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
const PARTNER_ADVOCATES_PDF_FIELD_ID = "s2fa7998f1";
const PARTNER_ADVOCATES_GENERATED_AT_FIELD_ID = "se859c9fce";

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

const PARTNER_PREFERENCE_FIELD_ID = "sc11a3c496";
const SINGLES_SUBMITTED_FIELD_ID = "s8f1e0b31f";
const PARTNER_PREFERENCE_YES = "yzzsI";
const PARTNER_PREFERENCE_NO = "ndBgJ";
/** Also accept alternate IDs from API: yzzs1 = Yes, ndug = No */
const PARTNER_PREFERENCE_YES_ALT = "yzzs1";
const PARTNER_PREFERENCE_NO_ALT = "ndug";
/** SmartSuite field id for Date of Birth. Override with PROJECT_NINVEH_SMARTSUITE_PARTNER_ADVOCATES_BIRTHDAY_FIELD_ID if "birthday" key is empty. */
const BIRTHDAY_FIELD_ID =
  process.env.PROJECT_NINVEH_SMARTSUITE_PARTNER_ADVOCATES_BIRTHDAY_FIELD_ID ??
  "birthday";

const EMAIL_FIELD_ID = "email";
const PHONE_NUMBER_FIELD_ID = "phone_number";
const CATEGORY_TYPE_FIELD_ID = "category_type";
const PROFESSION_FIELD_ID = "sf4b9aaf6b";
const SINGLES_NAME_FIELD_ID = "s002a13c45";
const SINGLES_BIRTHDAY_FIELD_ID = "smvqck9w";
const SINGLES_LONG_TERM_PLAN_FIELD_ID = "sd505ede9d";
const FIRST_CREATED_FIELD_ID = "first_created";

type PartnerAdvocateRow = {
  email: string;
  phoneNumber: string;
  categoryType: string;
  profession: string;
  partnerPreferenceDisplay: string;
  singlesName: string;
  singlesAge: string;
  singlesLongTermPlan: string;
  appliedAt: string;
  firstName: string;
  lastName: string;
  city: string;
  status: string;
  dateOfBirth: string;
  followUpRequired: boolean;
  teamId: string;
  /** "yzzsI" / "yzzs1" = Yes have partner, "ndBgJ" / "ndug" = No please pair me */
  partnerPreference: string;
  /** Singles Submitted as text (number) */
  singlesSubmitted: string;
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

function extractNameParts(value: unknown): {
  firstName: string;
  lastName: string;
} {
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

function extractAddressCity(value: unknown): string {
  if (isRecord(value)) {
    const city = coerceDisplayText(value["location_city"]);
    if (city) return city;
    const nestedCandidates = [value["display_value"], value["sys_root"]];
    for (const candidate of nestedCandidates) {
      const text = coerceDisplayText(candidate);
      if (text) return text;
    }
  }
  return coerceDisplayText(value);
}

/** Get a single date string from SmartSuite date field (value, date, on, display_value, etc.). */
function extractDateString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && !Number.isNaN(value)) return String(value);
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
  }
  return "";
}

