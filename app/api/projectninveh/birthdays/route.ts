import { NextResponse } from "next/server";
import { PDFDocument, type PDFFont, StandardFonts, rgb } from "pdf-lib";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
export const runtime = "nodejs";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";
const BIRTHDAYS_PDF_FIELD_ID = "s08098302e";
const BIRTHDAYS_GENERATED_AT_FIELD_ID = "s69a246b1e";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MONTH_NAME_TO_NUM: Record<string, number> = Object.fromEntries(
  MONTH_NAMES.map((m, i) => [m.toLowerCase(), i + 1]),
);

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

type BirthdayRow = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  source: string;
  monthNum: number;
  dayNum: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceDisplayText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function extractNameParts(value: unknown): { firstName: string; lastName: string } {
  if (!isRecord(value)) {
    const full = coerceDisplayText(value);
    if (!full) return { firstName: "", lastName: "" };
    const [first, ...rest] = full.split(/\s+/).filter(Boolean);
    return { firstName: first ?? "", lastName: rest.join(" ") };
  }
  const first = coerceDisplayText(value["first_name"]);
  const last = coerceDisplayText(value["last_name"]);
  if (first || last) return { firstName: first, lastName: last };
  const root = coerceDisplayText(value["sys_root"]);
  if (!root) return { firstName: "", lastName: "" };
  const [firstPart, ...rest] = root.split(/\s+/).filter(Boolean);
  return { firstName: firstPart ?? "", lastName: rest.join(" ") };
}

function extractDateString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (value instanceof Date) return value.toISOString();
  if (isRecord(value)) {
    const candidates = [
      value["value"],
      value["date"],
      value["on"],
      value["start"],
      value["start_date"],
      value["iso"],
      value["display_value"],
      value["sys_root"],
    ];
    for (const c of candidates) {
      const s = extractDateString(c);
      if (s) return s;
    }
    const nested = extractDateString(value["data"]);
    if (nested) return nested;
  }
  return undefined;
}

function parseBirthday(value: unknown): { monthNum: number; dayNum: number; display: string } | null {
  const raw = extractDateString(value);
  if (!raw) return null;

  // ISO: YYYY-MM-DD
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const monthNum = parseInt(isoMatch[2], 10);
    const dayNum = parseInt(isoMatch[3], 10);
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return { monthNum, dayNum, display: `${MONTH_SHORT[monthNum - 1]} ${dayNum}` };
    }
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    const monthNum = parseInt(mdyMatch[1], 10);
    const dayNum = parseInt(mdyMatch[2], 10);
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return { monthNum, dayNum, display: `${MONTH_SHORT[monthNum - 1]} ${dayNum}` };
    }
  }

  // Try JS Date as last resort
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    const monthNum = d.getUTCMonth() + 1;
    const dayNum = d.getUTCDate();
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return { monthNum, dayNum, display: `${MONTH_SHORT[monthNum - 1]} ${dayNum}` };
    }
  }

  return null;
}

function parseMonthFilter(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return MONTH_NAME_TO_NUM[value.trim().toLowerCase()] ?? null;
}

function parseDateToMonthFilter(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCMonth() + 1;
}

