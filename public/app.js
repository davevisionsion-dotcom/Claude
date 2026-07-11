/* BrandForge dashboard */

const $ = (id) => document.getElementById(id);

const state = {
  image: null,        // { media_type, data }  — the inspiration screenshot
  logoDataUrl: null,  // data: URL substituted into {{LOGO_SRC}}
  design: null,       // { analysis, width, height, html }
  turns: [],          // conversation history for refinement rounds
};

/* ---------- inspiration screenshot: paste / drop / browse ---------- */

function setImageFromFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    const [, media_type, data] = reader.result.match(/^data:(.+?);base64,(.*)$/);
    state.image = { media_type, data };
    const img = $("inspo-preview");
    img.src = reader.result;
    img.hidden = false;
  };
  reader.readAsDataURL(file);
}

document.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
  if (item) setImageFromFile(item.getAsFile());
});

const dropzone = $("dropzone");
dropzone.addEventListener("click", () => $("file-input").click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  setImageFromFile(e.dataTransfer.files[0]);
});
$("file-input").addEventListener("change", (e) => setImageFromFile(e.target.files[0]));

$("logo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) { state.logoDataUrl = null; return; }
  const reader = new FileReader();
  reader.onload = () => { state.logoDataUrl = reader.result; };
  reader.readAsDataURL(file);
});

/* ---------- generate & refine ---------- */

function collectBrand() {
  return {
    name: $("brand-name").value.trim(),
    primary: $("color-primary").value,
    secondary: $("color-secondary").value,
    accent: $("color-accent").value,
    gradient: document.querySelector('input[name="treatment"]:checked').value === "gradient",
    headingFont: $("font-heading").value.trim(),
    bodyFont: $("font-body").value.trim(),
    bold: $("style-bold").checked,
    italic: $("style-italic").checked,
    underline: $("style-underline").checked,
    hasLogo: Boolean(state.logoDataUrl),
    notes: $("brand-notes").value.trim(),
  };
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.classList.toggle("error", isError);
}

async function callApi(body, button) {
  button.disabled = true;
  $("generate-btn").disabled = true;
  setStatus("Designing… analyzing layout, rebuilding it on-brand. This can take a minute or two.");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    state.design = json.design;
    state.turns = json.turns;
    renderDesign();
    setStatus("");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    button.disabled = false;
    $("generate-btn").disabled = false;
  }
}

$("generate-btn").addEventListener("click", () => {
  if (!state.image) { setStatus("Paste or drop an inspiration screenshot first.", true); return; }
  callApi(
    { image: state.image, brand: collectBrand(), brief: $("brief").value.trim() },
    $("generate-btn")
  );
});

$("refine-btn").addEventListener("click", () => {
  const refinement = $("refine-input").value.trim();
  if (!refinement || !state.turns.length) return;
  callApi({ history: state.turns, refinement }, $("refine-btn"));
  $("refine-input").value = "";
});
$("refine-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("refine-btn").click();
});

/* ---------- rendering & export ---------- */

function artboardHtml() {
  let html = state.design.html;
  if (state.logoDataUrl) html = html.replaceAll("{{LOGO_SRC}}", state.logoDataUrl);
  return html;
}

function fullDocument() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style></head><body>${artboardHtml()}</body></html>`;
}

function renderDesign() {
  const { width, height, analysis } = state.design;
  const iframe = $("preview");
  $("preview-empty").style.display = "none";
  iframe.hidden = false;
  iframe.srcdoc = fullDocument();

  // Scale the fixed-size artboard down to fit the preview panel.
  const wrap = $("preview-wrap");
  const available = wrap.clientWidth - 24;
  const scale = Math.min(1, available / width);
  iframe.width = width;
  iframe.height = height;
  iframe.style.transformOrigin = "top left";
  iframe.style.transform = `scale(${scale})`;
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  wrap.style.height = `${Math.round(height * scale) + 24}px`;
  wrap.style.alignItems = "flex-start";
  wrap.style.padding = "12px";

  const note = $("analysis");
  note.textContent = analysis;
  note.hidden = false;
  $("result-actions").hidden = false;
  $("refine-box").hidden = false;
}

$("export-html").addEventListener("click", () => {
  const blob = new Blob([fullDocument()], { type: "text/html" });
  triggerDownload(URL.createObjectURL(blob), "creative.html");
});

$("export-png").addEventListener("click", async () => {
  const { width, height } = state.design;
  // Render the artboard off-screen at full size, wait for its fonts, then rasterize.
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;`;
  host.innerHTML = artboardHtml();
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 400)); // give @import fonts a beat to apply
    const canvas = await html2canvas(host.firstElementChild, {
      width, height, scale: 1, backgroundColor: null, useCORS: true,
    });
    triggerDownload(canvas.toDataURL("image/png"), "creative.png");
  } catch (err) {
    setStatus(`PNG export failed: ${err.message}. Use "Download HTML" and screenshot it instead.`, true);
  } finally {
    host.remove();
  }
});

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
