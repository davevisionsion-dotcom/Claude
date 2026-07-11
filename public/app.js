/* BrandForge dashboard */

const $ = (id) => document.getElementById(id);

const state = {
  image: null,           // { media_type, data }  — the inspiration screenshot
  logoDataUrl: null,     // data: URL substituted into {{LOGO_SRC}}
  userPhotoDataUrl: null, // data: URL substituted into {{USER_PHOTO}}
  design: null,       // { analysis, width, height, html, photos }
  photoUrls: {},      // {{PHOTO_n}} token -> stock photo URL
  turns: [],          // design conversation history for refinement rounds
  chatTurns: [],      // assistant conversation history
  chatSummary: null,  // confirmed plan from the assistant, passed to generation
};

/* ---------- conditional form controls ---------- */

function updateColorControls() {
  const gradient = document.querySelector('input[name="treatment"]:checked').value === "gradient";
  $("gradient-colors").hidden = !gradient;
  const mode = $("bg-mode").value;
  $("bg-colors").hidden = !(mode === "solid" || mode === "gradient");
  $("bg-color2-label").hidden = mode !== "gradient";
  $("bg-text-label").hidden = mode !== "describe";
}
document.querySelectorAll('input[name="treatment"]').forEach((r) =>
  r.addEventListener("change", updateColorControls)
);
document.getElementById("bg-mode").addEventListener("change", updateColorControls);
updateColorControls();

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

$("photo-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) { state.userPhotoDataUrl = null; return; }
  const reader = new FileReader();
  reader.onload = () => { state.userPhotoDataUrl = reader.result; };
  reader.readAsDataURL(file);
});

/* ---------- form <-> state ---------- */

function collectBrand() {
  return {
    name: $("brand-name").value.trim(),
    primary: $("color-primary").value,
    secondary: $("color-secondary").value,
    accent: $("color-accent").value,
    gradient: document.querySelector('input[name="treatment"]:checked').value === "gradient",
    gradientFrom: $("gradient-from").value,
    gradientTo: $("gradient-to").value,
    fidelity: document.querySelector('input[name="fidelity"]:checked').value,
    background: {
      mode: $("bg-mode").value,
      color1: $("bg-color1").value,
      color2: $("bg-color2").value,
      text: $("bg-text").value.trim(),
    },
    headingFont: $("font-heading").value.trim(),
    bodyFont: $("font-body").value.trim(),
    bold: $("style-bold").checked,
    italic: $("style-italic").checked,
    underline: $("style-underline").checked,
    hasLogo: Boolean(state.logoDataUrl),
    hasUserPhoto: Boolean(state.userPhotoDataUrl),
    notes: $("brand-notes").value.trim(),
    instructions: $("instructions").value.trim(),
  };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function normalizeHex(v) {
  if (typeof v !== "string") return null;
  let h = v.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  return HEX_RE.test(h) ? h.toLowerCase() : null;
}

function applyUpdates(updates) {
  if (!updates) return [];
  const applied = [];
  const setText = (id, val, label) => {
    if (typeof val === "string") { $(id).value = val; flash(id); applied.push(label); }
  };
  const setColor = (id, val, label) => {
    const hex = normalizeHex(val);
    if (hex) { $(id).value = hex; flash(id); applied.push(label); }
  };
  const setCheck = (id, val, label) => {
    if (typeof val === "boolean") { $(id).checked = val; flash(id); applied.push(label); }
  };

  setText("brand-name", updates.name, "brand name");
  setColor("color-primary", updates.primary, "primary color");
  setColor("color-secondary", updates.secondary, "secondary color");
  setColor("color-accent", updates.accent, "accent color");
  if (typeof updates.gradient === "boolean") {
    document.querySelector(`input[name="treatment"][value="${updates.gradient ? "gradient" : "plain"}"]`).checked = true;
    applied.push(updates.gradient ? "gradient treatment" : "plain colors");
  }
  if (typeof updates.background === "string") {
    $("bg-mode").value = "describe";
    $("bg-text").value = updates.background;
    updateColorControls();
    flash("bg-text");
    applied.push("background");
  }
  setText("font-heading", updates.headingFont, "heading font");
  setText("font-body", updates.bodyFont, "body font");
  setCheck("style-bold", updates.bold, "bold");
  setCheck("style-italic", updates.italic, "italic");
  setCheck("style-underline", updates.underline, "underline");
  setText("brand-notes", updates.notes, "brand notes");
  setText("instructions", updates.instructions, "instructions");
  setText("brief", updates.brief, "brief");
  return applied;
}

function flash(id) {
  const el = $(id);
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 1600);
}

/* ---------- assistant chat ---------- */

function addChatMessage(text, who) {
  const div = document.createElement("div");
  div.className = `msg ${who}-msg`;
  div.textContent = text;
  $("chat-log").appendChild(div);
  $("chat-log").scrollTop = $("chat-log").scrollHeight;
  return div;
}

