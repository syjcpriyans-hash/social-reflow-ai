const ELEMENT_TYPES = ["text", "logo", "product", "photo", "icon", "shape", "decoration"];
const ANCHORS = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right"
];

// Gemini structured-output schemas can be rejected when they are large or deeply nested.
// This endpoint uses JSON response mode plus server-side validation instead.

export async function POST(request) {
  if (!process.env.GEMINI_API_KEY) {
    return json({
      error: "GEMINI_API_KEY is missing.",
      details: "Add GEMINI_API_KEY in Vercel Project Settings or in .env.local for local development."
    }, 500);
  }

  try {
    const body = await request.json();
    validateRequest(body);

    const match = body.imageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) throw new Error("The uploaded image data is invalid.");
    const mimeType = match[1];
    const base64Data = match[2];
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    let geminiResponse;

    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: buildPrompt(body) },
                { inlineData: { mimeType, data: base64Data } }
              ]
            }],
            generationConfig: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: "minimal" },
              maxOutputTokens: 12000
            }
          })
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    const geminiRaw = await geminiResponse.text();
    let geminiJson;
    try {
      geminiJson = geminiRaw ? JSON.parse(geminiRaw) : {};
    } catch {
      throw new Error(`Gemini returned a non-JSON response (${geminiResponse.status}): ${geminiRaw.slice(0, 300)}`);
    }
    if (!geminiResponse.ok) {
      const upstreamMessage = geminiJson?.error?.message || `Gemini request failed (${geminiResponse.status}).`;
      const error = new Error(upstreamMessage);
      error.upstreamStatus = geminiResponse.status;
      throw error;
    }

    const candidate = geminiJson?.candidates?.[0];
    const output = candidate?.content?.parts
      ?.map((part) => part.text || "")
      .join("");
    if (!output) {
      throw new Error(`Gemini returned an empty analysis${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}.`);
    }

    const plan = parseJsonOutput(output);
    sanitizePlan(plan);
    return json({ plan });
  } catch (error) {
    console.error(error);
    const status = Number(error?.upstreamStatus);
    return json({
      error: "Could not analyse this design.",
      details: error?.name === "AbortError"
        ? "Gemini analysis took longer than 45 seconds. Try again or use a smaller/simpler source image."
        : (error instanceof Error ? error.message : "Unknown analysis error."),
      upstreamStatus: Number.isFinite(status) ? status : undefined
    }, Number.isFinite(status) && status >= 400 && status < 500 ? 400 : 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}

function buildPrompt(body) {
  return `You are a senior graphic designer and computer-vision layout analyst.

Analyse the attached flattened social-media design and create a reconstruction plan for a new canvas.

SOURCE CANVAS: ${body.sourceWidth} × ${body.sourceHeight}px.
TARGET: ${body.target.platform}, ${body.target.label}, ${body.target.width} × ${body.target.height}px.

NON-NEGOTIABLE RULES:
1. Do not crop, omit, summarize, or rewrite any meaningful information.
2. Do not stretch logos, products, people, photos, or icons.
3. Do not add padding, blurred borders, or visible background extension around the entire original post.
4. Reconstruct the design as editable layers and intelligently reflow them for the target aspect ratio.
5. Preserve visual hierarchy, brand feel, logo anchoring, text hierarchy, CTA prominence, and reading order.
6. Return every meaningful text block as a separate text element with exact visible wording.
7. Return logos, products, photos, icons, shapes, and decorations as separate elements with precise source bounding boxes.
8. sourceBox and targetBox must be [ymin,xmin,ymax,xmax], normalized 0-1000.
9. Keep target boxes inside 0-1000, avoid important overlaps, and use safe outer margins of approximately 35-60 normalized units.
10. Use solid or gradient background reconstruction only when visually justified. If the source has a photographic or complex background that cannot be faithfully reconstructed after elements move, classify it accurately and add a warning.
11. For coloured cards or pills, create separate shape elements behind their text.
12. Set removeBackgroundRecommended=true for logos, standalone products, isolated people, and icons that should become transparent layers.
13. Colours must be six-digit hex. Use "transparent" only where a background or border does not apply.
14. fontSizeRatio means font size divided by target canvas height. Keep all text readable.
15. Make a decisive professional target layout rather than simply scaling source coordinates.
16. Include all visible brand, legal, contact, feature, CTA, and disclaimer information.
17. Keep targetBox dimensions large enough to contain the full exact text after wrapping.

The result will be rendered by code, not by an image generator. Accuracy and complete element coverage matter more than artistic commentary.

Return one JSON object only, using this exact top-level structure:
{
  "title": "string",
  "sourceSummary": "string",
  "sourceBackground": {"type":"solid|linear-gradient|complex|photographic","colors":["#ffffff"],"angle":0,"confidence":0.9,"notes":"string"},
  "targetBackground": {"type":"solid|linear-gradient|complex|photographic","colors":["#ffffff"],"angle":0,"confidence":0.9,"notes":"string"},
  "targetStrategy": "string",
  "confidence": 0.9,
  "warnings": ["string"],
  "elements": [
    {
      "id":"unique-id",
      "type":"text|logo|product|photo|icon|shape|decoration",
      "label":"string",
      "text":"exact text or empty string",
      "sourceBox":[0,0,100,100],
      "targetBox":[0,0,100,100],
      "anchor":"top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right",
      "alignment":"left|center|right",
      "fontFamily":"Arial",
      "fontWeight":400,
      "fontSizeRatio":0.04,
      "color":"#111111",
      "backgroundColor":"transparent",
      "borderColor":"transparent",
      "borderWidthRatio":0,
      "borderRadiusRatio":0,
      "rotation":0,
      "opacity":1,
      "zIndex":1,
      "importance":5,
      "preserveExactly":false,
      "removeBackgroundRecommended":false,
      "notes":"string"
    }
  ]
}
Do not wrap the JSON in Markdown fences.`;
}

function validateRequest(body) {
  if (!body || typeof body.imageDataUrl !== "string") throw new Error("Missing image.");
  if (body.imageDataUrl.length > 17_000_000) throw new Error("Image payload is too large.");
  if (!Number.isFinite(body.sourceWidth) || !Number.isFinite(body.sourceHeight)) throw new Error("Invalid source dimensions.");
  if (!body.target || !Number.isFinite(body.target.width) || !Number.isFinite(body.target.height)) throw new Error("Invalid target dimensions.");
}

function parseJsonOutput(output) {
  const trimmed = String(output || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const withoutFences = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      return JSON.parse(withoutFences);
    } catch {
      const firstBrace = withoutFences.indexOf("{");
      const lastBrace = withoutFences.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        return JSON.parse(withoutFences.slice(firstBrace, lastBrace + 1));
      }
      throw new Error("Gemini returned text that could not be parsed as JSON.");
    }
  }
}

