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
const REPORTS_PDF_FIELD_ID = "s6fa7ab794";
const REPORTS_GENERATED_AT_FIELD_ID = "sd3609996a";

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

type BasicCommitteeRow = {
  firstName: string;
  lastName: string;
  role: string;
  city: string;
  telephone: string;
  email: string;
  approvedFor: string;
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

function extractMultiSelectLabels(value: unknown): string[] {
  if (!value) return [];

  const labels: string[] = [];
  const add = (candidate: unknown) => {
    const text = coerceDisplayText(candidate);
    if (text) labels.push(text);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) {
        add(
          item["label"] ??
            item["display_value"] ??
            item["title"] ??
            item["name"] ??
            item["sys_root"] ??
            item["value"],
        );
      } else {
        add(item);
      }
    }
  } else if (isRecord(value)) {
    const options = value["selected_options"];
    if (Array.isArray(options)) {
      for (const option of options) {
        if (isRecord(option)) {
          add(
            option["label"] ??
              option["display_value"] ??
              option["title"] ??
              option["name"] ??
              option["sys_root"] ??
              option["value"],
          );
        } else {
          add(option);
        }
      }
    } else {
      add(
        value["display_value"] ??
          value["label"] ??
          value["name"] ??
          value["title"] ??
          value["sys_root"] ??
          value["value"],
      );
    }
  } else {
    add(value);
  }

  return Array.from(
    new Set(
      labels
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/\s+/g, " ")),
    ),
  );
}

function extractPhoneNumber(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (isRecord(item)) {
          return coerceDisplayText(
            item["phone_number"] ?? item["display_value"] ?? item["value"],
          );
        }
        return coerceDisplayText(item);
      })
      .filter(Boolean);
    return parts.join(", ");
  }
  if (isRecord(value)) {
    return coerceDisplayText(
      value["phone_number"] ?? value["display_value"] ?? value["value"],
    );
  }
  return coerceDisplayText(value);
}

function extractEmail(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (isRecord(item)) {
          return coerceDisplayText(
            item["email"] ?? item["display_value"] ?? item["value"],
          );
        }
        return coerceDisplayText(item);
      })
      .filter(Boolean);
    return parts.join(", ");
  }
  if (isRecord(value)) {
    return coerceDisplayText(
      value["email"] ?? value["display_value"] ?? value["value"],
    );
  }
  return coerceDisplayText(value);
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

async function generateBasicCommitteePdf(
  rows: BasicCommitteeRow[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595; // A4 portrait
  const pageHeight = 842;
  const margin = 21;
  const fontSize = 7;
  const lineHeight = fontSize + 2;
  const cellPaddingX = 3;
  const cellPaddingY = 3;
  const headerHeight = 36;
  const borderColor = rgb(0.8, 0.8, 0.8);
  const headerBg = rgb(0.95, 0.95, 0.95);
  const groupBg = rgb(0.9, 0.95, 1);

  const columns: Array<{
    key: keyof BasicCommitteeRow;
    label: string;
    width: number;
  }> = [
    { key: "firstName", label: "First Name", width: 75 },
    { key: "lastName", label: "Last Name", width: 75 },
    { key: "role", label: "Role", width: 80 },
    { key: "city", label: "City", width: 80 },
    { key: "telephone", label: "Telephone", width: 90 },
    { key: "email", label: "Email", width: 153 },
  ];

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const maxWidth = pageWidth - margin * 2;
  if (totalWidth > maxWidth) {
    throw new Error(`PDF columns exceed width (${totalWidth} > ${maxWidth}).`);
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawHeader = () => {
    const title = `Project Ninveh - Committee Export (${rows.length} rows)`;
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

  const drawGroupHeader = (groupLabel: string) => {
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
    const title =
      groupLabel === "Not Approved"
        ? "Not Approved"
        : `Approved For: ${groupLabel}`;
    page.drawText(title, {
      x: margin + 4,
      y: y - groupHeight + 6,
      size: 10,
      font: bold,
      color: rgb(0, 0, 0),
    });
    y -= groupHeight;
  };

  const drawDataRow = (row: BasicCommitteeRow) => {
    const maxLineCounts = columns.map((col) => {
      const lines = wrapTextToWidth({
        text: row[col.key] ?? "",
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
      const lines = wrapTextToWidth({
        text: row[col.key] ?? "",
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

  const groups = new Map<string, BasicCommitteeRow[]>();
  for (const row of rows) {
    const key = row.approvedFor || "Not Approved";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Not Approved" && b !== "Not Approved") return 1;
    if (b === "Not Approved" && a !== "Not Approved") return -1;
    return a.localeCompare(b, "en", { sensitivity: "base" });
  });

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

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(req: Request) {
  try {
    const apiKey = requireEnv("PROJECT_NINVEH_SMARTSUITE_API_KEY");
    const accountId = requireEnv("PROJECT_NINVEH_SMARTSUITE_ACCOUNT_ID");
    const committeeTableId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_COMMITTEE_TABLE_ID",
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
      tableId: committeeTableId,
    });

    const expandedRows: BasicCommitteeRow[] = [];

    for (const record of records) {
      if (!isRecord(record)) continue;

      const { firstName, lastName } = extractNameParts(record["s136335e0e"]);
      const role = coerceDisplayText(record["sa689248fd"]);
      const city = extractAddressCity(record["sd6a02d6e2"]);
      const telephone = extractPhoneNumber(record["phone_number"]);
      const email = extractEmail(record["email"]);
      const approvedForValues = extractMultiSelectLabels(record["s366acef72"]);

      if (approvedForValues.length === 0) {
        expandedRows.push({
          firstName,
          lastName,
          role,
          city,
          telephone,
          email,
          approvedFor: "Not Approved",
        });
        continue;
      }

      for (const approvedFor of approvedForValues) {
        expandedRows.push({
          firstName,
          lastName,
          role,
          city,
          telephone,
          email,
          approvedFor,
        });
      }
    }

    const pdfBuffer = await generateBasicCommitteePdf(expandedRows);
    const filename = `committee_basic_${new Date().toISOString().slice(0, 10)}.pdf`;
    const generatedAtIso = new Date().toISOString();

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: REPORTS_PDF_FIELD_ID,
    });

    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: REPORTS_PDF_FIELD_ID,
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
        [REPORTS_GENERATED_AT_FIELD_ID]: generatedAtIso,
      },
    });

    return NextResponse.json(
      {
        message: "Basic committee PDF generated and uploaded to SmartSuite",
        recordCount: expandedRows.length,
        reportsTableId,
        reportsRecordId,
        reportsFieldId: REPORTS_PDF_FIELD_ID,
        generatedAtFieldId: REPORTS_GENERATED_AT_FIELD_ID,
        generatedAt: generatedAtIso,
        filename,
        pdfSizeBytes: pdfBuffer.length,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[PROJECT_NINVEH] basic-committee-pdf error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate/upload basic committee PDF",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
