import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";

const DELIVERY_LIST_TABLE_ID = "6925af29a4002f833ea5a0e8";

// Filters
// Delivery List lookup field that points to Distribution Schedules → Package Type
const PACKAGE_TYPE_FIELD_ID = "sa8cc7c261";
const PACKAGE_TYPE_PESACH_VALUE_ID = "nuNTD";
const PACKAGE_YEAR_FIELD_ID = "s008955138";

// Fields to include in the report
const ID_FIELD_ID = "s1c36a8396";
const CARDS_TOTAL_FIELD_ID = "s83940c544";
const CARDS_ACTUAL_FIELD_ID = "s649361439";
const FIRST_NAME_FIELD_ID = "sbrcclv0";
const LAST_NAME_FIELD_ID = "s305be42b5";
const ADDRESS_FIELD_ID = "s01b42a1e2";
const WINE_BOTTLES_FIELD_ID = "s6c00bb5b1";

// Target report record / field
// Table id provided for the "Reports" app
const REPORTS_TABLE_ID = "69af983fd4df284d80aa4f6b";
const REPORTS_RECORD_ID = "69afea9689052b7b2c10cdca";
const REPORTS_FILE_FIELD_ID = "s70d15f822";
const REPORTS_FILE_FIELD_ID_BY_ID = "sb447c8ca2";
const REPORTS_LAST_CREATED_FIELD_ID = "s1c5f28ecd";

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

type DeliveryRow = {
  id: string;
  wineBottles: string;
  firstName: string;
  lastName: string;
  address: string;
  cardsTotal: string;
  cardsActual: string;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceDisplayText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => coerceDisplayText(v))
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.join(", ");
  }
  if (isRecord(value)) {
    const candidates = [
      value["display_value"],
      value["label"],
      value["name"],
      value["title"],
      value["sys_root"],
      value["value"],
    ];
    for (const c of candidates) {
      const s = coerceDisplayText(c);
      if (s) return s;
    }
    return "";
  }
  const text = String(value).trim();
  if (/^\[object\s+.+\]$/i.test(text)) return "";
  return text;
}

