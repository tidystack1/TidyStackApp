import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  type PDFPage,
  type PDFFont,
  StandardFonts,
  rgb,
} from "pdf-lib";

export const runtime = "nodejs";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";

// Per your requirement: upload the generated PDF into this SmartSuite field.
const REPORTS_PDF_FIELD_ID = "s6e8011ad7";

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
  }
  const s = String(value).trim();
  return s;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function getReportsPdfFieldId(): string {
  const fromEnv = process.env.PROJECT_NINVEH_SMARTSUITE_REPORTS_FIELD_ID;
  // SmartSuite field IDs typically look like "s" + 9 alphanumerics (e.g. s6e8011ad7).
  if (fromEnv && /^s[a-z0-9]{9}$/i.test(fromEnv.trim())) return fromEnv.trim();
  return REPORTS_PDF_FIELD_ID;
}

function extractDateString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (value instanceof Date) return value.toISOString();

  if (isRecord(value)) {
    // SmartSuite hydrated values often put the usable value in one of these.
    const candidates = [
      value["value"],
      value["display_value"],
      value["sys_root"],
      value["date"],
      value["on"],
      value["start"],
      value["start_date"],
      value["iso"],
    ];
    for (const c of candidates) {
      const s = extractDateString(c);
      if (s) return s;
    }

    // Sometimes nested
    const nested = value["data"];
    const nestedStr = extractDateString(nested);
    if (nestedStr) return nestedStr;
  }

  // Avoid returning "[object Object]" for unknown structures
  return undefined;
}

function formatDate(value: unknown): string {
  const s = extractDateString(value);
  if (!s) return "";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function extractFullNameParts(value: unknown): {
  firstName: string;
  lastName: string;
} {
  if (isRecord(value)) {
    const first = coerceDisplayText(value["first_name"]);
    const last = coerceDisplayText(value["last_name"]);
    if (first || last) return { firstName: first, lastName: last };

    // Sometimes SmartSuite returns `sys_root` as the full name string.
    const sysRoot = coerceDisplayText(value["sys_root"]);
    if (sysRoot) {
      const [firstPart, ...rest] = sysRoot.split(/\s+/).filter(Boolean);
      return { firstName: firstPart ?? "", lastName: rest.join(" ") };
    }
  }

  const s = coerceDisplayText(value);
  if (!s) return { firstName: "", lastName: "" };
  const [firstPart, ...rest] = s.split(/\s+/).filter(Boolean);
  return { firstName: firstPart ?? "", lastName: rest.join(" ") };
}

function mapRelationshipToLabel(raw: unknown): string {
  const hydrated = coerceDisplayText(raw);
  if (!hydrated) return "";

  // If SmartSuite already gave a label, keep it.
  if (!/^[A-Za-z0-9_]{3,}$/.test(hydrated)) return hydrated;

  const mapping: Record<string, string> = {
    WikR3: "Neighbor",
    MrFq7: "Friend",
    wMrMe: "Niece",
    "408iN": "Cousin",
    OTHER_VALUE: "Other",
  };
  return mapping[hydrated] ?? hydrated;
}

function mapFormTypeToLabel(raw: unknown): string {
  const hydrated = coerceDisplayText(raw);
  if (!hydrated) return "";

  // If SmartSuite already gave a label, keep it.
  if (!/^[A-Za-z0-9_]{3,}$/.test(hydrated)) return hydrated;

  const mapping: Record<string, string> = {
    YLQk8: "Partner Advocate Request for Single",
    DA9Kg: "Single Request to be Paired with Advocate",
  };
  return mapping[hydrated] ?? hydrated;
}

function extractLinkedRecordTitles(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => {
        if (typeof v === "string") return v;
        if (isRecord(v)) {
          return (
            coerceString(v["title"]) ??
            coerceString(v["display_value"]) ??
            coerceString(v["sys_root"]) ??
            coerceString(v["name"]) ??
            coerceDisplayText(v)
          );
        }
        return coerceDisplayText(v);
      })
      .map((s) => (s ?? "").trim())
      .filter(Boolean);
    return parts.join(", ");
  }
  return coerceDisplayText(value);
}

