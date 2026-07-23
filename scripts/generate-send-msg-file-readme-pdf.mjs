/**
 * Regenerates app/api/send-msg-file/readme.pdf for Outlook plugin developers.
 * Run: node scripts/generate-send-msg-file-readme-pdf.mjs
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../app/api/send-msg-file/readme.pdf");

const BASE = "https://tidystack-app.vercel.app";

const C = {
  brand: rgb(0.05, 0.28, 0.52),
  brandLight: rgb(0.88, 0.93, 0.98),
  step1: rgb(0.2, 0.45, 0.75),
  step2: rgb(0.15, 0.55, 0.45),
  step3: rgb(0.55, 0.35, 0.65),
  warn: rgb(0.75, 0.35, 0.12),
  warnBg: rgb(1, 0.96, 0.9),
  ok: rgb(0.12, 0.48, 0.28),
  okBg: rgb(0.92, 0.98, 0.94),
  codeBg: rgb(0.95, 0.96, 0.97),
  border: rgb(0.82, 0.85, 0.88),
  text: rgb(0.12, 0.14, 0.18),
  muted: rgb(0.4, 0.44, 0.5),
};

const pdfDoc = await PDFDocument.create();
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
const mono = await pdfDoc.embedFont(StandardFonts.Courier);

const margin = 48;
const contentWidth = 519;
let page = pdfDoc.addPage([612, 792]);
let { width, height } = page.getSize();
let y = height - margin;

function newPageIfNeeded(needed = 80) {
  if (y < margin + needed) {
    page = pdfDoc.addPage([612, 792]);
    ({ width, height } = page.getSize());
    y = height - margin;
  }
}

function drawText(text, opts = {}) {
  const {
    x = margin,
    size = 10,
    f = font,
    color = C.text,
    maxWidth = contentWidth,
    lineGap = 4,
  } = opts;
  const lines = wrapText(text, f, size, maxWidth);
  for (const line of lines) {
    newPageIfNeeded(size + lineGap + 10);
    page.drawText(line, { x, y, size, font: f, color });
    y -= size + lineGap;
  }
}

function wrapText(text, f, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (f.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function drawRect(x, topY, w, h, fill, stroke) {
  page.drawRectangle({
    x,
    y: topY - h,
    width: w,
    height: h,
    color: fill,
    borderColor: stroke ?? fill,
    borderWidth: stroke ? 1 : 0,
  });
}

function drawHeaderBanner() {
  const h = 72;
  drawRect(0, y + 28, width, h, C.brand);
  page.drawText("Outlook plugin", {
    x: margin,
    y: y - 8,
    size: 11,
    font,
    color: rgb(0.85, 0.92, 1),
  });
  page.drawText("Sending a categorized email (.msg)", {
    x: margin,
    y: y - 28,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  y -= h + 16;
}

function drawInfoBox(title, bodyLines, accent) {
  const pad = 10;
  const innerW = contentWidth - pad * 2;

  if (title && bodyLines.length === 0) {
    const boxH = pad * 2 + 14;
    newPageIfNeeded(boxH + 8);
    drawRect(margin, y, contentWidth, boxH, C.brandLight, C.border);
    page.drawRectangle({
      x: margin,
      y: y - boxH,
      width: 4,
      height: boxH,
      color: accent ?? C.brand,
    });
    page.drawText(title, {
      x: margin + pad + 4,
      y: y - pad - 10,
      size: 10,
      font: fontBold,
      color: accent ?? C.brand,
    });
    y -= boxH + 12;
    return;
  }

  newPageIfNeeded(24 + bodyLines.length * 14);
  let textH = 0;
  for (const line of bodyLines) {
    textH += wrapText(line, font, 9.5, innerW).length * 13;
  }
  const boxH = textH + pad * 2 + (title ? 18 : 0);
  drawRect(margin, y, contentWidth, boxH, C.brandLight, C.border);
  if (title) {
    page.drawRectangle({
      x: margin,
      y: y - boxH,
      width: 4,
      height: boxH,
      color: accent ?? C.brand,
    });
    page.drawText(title, {
      x: margin + pad + 4,
      y: y - pad - 10,
      size: 10,
      font: fontBold,
      color: accent ?? C.brand,
    });
    y -= pad + 18;
  }
  for (const line of bodyLines) {
    const wrapped = wrapText(line, font, 9.5, innerW);
    for (const w of wrapped) {
      page.drawText(w, {
        x: margin + pad + 4,
        y: y - 10,
        size: 9.5,
        font,
        color: C.text,
      });
      y -= 13;
    }
  }
  y -= pad + 8;
}

const STEP_TOP_MARGIN = 20;

function drawStep(num, title, accent) {
  newPageIfNeeded(36 + STEP_TOP_MARGIN);
  y -= STEP_TOP_MARGIN;
  page.drawText(`Step ${num}`, {
    x: margin,
    y,
    size: 9,
    font: fontBold,
    color: accent,
  });
  page.drawText(title, {
    x: margin + 52,
    y,
    size: 13,
    font: fontBold,
    color: C.text,
  });
  y -= 18;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + contentWidth, y },
    thickness: 0.5,
    color: C.border,
  });
  y -= 12;
}

function drawMethodLine(method, path) {
  newPageIfNeeded(24);
  const fontSize = 9;
  const padX = 5;
  const badgeH = 18;
  const methodW = fontBold.widthOfTextAtSize(method, fontSize) + padX * 2;
  const badgeBottom = y - 4;
  const badgeTop = badgeBottom + badgeH;
  drawRect(margin, badgeTop, methodW, badgeH, C.brand);
  const methodBaseline = badgeBottom + (badgeH - fontSize) / 2 + 1;
  page.drawText(method, {
    x: margin + padX,
    y: methodBaseline,
    size: fontSize,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(path, {
    x: margin + methodW + 8,
    y,
    size: 8.5,
    font: mono,
    color: C.text,
  });
  y -= 22;
  drawText("Content-Type: application/json", { size: 9, f: mono, color: C.muted });
}

function drawWarnBox(lines) {
  const pad = 10;
  const innerW = contentWidth - pad * 2;
  let textH = 0;
  for (const line of lines) {
    textH += wrapText(line, fontBold, 9, innerW).length * 12;
  }
  const boxH = textH + pad * 2;
  newPageIfNeeded(boxH + 8);
  drawRect(margin, y, contentWidth, boxH, C.warnBg, C.warn);
  let cy = y - pad - 9;
  for (const line of lines) {
    for (const w of wrapText(line, fontBold, 9, innerW)) {
      page.drawText(w, {
        x: margin + pad,
        y: cy,
        size: 9,
        font: fontBold,
        color: C.warn,
      });
      cy -= 12;
    }
  }
  y -= boxH + 10;
}

function drawCodeBlock(lines) {
  const pad = 10;
  const lineH = 11;
  const boxH = lines.length * lineH + pad * 2;
  newPageIfNeeded(boxH + 8);
  drawRect(margin, y, contentWidth, boxH, C.codeBg, C.border);
  let cy = y - pad - 9;
  for (const line of lines) {
    page.drawText(line, {
      x: margin + pad,
      y: cy,
      size: 8,
      font: mono,
      color: C.text,
    });
    cy -= lineH;
  }
  y -= boxH + 10;
}

function drawBullet(label, desc) {
  newPageIfNeeded(16);
  page.drawText("•", { x: margin + 4, y, size: 10, font, color: C.brand });
  page.drawText(label, {
    x: margin + 16,
    y,
    size: 9.5,
    font: fontBold,
    color: C.text,
  });
  const lw = fontBold.widthOfTextAtSize(`${label}  `, 9.5);
  drawText(desc, {
    x: margin + 16 + lw,
    size: 9.5,
    maxWidth: contentWidth - 16 - lw,
    lineGap: 3,
  });
  y -= 2;
}

// --- Build PDF ---

drawHeaderBanner();

drawInfoBox("Overview", [], C.brand);

// Step 1
drawStep(1, "Get upload URL", C.step1);
drawMethodLine("POST", `${BASE}/api/send-msg-file/get-upload-url`);
drawText("Body: messageId, category, secret", { size: 9.5, color: C.muted });
y -= 2;
drawCodeBlock([
  '{ "messageId": "AAMkAG...", "category": "HubSpot deal",',
  '  "secret": "<shared-secret>" }',
]);
drawText("Response (200) when registered:", { size: 9, f: fontBold, color: C.muted });
drawCodeBlock([
  '{ "uploadUrl": "<presigned-url>", "pathname": "msg/<messageId>.msg",',
  '  "registeredCategory": true }',
]);
drawWarnBox([
  "If registeredCategory is false, stop here — do not upload or call process.",
  '(HTTP 200 with message: "This category is not registered.")',
]);

// Step 2
drawStep(2, "Upload the .msg file", C.step2);
drawText("PUT the uploadUrl returned from step 1 (not the API base URL).", {
  size: 9.5,
});
y -= 2;
drawBullet("Body", "Raw .msg file bytes");
drawBullet("Content-Type", "application/vnd.ms-outlook (or application/octet-stream)");
drawBullet("Limits", "Max 100 MB. Complete upload within 15 minutes of step 1.");
y -= 4;
newPageIfNeeded(44);
drawRect(margin, y, contentWidth, 32, C.okBg, C.ok);
page.drawText("Only continue to step 3 if the PUT returns HTTP 200.", {
  x: margin + 10,
  y: y - 20,
  size: 9.5,
  font: fontBold,
  color: C.ok,
});
y -= 40;

// Step 3
drawStep(3, "Process", C.step3);
drawMethodLine("POST", `${BASE}/api/send-msg-file/process`);
drawText("Request body (JSON):", { size: 9.5, f: fontBold });
y -= 2;
drawBullet("pathname", "Value from step 1 response (e.g. msg/AAMkAG....msg)");
drawBullet("category", '"HubSpot deal"');
drawBullet("secret", "Plugin shared secret");
drawBullet("triggeredBy", "(Optional) User or mailbox id for logging");
y -= 4;
drawText("Example request:", { size: 9, f: fontBold, color: C.muted });
drawCodeBlock([
  "{",
  '  "pathname": "msg/AAMkAG....msg",',
  '  "category": "HubSpot deal",',
  '  "secret": "<shared-secret>",',
  '  "triggeredBy": "berel@shmerel.com"',
  "}",
]);
drawText("Sample success response (HubSpot deal, HTTP 200):", {
  size: 9,
  f: fontBold,
  color: C.muted,
});
drawCodeBlock([
  "{",
  '  "success": true,',
  '  "passengerName": "Jane Smith",',
  '  "departureAirport": "JFK",',
  '  "arrivalAirport": "LHR",',
  '  "dealId": "123456789",',
  '  "dealName": "Jane Smith JFK LHR 2026-08-01/2026-08-15",',
  '  "registeredCategory": true',
  "}",
]);
drawText("Additional booking/deal fields may be present.", {
  size: 8.5,
  color: C.muted,
});

y -= 8;
drawText("Common errors", { size: 12, f: fontBold, color: C.brand });
drawBullet("401", "Wrong or missing secret");
drawBullet("400", "Invalid JSON, bad messageId/pathname, or invalid .msg");
drawBullet("404", ".msg not uploaded yet (step 2 missing or failed)");
drawBullet("500", "Server or downstream processing failure");
drawText("Error bodies include error and details fields.", { size: 9, color: C.muted });

const pdfBytes = await pdfDoc.save();
writeFileSync(outPath, pdfBytes);
console.log("Wrote", outPath);
