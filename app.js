const PRESETS = [
  { id: "linkedin-landscape", platform: "LinkedIn", label: "LinkedIn landscape", width: 1200, height: 627 },
  { id: "linkedin-square", platform: "LinkedIn", label: "LinkedIn square", width: 1200, height: 1200 },
  { id: "facebook-landscape", platform: "Facebook", label: "Facebook landscape", width: 1200, height: 630 },
  { id: "facebook-square", platform: "Facebook", label: "Facebook square", width: 1080, height: 1080 },
  { id: "google-business-square", platform: "Google Business Profile", label: "Google Business square", width: 1200, height: 1200 },
  { id: "instagram-square", platform: "Instagram", label: "Instagram square", width: 1080, height: 1080 },
  { id: "instagram-portrait", platform: "Instagram", label: "Instagram portrait", width: 1080, height: 1350 }
];

const state = {
  sourceDataUrl: null,
  sourceImage: null,
  sourceWidth: 0,
  sourceHeight: 0,
  sourceName: "social-post",
  target: PRESETS[0],
  plan: null,
  elements: [],
  selectedId: null,
  busy: false,
  cleanup: true,
  drag: null
};

const $ = (id) => document.getElementById(id);
const canvas = $("editorCanvas");
const ctx = canvas.getContext("2d");

init();

function init() {
  populatePresets();
  bindUpload();
  bindActions();
  bindInspector();
  bindCanvas();
  updateTargetCard();
}

function populatePresets() {
  $("targetSelect").innerHTML = PRESETS.map(
    (preset) => `<option value="${preset.id}">${preset.label} — ${preset.width} × ${preset.height}</option>`
  ).join("");
}