async function fetchAllSmartSuiteRecords({
  apiKey,
  accountId,
  tableId,
  hydrated,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  hydrated: boolean;
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
          sort: [
            {
              direction: "desc",
              field: "s4b6358f05",
            },
          ],
          hydrated,
          limit,
          offset,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `SmartSuite list records failed: ${response.status} ${errorText}`
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
  maxLines: number;
}): string[] {
  const cleaned = (text ?? "").trim();
  if (!cleaned) return [""];

  const words = cleaned.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width <= maxWidth || !current) {
      current = test;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines) lines.push(current);

  if (lines.length > maxLines) return lines.slice(0, maxLines);
  if (lines.length === maxLines) {
    // If we truncated, append ellipsis to the last line if needed.
    const joined = words.join(" ");
    const reconstructed = lines.join(" ");
    if (joined.length > reconstructed.length) {
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

async function generateSinglesPdf(rows: Array<Record<string, string>>) {
  type SinglesPdfRow = {
    firstName: string;
    lastName: string;
    partnerAdvocate: string;
    partnerRelationship: string;
    age: string;
    singlesCell: string;
    singlesEmail: string;
    preferredLongTermPlan: string;
    formType: string;
    city: string;
    dob: string;
  };

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // A4 vertical (portrait).
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 24;
  const headerHeight = 49;
  const fontSize = 7;
  const lineHeight = fontSize + 2;
  const cellPaddingX = 4;
  const cellPaddingY = 4;
  const borderColor = rgb(0.8, 0.8, 0.8);
  const headerBg = rgb(0.95, 0.95, 0.95);
  const highlightBg = rgb(1, 1, 0.7);

  const contentWidth = pageWidth - margin * 2;

  const columns: Array<{
    key: keyof SinglesPdfRow;
    label: string;
    width: number;
  }> = [
    { key: "firstName", label: "First Name", width: 40 },
    { key: "lastName", label: "Last Name", width: 40 },
    { key: "partnerAdvocate", label: "Partner Advocate", width: 65 },
    {
      key: "partnerRelationship",
      label: "Partner Relationship",
      width: 50,
    },
    { key: "age", label: "Age", width: 20 },
    { key: "singlesCell", label: "Single's Cell", width: 50 },
    { key: "singlesEmail", label: "Single's Email", width: 85 },
    {
      key: "preferredLongTermPlan",
      label: "What is her preferred long-term plan?",
      width: 50,
    },
    { key: "formType", label: "Form Type", width: 55 },
    { key: "city", label: "City", width: 45 },
    { key: "dob", label: "DOB", width: 42 },
  ];

  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  if (totalWidth > contentWidth) {
    // Should not happen with current widths, but guard anyway.
    throw new Error(
      `PDF columns exceed width (${totalWidth} > ${contentWidth}).`
    );
  }

  const drawRow = ({
    page,
    yTop,
    values,
    isHeader,
    rowHeight,
    isHighlighted,
  }: {
    page: PDFPage;
    yTop: number;
    values?: Partial<SinglesPdfRow>;
    isHeader: boolean;
    rowHeight: number;
    isHighlighted?: boolean;
  }) => {
    // background + border
    page.drawRectangle({
      x: margin,
      y: yTop - rowHeight,
      width: totalWidth,
      height: rowHeight,
      borderColor,
      borderWidth: 1,
      color: isHeader ? headerBg : isHighlighted ? highlightBg : undefined,
    });

    let x = margin;
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const text = isHeader ? col.label : values?.[col.key] ?? "";
      const fontToUse = isHeader ? boldFont : font;
      const maxTextWidth = col.width - cellPaddingX * 2;
      const maxLines = isHeader ? 5 : 3;
      const lines = wrapTextToWidth({
        text,
        font: fontToUse,
        fontSize,
        maxWidth: maxTextWidth,
        maxLines,
      });

      // vertical divider
      if (i < columns.length - 1) {
        page.drawLine({
          start: { x: x + col.width, y: yTop },
          end: { x: x + col.width, y: yTop - rowHeight },
          color: borderColor,
          thickness: 1,
        });
      }

      // draw text (top aligned in cell)
      let textY = yTop - cellPaddingY - fontSize;
      for (const line of lines) {
        page.drawText(line, {
          x: x + cellPaddingX,
          y: textY,
          size: fontSize,
          font: fontToUse,
          color: rgb(0, 0, 0),
          maxWidth: maxTextWidth,
        });
        textY -= lineHeight;
      }

      x += col.width;
    }
  };

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Title
  const title = `Project Ninveh - Singles Export - Sorted by Age (${rows.length} records)`;
  page.drawText(title, {
    x: margin,
    y,
    size: 14,
    font: boldFont,
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

  // Header row
  drawRow({
    page,
    yTop: y,
    isHeader: true,
    rowHeight: headerHeight,
    isHighlighted: false,
  });
  y -= headerHeight;

  for (const row of rows) {
    const maxLineCounts = columns.map((c) => {
      const maxTextWidth = c.width - cellPaddingX * 2;
      const lines = wrapTextToWidth({
        text: row[c.key] ?? "",
        font,
        fontSize,
        maxWidth: maxTextWidth,
        maxLines: 3,
      });
      return lines.length;
    });
    const rowHeight = Math.max(
      headerHeight,
      Math.max(...maxLineCounts) * lineHeight + cellPaddingY * 2
    );

    if (y - rowHeight < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;

      // Repeat header on new page
      drawRow({
        page,
        yTop: y,
        isHeader: true,
        rowHeight: headerHeight,
        isHighlighted: false,
      });
      y -= headerHeight;
    }

    drawRow({
      page,
      yTop: y,
      values: row,
      isHeader: false,
      rowHeight,
      isHighlighted:
        (row.formType ?? "").trim() ===
        "Single Request to be Paired with Advocate",
    });
    y -= rowHeight;
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
    }
  );

  // Clearing is best-effort (upload still works even if this fails in many cases).
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      `[PROJECT_NINVEH] Failed to clear existing file field: ${response.status} ${text}`
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
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite file upload failed: ${response.status} ${errorText}`
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const expectedPassword = requireEnv("PROJECT_NINVEH_API_PASSWORD").trim();

    const body = await req.json();
    const password = isRecord(body) ? coerceString(body.password) : undefined;
    if ((password ?? "").trim() !== expectedPassword) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const apiKey = requireEnv("PROJECT_NINVEH_SMARTSUITE_API_KEY");
    const accountId = requireEnv("PROJECT_NINVEH_SMARTSUITE_ACCOUNT_ID");
    const singlesTableId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_SINGLES_TABLE_ID"
    );
    const reportsTableId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_REPORTS_TABLE_ID"
    );
    const reportsRecordId = requireEnv(
      "PROJECT_NINVEH_SMARTSUITE_REPORTS_RECORD_ID"
    );
    const reportsFieldId = getReportsPdfFieldId();

    const records = await fetchAllSmartSuiteRecords({
      apiKey,
      accountId,
      tableId: singlesTableId,
      hydrated: true,
    });

    const rows: Array<Record<string, string>> = records
      .filter(isRecord)
      .map((r) => {
        const { firstName, lastName } = extractFullNameParts(r["singles_name"]);

        return {
          firstName,
          lastName,
          partnerAdvocate: extractLinkedRecordTitles(r["s7c5f198f0"]),
          partnerRelationship: mapRelationshipToLabel(
            r["relationship_to_single"]
          ),
          age: coerceDisplayText(r["s32a1b2047"]),
          singlesCell: coerceDisplayText(r["sa80937d3c"]),
          singlesEmail: coerceDisplayText(r["se815f0de2"]),
          preferredLongTermPlan: coerceDisplayText(r["partner_category_type"]),
          formType: mapFormTypeToLabel(r["sf559e7b8a"]),
          city: coerceDisplayText(r["s95c524609"]),
          dob: formatDate(r["s4b6358f05"]),
        };
      });

    // Sort by last name, then first name for nicer output.
    // rows.sort((a, b) => {
    //   const last = (a.lastName ?? "").localeCompare(b.lastName ?? "", "en", {
    //     sensitivity: "base",
    //   });
    //   if (last !== 0) return last;
    //   return (a.firstName ?? "").localeCompare(b.firstName ?? "", "en", {
    //     sensitivity: "base",
    //   });
    // });

    const pdfBuffer = await generateSinglesPdf(rows);
    const filename = `singles_${new Date().toISOString().slice(0, 10)}.pdf`;

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: reportsFieldId,
    });

    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: reportsTableId,
      recordId: reportsRecordId,
      fieldId: reportsFieldId,
      buffer: pdfBuffer,
      filename,
      contentType: "application/pdf",
    });

    return NextResponse.json(
      {
        message: "Singles PDF generated and uploaded to SmartSuite",
        recordCount: rows.length,
        reportsTableId,
        reportsRecordId,
        reportsFieldId,
        filename,
        pdfSizeBytes: pdfBuffer.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[PROJECT_NINVEH] singles-pdf error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate/upload singles PDF",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
