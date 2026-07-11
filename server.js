import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(here, "public")));

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const SYSTEM_PROMPT = `You are a senior brand designer and art director at a creative agency. Your specialty is layout adaptation: a client shows you an inspiration creative (an ad, static post, carousel slide, poster) they found on Pinterest or elsewhere, and you recreate the same visual APPROACH — composition, grid, visual hierarchy, spacing rhythm, typographic scale, energy — but fully rebuilt in the client's own branding and about the client's own topic.

Rules for every recreation:
- Study the inspiration screenshot carefully: where is the headline, how large is it relative to the canvas, where do supporting text, imagery, badges, buttons, and logos sit, what is the margin/padding rhythm, is it centered or asymmetric, busy or minimal.
- REBUILD the structure. Never copy the inspiration's actual text, product names, photos, logos, or trademarks. All copy must be written fresh for the client's topic and brand voice.
- Apply the client's brand kit exactly: their colors (respect the plain-vs-gradient choice), their heading and body fonts, and their text style preferences (bold / italic / underline emphasis).
- Where the inspiration uses photography or illustration, create tasteful CSS/SVG graphics (shapes, gradients, patterns, simple inline SVG illustrations) that fit the topic — or a clearly marked placeholder area the designer can drop a photo into, styled so the composition still reads correctly.
- If the brand kit says a logo was provided, place an <img src="{{LOGO_SRC}}" alt="logo"> element (the application substitutes the real logo file into that exact token) sized and positioned the way the inspiration treats its logo/brand mark.
- Load fonts with a Google Fonts @import at the top of the <style> block when the requested fonts are Google Fonts; otherwise use the closest widely available fallback stack and say so in your analysis.

Output contract (strict):
- "html" must be ONE self-contained fragment: a single root <div class="artboard"> containing an inline <style> tag and the layout markup. No <html>, <head>, <body>, no external scripts, no external images (inline SVG and CSS art only, plus the optional {{LOGO_SRC}} token).
- Scope every CSS rule under .artboard so nothing leaks.
- The .artboard element must have fixed pixel dimensions equal to "width" x "height". Match the inspiration's aspect ratio unless the brief asks for a specific format (default social sizes: 1080x1080 square, 1080x1350 portrait, 1080x1920 story).
- Use absolute/flex/grid positioning so the result is pixel-stable — it will be exported as a PNG.
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
  },
  required: ["analysis", "width", "height", "html"],
  additionalProperties: false,
};

function brandBrief(brand, brief) {
  const lines = [
    `CLIENT BRAND KIT`,
    `- Brand name: ${brand.name || "(not given)"}`,
    `- Primary color: ${brand.primary}`,
    `- Secondary color: ${brand.secondary}`,
    `- Accent color: ${brand.accent}`,
    `- Color treatment: ${
      brand.gradient
        ? `gradient (blend the brand colors into smooth gradients where the inspiration uses large color fields)`
        : `plain, flat color fields`
    }`,
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
  ];
  if (brand.notes) lines.push(`- Extra brand notes: ${brand.notes}`);
  lines.push(
    ``,
    `THE POST / CONTENT BRIEF`,
    brief || "(no brief given — infer a sensible topic from the brand)",
    ``,
    `Recreate the attached inspiration screenshot's layout and visual approach for this brand and brief.`
  );
  return lines.join("\n");
}

app.post("/api/generate", async (req, res) => {
  const { image, brand, brief, history, refinement } = req.body || {};

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
          { type: "text", text: brandBrief(brand || {}, brief) },
        ],
      },
    ];
  }

  try {
    const stream = getClient().messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
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

    res.json({
      design,
      // Client stores these and sends them back for refinement rounds.
      // final.content is echoed verbatim so thinking blocks survive the round-trip.
      turns: [
        ...messages,
        { role: "assistant", content: final.content },
      ],
      usage: final.usage,
    });
  } catch (error) {
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
});

app.listen(PORT, () => {
  console.log(`BrandForge running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "⚠️  ANTHROPIC_API_KEY is not set. The dashboard will load, but generation will fail until you set it."
    );
  }
});