function bindUpload() {
  $("uploadZone").addEventListener("click", () => $("imageInput").click());
  $("imageInput").addEventListener("change", (event) => handleUpload(event.target.files?.[0]));

  for (const type of ["dragenter", "dragover"]) {
    $("uploadZone").addEventListener(type, (event) => {
      event.preventDefault();
      $("uploadZone").classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    $("uploadZone").addEventListener(type, (event) => {
      event.preventDefault();
      $("uploadZone").classList.remove("dragging");
    });
  }
  $("uploadZone").addEventListener("drop", (event) => handleUpload(event.dataTransfer.files?.[0]));
}

async function handleUpload(file) {
  clearMessages();
  if (!file) return;
  if (!file.type.startsWith("image/")) return showError("setup", "Please upload a PNG, JPG, or WebP image.");
  if (file.size > 12 * 1024 * 1024) return showError("setup", "Use an image smaller than 12 MB.");

  try {
    const dataUrl = await fileToDataUrl(file);
    const image = await loadImage(dataUrl);
    state.sourceDataUrl = dataUrl;
    state.sourceImage = image;
    state.sourceWidth = image.naturalWidth;
    state.sourceHeight = image.naturalHeight;
    state.sourceName = file.name.replace(/\.[^/.]+$/, "") || "social-post";
    state.plan = null;
    state.elements = [];
    state.selectedId = null;

    $("sourcePreview").src = dataUrl;
    $("sourceMeta").textContent = `Original: ${state.sourceWidth} × ${state.sourceHeight}px`;
    setView("setup");
  } catch (error) {
    showError("setup", error.message || "Could not load this image.");
  }
}

function bindActions() {
  $("targetSelect").addEventListener("change", (event) => {
    state.target = PRESETS.find((preset) => preset.id === event.target.value) || PRESETS[0];
    state.plan = null;
    state.elements = [];
    updateTargetCard();
  });
  $("cleanupToggle").addEventListener("change", (event) => (state.cleanup = event.target.checked));
  $("analyzeButton").addEventListener("click", analyzeAndBuild);
  $("reanalyzeButton").addEventListener("click", analyzeAndBuild);
  $("downloadButton").addEventListener("click", downloadPng);
  $("resetButton").addEventListener("click", resetApp);
}

function updateTargetCard() {
  $("targetSelect").value = state.target.id;
  $("targetPlatform").textContent = state.target.platform;
  $("targetDimensions").textContent = `${state.target.width} × ${state.target.height}px`;
  $("ratioBox").style.aspectRatio = `${state.target.width} / ${state.target.height}`;
}

async function analyzeAndBuild() {
  if (!state.sourceDataUrl || state.busy) return;
  state.busy = true;
  setBusy(true);
  clearMessages();
  setStatus(currentStatusArea(), "Gemini is identifying the design structure…");

  try {
    const analysisDataUrl = await prepareAnalysisDataUrl(state.sourceImage);
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl: analysisDataUrl,
        sourceWidth: state.sourceWidth,
        sourceHeight: state.sourceHeight,
        target: state.target
      })
    });

    // Vercel can return a plain-text platform error when a function times out
    // or crashes. Read the body as text first so the UI shows the real error
    // instead of "Unexpected token ... is not valid JSON".
    const rawResponse = await response.text();
    let result = {};
    if (rawResponse) {
      try {
        result = JSON.parse(rawResponse);
      } catch {
        const preview = rawResponse.replace(/\s+/g, " ").trim().slice(0, 500);
        throw new Error(`Server error ${response.status}: ${preview || response.statusText}`);
      }
    }

    if (!response.ok || !result.plan) {
      const message = result.details || result.error || response.statusText || "AI analysis failed.";
      throw new Error(`${message} (HTTP ${response.status})`);
    }

    state.plan = result.plan;
    state.elements = [];
    const total = state.plan.elements.length;

    for (let index = 0; index < total; index++) {
      const element = state.plan.elements[index];
      setStatus(currentStatusArea(), `Preparing layer ${index + 1} of ${total}: ${element.label}`);
      let assetUrl = null;
      let assetImage = null;

      if (!["text", "shape"].includes(element.type)) {
        try {
          let blob = await cropImage(state.sourceImage, element.sourceBox, element.type === "logo" ? 0.006 : 0.012);
          if (state.cleanup && element.removeBackgroundRecommended) blob = await removeBackgroundLocally(blob);
          assetUrl = await fileToDataUrl(blob);
          assetImage = await loadImage(assetUrl);
        } catch (error) {
          console.warn("Could not extract layer", element.id, error);
        }
      }
      state.elements.push({ ...element, hidden: false, assetUrl, assetImage });
    }

    state.selectedId = state.elements[0]?.id || null;
    prepareWorkspace();
    setView("workspace");
    renderAll();
    setStatus("workspace", "The editable target layout is ready.");
  } catch (error) {
    showError(currentStatusArea(), error.message || "The design could not be analysed.");
    setStatus(currentStatusArea(), "");
  } finally {
    state.busy = false;
    setBusy(false);
  }
}

async function prepareAnalysisDataUrl(image) {
  const limits = [1600, 1440, 1280, 1120];
  const qualities = [0.82, 0.74, 0.66, 0.58];
  const maxDataUrlLength = 1_900_000;

  for (const maxSide of limits) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = width;
    analysisCanvas.height = height;
    const analysisContext = analysisCanvas.getContext("2d", { alpha: false });
    analysisContext.fillStyle = "#ffffff";
    analysisContext.fillRect(0, 0, width, height);
    analysisContext.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const dataUrl = analysisCanvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= maxDataUrlLength) return dataUrl;
    }
  }

  throw new Error("This image is too complex to send for analysis. Export it from Canva as a JPG or use a smaller source file.");
}

function prepareWorkspace() {
  canvas.width = state.target.width;
  canvas.height = state.target.height;
  $("workspaceTitle").textContent = state.target.label;
  $("workspaceMeta").textContent = `${state.target.width} × ${state.target.height}px · confidence ${Math.round((state.plan.confidence || 0) * 100)}%`;
  $("sourceSummary").textContent = state.plan.sourceSummary || "";
  $("targetStrategy").textContent = state.plan.targetStrategy || "";
  $("backgroundNotes").textContent = state.plan.targetBackground?.notes || "";

  const warnings = [...(state.plan.warnings || [])];
  if (["complex", "photographic"].includes(state.plan.sourceBackground?.type)) {
    warnings.push(`The source background is ${state.plan.sourceBackground.type}. Exact reconstruction may require the original Canva layers or a paid inpainting step.`);
  }
  $("warningList").innerHTML = warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  $("warningBox").classList.toggle("hidden", warnings.length === 0);
  resizeCanvasCss();
}

