# BrandForge

An AI creative studio for social media managers. Screenshot any creative you find inspiring — a Pinterest ad, a static post, a carousel slide — paste it into the dashboard, fill in your client's brand kit, and BrandForge recreates the **same layout and visual approach** rebuilt entirely in your client's branding and topic.

Powered by Claude's vision: it studies the inspiration's composition, hierarchy, spacing, and typographic scale, then generates a pixel-fixed artboard using your brand's colors (plain or gradient), fonts, text styles, and logo.

## Features

- **Paste-to-import** — Ctrl/Cmd+V a screenshot straight into the dashboard (drag & drop and file browse also work)
- **Brand kit** — brand name, three brand colors, plain vs. gradient treatment, heading + body fonts (Google Fonts supported), bold/italic/underline emphasis preferences, logo upload, free-form brand notes
- **Content brief** — tell it what the post is about; all copy is written fresh for your topic (nothing is copied from the inspiration)
- **Adaptive imagery** — where the inspiration used photos, it generates CSS/SVG art that fits your topic, or a styled placeholder you can drop a photo into
- **Refinement loop** — "make the headline bigger", "move the logo top-right", "try the gradient diagonal" — it keeps the design context and applies your changes
- **Export** — download the result as PNG or as a standalone HTML file

## Setup

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # get one at https://platform.claude.com
npm start
```

Open http://localhost:3000.

## How it works

1. The frontend sends your screenshot (base64), brand kit, and brief to `POST /api/generate`.
2. The server calls Claude (`claude-opus-4-8`) with vision + structured outputs, asking for a JSON design: `{ analysis, width, height, html }`. The HTML is one self-contained `<div class="artboard">` with scoped inline CSS at fixed pixel dimensions.
3. The dashboard renders it in a sandboxed iframe, scaled to fit. Your uploaded logo is substituted into the `{{LOGO_SRC}}` token client-side, so the logo file never leaves your browser.
4. Refinements re-send the conversation so the model keeps full design context.
5. PNG export rasterizes the artboard in-browser with html2canvas.

## Notes

- Default canvas sizes follow the inspiration's aspect ratio (1080×1080 square, 1080×1350 portrait, 1080×1920 story), or ask for a specific format in the brief.
- The model is instructed to **never copy** the inspiration's text, product names, photos, or trademarks — it rebuilds the structure, not the content.
- Generation typically takes 30–120 seconds depending on layout complexity.