function sanitizePlan(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.elements)) {
    throw new Error("Gemini returned an invalid element plan.");
  }
  plan.title = String(plan.title || "Reflowed design");
  plan.sourceSummary = String(plan.sourceSummary || "Source design analysed.");
  plan.targetStrategy = String(plan.targetStrategy || "Elements reflowed for the target canvas.");
  plan.sourceBackground = plan.sourceBackground && typeof plan.sourceBackground === "object"
    ? plan.sourceBackground
    : { type: "solid", colors: ["#ffffff"], angle: 0, confidence: 0.5, notes: "Fallback background." };
  plan.targetBackground = plan.targetBackground && typeof plan.targetBackground === "object"
    ? plan.targetBackground
    : { type: "solid", colors: ["#ffffff"], angle: 0, confidence: 0.5, notes: "Fallback background." };
  plan.confidence = clampNumber(plan.confidence, 0, 1, 0.5);
  plan.warnings = Array.isArray(plan.warnings) ? plan.warnings.map(String) : [];

  for (let index = 0; index < plan.elements.length; index++) {
    const element = plan.elements[index];
    element.id = String(element.id || `element-${index + 1}`);
    element.type = ELEMENT_TYPES.includes(element.type) ? element.type : "decoration";
    element.label = String(element.label || element.id);
    element.text = String(element.text || "");
    element.sourceBox = sanitizeBox(element.sourceBox);
    element.targetBox = sanitizeBox(element.targetBox);
    element.anchor = ANCHORS.includes(element.anchor) ? element.anchor : "center";
    element.alignment = ["left", "center", "right"].includes(element.alignment) ? element.alignment : "left";
    element.fontFamily = String(element.fontFamily || "Arial");
    element.fontWeight = clampNumber(element.fontWeight, 100, 900, 400);
    element.fontSizeRatio = clampNumber(element.fontSizeRatio, 0.008, 0.2, 0.04);
    element.color = normalizeHex(element.color, "#111111");
    element.backgroundColor = element.backgroundColor === "transparent" ? "transparent" : normalizeHex(element.backgroundColor, "#d1d5db");
    element.borderColor = element.borderColor === "transparent" ? "transparent" : normalizeHex(element.borderColor, "#000000");
    element.borderWidthRatio = clampNumber(element.borderWidthRatio, 0, 0.05, 0);
    element.borderRadiusRatio = clampNumber(element.borderRadiusRatio, 0, 0.2, 0);
    element.rotation = clampNumber(element.rotation, -180, 180, 0);
    element.opacity = clampNumber(element.opacity, 0, 1, 1);
    element.zIndex = Math.round(clampNumber(element.zIndex, -100, 1000, index));
    element.importance = Math.round(clampNumber(element.importance, 0, 10, 5));
    element.preserveExactly = Boolean(element.preserveExactly);
    element.removeBackgroundRecommended = Boolean(element.removeBackgroundRecommended);
    element.notes = String(element.notes || "");
  }

  sanitizeBackground(plan.sourceBackground);
  sanitizeBackground(plan.targetBackground);
}

function sanitizeBackground(background) {
  if (!background || typeof background !== "object") return;
  const types = ["solid", "linear-gradient", "complex", "photographic"];
  background.type = types.includes(background.type) ? background.type : "solid";
  background.colors = Array.isArray(background.colors) && background.colors.length
    ? background.colors.map((color) => normalizeHex(color, "#ffffff"))
    : ["#ffffff"];
  background.angle = clampNumber(background.angle, -360, 360, 0);
  background.confidence = clampNumber(background.confidence, 0, 1, 0.5);
  background.notes = String(background.notes || "");
}

function sanitizeBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return [0, 0, 1000, 1000];
  const box = value.map((item) => clampNumber(item, 0, 1000, 0));
  const [y1, x1, y2, x2] = box;
  const normalized = [Math.min(y1, y2), Math.min(x1, x2), Math.max(y1, y2), Math.max(x1, x2)];
  if (normalized[2] - normalized[0] < 2) normalized[2] = Math.min(1000, normalized[0] + 2);
  if (normalized[3] - normalized[1] < 2) normalized[3] = Math.min(1000, normalized[1] + 2);
  return normalized;
}

function normalizeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