function renderAll() {
  renderLayerList();
  renderInspector();
  renderCanvas();
}

function renderCanvas() {
  if (!state.plan) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground(state.plan.targetBackground);

  const sorted = [...state.elements].filter((element) => !element.hidden).sort((a, b) => a.zIndex - b.zIndex);
  for (const element of sorted) drawElement(element);

  const selected = getSelected();
  if (selected && !selected.hidden) {
    const box = boxToPixels(selected.targetBox, canvas.width, canvas.height);
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = Math.max(2, canvas.width / 500);
    ctx.setLineDash([10, 7]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.restore();
  }
}

function drawBackground(background = {}) {
  const colors = background.colors?.length ? background.colors : ["#ffffff"];
  if (background.type === "linear-gradient" && colors.length > 1) {
    const angle = ((background.angle || 0) * Math.PI) / 180;
    const x2 = canvas.width / 2 + Math.cos(angle) * canvas.width;
    const y2 = canvas.height / 2 + Math.sin(angle) * canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, x2, y2);
    colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), normalizeColor(color, "#ffffff")));
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = normalizeColor(colors[0], "#ffffff");
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawElement(element) {
  const box = boxToPixels(element.targetBox, canvas.width, canvas.height);
  ctx.save();
  ctx.globalAlpha = clamp(element.opacity ?? 1, 0, 1);
  ctx.translate(box.x + box.width / 2, box.y + box.height / 2);
  ctx.rotate(((element.rotation || 0) * Math.PI) / 180);
  ctx.translate(-box.width / 2, -box.height / 2);

  if (element.type === "shape") {
    drawRoundedRect(0, 0, box.width, box.height, (element.borderRadiusRatio || 0) * canvas.height);
    ctx.fillStyle = normalizeColor(element.backgroundColor || element.color, "#d1d5db");
    ctx.fill();
    if (element.borderWidthRatio > 0 && element.borderColor !== "transparent") {
      ctx.strokeStyle = normalizeColor(element.borderColor, "#000000");
      ctx.lineWidth = element.borderWidthRatio * canvas.height;
      ctx.stroke();
    }
  } else if (element.type === "text") {
    drawTextElement(element, box.width, box.height);
  } else if (element.assetImage) {
    drawContain(element.assetImage, box.width, box.height);
  } else {
    ctx.fillStyle = "rgba(148,163,184,.18)";
    ctx.fillRect(0, 0, box.width, box.height);
    ctx.strokeStyle = "#94a3b8";
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(0, 0, box.width, box.height);
  }
  ctx.restore();
}

function drawTextElement(element, width, height) {
  const fontSize = Math.max(10, (element.fontSizeRatio || 0.04) * canvas.height);
  const fontWeight = clamp(Number(element.fontWeight) || 400, 100, 900);
  const fontFamily = safeFont(element.fontFamily);
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillStyle = normalizeColor(element.color, "#111111");
  ctx.textBaseline = "top";
  ctx.textAlign = element.alignment || "left";
  const lineHeight = fontSize * 1.12;
  const lines = wrapText(String(element.text || ""), width, ctx);
  const totalHeight = lines.length * lineHeight;
  let y = Math.max(0, (height - totalHeight) / 2);
  const x = element.alignment === "center" ? width / 2 : element.alignment === "right" ? width : 0;
  for (const line of lines) {
    ctx.fillText(line, x, y, width);
    y += lineHeight;
    if (y > height + lineHeight) break;
  }
}

