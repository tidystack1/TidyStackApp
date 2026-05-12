import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FormData = Record<string, string | undefined>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function str(data: FormData, key: string): string {
  return (data[key] ?? "").trim();
}

function currency(value: string): string {
  const n = parseFloat(value);
  if (isNaN(n)) return value || "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function present(value: string): boolean {
  return value.trim().length > 0 && value.trim() !== "0" && value.trim() !== "0.00";
}

/** Uses "Number of passengers" when set; otherwise infers max N from keys like "Passenger 3 Seat Preference". */
function inferPassengerCount(data: FormData): number {
  const explicit = parseInt(str(data, "Number of passengers") || "0", 10);
  if (!Number.isNaN(explicit) && explicit > 0) return explicit;

  let max = 0;
  const re = /^Passenger (\d+)\s/;
  for (const key of Object.keys(data)) {
    const m = key.match(re);
    if (m) {
      const n = parseInt(m[1]!, 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return max;
}

export function parseSafeFileName(dealName: string): string {
  return (dealName || "booking").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

// ─── PDF Layout constants ──────────────────────────────────────────────────────

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

/** Highview Travel brand: #E6D09E */
const COLOR_BRAND = rgb(230 / 255, 208 / 255, 158 / 255);
/** Dark text / accents on brand gold and body */
const COLOR_ACCENT = rgb(0.42, 0.34, 0.22);
const COLOR_BG_HEADER = COLOR_BRAND;
const COLOR_SECTION_BG = rgb(0.97, 0.94, 0.88);
const COLOR_TEXT = rgb(0.1, 0.1, 0.1);
const COLOR_LABEL = rgb(0.35, 0.35, 0.35);
const COLOR_WHITE = rgb(1, 1, 1);
const COLOR_LINE = rgb(0.82, 0.82, 0.82);
/** Highlight row — deep gold for contrast with white text */
const COLOR_TOTAL_BG = rgb(0.48, 0.4, 0.26);
const COLOR_HEADER_TITLE = rgb(0.22, 0.18, 0.12);
const COLOR_HEADER_META = rgb(0.5, 0.43, 0.32);
const COLOR_PASSENGER_BAR = rgb(0.55, 0.46, 0.32);

interface DrawCtx {
  page: ReturnType<PDFDocument["addPage"]>;
  font: PDFFont;
  boldFont: PDFFont;
  y: number;
  doc: PDFDocument;
}

function ensureSpace(ctx: DrawCtx, needed: number): DrawCtx {
  if (ctx.y - needed < MARGIN + 20) {
    const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    return { ...ctx, page, y: PAGE_H - MARGIN };
  }
  return ctx;
}

function drawHRule(ctx: DrawCtx, color = COLOR_LINE): DrawCtx {
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.5,
    color,
  });
  return { ...ctx, y: ctx.y - 6 };
}

function drawSectionHeader(ctx: DrawCtx, title: string): DrawCtx {
  ctx = ensureSpace(ctx, 28);
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 18, width: CONTENT_W, height: 20, color: COLOR_SECTION_BG });
  ctx.page.drawText(title.toUpperCase(), { x: MARGIN + 8, y: ctx.y - 13, size: 8, font: ctx.boldFont, color: COLOR_ACCENT });
  return { ...ctx, y: ctx.y - 26 };
}

function wrapText(text: string, font: PDFFont, size: number, maxW: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxW || !current) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function drawLabelValue(
  ctx: DrawCtx,
  label: string,
  value: string,
  opts?: { indent?: number; bold?: boolean; large?: boolean; highlight?: boolean }
): DrawCtx {
  const indent = opts?.indent ?? 0;
  const size = opts?.large ? 11 : 9.5;
  const labelFont = ctx.boldFont;
  const valueFont = opts?.bold ? ctx.boldFont : ctx.font;
  const labelCol = MARGIN + indent;
  const valueCol = labelCol + 148;
  const maxValueW = PAGE_W - MARGIN - valueCol;

  const lines = wrapText(value, ctx.font, size, maxValueW);
  const lineH = size + 3.5;
  const blockH = lines.length * lineH + 4;

  ctx = ensureSpace(ctx, blockH + 2);

  if (opts?.highlight) {
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - blockH + 2, width: CONTENT_W, height: blockH, color: COLOR_TOTAL_BG });
    ctx.page.drawText(label, { x: labelCol, y: ctx.y - size + 2, size, font: labelFont, color: COLOR_WHITE });
    for (let i = 0; i < lines.length; i++) {
      ctx.page.drawText(lines[i], { x: valueCol, y: ctx.y - size + 2 - i * lineH, size, font: valueFont, color: COLOR_WHITE });
    }
  } else {
    ctx.page.drawText(label, { x: labelCol, y: ctx.y - size + 2, size, font: labelFont, color: COLOR_LABEL });
    for (let i = 0; i < lines.length; i++) {
      ctx.page.drawText(lines[i], {
        x: valueCol,
        y: ctx.y - size + 2 - i * lineH,
        size,
        font: valueFont,
        color: opts?.bold ? COLOR_ACCENT : COLOR_TEXT,
      });
    }
  }

  return { ...ctx, y: ctx.y - blockH - 2 };
}

