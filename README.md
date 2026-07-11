# BrandForge

An AI creative studio for social media managers. Screenshot any creative you find inspiring — a Pinterest ad, a static post, a carousel slide — paste it into the dashboard, fill in your client's brand kit, and BrandForge recreates the **same layout and visual approach** rebuilt entirely in your client's branding and topic.

Powered by Claude's vision: it studies the inspiration's composition, hierarchy, spacing, and typographic scale, then generates a pixel-fixed artboard using your brand's colors (plain or gradient), fonts, text styles, and logo.

## Features

- **Paste-to-import** — Ctrl/Cmd+V a screenshot straight into the dashboard (drag & drop and file browse also work)
- **Brand research assistant** — type the client's company name and hit *Research this brand online*: the assistant searches the web, reports what it found, asks you to confirm it's the right company, then auto-fills the brand kit (colors as hex, fonts, tone notes) to match the company's real branding. It's a full chat — answer its questions, correct it, ask it anything
- **Confirm-before-generate flow** — the assistant asks the clarifying questions a designer would (format, offer, CTA…) and only marks the plan "ready" once you've confirmed; the confirmed plan is passed to the generator so it honors your decisions
- **Brand kit** — brand name, a Canva-style brand color palette (add as many colors as the brand has; the AI decides each color's role, guided by the inspiration), free-text color notes ("use the red as a gradient"), background preference, heading + body fonts (leave empty to match the inspiration's typography), bold/italic/underline emphasis preferences, logo upload, brand description/notes
- **Multiple versions** — generate 1–3 variants per run, each applying the palette differently; switch between them with tabs and export the one you like
- **Content brief + additional instructions** — tell it what the post is about and give standing instructions the AI must follow ("always include the tagline…", "CTA bottom center")
- **Adaptive imagery** — where the inspiration used photos, it generates CSS/SVG art that fits your topic, or a styled placeholder you can drop a photo into
- **Refinement loop** — "make the headline bigger", "move the logo top-right", "try the gradient diagonal" — it keeps the design context and applies your changes
- **Export** — download the result as PNG, JPEG, or a standalone HTML file. For Canva: drag the exported PNG/JPEG into a Canva design (native editable-Canva export via the Canva Connect API is a planned follow-up)

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # get one at https://platform.claude.com
npm start
```

Open http://localhost:3000.

## How it works

1. **Assistant** (`POST /api/assistant`): a chat with Claude (`claude-opus-4-8`) armed with the web-search server tool. It researches the company, proposes brand-kit values through a structured `updates` object the dashboard applies to the form live, asks clarifying questions, and flips to `status: "ready"` with a confirmed plan summary once you've signed off.
2. **Generation** (`POST /api/generate`): the frontend sends your screenshot (base64), brand kit, brief, and the assistant's confirmed plan. The server calls Claude with vision + structured outputs, asking for a JSON design: `{ analysis, width, height, html }` — one self-contained `<div class="artboard">` with scoped inline CSS at fixed pixel dimensions.
3. The dashboard renders it in a sandboxed iframe, scaled to fit. Your uploaded logo is substituted into the `{{LOGO_SRC}}` token client-side, so the logo file never leaves your browser.
4. Refinements re-send the conversation so the model keeps full design context.
5. PNG/JPEG export rasterizes the artboard in-browser with html2canvas.

## Notes

- Default canvas sizes follow the inspiration's aspect ratio (1080×1080 square, 1080×1350 portrait, 1080×1920 story), or ask for a specific format in the brief.
- The model is instructed to **never copy** the inspiration's text, product names, photos, or trademarks — it rebuilds the structure, not the content.
- Generation typically takes 30–120 seconds depending on layout complexity.