function extractMonthDay(value: unknown): string {
  const raw = extractDateString(value) || coerceDisplayText(value);
  if (!raw) return "";
  // Matches ISO date strings like "1990-05-15" or "1990-05-15T..."
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${monthNames[month - 1] ?? match[2]} ${day}`;
  }
  return raw;
}

/** Compute age in years from SmartSuite date object (e.g. Single's Birthday). */
function extractAgeFromDate(value: unknown): string {
  const raw = extractDateString(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const birthYear = parseInt(match[1], 10);
  const birthMonth = parseInt(match[2], 10);
  const birthDay = parseInt(match[3], 10);
  const now = new Date();
  let age = now.getFullYear() - birthYear;
  if (
    now.getMonth() + 1 < birthMonth ||
    (now.getMonth() + 1 === birthMonth && now.getDate() < birthDay)
  ) {
    age -= 1;
  }
  return age >= 0 ? String(age) : "";
}

/** Join array of strings/objects into one display string (e.g. category_type, long term plan). */
function extractArrayDisplay(value: unknown): string {
  if (value == null) return "";
  if (!Array.isArray(value)) return coerceDisplayText(value);
  const parts = value.map((v) => coerceDisplayText(v)).filter(Boolean);
  return parts.join(", ");
}

/** Singles Name field: array of objects with first_name, last_name, sys_root. */
function extractSinglesNameDisplay(value: unknown): string {
  if (value == null) return "";
  if (!Array.isArray(value)) return coerceDisplayText(value);
  const names = value.map((v) => coerceDisplayText(v)).filter(Boolean);
  return names.join(", ");
}

/** Format first_created / applied at as readable date. */
function formatAppliedAt(value: unknown): string {
  const raw = extractDateString(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  const [, y, m, d] = match;
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[parseInt(m ?? "1", 10) - 1]} ${d}, ${y}`;
}