function gap(ctx: DrawCtx, amount = 8): DrawCtx {
  return { ...ctx, y: ctx.y - amount };
}

// ─── Main PDF builder ─────────────────────────────────────────────────────────

export async function buildPDF(data: FormData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let ctx: DrawCtx = { page, font, boldFont, y: PAGE_H, doc };

  const formType = str(data, "Form Type");
  const isFora = formType === "Fora";
  const numPassengers = inferPassengerCount(data);
  const amountOfDeals = parseInt(str(data, "Amount of deals on contact") || "0", 10);
  const mailingAddressSame = str(data, "Is the mailing address for commission check the same as the agency address?") === "YES";
  const checkPayableSame = str(data, "Is the commission's check payable name the same as the agency name?") === "YES";

  // ─── Page header (brand bar + logo) ─────────────────────────────────────
  const HEADER_H = 92;
  ctx.page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: COLOR_BG_HEADER });

  let logoW = 0;
  let logoGap = 0;
  try {
    const logoPath = path.join(process.cwd(), "public", "HighViewTravel", "hv-logo.png");
    const logoBytes = await readFile(logoPath);
    const logoImage = await doc.embedPng(logoBytes);
    const fitted = logoImage.scaleToFit(168, 44);
    logoW = fitted.width;
    const logoH = fitted.height;
    logoGap = 18;
    const logoX = MARGIN;
    const logoY = PAGE_H - HEADER_H / 2 - logoH / 2;
    ctx.page.drawImage(logoImage, { x: logoX, y: logoY, width: logoW, height: logoH });
  } catch (e) {
    console.warn("[pdf-builder] HighView logo not embedded:", e instanceof Error ? e.message : e);
  }

  const titleX = MARGIN + logoW + logoGap;
  ctx.page.drawText("TRAVEL BOOKING SUMMARY", {
    x: titleX,
    y: PAGE_H - 36,
    size: 15,
    font: boldFont,
    color: COLOR_HEADER_TITLE,
  });

  const now = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dateLabel = `Generated: ${now}`;
  const dateW = font.widthOfTextAtSize(dateLabel, 8);
  ctx.page.drawText(dateLabel, { x: PAGE_W - MARGIN - dateW, y: PAGE_H - 58, size: 8, font, color: COLOR_HEADER_META });

  ctx = { ...ctx, y: PAGE_H - HEADER_H - 14 };

  // ─── Agent Information ────────────────────────────────────────────────────
  ctx = drawSectionHeader(ctx, "Agent Information");
  ctx = drawLabelValue(ctx, "Agent Name:", str(data, "Agent Name"));
  ctx = drawLabelValue(ctx, "Agency Name:", str(data, "Agency Name"));
  ctx = drawLabelValue(ctx, "Email:", str(data, "Email"));

  if (amountOfDeals === 1) {
    const agencyAddr = str(data, "Please provide your agency address");
    if (agencyAddr) ctx = drawLabelValue(ctx, "Agency Address:", agencyAddr);
  }

  if (!mailingAddressSame) {
    const mailingAddr = str(data, "Mailing Address");
    if (mailingAddr) ctx = drawLabelValue(ctx, "Mailing Address:", mailingAddr);
  }

  if (!checkPayableSame) {
    const checkPayable = str(data, "Check Payable to");
    if (checkPayable) ctx = drawLabelValue(ctx, "Check Payable to:", checkPayable);
  }

  ctx = gap(ctx, 10);

  // ─── Booking Details ──────────────────────────────────────────────────────
  ctx = drawSectionHeader(ctx, "Booking Details");

  const reservationDetails = str(data, "Reservation Details");
  const penalties = str(data, "Penalties");
  if (reservationDetails) ctx = drawLabelValue(ctx, "Reservation Details:", reservationDetails);
  if (penalties) ctx = drawLabelValue(ctx, "Penalties:", penalties);

  ctx = gap(ctx, 10);

  // ─── Passenger Details ────────────────────────────────────────────────────
  if (numPassengers > 0) {
    ctx = drawSectionHeader(ctx, `Passenger Details (${numPassengers} Passenger${numPassengers > 1 ? "s" : ""})`);

    for (let i = 1; i <= numPassengers; i++) {
      ctx = ensureSpace(ctx, 24);
      ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 16, width: CONTENT_W, height: 18, color: COLOR_PASSENGER_BAR });
      ctx.page.drawText(`Passenger ${i}`, { x: MARGIN + 8, y: ctx.y - 11, size: 9, font: boldFont, color: COLOR_WHITE });
      ctx = { ...ctx, y: ctx.y - 24 };

      const seat    = str(data, `Passenger ${i} Seat Preference`);
      const ff      = str(data, `Passenger ${i} Frequent Flyer #`);
      const kt      = str(data, `Passenger ${i} Known Traveler #`);
      const special = str(data, `Passenger ${i} Special Requests`);

      if (seat)    ctx = drawLabelValue(ctx, "Seat Preference:", seat,    { indent: 12 });
      if (ff)      ctx = drawLabelValue(ctx, "Frequent Flyer #:", ff,     { indent: 12 });
      if (kt)      ctx = drawLabelValue(ctx, "Known Traveler #:", kt,     { indent: 12 });
      if (special) ctx = drawLabelValue(ctx, "Special Requests:", special, { indent: 12 });

      if (!seat && !ff && !kt && !special) {
        ctx = drawLabelValue(ctx, "", "No additional details provided.", { indent: 12 });
      }

      ctx = gap(ctx, 6);
    }

    ctx = gap(ctx, 10);
  }

  // ─── Payment Information ──────────────────────────────────────────────────
  ctx = drawSectionHeader(ctx, "Payment Information");
  ctx = drawLabelValue(ctx, "Form of Payment:", str(data, "Form of payment"), { bold: true });
  ctx = gap(ctx, 10);

  // ─── Fare Breakdown ───────────────────────────────────────────────────────
  ctx = drawSectionHeader(ctx, "Fare Breakdown");

  const ratePerPerson  = str(data, "RATE PER PERSON");
  const basePerPerson  = str(data, "Base Per Person");
  const issuingFee     = str(data, "Issuing Fee");
  const commissionPP   = str(data, "+ COMMISSION PP");
  const taxesAndFees   = str(data, "Taxes and Fees Per Person");
  const totalPerPerson = str(data, "Total Per Person");
  const total          = str(data, "Total");
  const ccFee          = str(data, "+ 3.5% CC FEE (NON-REFUNDABLE)");
  const totalAuthorized = str(data, "= TOTAL AUTHORIZED TO CHARGE PP*");

  if (!isFora && present(ratePerPerson))  ctx = drawLabelValue(ctx, "Rate Per Person:", currency(ratePerPerson));
  if (isFora  && present(basePerPerson))  ctx = drawLabelValue(ctx, "Base Per Person:", currency(basePerPerson));
  if (isFora  && present(taxesAndFees))   ctx = drawLabelValue(ctx, "Taxes & Fees Per Person:", currency(taxesAndFees));
  if (present(issuingFee))                ctx = drawLabelValue(ctx, "Issuing Fee:", currency(issuingFee));
  if (present(commissionPP))              ctx = drawLabelValue(ctx, "+ Commission PP:", currency(commissionPP));

  if (present(totalPerPerson)) {
    ctx = drawHRule(ctx);
    ctx = drawLabelValue(ctx, "Total Per Person:", currency(totalPerPerson), { bold: true });
  }

  if (!isFora && present(total))          ctx = drawLabelValue(ctx, "Total:", currency(total), { bold: true });
  if (present(ccFee))                     ctx = drawLabelValue(ctx, "+ 3.5% CC Fee (non-refundable):", currency(ccFee));

  if (present(totalAuthorized)) {
    ctx = gap(ctx, 4);
    ctx = drawLabelValue(ctx, "= Total Authorized to Charge PP*:", currency(totalAuthorized), { bold: true, highlight: true });
    ctx = gap(ctx, 4);
  }

  // ─── Footer on every page ─────────────────────────────────────────────────
  const pages = doc.getPages();
  const pageCount = doc.getPageCount();
  pages.forEach((p, idx) => {
    p.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 14 }, thickness: 0.5, color: COLOR_LINE });
    p.drawText("This document is for internal use only. Highview Travel.", { x: MARGIN, y: MARGIN + 4, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
    const pg = `Page ${idx + 1} of ${pageCount}`;
    const pgW = font.widthOfTextAtSize(pg, 7);
    p.drawText(pg, { x: PAGE_W - MARGIN - pgW, y: MARGIN + 4, size: 7, font, color: rgb(0.6, 0.6, 0.6) });
  });

  return doc.save();
}
