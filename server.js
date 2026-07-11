import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));

// Load settings from config.txt or .env so non-technical users can just
// edit a text file instead of setting environment variables. Real
// environment variables still win.
for (const filename of ["config.txt", ".env"]) {
  try {
    for (const line of fs.readFileSync(path.join(here, filename), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m && m[2] && !m[2].startsWith("paste-") && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim();
      }
    }
  } catch {
    // file not present — fine
  }
}

const PORT = process.env.PORT || 3000;
const MODEL = "claude-opus-4-8";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(here, "public")));

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

/* ================================================================
   DESIGN GENERATION
   ================================================================ */

const DESIGN_SYSTEM_PROMPT = `You are a senior brand designer and art director at a creative agency. Your specialty is layout adaptation: a client shows you an inspiration creative (an ad, static post, carousel slide, poster) they found on Pinterest or elsewhere, and you recreate the same visual APPROACH — composition, grid, visual hierarchy, spacing rhythm, typographic scale, energy — but fully rebuilt in the client's own branding and about the client's own topic.

Rules for every recreation:
- Study the inspiration screenshot carefully: where is the headline, how large is it relative to the canvas, where do supporting text, imagery, badges, buttons, and logos sit, what is the margin/padding rhythm, is it centered or asymmetric, busy or minimal.
- REBUILD the structure. Never copy the inspiration's actual text, product names, photos, logos, or trademarks. All copy must be written fresh for the client's topic and brand voice.
- Honor the requested LAYOUT FIDELITY level:
  * strict — reproduce the inspiration's composition element-for-element: same placement, same relative sizes, same background mood (dark stays dark), same alignment and density. Only the branding, copy, and imagery content change.
  * balanced (default) — keep the inspiration's overall structure and hierarchy, but adapt freely where the brand kit calls for it.
  * free — take only the mood and energy of the inspiration; design the layout freely.
- Apply the client's brand kit exactly: their colors (respect the plain-vs-gradient choice), their background preference, their heading and body fonts, and their text style preferences (bold / italic / underline emphasis).
- Follow the client's additional instructions to the letter. If an instruction conflicts with the inspiration's layout, the instruction wins for that specific point — but preserve every aspect of the inspiration's composition the instructions do NOT explicitly change. Never let a small instruction justify redesigning the whole layout.
- Where the inspiration uses photography, adapt the SUBJECT to the client's topic (a laptop in the inspiration becomes a leadership-related photo when the post is about leadership). Keep the photo's size, position, crop, and any overlay/duotone/shadow treatment identical to the inspiration. Image source priority:
  1. If the brief says the CLIENT PROVIDED A PHOTO: place <img src="{{USER_PHOTO}}" alt="..."> with object-fit: cover in the main image slot, sized and positioned like the inspiration's image. Match the inspiration's visual treatment as closely as CSS allows — crop, rounded corners/masking, duotone or color-wash overlays (a positioned pseudo-element or overlay div with mix-blend-mode), grayscale/contrast/saturation filters, borders, shadows.
  2. Otherwise, if stock photos are ENABLED: place <img src="{{PHOTO_1}}" alt="..."> (then {{PHOTO_2}}, ...) with object-fit: cover, and list every token in "photos" with a 2-5 word stock-photo search query matching the CLIENT'S TOPIC. Also apply the inspiration's visual treatment via CSS as above.
  3. Otherwise: create a tasteful CSS/SVG illustration of the topic, or a clearly marked placeholder region the designer can drop a photo into, styled so the composition still reads correctly. Never emit {{PHOTO_n}} tokens when stock photos are disabled.
- Where the inspiration uses illustration or abstract graphics, recreate the same kind of graphic with inline CSS/SVG in the brand colors.
- If the brand kit says a logo was provided, place an <img src="{{LOGO_SRC}}" alt="logo"> element (the application substitutes the real logo file into that exact token) sized and positioned the way the inspiration treats its logo/brand mark.
- Load fonts with a Google Fonts @import at the top of the <style> block when the requested fonts are Google Fonts; otherwise use the closest widely available fallback stack and say so in your analysis.

Output contract (strict):
- "html" must be ONE self-contained fragment: a single root <div class="artboard"> containing an inline <style> tag and the layout markup. No <html>, <head>, <body>, no external scripts, no external images (inline SVG and CSS art only, plus the optional {{LOGO_SRC}} token).
- Scope every CSS rule under .artboard so nothing leaks.
- The .artboard element must have fixed pixel dimensions equal to "width" x "height". Match the inspiration's aspect ratio unless the brief asks for a specific format (default social sizes: 1080x1080 square, 1080x1350 portrait, 1080x1920 story).
- Use absolute/flex/grid positioning so the result is pixel-stable — it will be exported as a PNG/JPEG.
- "analysis" is a short note to the designer: what you observed in the inspiration (composition, hierarchy, mood) and the key choices you made adapting it to the brand. Keep it under 150 words.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    analysis: {
      type: "string",
      description:
        "Short designer's note: what the inspiration's layout does and how it was adapted to the brand.",
    },
    width: { type: "integer", description: "Artboard width in pixels." },
    height: { type: "integer", description: "Artboard height in pixels." },
    html: {
      type: "string",
      description:
        "Self-contained HTML fragment: one <div class=\"artboard\"> with an inline <style> tag, fixed pixel size, all CSS scoped under .artboard.",
    },
    photos: {
      type: "array",
      description:
        "One entry per {{PHOTO_n}} token used in the html. Empty array when stock photos are disabled or the design uses none.",
      items: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "The exact token used in the html, e.g. {{PHOTO_1}}",
          },
          query: {
            type: "string",
            description: "2-5 word stock-photo search query matching the client's topic",
          },
        },
        required: ["token", "query"],
        additionalProperties: false,
      },
    },
  },
  required: ["analysis", "width", "height", "html", "photos"],
  additionalProperties: false,
};

function backgroundLine(bg) {
  if (!bg) return "same as the inspiration's background — match its color and mood exactly";
  if (typeof bg === "string") return bg;
  switch (bg.mode) {
    case "solid":
      return `solid ${bg.color1}`;
    case "gradient":
      return `gradient from ${bg.color1} to ${bg.color2}`;
    case "describe":
      return bg.text || "designer's choice, guided by the inspiration";
    default:
      return "same as the inspiration's background — match its color and mood exactly";
  }
}

function brandBrief(brand, brief, chatContext, photosEnabled) {
  const fidelity = ["strict", "balanced", "free"].includes(brand.fidelity)
    ? brand.fidelity
    : "balanced";
  const lines = [
    `LAYOUT FIDELITY: ${fidelity}`,
    `STOCK PHOTOS: ${
      photosEnabled
        ? "ENABLED — use {{PHOTO_n}} tokens and fill the photos array with topic-matched search queries"
        : "DISABLED — use CSS/SVG illustration or a styled placeholder; no {{PHOTO_n}} tokens"
    }`,
    ``,
    `CLIENT BRAND KIT`,
    `- Brand name: ${brand.name || "(not given)"}`,
    `- Primary color: ${brand.primary}`,
    `- Secondary color: ${brand.secondary}`,
    `- Accent color: ${brand.accent}`,
    `- Color treatment: ${
      brand.gradient
        ? `gradient, blending from ${brand.gradientFrom || brand.primary} to ${
            brand.gradientTo || brand.secondary
          } where the inspiration uses large color fields`
        : `plain, flat color fields`
    }`,
    `- Background: ${backgroundLine(brand.background)}`,
    `- Heading font: ${brand.headingFont || "designer's choice"}`,
    `- Body font: ${brand.bodyFont || "designer's choice"}`,
    `- Text emphasis styles to favor: ${
      [
        brand.bold && "bold",
        brand.italic && "italic",
        brand.underline && "underline",
      ]
        .filter(Boolean)
        .join(", ") || "none specified"
    }`,
    `- Logo: ${
      brand.hasLogo
        ? "provided — place it using the {{LOGO_SRC}} token"
        : "none provided — use the brand name as a typographic mark if the layout calls for one"
    }`,
    `- Client photo for the design: ${
      brand.hasUserPhoto
        ? "PROVIDED — place it with the {{USER_PHOTO}} token in the main image slot, styled like the inspiration's image"
        : "none — source imagery per the stock-photo setting above"
    }`,
  ];
  if (brand.notes) lines.push(`- Brand description / notes: ${brand.notes}`);
  if (brand.instructions)
    lines.push(``, `ADDITIONAL INSTRUCTIONS (must follow):`, brand.instructions);
  lines.push(
    ``,
    `THE POST / CONTENT BRIEF`,
    brief || "(no brief given — infer a sensible topic from the brand)"
  );
  if (chatContext) {
    lines.push(
      ``,
      `DECISIONS CONFIRMED WITH THE CLIENT (from the planning conversation — honor these):`,
      chatContext
    );
  }
  lines.push(
    ``,
    `Recreate the attached inspiration screenshot's layout and visual approach for this brand and brief.`
  );
  return lines.join("\n");
}

