import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import type { LowerWattCommission } from "./types";
import type { NormalizedRepPayload } from "./commissions";
import { formatCurrency, formatPercent, sanitizePdfText } from "./format";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLOR_HEADER_BG = rgb(15 / 255, 23 / 255, 42 / 255);
const COLOR_HEADER_TEXT = rgb(1, 1, 1);
const COLOR_HEADER_SUBTEXT = rgb(203 / 255, 213 / 255, 225 / 255);
const COLOR_TEXT = rgb(15 / 255, 23 / 255, 42 / 255);
const COLOR_MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const COLOR_BORDER = rgb(226 / 255, 232 / 255, 240 / 255);
const COLOR_PANEL_BG = rgb(248 / 255, 250 / 255, 252 / 255);
const COLOR_TABLE_HEADER_BG = rgb(241 / 255, 245 / 255, 249 / 255);

type PdfColumn = {
  key: keyof LowerWattCommission;
  label: string;
  width: number;
  align: "left" | "right";
};

const COLUMNS_WITH_ADJUSTMENT: PdfColumn[] = [
  { key: "gross", label: "Gross", width: 90, align: "right" },
  { key: "commissionAmount", label: "Commission", width: 106, align: "right" },
  { key: "adjustment", label: "Adjustment", width: 116, align: "right" },
  {
    key: "commissionTotal",
    label: "Commission Total",
    width: 141,
    align: "right",
  },
  { key: "commissionRate", label: "Rate", width: 63, align: "right" },
];

const COLUMNS_WITHOUT_ADJUSTMENT: PdfColumn[] = [
  { key: "gross", label: "Gross", width: 116, align: "right" },
  { key: "commissionAmount", label: "Commission", width: 137, align: "right" },
  {
    key: "commissionTotal",
    label: "Commission Total",
    width: 182,
    align: "right",
  },
  { key: "commissionRate", label: "Rate", width: 81, align: "right" },
];

const TABLE_FONT_SIZE = 9;
const TABLE_LINE_HEIGHT = TABLE_FONT_SIZE + 3;
const CELL_PADDING_X = 6;
const CELL_PADDING_Y = 6;
const HEADER_ROW_HEIGHT = 28;

function hasAdjustments(commissions: LowerWattCommission[]): boolean {
  return commissions.some((item) => Number(item.adjustment ?? 0) !== 0);
}

function getColumns(commissions: LowerWattCommission[]): PdfColumn[] {
  return hasAdjustments(commissions)
    ? COLUMNS_WITH_ADJUSTMENT
    : COLUMNS_WITHOUT_ADJUSTMENT;
}

function getTableWidth(columns: PdfColumn[]): number {
  return columns.reduce((sum, column) => sum + column.width, 0);
}

type PdfContext = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  y: number;
  font: PDFFont;
  bold: PDFFont;
};

function wrapTextToWidth(params: {
  text: string;
  font: PDFFont;
  fontSize: number;
  maxWidth: number;
  maxLines?: number;
}): string[] {
  const { text, font, fontSize, maxWidth, maxLines = 4 } = params;
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === 0) return [""];

  if (
    lines.length === maxLines &&
    words.join(" ").length > lines.join(" ").length
  ) {
    const last = lines[maxLines - 1] ?? "";
    let trimmed = last;
    while (
      trimmed.length > 0 &&
      font.widthOfTextAtSize(`${trimmed}...`, fontSize) > maxWidth
    ) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[maxLines - 1] = `${trimmed}...`;
  }

  return lines;
}

function getCellValue(item: LowerWattCommission, column: PdfColumn): string {
  switch (column.key) {
    case "gross":
      return formatCurrency(Number(item.gross ?? 0));
    case "commissionRate":
      return formatPercent(Number(item.commissionRate ?? 0));
    case "commissionAmount":
      return formatCurrency(Number(item.commissionAmount ?? 0));
    case "commissionTotal":
      return formatCurrency(Number(item.commissionTotal ?? 0));
    case "adjustment":
      return formatCurrency(Number(item.adjustment ?? 0));
    default:
      return "";
  }
}