function drawContain(image, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function wrapText(text, maxWidth, context) {
  const paragraphs = text.split(/\n/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = words.shift();
    for (const word of words) {
      const test = `${current} ${word}`;
      if (context.measureText(test).width <= maxWidth) current = test;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

function renderLayerList() {
  $("layerRows").innerHTML = [...state.elements]
    .sort((a, b) => b.zIndex - a.zIndex)
    .map(
      (element) => `<button class="layer-row ${state.selectedId === element.id ? "selected" : ""}" data-layer-id="${escapeAttr(element.id)}" type="button">
        <span class="layer-type">${escapeHtml(element.type.slice(0, 1).toUpperCase())}</span>
        <span><strong>${escapeHtml(element.label || element.id)}</strong><small>${escapeHtml(element.type)}</small></span>
        ${element.hidden ? "<em>hidden</em>" : ""}
      </button>`
    )
    .join("");

  document.querySelectorAll("[data-layer-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.layerId;
      renderAll();
    });
  });
}

function renderInspector() {
  const element = getSelected();
  $("inspectorEmpty").classList.toggle("hidden", Boolean(element));
  $("inspectorContent").classList.toggle("hidden", !element);
  if (!element) return;

  $("elementType").textContent = element.type;
  $("elementLabel").textContent = element.label || element.id;
  $("elementVisible").checked = !element.hidden;
  $("elementRotation").value = element.rotation || 0;
  $("elementNote").textContent = element.notes ? `AI note: ${element.notes}` : "";
  $("elementNote").classList.toggle("hidden", !element.notes);

  const isText = element.type === "text";
  const isShape = element.type === "shape";
  $("textControls").classList.toggle("hidden", !isText);
  $("shapeControls").classList.toggle("hidden", !isShape);
  $("assetControls").classList.toggle("hidden", isText || isShape);

  if (isText) {
    $("elementText").value = element.text || "";
    $("elementColor").value = normalizeColor(element.color, "#111111");
    $("elementAlignment").value = element.alignment || "left";
    $("elementFontSize").value = element.fontSizeRatio || 0.04;
    $("fontSizeValue").textContent = Number(element.fontSizeRatio || 0.04).toFixed(3);
  } else if (isShape) {
    $("elementFill").value = normalizeColor(element.backgroundColor || element.color, "#d1d5db");
    $("elementOpacity").value = element.opacity ?? 1;
  } else {
    $("assetPreview").src = element.assetUrl || "";
    $("assetPreview").classList.toggle("hidden", !element.assetUrl);
  }
}

function bindInspector() {
  $("elementVisible").addEventListener("change", (event) => updateSelected({ hidden: !event.target.checked }));
  $("elementText").addEventListener("input", (event) => updateSelected({ text: event.target.value }, false));
  $("elementColor").addEventListener("input", (event) => updateSelected({ color: event.target.value }, false));
  $("elementAlignment").addEventListener("change", (event) => updateSelected({ alignment: event.target.value }));
  $("elementFontSize").addEventListener("input", (event) => {
    $("fontSizeValue").textContent = Number(event.target.value).toFixed(3);
    updateSelected({ fontSizeRatio: Number(event.target.value) }, false);
  });
  $("elementFill").addEventListener("input", (event) => updateSelected({ backgroundColor: event.target.value }, false));
  $("elementOpacity").addEventListener("input", (event) => updateSelected({ opacity: Number(event.target.value) }, false));
  $("elementRotation").addEventListener("input", (event) => updateSelected({ rotation: Number(event.target.value) }, false));
  $("replaceAssetButton").addEventListener("click", () => $("assetInput").click());
  $("assetInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const assetImage = await loadImage(dataUrl);
    updateSelected({ assetUrl: dataUrl, assetImage });
  });
}

function updateSelected(patch, rerenderInspector = true) {
  const element = getSelected();
  if (!element) return;
  Object.assign(element, patch);
  renderCanvas();
  renderLayerList();
  if (rerenderInspector) renderInspector();
}