function extractFollowUpRequired(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value.toLowerCase() === "yes";
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

/** Extract select option id (e.g. "yzzsI", "ndBgJ") from SmartSuite field value. */
function extractSelectValueId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (!isRecord(value)) return "";
  const options = value["selected_options"];
  if (Array.isArray(options) && options.length > 0 && isRecord(options[0])) {
    const id =
      (options[0]["value"] as string) ??
      (options[0]["id"] as string) ??
      coerceDisplayText(options[0]);
    return typeof id === "string" ? id.trim() : "";
  }
  const id =
    (value["value"] as string) ??
    (value["id"] as string) ??
    coerceDisplayText(value);
  return typeof id === "string" ? id.trim() : "";
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

async function generatePartnerAdvocatesPdf(
  rows: PartnerAdvocateRow[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 21;
  const fontSize = 7;
  const lineHeight = fontSize + 2;
  const cellPaddingX = 3;
  const cellPaddingY = 3;
  const headerHeight = 36;
  const borderColor = rgb(0.8, 0.8, 0.8);
  const headerBg = rgb(0.95, 0.95, 0.95);
  const rowHighlightBg = rgb(1, 0.82, 0.82);
  const rowGreen = rgb(0.82, 1, 0.82);
  const rowYellow = rgb(1, 1, 0.82);
  const rowRed = rgb(1, 0.82, 0.82);

  /** No → red (preference). Yes + singles ≥ 1 → green. Yes + singles < 1 → yellow. */
  const isNoPartnerPreference = (pref: string) =>
    pref === PARTNER_PREFERENCE_NO || pref === PARTNER_PREFERENCE_NO_ALT;
  const isYesPartnerPreference = (pref: string) =>
    pref === PARTNER_PREFERENCE_YES || pref === PARTNER_PREFERENCE_YES_ALT;
  const getRowShade = (row: PartnerAdvocateRow) => {
    const pref = row.partnerPreference;
    const raw = (row.singlesSubmitted ?? "").trim();
    const num = raw === "" ? NaN : parseInt(raw, 10);
    const hasSingles = !Number.isNaN(num) && num >= 1;
    if (isNoPartnerPreference(pref)) return rowRed;
    if (isYesPartnerPreference(pref) && hasSingles) return rowGreen;
    if (isYesPartnerPreference(pref) && !hasSingles) return rowYellow;
    return undefined;
  };

  type RowKey = keyof Omit<PartnerAdvocateRow, "followUpRequired">;

  const columns: Array<{
    key: RowKey | "followUpRequired" | "rowNum";
    label: string;
    width: number;
  }> = [
    { key: "rowNum", label: "", width: 20 },
    { key: "firstName", label: "First Name", width: 36 },
    { key: "lastName", label: "Last Name", width: 36 },
    { key: "appliedAt", label: "Application Date", width: 33 },
    { key: "status", label: "Partner Advocate Status", width: 72 },
    { key: "city", label: "City", width: 36 },
    { key: "email", label: "Email", width: 38 },
    { key: "phoneNumber", label: "Phone Number", width: 36 },
    { key: "categoryType", label: "Your Category Type", width: 38 },
    { key: "profession", label: "Profession", width: 33 },
    { key: "partnerPreferenceDisplay", label: "Partner up with?", width: 40 },
    { key: "singlesName", label: "Singles Name", width: 40 },
    { key: "singlesAge", label: "Singles Age", width: 20 },
    { key: "singlesLongTermPlan", label: "Long Term Plan", width: 40 },
    { key: "dateOfBirth", label: "Date of Birth", width: 33 },
  ];

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const maxWidth = pageWidth - margin * 2;
  if (totalWidth > maxWidth) {
    throw new Error(`PDF columns exceed width (${totalWidth} > ${maxWidth}).`);
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = () => {
    const title = `Project Ninveh - Partner Advocates Export (${rows.length} rows)`;
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

  const groupBg = rgb(0.9, 0.95, 1);

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
    page.drawText(`Team: ${label}`, {
      x: margin + 4,
      y: y - groupHeight + 6,
      size: 10,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= groupHeight;
  };

  const drawDataRow = (row: PartnerAdvocateRow, rowIndex: number) => {
    const getCellText = (key: (typeof columns)[number]["key"]): string => {
      if (key === "rowNum") return String(rowIndex);
      if (key === "followUpRequired")
        return row.followUpRequired ? "Yes" : "No";
      return (row[key as RowKey] ?? "") as string;
    };

    const maxLineCounts = columns.map((col) => {
      const lines = wrapTextToWidth({
        text: getCellText(col.key),
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
    const shade = getRowShade(row);
    const rowBg = shade ?? (row.followUpRequired ? rowHighlightBg : undefined);
    page.drawRectangle({
      x: margin,
      y: y - rowHeight,
      width: totalWidth,
      height: rowHeight,
      borderColor,
      borderWidth: 1,
      color: rowBg,
    });

    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const cellText = getCellText(col.key);
      const lines = wrapTextToWidth({
        text: cellText,
        font,
        fontSize,
        maxWidth: col.width - cellPaddingX * 2,
      });
      if (col.key === "rowNum") {
        const line = lines[0] ?? "";
        const textWidth = font.widthOfTextAtSize(line, fontSize);
        const centerX = x + col.width / 2 - textWidth / 2;
        const centerY = y - rowHeight / 2 - fontSize / 2;
        page.drawText(line, {
          x: centerX,
          y: centerY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      } else {
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

  const groups = new Map<string, PartnerAdvocateRow[]>();
  for (const row of rows) {
    const key = row.teamId || "No Team";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "No Team" && b !== "No Team") return 1;
    if (b === "No Team" && a !== "No Team") return -1;
    return a.localeCompare(b, "en", { sensitivity: "base" });
  });

  let rowNumber = 0;
  for (const groupKey of sortedGroupKeys) {
    drawGroupHeader(groupKey);
    const groupRows = groups.get(groupKey) ?? [];
    groupRows.sort((a, b) => {
      const last = a.lastName.localeCompare(b.lastName, "en", {
        sensitivity: "base",
      });
      if (last !== 0) return last;
      return a.firstName.localeCompare(b.firstName, "en", {
        sensitivity: "base",
      });
    });
    for (const row of groupRows) {
      rowNumber += 1;
      drawDataRow(row, rowNumber);
    }
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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(req: Request) {
  try {
    void req;
    const apiKey = requireEnv("PROJECT_NINVEH_SMARTSUITE_API_KEY");
    const accountId = requireEnv("PROJECT_NINVEH_SMARTSUITE_ACCOUNT_ID");
    const partnerAdvocatesTableId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_PARTNER_ADVOCATES_TABLE_ID",
    );
    const reportsTableId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_REPORTS_TABLE_ID",
    );
    const reportsRecordId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_REPORTS_RECORD_ID",
    );

    const records = await fetchAllSmartSuiteRecords({
      apiKey,
      accountId,
      tableId: partnerAdvocatesTableId,
    });

    const rows: PartnerAdvocateRow[] = [];

    for (const record of records) {
      if (!isRecord(record)) continue;

      const { firstName, lastName } = extractNameParts(record["s136335e0e"]);
      const city = extractAddressCity(record["sd6a02d6e2"]);
      const status = coerceDisplayText(record["sccc2d121d"]);
      const dateOfBirth = extractMonthDay(record[BIRTHDAY_FIELD_ID]);
      const followUpRequired = extractFollowUpRequired(record["sd2f734dc1"]);
      const teamId = coerceDisplayText(record["sd0282f4f0"]);
      const partnerPreference = extractSelectValueId(
        record[PARTNER_PREFERENCE_FIELD_ID],
      );
      const singlesSubmitted = coerceDisplayText(
        record[SINGLES_SUBMITTED_FIELD_ID],
      );

      const email = coerceDisplayText(record[EMAIL_FIELD_ID]);
      const phoneNumber = coerceDisplayText(record[PHONE_NUMBER_FIELD_ID]);
      const categoryType = extractArrayDisplay(record[CATEGORY_TYPE_FIELD_ID]);
      const profession = coerceDisplayText(record[PROFESSION_FIELD_ID]);
      const partnerPreferenceDisplay =
        partnerPreference === PARTNER_PREFERENCE_YES ||
        partnerPreference === PARTNER_PREFERENCE_YES_ALT
          ? "Yes"
          : partnerPreference === PARTNER_PREFERENCE_NO ||
              partnerPreference === PARTNER_PREFERENCE_NO_ALT
            ? "No"
            : "";
      const singlesName = extractSinglesNameDisplay(
        record[SINGLES_NAME_FIELD_ID],
      );
      const singlesAge = extractAgeFromDate(record[SINGLES_BIRTHDAY_FIELD_ID]);
      const singlesLongTermPlan = extractArrayDisplay(
        record[SINGLES_LONG_TERM_PLAN_FIELD_ID],
      );
      const appliedAt = formatAppliedAt(record[FIRST_CREATED_FIELD_ID]);

      rows.push({
        email,
        phoneNumber,
        categoryType,
        profession,
        partnerPreferenceDisplay,
        singlesName,
        singlesAge,
        singlesLongTermPlan,
        appliedAt,
        firstName,
        lastName,
        city,
        status,
        dateOfBirth,
        followUpRequired,
        teamId,
        partnerPreference,
        singlesSubmitted,
      });
    }

    const pdfBuffer = await generatePartnerAdvocatesPdf(rows);
    const filename = `partner_advocates_${new Date().toISOString().slice(0, 10)}.pdf`;
    const generatedAtIso = new Date().toISOString();

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: PARTNER_ADVOCATES_PDF_FIELD_ID,
    });

    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: PARTNER_ADVOCATES_PDF_FIELD_ID,
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
        [PARTNER_ADVOCATES_GENERATED_AT_FIELD_ID]: generatedAtIso,
      },
    });

    return NextResponse.json(
      {
        message: "Partner Advocates PDF generated and uploaded to SmartSuite",
        recordCount: rows.length,
        reportsTableId,
        reportsRecordId,
        reportsFieldId: PARTNER_ADVOCATES_PDF_FIELD_ID,
        generatedAtFieldId: PARTNER_ADVOCATES_GENERATED_AT_FIELD_ID,
        generatedAt: generatedAtIso,
        filename,
        pdfSizeBytes: pdfBuffer.length,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[PROJECT_NINVEH] partner-advocates-pdf error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate/upload partner advocates PDF",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