async function sendToAssistant(userMessage) {
  addChatMessage(userMessage, "user");
  const thinking = addChatMessage("…", "assistant");
  $("chat-send").disabled = true;
  $("research-btn").disabled = true;
  try {
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history: state.chatTurns,
        userMessage,
        form: collectBrand(),
        imageAttached: Boolean(state.image),
        image: state.chatTurns.length === 0 ? state.image : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Assistant request failed (${res.status})`);

    state.chatTurns = json.turns;
    const applied = applyUpdates(json.updates);
    thinking.textContent = json.reply || "(no reply)";
    if (applied.length) {
      const note = document.createElement("div");
      note.className = "msg applied-msg";
      note.textContent = `✓ Updated in the form: ${applied.join(", ")}`;
      $("chat-log").appendChild(note);
    }
    if (json.status === "ready") {
      state.chatSummary = json.summary || json.reply;
      $("ready-banner").hidden = false;
      $("generate-btn").classList.add("pulse");
    }
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
  } catch (err) {
    thinking.textContent = `⚠ ${err.message}`;
    thinking.classList.add("error-msg");
  } finally {
    $("chat-send").disabled = false;
    $("research-btn").disabled = false;
  }
}

$("research-btn").addEventListener("click", () => {
  const name = $("brand-name").value.trim();
  if (!name) {
    addChatMessage("Type the brand / company name first, then I can research it.", "assistant");
    return;
  }
  sendToAssistant(
    `Please research the company "${name}" online. Tell me what you find, confirm with me that it's the right company, and suggest brand colors, fonts, and notes that match their real branding.`
  );
});

$("chat-send").addEventListener("click", () => {
  const text = $("chat-text").value.trim();
  if (!text) return;
  $("chat-text").value = "";
  sendToAssistant(text);
});
$("chat-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("chat-send").click();
});

/* ---------- generate & refine ---------- */

function setStatus(msg, isError = false) {
  const el = $("status");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.classList.toggle("error", isError);
}

async function callGenerate(body, button) {
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
    state.photoUrls = json.photoUrls || {};
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
  $("generate-btn").classList.remove("pulse");
  callGenerate(
    {
      image: state.image,
      brand: collectBrand(),
      brief: $("brief").value.trim(),
      chatContext: state.chatSummary,
    },
    $("generate-btn")
  );
});

$("refine-btn").addEventListener("click", () => {
  const refinement = $("refine-input").value.trim();
  if (!refinement || !state.turns.length) return;
  callGenerate({ history: state.turns, refinement }, $("refine-btn"));
  $("refine-input").value = "";
});
$("refine-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("refine-btn").click();
});

/* ---------- rendering & export ---------- */

const PHOTO_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'>" +
      "<rect width='100%' height='100%' fill='#d7dbe4'/>" +
      "<text x='50%' y='50%' font-family='sans-serif' font-size='30' fill='#747b8c' text-anchor='middle'>drop your photo here</text>" +
      "</svg>"
  );

function artboardHtml() {
  let html = state.design.html;
  if (state.logoDataUrl) html = html.replaceAll("{{LOGO_SRC}}", state.logoDataUrl);
  if (state.userPhotoDataUrl) html = html.replaceAll("{{USER_PHOTO}}", state.userPhotoDataUrl);
  html = html.replace(/\{\{PHOTO_\d+\}\}/g, (token) => state.photoUrls[token] || PHOTO_FALLBACK);
  html = html.replaceAll("{{USER_PHOTO}}", PHOTO_FALLBACK);
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
  $("canva-hint").hidden = false;
  $("refine-box").hidden = false;
}

async function rasterize() {
  const { width, height } = state.design;
  // Render the artboard off-screen at full size, wait for its fonts, then rasterize.
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;`;
  host.innerHTML = artboardHtml();
  document.body.appendChild(host);
  try {
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 400)); // give @import fonts a beat to apply
    return await html2canvas(host.firstElementChild, {
      width, height, scale: 1, backgroundColor: "#ffffff", useCORS: true,
    });
  } finally {
    host.remove();
  }
}

$("export-png").addEventListener("click", async () => {
  try {
    const canvas = await rasterize();
    triggerDownload(canvas.toDataURL("image/png"), "creative.png");
  } catch (err) {
    setStatus(`PNG export failed: ${err.message}. Use "HTML" and screenshot it instead.`, true);
  }
});

$("export-jpeg").addEventListener("click", async () => {
  try {
    const canvas = await rasterize();
    triggerDownload(canvas.toDataURL("image/jpeg", 0.92), "creative.jpg");
  } catch (err) {
    setStatus(`JPEG export failed: ${err.message}. Use "HTML" and screenshot it instead.`, true);
  }
});

$("export-html").addEventListener("click", () => {
  const blob = new Blob([fullDocument()], { type: "text/html" });
  triggerDownload(URL.createObjectURL(blob), "creative.html");
});

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