function bindCanvas() {
  canvas.addEventListener("pointerdown", (event) => {
    const point = pointerToCanvas(event);
    const hit = hitTest(point.x, point.y);
    state.selectedId = hit?.id || null;
    if (hit) {
      const box = boxToPixels(hit.targetBox, canvas.width, canvas.height);
      state.drag = { id: hit.id, offsetX: point.x - box.x, offsetY: point.y - box.y, width: box.width, height: box.height };
      canvas.setPointerCapture(event.pointerId);
    }
    renderAll();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    const point = pointerToCanvas(event);
    const element = state.elements.find((item) => item.id === state.drag.id);
    if (!element) return;
    const x = clamp(point.x - state.drag.offsetX, 0, canvas.width - state.drag.width);
    const y = clamp(point.y - state.drag.offsetY, 0, canvas.height - state.drag.height);
    element.targetBox = pixelsToBox(x, y, state.drag.width, state.drag.height, canvas.width, canvas.height);
    renderCanvas();
  });

  const endDrag = (event) => {
    if (state.drag && canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    state.drag = null;
    renderLayerList();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", resizeCanvasCss);
}

function hitTest(x, y) {
  const visible = [...state.elements].filter((element) => !element.hidden).sort((a, b) => b.zIndex - a.zIndex);
  return visible.find((element) => {
    const box = boxToPixels(element.targetBox, canvas.width, canvas.height);
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  });
}

function pointerToCanvas(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height
  };
}

function resizeCanvasCss() {
  if (!canvas.width || !canvas.height) return;
  const wrap = $("canvasWrap");
  const maxWidth = Math.max(320, wrap.clientWidth - 26);
  const maxHeight = 620;
  const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, 1);
  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
}

function downloadPng() {
  if (!state.plan) return;
  const selected = state.selectedId;
  state.selectedId = null;
  renderCanvas();
  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png", 1);
  anchor.download = `${state.sourceName}-${state.target.id}-${state.target.width}x${state.target.height}.png`;
  anchor.click();
  state.selectedId = selected;
  renderCanvas();
}

function setView(view) {
  $("welcomeView").classList.toggle("hidden", view !== "welcome");
  $("setupView").classList.toggle("hidden", view !== "setup");
  $("workspaceView").classList.toggle("hidden", view !== "workspace");
  $("resetButton").classList.toggle("hidden", view === "welcome");
  if (view === "workspace") requestAnimationFrame(resizeCanvasCss);
}

function resetApp() {
  state.sourceDataUrl = null;
  state.sourceImage = null;
  state.sourceWidth = 0;
  state.sourceHeight = 0;
  state.plan = null;
  state.elements = [];
  state.selectedId = null;
  state.drag = null;
  $("imageInput").value = "";
  clearMessages();
  setView("welcome");
}

function setBusy(busy) {
  $("analyzeButton").disabled = busy;
  $("reanalyzeButton").disabled = busy;
  $("analyzeButton").textContent = busy ? "Building the layout…" : "Analyse and rebuild";
  $("reanalyzeButton").textContent = busy ? "Working…" : "Re-analyse";
}

function currentStatusArea() {
  return $("workspaceView").classList.contains("hidden") ? "setup" : "workspace";
}

function setStatus(area, text) {
  const node = area === "workspace" ? $("workspaceStatus") : $("setupStatus");
  node.textContent = text;
  node.classList.toggle("hidden", !text);
}

function showError(area, text) {
  const node = area === "workspace" ? $("workspaceError") : $("setupError");
  node.textContent = text;
  node.classList.remove("hidden");
}

function clearMessages() {
  for (const id of ["setupStatus", "setupError", "workspaceStatus", "workspaceError"]) {
    $(id).textContent = "";
    $(id).classList.add("hidden");
  }
}

function getSelected() {
  return state.elements.find((element) => element.id === state.selectedId) || null;
}