function drawPanel(params: {
  page: PDFPage;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const { page, x, y, width, height } = params;
  page.drawRectangle({
    x,
    y: y - height,
    width,
    height,
    color: COLOR_PANEL_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });
}

function drawMetaLine(params: {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  x: number;
  y: number;
  label: string;
  value: string;
}) {
  const { page, font, bold, x, y, label, value } = params;
  const labelText = sanitizePdfText(`${label}: `);
  const labelWidth = bold.widthOfTextAtSize(labelText, 11);
  page.drawText(labelText, { x, y, size: 11, font: bold, color: COLOR_TEXT });
  page.drawText(sanitizePdfText(value), {
    x: x + labelWidth,
    y,
    size: 11,
    font,
    color: COLOR_TEXT,
  });
}

function ensureSpace(
  ctx: PdfContext,
  height: number,
  redrawTableHeader?: () => void,
) {
  if (ctx.y - height >= MARGIN) return;

  ctx.page = ctx.pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.y = PAGE_HEIGHT - MARGIN;
  redrawTableHeader?.();
}

function drawTableHeader(ctx: PdfContext, columns: PdfColumn[]) {
  const tableWidth = getTableWidth(columns);
  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - HEADER_ROW_HEIGHT,
    width: tableWidth,
    height: HEADER_ROW_HEIGHT,
    color: COLOR_TABLE_HEADER_BG,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  let x = MARGIN;
  for (const column of columns) {
    const textX =
      column.align === "right"
        ? x +
          column.width -
          CELL_PADDING_X -
          ctx.bold.widthOfTextAtSize(
            sanitizePdfText(column.label),
            TABLE_FONT_SIZE,
          )
        : x + CELL_PADDING_X;
    ctx.page.drawText(sanitizePdfText(column.label), {
      x: textX,
      y: ctx.y - HEADER_ROW_HEIGHT + CELL_PADDING_Y + 2,
      size: TABLE_FONT_SIZE,
      font: ctx.bold,
      color: COLOR_TEXT,
    });
    x += column.width;
  }
  ctx.y -= HEADER_ROW_HEIGHT;
}

function drawCommissionTable(
  ctx: PdfContext,
  params: {
    commissions: LowerWattCommission[];
    emptyMessage: string;
  },
) {
  const { commissions, emptyMessage } = params;
  const columns = getColumns(commissions);
  const tableWidth = getTableWidth(columns);
  const redrawHeader = () => drawTableHeader(ctx, columns);
  drawTableHeader(ctx, columns);

  if (commissions.length === 0) {
    const emptyLines = wrapTextToWidth({
      text: emptyMessage,
      font: ctx.font,
      fontSize: TABLE_FONT_SIZE,
      maxWidth: tableWidth - CELL_PADDING_X * 2,
      maxLines: 2,
    });
    const rowHeight =
      Math.max(emptyLines.length, 1) * TABLE_LINE_HEIGHT + CELL_PADDING_Y * 2;

    ensureSpace(ctx, rowHeight, redrawHeader);

    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      borderColor: COLOR_BORDER,
      borderWidth: 1,
    });

    let lineY = ctx.y - CELL_PADDING_Y - TABLE_FONT_SIZE;
    for (const line of emptyLines) {
      const text = sanitizePdfText(line);
      const textWidth = ctx.font.widthOfTextAtSize(text, TABLE_FONT_SIZE);
      const textX = MARGIN + (tableWidth - textWidth) / 2;
      ctx.page.drawText(text, {
        x: textX,
        y: lineY,
        size: TABLE_FONT_SIZE,
        font: ctx.font,
        color: COLOR_MUTED,
      });
      lineY -= TABLE_LINE_HEIGHT;
    }

    ctx.y -= rowHeight;
    return;
  }

  for (const item of commissions) {
    const cellLines = columns.map((column) =>
      wrapTextToWidth({
        text: getCellValue(item, column),
        font: ctx.font,
        fontSize: TABLE_FONT_SIZE,
        maxWidth: column.width - CELL_PADDING_X * 2,
        maxLines: 3,
      }),
    );

    const rowHeight =
      Math.max(...cellLines.map((lines) => lines.length), 1) *
        TABLE_LINE_HEIGHT +
      CELL_PADDING_Y * 2;

    ensureSpace(ctx, rowHeight, redrawHeader);

    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      borderColor: COLOR_BORDER,
      borderWidth: 1,
    });

    let x = MARGIN;
    for (let i = 0; i < columns.length; i++) {
      const column = columns[i]!;
      const lines = cellLines[i] ?? [""];
      let lineY = ctx.y - CELL_PADDING_Y - TABLE_FONT_SIZE;
      for (const line of lines) {
        const text = sanitizePdfText(line);
        const textX =
          column.align === "right"
            ? x +
              column.width -
              CELL_PADDING_X -
              ctx.font.widthOfTextAtSize(text, TABLE_FONT_SIZE)
            : x + CELL_PADDING_X;
        ctx.page.drawText(text, {
          x: textX,
          y: lineY,
          size: TABLE_FONT_SIZE,
          font: ctx.font,
          color: COLOR_TEXT,
        });
        lineY -= TABLE_LINE_HEIGHT;
      }
      x += column.width;
    }

    ctx.y -= rowHeight;
  }
}