function wrapTextToWidth({
  text,
  font,
  fontSize,
  maxWidth,
  maxLines,
}: {
  text: string;
  font: PDFFont;
  fontSize: number;
  maxWidth: number;
  maxLines?: number;
}): string[] {
  const cleaned = (text ?? "").trim();
  if (!cleaned) return [""];

  const words = cleaned.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  const pushWrappedWord = (word: string) => {
    let remaining = word;
    while (remaining.length > 0) {
      let sliceEnd = remaining.length;
      while (
        sliceEnd > 1 &&
        font.widthOfTextAtSize(remaining.slice(0, sliceEnd), fontSize) >
          maxWidth
      ) {
        sliceEnd -= 1;
      }
      if (sliceEnd <= 0) sliceEnd = 1;
      lines.push(remaining.slice(0, sliceEnd));
      remaining = remaining.slice(sliceEnd);
    }
  };

  for (const word of words) {
    if (!current && font.widthOfTextAtSize(word, fontSize) > maxWidth) {
      pushWrappedWord(word);
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (maxLines && lines.length >= maxLines) break;
  }

  if (!maxLines || lines.length < maxLines) {
    lines.push(current);
  }

  if (maxLines && lines.length > maxLines) return lines.slice(0, maxLines);

  if (maxLines && lines.length === maxLines) {
    const joined = words.join(" ");
    const rendered = lines.join(" ");
    if (joined.length > rendered.length) {
      let last = lines[lines.length - 1];
      while (
        last.length > 0 &&
        font.widthOfTextAtSize(`${last}…`, fontSize) > maxWidth
      ) {
        last = last.slice(0, -1);
      }
      lines[lines.length - 1] = `${last}…`;
    }
  }

  return lines;
}

async function fetchPesachDeliveryRecords({
  apiKey,
  accountId,
  year,
}: {
  apiKey: string;
  accountId: string;
  year: number;
}): Promise<unknown[]> {
  const fromDateValue = {
    date_mode: "exact_date",
    date_mode_value: `${year}-01-01`,
  };
  const toDateValue = {
    date_mode: "exact_date",
    date_mode_value: `${year}-12-31`,
  };

  const response = await fetch(
    `${SMARTSUITE_API_BASE}/applications/${DELIVERY_LIST_TABLE_ID}/records/list/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          operator: "and",
          fields: [
            {
              field: PACKAGE_TYPE_FIELD_ID,
              comparison: "is",
              value: PACKAGE_TYPE_PESACH_VALUE_ID,
            },
            {
              field: PACKAGE_YEAR_FIELD_ID,
              comparison: "is_on_or_after",
              value: fromDateValue,
            },
            {
              field: PACKAGE_YEAR_FIELD_ID,
              comparison: "is_on_or_before",
              value: toDateValue,
            },
          ],
        },
        hydrated: true,
        limit: 1000,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `SmartSuite list records failed: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as SmartSuiteListResponse;
  return Array.isArray(data.items) ? data.items : [];
}

function mapToDeliveryRows(rawRecords: unknown[]): DeliveryRow[] {
  const rows: DeliveryRow[] = [];

  for (const record of rawRecords) {
    if (!isRecord(record)) continue;

    const id = coerceDisplayText(record[ID_FIELD_ID]);
    const wineBottles = coerceDisplayText(record[WINE_BOTTLES_FIELD_ID]);
    const firstName = coerceDisplayText(record[FIRST_NAME_FIELD_ID]);
    const lastName = coerceDisplayText(record[LAST_NAME_FIELD_ID]);
    const address = coerceDisplayText(record[ADDRESS_FIELD_ID]);
    const cardsTotal = coerceDisplayText(record[CARDS_TOTAL_FIELD_ID]);
    const cardsActual = coerceDisplayText(record[CARDS_ACTUAL_FIELD_ID]);

    rows.push({
      id,
      wineBottles,
      firstName,
      lastName,
      address,
      cardsTotal,
      cardsActual,
    });
  }

  return rows;
}

async function generatePesachDeliveryPdf(
  rows: DeliveryRow[],
  year: number,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 21;
  const headerHeight = 40;
  const fontSize = 8;
  const lineHeight = fontSize + 2;
  const cellPaddingX = 3;
  const cellPaddingY = 3;
  const borderColor = rgb(0.8, 0.8, 0.8);
  const headerBg = rgb(0.95, 0.95, 0.95);

  const columns: Array<{
    key: keyof DeliveryRow;
    label: string;
    width: number;
  }> = [
    { key: "id", label: "ID#", width: 45 },
    { key: "wineBottles", label: "Wine Bottles Total", width: 50 },
    { key: "firstName", label: "First Name", width: 70 },
    { key: "lastName", label: "Last Name", width: 70 },
    { key: "address", label: "Address", width: 138 },
    { key: "cardsTotal", label: "Cards Total", width: 55 },
    { key: "cardsActual", label: "Cards Actual", width: 60 },
    { key: "id", label: "ID#", width: 35 },
  ];

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const maxWidth = pageWidth - margin * 2;
  if (totalWidth > maxWidth) {
    throw new Error(
      `PDF columns exceed width (${totalWidth} > ${maxWidth}). Adjust column widths.`,
    );
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = () => {
    const title = `Tomchei Shabbos - Pesach Delivery List (${year})`;
    page.drawText(title, {
      x: margin,
      y,
      size: 14,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= 18;
    page.drawText(`Generated: ${new Date().toLocaleString("en-US")}`, {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 14;
    page.drawText(`Total records: ${rows.length}`, {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 16;
  };

  const ensureSpace = (height: number) => {
    if (y - height < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawHeader();
      drawTableHeader();
    }
  };

  const drawTableHeader = () => {
    ensureSpace(headerHeight);
    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: totalWidth,
      height: headerHeight,
      borderColor,
      borderWidth: 1,
      color: headerBg,
    });
    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const lines = wrapTextToWidth({
        text: col.label,
        font: bold,
        fontSize,
        maxWidth: col.width - cellPaddingX * 2,
        maxLines: 3,
      });
      let textY = y - cellPaddingY - fontSize;
      for (const line of lines) {
        page.drawText(line, {
          x: x + cellPaddingX,
          y: textY,
          size: fontSize,
          font: bold,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight;
      }
      if (i < columns.length - 1) {
        page.drawLine({
          start: { x: x + col.width, y },
          end: { x: x + col.width, y: y - headerHeight },
          color: borderColor,
          thickness: 1,
        });
      }
      x += col.width;
    }
    y -= headerHeight;
  };

  const drawDataRow = (row: DeliveryRow) => {
    const maxLineCounts = columns.map((col) => {
      const text = row[col.key] ?? "";
      const lines = wrapTextToWidth({
        text,
        font,
        fontSize,
        maxWidth: col.width - cellPaddingX * 2,
      });
      return lines.length;
    });
    const rowHeight = Math.max(
      lineHeight + cellPaddingY * 2,
      Math.max(...maxLineCounts) * lineHeight + cellPaddingY * 2,
    );

    ensureSpace(rowHeight);

    page.drawRectangle({
      x: margin,
      y: y - rowHeight,
      width: totalWidth,
      height: rowHeight,
      borderColor,
      borderWidth: 1,
      color: undefined,
    });

    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const text = row[col.key] ?? "";
      const lines = wrapTextToWidth({
        text,
        font,
        fontSize,
        maxWidth: col.width - cellPaddingX * 2,
      });
      let textY = y - cellPaddingY - fontSize;
      for (const line of lines) {
        page.drawText(line, {
          x: x + cellPaddingX,
          y: textY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        textY -= lineHeight;
      }
      if (i < columns.length - 1) {
        page.drawLine({
          start: { x: x + col.width, y },
          end: { x: x + col.width, y: y - rowHeight },
          color: borderColor,
          thickness: 1,
        });
      }
      x += col.width;
    }
    y -= rowHeight;
  };

  drawHeader();
  drawTableHeader();

  for (let i = 0; i < rows.length; i++) {
    drawDataRow(rows[i]);
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function clearSmartSuiteFileField({
  apiKey,
  accountId,
  tableId,
  recordId,
  fieldId,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
}) {
  const response = await fetch(
    `${SMARTSUITE_API_BASE}/applications/${tableId}/records/${recordId}/`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ [fieldId]: null }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      `[TOMCHEI_SHABBOS] Failed to clear existing file field: ${response.status} ${text}`,
    );
  }
}

async function uploadSmartSuiteFileToRecord({
  apiKey,
  accountId,
  tableId,
  recordId,
  fieldId,
  buffer,
  filename,
  contentType,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
  buffer: Buffer;
  filename: string;
  contentType: string;
}) {
  const formData = new FormData();
  const bytes = new Uint8Array(buffer);
  const blob = new Blob([bytes], { type: contentType });
  formData.append("files", blob, filename);
  formData.append("filename", filename);

  const response = await fetch(
    `${SMARTSUITE_API_BASE}/recordfiles/${tableId}/${recordId}/${fieldId}/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite file upload failed: ${response.status} ${errorText}`,
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(req: Request) {
  try {
    const apiKey = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_API_KEY");
    const accountId = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID");

    const body = await req.json().catch(() => ({}));
    const packageDateRaw =
      body && typeof body === "object" && "PackageDate" in body
        ? (body as { PackageDate?: unknown }).PackageDate
        : undefined;

    if (!packageDateRaw || typeof packageDateRaw !== "string") {
      return NextResponse.json(
        { error: "Invalid or missing 'PackageDate' in request body" },
        { status: 400, headers: corsHeaders() },
      );
    }

    const parsedDate = new Date(packageDateRaw);
    const yearNum = parsedDate.getFullYear();

    if (isNaN(yearNum) || String(yearNum).length !== 4) {
      return NextResponse.json(
        { error: "'PackageDate' is not a valid date" },
        { status: 400, headers: corsHeaders() },
      );
    }

    const records = await fetchPesachDeliveryRecords({
      apiKey,
      accountId,
      year: yearNum,
    });

    const rows = mapToDeliveryRows(records);
    rows.sort((a, b) => a.lastName.localeCompare(b.lastName));
    const pdfBuffer = await generatePesachDeliveryPdf(rows, yearNum);
    const filename = `tomchei_pesach_delivery_${yearNum}.pdf`;

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: REPORTS_TABLE_ID,
      recordId: REPORTS_RECORD_ID,
      fieldId: REPORTS_FILE_FIELD_ID,
    });

    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: REPORTS_TABLE_ID,
      recordId: REPORTS_RECORD_ID,
      fieldId: REPORTS_FILE_FIELD_ID,
      buffer: pdfBuffer,
      filename,
      contentType: "application/pdf",
    });

    // Second report: same data sorted by id (lowest to highest)
    const rowsById = [...rows].sort((a, b) => {
      const numA = Number(a.id);
      const numB = Number(b.id);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
    const pdfBufferById = await generatePesachDeliveryPdf(rowsById, yearNum);
    const filenameById = `tomchei_pesach_delivery_${yearNum}_by_id.pdf`;

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: REPORTS_TABLE_ID,
      recordId: REPORTS_RECORD_ID,
      fieldId: REPORTS_FILE_FIELD_ID_BY_ID,
    });

    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: REPORTS_TABLE_ID,
      recordId: REPORTS_RECORD_ID,
      fieldId: REPORTS_FILE_FIELD_ID_BY_ID,
      buffer: pdfBufferById,
      filename: filenameById,
      contentType: "application/pdf",
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await fetch(
      `${SMARTSUITE_API_BASE}/applications/${REPORTS_TABLE_ID}/records/${REPORTS_RECORD_ID}/`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": accountId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [REPORTS_LAST_CREATED_FIELD_ID]: new Date().toISOString(),
        }),
      },
    );

    return NextResponse.json(
      {
        message:
          "Tomchei Shabbos Pesach delivery PDFs generated and uploaded to SmartSuite",
        year: yearNum,
        recordCount: rows.length,
        reportsTableId: REPORTS_TABLE_ID,
        reportsRecordId: REPORTS_RECORD_ID,
        byLastName: {
          reportsFieldId: REPORTS_FILE_FIELD_ID,
          filename,
          pdfSizeBytes: pdfBuffer.length,
        },
        byId: {
          reportsFieldId: REPORTS_FILE_FIELD_ID_BY_ID,
          filename: filenameById,
          pdfSizeBytes: pdfBufferById.length,
        },
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[TOMCHEI_SHABBOS] delivery-list-export error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate/upload Tomchei Shabbos delivery PDF",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