async function cropImage(image, normalizedBox, paddingRatio = 0.01) {
  const raw = boxToPixels(normalizedBox, image.naturalWidth, image.naturalHeight);
  const pad = Math.max(image.naturalWidth, image.naturalHeight) * paddingRatio;
  const sx = Math.max(0, Math.floor(raw.x - pad));
  const sy = Math.max(0, Math.floor(raw.y - pad));
  const sw = Math.min(image.naturalWidth - sx, Math.ceil(raw.width + pad * 2));
  const sh = Math.min(image.naturalHeight - sy, Math.ceil(raw.height + pad * 2));
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, sw);
  cropCanvas.height = Math.max(1, sh);
  const cropContext = cropCanvas.getContext("2d", { alpha: true });
  cropContext.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToBlob(cropCanvas);
}

async function removeBackgroundLocally(blob) {
  const source = await fileToDataUrl(blob);
  const image = await loadImage(source);
  const work = document.createElement("canvas");
  work.width = image.naturalWidth;
  work.height = image.naturalHeight;
  const workContext = work.getContext("2d", { willReadFrequently: true });
  workContext.drawImage(image, 0, 0);
  const frame = workContext.getImageData(0, 0, work.width, work.height);
  const pixels = frame.data;
  const background = estimateEdgeColor(pixels, work.width, work.height);
  const total = work.width * work.height;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const enqueue = (index) => {
    if (index < 0 || index >= total || visited[index]) return;
    visited[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < work.width; x++) {
    enqueue(x);
    enqueue((work.height - 1) * work.width + x);
  }
  for (let y = 0; y < work.height; y++) {
    enqueue(y * work.width);
    enqueue(y * work.width + work.width - 1);
  }

  const threshold = 58;
  while (head < tail) {
    const index = queue[head++];
    const offset = index * 4;
    if (colorDistance(pixels[offset], pixels[offset + 1], pixels[offset + 2], ...background) > threshold) continue;
    pixels[offset + 3] = 0;
    const x = index % work.width;
    const y = Math.floor(index / work.width);
    if (x > 0) enqueue(index - 1);
    if (x < work.width - 1) enqueue(index + 1);
    if (y > 0) enqueue(index - work.width);
    if (y < work.height - 1) enqueue(index + work.width);
  }
  workContext.putImageData(frame, 0, 0);
  return canvasToBlob(work);
}

function estimateEdgeColor(data, width, height) {
  const points = [[0,0],[width-1,0],[0,height-1],[width-1,height-1],[Math.floor(width/2),0],[Math.floor(width/2),height-1],[0,Math.floor(height/2)],[width-1,Math.floor(height/2)]];
  const samples = points.map(([x,y]) => {
    const offset = (y * width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2]];
  });
  samples.sort((a,b) => brightness(a) - brightness(b));
  return samples[Math.floor(samples.length / 2)];
}

function brightness([r,g,b]) { return r * .299 + g * .587 + b * .114; }
function colorDistance(r1,g1,b1,r2,g2,b2) { return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2); }

function boxToPixels([y1, x1, y2, x2], width, height) {
  return {
    x: (x1 / 1000) * width,
    y: (y1 / 1000) * height,
    width: Math.max(1, ((x2 - x1) / 1000) * width),
    height: Math.max(1, ((y2 - y1) / 1000) * height)
  };
}

function pixelsToBox(x, y, width, height, canvasWidth, canvasHeight) {
  return [
    clamp(Math.round((y / canvasHeight) * 1000), 0, 1000),
    clamp(Math.round((x / canvasWidth) * 1000), 0, 1000),
    clamp(Math.round(((y + height) / canvasHeight) * 1000), 0, 1000),
    clamp(Math.round(((x + width) / canvasWidth) * 1000), 0, 1000)
  ];
}

function drawRoundedRect(x, y, width, height, radius) {
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, r);
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function safeFont(value) {
  const cleaned = String(value || "Arial").replace(/[^a-zA-Z0-9 ,'-]/g, "");
  return cleaned || "Arial";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = src;
  });
}

function canvasToBlob(sourceCanvas) {
  return new Promise((resolve, reject) => sourceCanvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create image.")), "image/png", 1));
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]); }
function escapeAttr(value) { return escapeHtml(value); }