app.post("/api/generate", async (req, res) => {
  const { image, brand, brief, chatContext, history, refinement } = req.body || {};

  let messages;
  if (Array.isArray(history) && history.length > 0 && refinement) {
    // Follow-up round: prior turns (with the model's thinking blocks intact) + the new instruction.
    messages = [
      ...history,
      {
        role: "user",
        content: `Refinement request from the designer: ${refinement}\n\nApply it and return the full updated design in the same JSON format.`,
      },
    ];
  } else {
    if (!image?.data || !image?.media_type) {
      return res.status(400).json({ error: "An inspiration screenshot is required." });
    }
    messages = [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.media_type,
              data: image.data,
            },
          },
          {
            type: "text",
            text: brandBrief(brand || {}, brief, chatContext, Boolean(process.env.PEXELS_API_KEY)),
          },
        ],
      },
    ];
  }

  try {
    const stream = getClient().messages.stream({
      model: MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: DESIGN_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages,
    });

    const final = await stream.finalMessage();

    if (final.stop_reason === "refusal") {
      return res.status(422).json({
        error: "The model declined this request. Try a different inspiration image or brief.",
      });
    }
    if (final.stop_reason === "max_tokens") {
      return res.status(422).json({
        error: "The design was too large to finish. Try a simpler inspiration or shorter brief.",
      });
    }

    const text = final.content.find((b) => b.type === "text")?.text ?? "";
    const design = JSON.parse(text);
    const photoUrls = await resolvePhotos(design.photos);

    res.json({
      design,
      photoUrls,
      // Client stores these and sends them back for refinement rounds.
      // final.content is echoed verbatim so thinking blocks survive the round-trip.
      turns: [...messages, { role: "assistant", content: final.content }],
      usage: final.usage,
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/**
 * Turn the design's photo requests into real stock-photo URLs via Pexels.
 * Requires PEXELS_API_KEY (free at https://www.pexels.com/api/). Without it,
 * the design was already generated with placeholders instead of tokens.
 */
async function resolvePhotos(photos) {
  const key = process.env.PEXELS_API_KEY;
  const map = {};
  if (!key || !Array.isArray(photos)) return map;
  for (const p of photos) {
    if (!p?.token || !p?.query) continue;
    try {
      const r = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(p.query)}&per_page=1`,
        { headers: { Authorization: key } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const url = j.photos?.[0]?.src?.large2x || j.photos?.[0]?.src?.large;
      if (url) map[p.token] = url;
    } catch {
      // leave unresolved — the frontend substitutes a placeholder
    }
  }
  return map;
}

/* ================================================================
   BRAND ASSISTANT (chat + web research)
   ================================================================ */

const ASSISTANT_SYSTEM_PROMPT = `You are the brand assistant inside BrandForge, a tool where a social media manager pastes an inspiration screenshot and generates an on-brand creative for a client. You are conversational, concise, and proactive — a sharp account manager who does research and asks the right questions before the designer starts.

Each user turn includes a snapshot of the current form (brand kit, brief, background preference, extra instructions) and whether an inspiration screenshot is attached.

Your jobs:
0. INTAKE: when the user pastes a raw task or idea (from an Asana card, a ChatGPT/Claude conversation, a client email — any source), restate the assignment in your own words in 1-2 plain sentences ("So this post is about X for Y, and it should say Z — right?") and ask them to confirm. Only after they confirm, fill the form fields — "brief" gets the topic and the exact copy to use, nothing about design.

THE FIVE THINGS — every plan needs exactly these five items confirmed, nothing more:
  1. client — which brand/company this is for
  2. topic — what the post is about, one sentence
  3. copy — the exact wording (headline/subline/CTA), OR the user's okay for you to write it
  4. format — square (1080x1080), portrait (1080x1350), or story (1080x1920)
  5. musts — anything that MUST appear (logo, tagline, contact info, promo code); "nothing special" counts as confirmed
Work through whichever are missing, up to 3 questions per turn. Design decisions (colors, layout, illustration style) are NOT on this list — the inspiration screenshot and brand kit own those; actively discourage the user from adding design directions.
1. RESEARCH: when asked to research a company (or when a brand name is given and unconfirmed), use web search to find it. Report what you found in one short paragraph — what the company does, where it is, its visual identity if discoverable (brand colors as hex when you can find or closely estimate them, fonts or font styles they use, tone of voice). Then ASK the user to confirm it's the right company before treating anything as settled. If several companies share the name, list the candidates and ask which one.
2. ADJUST: propose concrete brand-kit values through the "updates" object — hex colors, font names (prefer Google Fonts equivalents of the brand's real typefaces), gradient vs plain, background, and a short brand description in "notes". Only include fields you want to change. The app applies them to the form instantly, so tell the user in your reply what you filled in.
3. CLARIFY: ask smart, specific questions about the creative — the offer/topic, the format (square/portrait/story), the call to action, anything ambiguous. Ask at most 2-3 questions per turn. Never re-ask what the user already answered.
4. CONFIRM & HAND OFF: when the company is confirmed, the brief is clear, and you have no open questions, set "status" to "ready", give a 2-4 sentence recap of exactly what will be generated ("summary" field), and tell the user to hit Generate.

Response contract (strict): respond ONLY with a single JSON object, no other text, in this shape:
{
  "reply": "your conversational message to the user (plain text, short paragraphs, may contain questions)",
  "status": "asking" | "ready",
  "updates": { ...only the form fields to change... } | null,
  "summary": "only when status is ready: the confirmed plan the designer should follow" | null,
  "checklist": { "client": boolean, "topic": boolean, "copy": boolean, "format": boolean, "musts": boolean }
}

"checklist" reports which of THE FIVE THINGS are confirmed so far — set an item true only once the user has confirmed it (or it was unambiguous in their input). Status can only be "ready" when all five are true.

Allowed keys in "updates": name (string), primary (hex), secondary (hex), accent (hex), gradient (boolean), background (string), headingFont (string), bodyFont (string), bold (boolean), italic (boolean), underline (boolean), notes (string), instructions (string), brief (string).

Never invent confirmation — status stays "asking" until the USER has explicitly confirmed the company identity (or said to skip research) and answered your key questions.

Field-writing rules: keep "brief" to the topic, the copy/text to use, and the format — no design directions. Keep "instructions" to at most 1-2 short sentences, and only for changes the user explicitly asked for. Never write art-direction specs (layout, illustration style, what to remove) into these fields — the inspiration screenshot defines the design, and long instructions override it.`;

function extractJson(blocks) {
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Assistant returned no JSON.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

app.post("/api/assistant", async (req, res) => {
  const { history, userMessage, form, imageAttached, image } = req.body || {};
  if (!userMessage) {
    return res.status(400).json({ error: "A message is required." });
  }

  const contextNote = `\n\n---\n[Current form snapshot: ${JSON.stringify(
    form || {}
  )}. Inspiration screenshot attached: ${imageAttached ? "yes" : "no"}.]`;

  const userContent = [];
  // Include the inspiration image on the first turn so the assistant can discuss it.
  if (image?.data && image?.media_type && !(Array.isArray(history) && history.length)) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: image.media_type, data: image.data },
    });
  }
  userContent.push({ type: "text", text: userMessage + contextNote });

  let messages = [...(Array.isArray(history) ? history : []), { role: "user", content: userContent }];

  try {
    const anthropic = getClient();
    let final;
    // Web search runs server-side; long research turns can pause — resume until done.
    for (let attempt = 0; attempt < 6; attempt++) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: ASSISTANT_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
        messages,
      });
      final = await stream.finalMessage();
      if (final.stop_reason !== "pause_turn") break;
      messages = [...messages, { role: "assistant", content: final.content }];
    }

    if (final.stop_reason === "refusal") {
      return res.status(422).json({ error: "The assistant declined that request." });
    }

    const parsed = extractJson(final.content);

    res.json({
      reply: parsed.reply ?? "",
      status: parsed.status === "ready" ? "ready" : "asking",
      updates: parsed.updates && typeof parsed.updates === "object" ? parsed.updates : null,
      summary: typeof parsed.summary === "string" ? parsed.summary : null,
      checklist: parsed.checklist && typeof parsed.checklist === "object" ? parsed.checklist : null,
      turns: [...messages, { role: "assistant", content: final.content }],
    });
  } catch (error) {
    handleApiError(error, res);
  }
});

/* ================================================================
   ASANA TASK FETCH (optional — needs ASANA_TOKEN in config.txt)
   ================================================================ */

app.post("/api/asana-task", async (req, res) => {
  const { url } = req.body || {};
  const token = process.env.ASANA_TOKEN;
  if (!token) {
    return res.status(400).json({
      error:
        "No ASANA_TOKEN set. Add one to config.txt (create it at app.asana.com/0/developer-console) — or just copy-paste the card's text instead of the link.",
    });
  }
  try {
    const segments = new URL(url).pathname.split("/").filter((s) => /^\d{6,}$/.test(s));
    const gid = segments[segments.length - 1];
    if (!gid) {
      return res.status(400).json({ error: "That doesn't look like an Asana task link." });
    }
    const r = await fetch(
      `https://app.asana.com/api/1.0/tasks/${gid}?opt_fields=name,notes`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) {
      return res.status(400).json({
        error: `Asana rejected the request (${r.status}). Check the link and your ASANA_TOKEN.`,
      });
    }
    const j = await r.json();
    res.json({ name: j.data?.name || "", notes: j.data?.notes || "" });
  } catch {
    res.status(400).json({ error: "Could not read that Asana link." });
  }
});

/* ================================================================ */

function handleApiError(error, res) {
  if (error instanceof Anthropic.AuthenticationError) {
    return res.status(401).json({
      error: "Invalid or missing ANTHROPIC_API_KEY. Set it in your environment and restart the server.",
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: "Rate limited by the API. Wait a moment and try again." });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return res.status(400).json({ error: `The API rejected the request: ${error.message}` });
  }
  if (error instanceof Anthropic.APIError) {
    return res.status(502).json({ error: `API error (${error.status}): ${error.message}` });
  }
  if (error instanceof Anthropic.AnthropicError) {
    // Client-side SDK error (no request was made) — almost always missing credentials.
    return res.status(401).json({
      error:
        "No API credentials found. Set ANTHROPIC_API_KEY in your environment (see .env.example) and restart the server.",
    });
  }
  console.error(error);
  res.status(500).json({ error: "Unexpected server error. Check the server logs." });
}

app.listen(PORT, () => {
  console.log(`BrandForge running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "⚠️  ANTHROPIC_API_KEY is not set. The dashboard will load, but generation will fail until you set it."
    );
  }
});