async function fetchAllSmartSuiteRecords({
  apiKey,
  accountId,
  tableId,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
}): Promise<unknown[]> {
  const limit = 1000;
  let offset = 0;
  const all: unknown[] = [];

  while (true) {
    const response = await fetch(
      `${SMARTSUITE_API_BASE}/applications/${tableId}/records/list/`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": accountId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: { operator: "and", fields: [] },
          hydrated: true,
          limit,
          offset,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `SmartSuite list records failed: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as SmartSuiteListResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    all.push(...items);

    if (items.length < limit) break;
    offset += limit;
  }

  return all;
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
        font.widthOfTextAtSize(remaining.slice(0, sliceEnd), fontSize) > maxWidth
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

  if (!maxLines || lines.length < maxLines) lines.push(current);
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

async function generateBirthdaysPdf(
  rows: BirthdayRow[],
  monthFilter: number | null,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 21;
  const fontSize = 8;
  const lineHeight = fontSize + 2;
  const cellPaddingX = 4;
  const cellPaddingY = 3;
  const headerHeight = 20;
  const borderColor = rgb(0.8, 0.8, 0.8);
  const headerBg = rgb(0.95, 0.95, 0.95);
  const groupBg = rgb(0.9, 0.95, 1);

  const columns: Array<{ label: string; width: number; key: keyof BirthdayRow }> = [
    { key: "firstName", label: "First Name", width: 120 },
    { key: "lastName", label: "Last Name", width: 120 },
    { key: "dateOfBirth", label: "Date of Birth", width: 70 },
    { key: "source", label: "Table", width: 100 },
  ];

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const titleLabel = monthFilter
    ? `Project Ninveh – Birthdays: ${MONTH_NAMES[monthFilter - 1]}`
    : "Project Ninveh – All Birthdays";

  const drawPageHeader = () => {
    page.drawText(titleLabel, {
      x: margin,
      y,
      size: 14,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= 18;
    page.drawText(`Generated: ${new Date().toLocaleString("en-US")}   |   ${rows.length} record${rows.length === 1 ? "" : "s"}`, {
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
      drawPageHeader();
      drawTableHeader();
    }
  };

  const drawTableHeader = () => {
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
      page.drawText(col.label, {
        x: x + cellPaddingX,
        y: y - cellPaddingY - fontSize,
        size: fontSize,
        font: bold,
        color: rgb(0, 0, 0),
      });
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

  const drawGroupHeader = (label: string) => {
    const groupHeight = 20;
    ensureSpace(groupHeight);
    page.drawRectangle({
      x: margin,
      y: y - groupHeight,
      width: totalWidth,
      height: groupHeight,
      borderColor,
      borderWidth: 1,
      color: groupBg,
    });
    page.drawText(label, {
      x: margin + 4,
      y: y - groupHeight + 6,
      size: 10,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= groupHeight;
  };

  const drawDataRow = (row: BirthdayRow) => {
    const cellTexts = columns.map((col) => String(row[col.key] ?? ""));
    const maxLineCounts = columns.map((col, i) =>
      wrapTextToWidth({
        text: cellTexts[i],
        font,
        fontSize,
        maxWidth: col.width - cellPaddingX * 2,
      }).length,
    );
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
    });

    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const lines = wrapTextToWidth({
        text: cellTexts[i],
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

  drawPageHeader();
  drawTableHeader();

  const groups = new Map<number, BirthdayRow[]>();
  for (const row of rows) {
    const list = groups.get(row.monthNum) ?? [];
    list.push(row);
    groups.set(row.monthNum, list);
  }

  const sortedMonths = Array.from(groups.keys()).sort((a, b) => a - b);

  for (const monthNum of sortedMonths) {
    const groupRows = groups.get(monthNum) ?? [];
    groupRows.sort((a, b) => {
      if (a.dayNum !== b.dayNum) return a.dayNum - b.dayNum;
      const last = a.lastName.localeCompare(b.lastName, "en", { sensitivity: "base" });
      if (last !== 0) return last;
      return a.firstName.localeCompare(b.firstName, "en", { sensitivity: "base" });
    });
    drawGroupHeader(`${MONTH_NAMES[monthNum - 1]} (${groupRows.length})`);
    for (const row of groupRows) drawDataRow(row);
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
      `[PROJECT_NINVEH] Failed to clear existing file field: ${response.status} ${text}`,
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

async function patchSmartSuiteRecordFields({
  apiKey,
  accountId,
  tableId,
  recordId,
  fields,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
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
      body: JSON.stringify(fields),
    },
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `SmartSuite record update failed: ${response.status} ${errorText}`,
    );
  }
}

function collectRows(
  records: unknown[],
  source: string,
  nameFieldId: string,
  birthdayFieldId: string,
  monthFilter: number | null,
): BirthdayRow[] {
  const rows: BirthdayRow[] = [];
  for (const record of records) {
    if (!isRecord(record)) continue;
    const { firstName, lastName } = extractNameParts(record[nameFieldId]);
    const bday = parseBirthday(record[birthdayFieldId]);
    if (!bday) continue;
    if (monthFilter !== null && bday.monthNum !== monthFilter) continue;
    rows.push({
      firstName,
      lastName,
      dateOfBirth: bday.display,
      source,
      monthNum: bday.monthNum,
      dayNum: bday.dayNum,
    });
  }
  return rows;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(req: Request) {
  try {
    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      // no body or invalid JSON — treat as no filter
    }

    const monthFilter = (() => {
      if (!isRecord(body)) return null;
      const fromDate = parseDateToMonthFilter(body["date"]);
      if (fromDate !== null) return fromDate;
      return parseMonthFilter(body["month"]);
    })();

    const apiKey = requireEnv("PROJECT_NINVEH_SMARTSUITE_API_KEY");
    const accountId = requireEnv("PROJECT_NINVEH_SMARTSUITE_ACCOUNT_ID");
    const committeeTableId = requireEnv("PROJECT_NINVEH_SMARTSUITE_COMMITTEE_TABLE_ID");
    const partnerAdvocatesTableId = requireEnv("PROJECT_NINVEH_SMARTSUITE_PARTNER_ADVOCATES_TABLE_ID");
    const singlesTableId = requireEnv("PROJECT_NINVEH_SMARTSUITE_SINGLES_TABLE_ID");
    const reportsTableId = requireEnv("PROJECT_NINVEH_SMARTSUITE_REPORTS_TABLE_ID");
    const reportsRecordId = requireEnv("PROJECT_NINVEH_SMARTSUITE_REPORTS_RECORD_ID");

    const [committeeRecords, partnerAdvocatesRecords, singlesRecords] =
      await Promise.all([
        fetchAllSmartSuiteRecords({ apiKey, accountId, tableId: committeeTableId }),
        fetchAllSmartSuiteRecords({ apiKey, accountId, tableId: partnerAdvocatesTableId }),
        fetchAllSmartSuiteRecords({ apiKey, accountId, tableId: singlesTableId }),
      ]);

    const rows: BirthdayRow[] = [
      ...collectRows(committeeRecords, "Committee", "s136335e0e", "birthday", monthFilter),
      ...collectRows(partnerAdvocatesRecords, "Partner Advocate", "s136335e0e", "birthday", monthFilter),
      ...collectRows(singlesRecords, "Single", "singles_name", "s4b6358f05", monthFilter),
    ];

    const pdfBuffer = await generateBirthdaysPdf(rows, monthFilter);
    const monthSuffix = monthFilter ? `_${MONTH_NAMES[monthFilter - 1].toLowerCase()}` : "_all";
    const filename = `birthdays${monthSuffix}_${new Date().toISOString().slice(0, 10)}.pdf`;
    const generatedAtIso = new Date().toISOString();

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: BIRTHDAYS_PDF_FIELD_ID,
    });

    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: BIRTHDAYS_PDF_FIELD_ID,
      buffer: pdfBuffer,
      filename,
      contentType: "application/pdf",
    });

    await patchSmartSuiteRecordFields({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fields: {
        [BIRTHDAYS_GENERATED_AT_FIELD_ID]: generatedAtIso,
      },
    });

    return NextResponse.json(
      {
        message: "Birthdays PDF generated and uploaded to SmartSuite",
        recordCount: rows.length,
        monthFilter: monthFilter ? MONTH_NAMES[monthFilter - 1] : null,
        reportsTableId,
        reportsRecordId,
        reportsFieldId: BIRTHDAYS_PDF_FIELD_ID,
        generatedAtFieldId: BIRTHDAYS_GENERATED_AT_FIELD_ID,
        generatedAt: generatedAtIso,
        filename,
        pdfSizeBytes: pdfBuffer.length,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[PROJECT_NINVEH] birthdays error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate/upload birthdays PDF",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