function drawCommissionSection(
  ctx: PdfContext,
  params: {
    sectionTitle: string;
    commissions: LowerWattCommission[];
    emptyMessage: string;
    totalCommission: number;
  },
) {
  const { sectionTitle, commissions, emptyMessage, totalCommission } = params;

  ensureSpace(ctx, 90);
  ctx.y -= 8;
  ctx.page.drawText(sanitizePdfText(sectionTitle), {
    x: MARGIN,
    y: ctx.y,
    size: 13,
    font: ctx.bold,
    color: COLOR_TEXT,
  });
  ctx.y -= 16;

  drawCommissionTable(ctx, { commissions, emptyMessage });

  ctx.y -= 12;
  const totalsHeight = 34;
  ensureSpace(ctx, totalsHeight);
  drawPanel({
    page: ctx.page,
    x: MARGIN,
    y: ctx.y,
    width: CONTENT_WIDTH,
    height: totalsHeight,
  });
  drawMetaLine({
    page: ctx.page,
    font: ctx.font,
    bold: ctx.bold,
    x: MARGIN + 14,
    y: ctx.y - 22,
    label: "Total Commissions",
    value: formatCurrency(totalCommission),
  });
  ctx.y -= totalsHeight + 18;
}

export function buildCommissionsPdfFilename(
  payload: NormalizedRepPayload,
): string {
  const month = payload.monthTitle
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  const rep = (payload.repName?.trim() || "rep")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  return `lowerwatt_commission_${month}_${rep}.pdf`;
}

export async function buildCommissionsPdf(
  payload: NormalizedRepPayload,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const repName = payload.repName?.trim() || "Unknown Rep";
  const repEmail = payload.repEmail?.trim() || "No email provided";

  const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const headerHeight = 64;
  page.drawRectangle({
    x: MARGIN,
    y: y - headerHeight,
    width: CONTENT_WIDTH,
    height: headerHeight,
    color: COLOR_HEADER_BG,
  });
  page.drawText(sanitizePdfText("LowerWatt Commission Summary"), {
    x: MARGIN + 16,
    y: y - 28,
    size: 18,
    font: bold,
    color: COLOR_HEADER_TEXT,
  });
  page.drawText(
    sanitizePdfText(`Monthly commission report - ${payload.monthTitle}`),
    {
      x: MARGIN + 16,
      y: y - 46,
      size: 11,
      font,
      color: COLOR_HEADER_SUBTEXT,
    },
  );
  y -= headerHeight + 18;

  const metaHeight = 90;
  drawPanel({ page, x: MARGIN, y, width: CONTENT_WIDTH, height: metaHeight });
  drawMetaLine({
    page,
    font,
    bold,
    x: MARGIN + 14,
    y: y - 22,
    label: "Report Month",
    value: payload.monthTitle,
  });
  drawMetaLine({
    page,
    font,
    bold,
    x: MARGIN + 14,
    y: y - 40,
    label: "Previous Month",
    value: payload.previousMonthTitle,
  });
  drawMetaLine({
    page,
    font,
    bold,
    x: MARGIN + 14,
    y: y - 58,
    label: "Rep Name",
    value: repName,
  });
  drawMetaLine({
    page,
    font,
    bold,
    x: MARGIN + 14,
    y: y - 76,
    label: "Rep Email",
    value: repEmail,
  });
  y -= metaHeight + 18;

  const ctx: PdfContext = { pdfDoc, page, y, font, bold };

  drawCommissionSection(ctx, {
    sectionTitle: payload.monthTitle,
    commissions: payload.commissionThisMonth,
    emptyMessage: "No commission records for this month.",
    totalCommission: payload.totalCommissionThisMonth,
  });

  drawCommissionSection(ctx, {
    sectionTitle: payload.previousMonthTitle,
    commissions: payload.commissionLastMonth,
    emptyMessage: "No commission records for last month.",
    totalCommission: payload.totalCommissionLastMonth,
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
