import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";

// Current year delivery list (Pesach)
const DELIVERY_LIST_TABLE_ID = "6925af29a4002f833ea5a0e8";
const PACKAGE_TYPE_FIELD_ID = "sa8cc7c261";
const PACKAGE_TYPE_PESACH_VALUE_ID = "nuNTD";
const PACKAGE_YEAR_FIELD_ID = "s008955138";

// Current delivery list person fields
const CURRENT_FIRST_NAME_FIELD_ID = "sbrcclv0";
const CURRENT_LAST_NAME_FIELD_ID = "s305be42b5";
const CURRENT_EMAIL_FIELD_ID = "s18619e9be";

// Previous year / historical dataset table + fields
const HISTORY_TABLE_ID = "69b1eb49b0d89dba92f87fe2";
const HISTORY_FIRST_NAME_FIELD_ID = "s8e14ebc53";
const HISTORY_LAST_NAME_FIELD_ID = "s9babce950";
const HISTORY_EMAIL_FIELD_ID = "s699f104ae";

// Reports table + fields (Comparison report slot)
const REPORTS_TABLE_ID = "69af983fd4df284d80aa4f6b";
const REPORTS_RECORD_ID = "69afea9689052b7b2c10cdca";
const REPORTS_FILE_FIELD_ID = "s0297450dc";
// Date / last-created field to update for this report
const REPORTS_LAST_CREATED_FIELD_ID = "s395630cc2";

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

type PersonRecord = {
  id: string;
  firstName: string;
  lastName: string;
  emails: string[];
  source: "current" | "history";
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

function normalizeEmail(email: string): string | null {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return null;
  return cleaned;
}

function normalizeLastName(lastName: string): string | null {
  const cleaned = lastName.trim().toUpperCase();
  if (!cleaned) return null;
  return cleaned;
}

function extractEmailArray(raw: unknown): string[] {
  const emails: string[] = [];

  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string") {
        const norm = normalizeEmail(v);
        if (norm) emails.push(norm);
      } else if (isRecord(v)) {
        const s = coerceDisplayText(v);
        const norm = normalizeEmail(s);
        if (norm) emails.push(norm);
      }
    }
    return Array.from(new Set(emails));
  }

  const text = coerceDisplayText(raw);
  if (!text) return [];
  for (const part of text.split(/[;,]/)) {
    const norm = normalizeEmail(part);
    if (norm) emails.push(norm);
  }
  return Array.from(new Set(emails));
}

type EmailSummaryRow = {
  value: string; // email
  lastYear: boolean;
  thisYear: boolean;
  both: boolean;
};

type LastNameSummaryRow = {
  value: string; // last name (display)
  lastYear: boolean;
  thisYear: boolean;
  both: boolean;
};

async function fetchCurrentYearDeliveryRecords(opts: {
  apiKey: string;
  accountId: string;
  year: number;
}): Promise<unknown[]> {
  const { apiKey, accountId, year } = opts;

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
      `SmartSuite list current-year records failed: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as SmartSuiteListResponse;
  return Array.isArray(data.items) ? data.items : [];
}

async function fetchHistoryRecords(opts: {
  apiKey: string;
  accountId: string;
}): Promise<unknown[]> {
  const { apiKey, accountId } = opts;

  const response = await fetch(
    `${SMARTSUITE_API_BASE}/applications/${HISTORY_TABLE_ID}/records/list/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hydrated: true,
        limit: 1000,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `SmartSuite list history records failed: ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as SmartSuiteListResponse;
  return Array.isArray(data.items) ? data.items : [];
}

function mapToCurrentPersons(rawRecords: unknown[]): PersonRecord[] {
  const persons: PersonRecord[] = [];

  for (const record of rawRecords) {
    if (!isRecord(record)) continue;

    // Only include records where the "Pesach Cards?" lookup (sff36bf980)
    // has at least one truthy value.
    const pesachCardsRaw = record["sff36bf980"];
    let hasPesachCards = false;
    if (Array.isArray(pesachCardsRaw)) {
      for (const row of pesachCardsRaw as unknown[]) {
        if (Array.isArray(row)) {
          for (const cell of row as unknown[]) {
            if (cell === true || cell === "true" || cell === 1 || cell === "1") {
              hasPesachCards = true;
              break;
            }
          }
        }
        if (hasPesachCards) break;
      }
    }
    if (!hasPesachCards) continue;

    const id = typeof record["id"] === "string" ? record["id"] : "";
    const firstName = coerceDisplayText(record[CURRENT_FIRST_NAME_FIELD_ID]);
    const lastName = coerceDisplayText(record[CURRENT_LAST_NAME_FIELD_ID]);
    const emailsRaw = record[CURRENT_EMAIL_FIELD_ID];
    const emails = extractEmailArray(emailsRaw);

    if (!firstName && !lastName && emails.length === 0) continue;

    persons.push({
      id,
      firstName,
      lastName,
      emails,
      source: "current",
    });
  }

  return persons;
}

function mapToHistoryPersons(rawRecords: unknown[]): PersonRecord[] {
  const persons: PersonRecord[] = [];

  for (const record of rawRecords) {
    if (!isRecord(record)) continue;

    const id = typeof record["id"] === "string" ? record["id"] : "";
    const firstName = coerceDisplayText(record[HISTORY_FIRST_NAME_FIELD_ID]);
    const lastName = coerceDisplayText(record[HISTORY_LAST_NAME_FIELD_ID]);
    const emailsRaw = record[HISTORY_EMAIL_FIELD_ID];
    const emails = extractEmailArray(emailsRaw);

    if (!firstName && !lastName && emails.length === 0) continue;

    persons.push({
      id,
      firstName,
      lastName,
      emails,
      source: "history",
    });
  }

  return persons;
}

function buildEmailSummary(
  currentPersons: PersonRecord[],
  historyPersons: PersonRecord[],
): EmailSummaryRow[] {
  const map = new Map<string, EmailSummaryRow>();

  const addEmails = (persons: PersonRecord[], which: "current" | "history") => {
    for (const person of persons) {
      for (const email of person.emails) {
        if (!map.has(email)) {
          map.set(email, {
            value: email,
            lastYear: false,
            thisYear: false,
            both: false,
          });
        }
        const row = map.get(email)!;
        if (which === "current") row.thisYear = true;
        if (which === "history") row.lastYear = true;
        row.both = row.thisYear && row.lastYear;
      }
    }
  };

  addEmails(currentPersons, "current");
  addEmails(historyPersons, "history");

  return Array.from(map.values()).sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}

function buildLastNameSummary(
  currentPersons: PersonRecord[],
  historyPersons: PersonRecord[],
): LastNameSummaryRow[] {
  const map = new Map<string, LastNameSummaryRow>(); // key = normalized last name

  const addLastNames = (
    persons: PersonRecord[],
    which: "current" | "history",
  ) => {
    for (const person of persons) {
      const key = normalizeLastName(person.lastName);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, {
          value: person.lastName || key,
          lastYear: false,
          thisYear: false,
          both: false,
        });
      }
      const row = map.get(key)!;
      if (which === "current") row.thisYear = true;
      if (which === "history") row.lastYear = true;
      row.both = row.thisYear && row.lastYear;
    }
  };

  addLastNames(currentPersons, "current");
  addLastNames(historyPersons, "history");

  return Array.from(map.values()).sort((a, b) =>
    a.value.localeCompare(b.value),
  );
}

async function generateComparisonPdf(
  emailRows: EmailSummaryRow[],
  lastNameRows: LastNameSummaryRow[],
  year: number,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 36;
  const lineHeight = 12;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawTitle = () => {
    const title = `Tomchei Shabbos - Comparison Report (${year})`;

    // Soft colored bar behind main title
    page.drawRectangle({
      x: margin - 4,
      y: y - 6,
      width: pageWidth - margin * 2 + 8,
      height: 24,
      color: rgb(0.9, 0.96, 1),
    });

    page.drawText(title, {
      x: margin,
      y,
      size: 16,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });
    y -= 20;
    page.drawText(`Generated: ${new Date().toLocaleString("en-US")}`, {
      x: margin,
      y,
      size: 9,
      font,
      color: rgb(0.25, 0.3, 0.4),
    });
    y -= 24;
  };

  const ensureSpace = (height: number) => {
    if (y - height < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawSectionHeader = (text: string) => {
    ensureSpace(24);

    // Accent bar for each section
    page.drawRectangle({
      x: margin - 2,
      y: y - 4,
      width: pageWidth - margin * 2 + 4,
      height: 18,
      color: rgb(0.93, 0.95, 1),
    });

    page.drawText(text, {
      x: margin,
      y,
      size: 13,
      font: bold,
      color: rgb(0.08, 0.2, 0.5),
    });
    y -= 18;
  };

  const drawMetrics = (rows: { lastYear: boolean; thisYear: boolean; both: boolean }[]) => {
    const total = rows.length;
    let lastYearOnly = 0;
    let thisYearOnly = 0;
    let both = 0;

    for (const r of rows) {
      if (r.both) both += 1;
      else if (r.lastYear && !r.thisYear) lastYearOnly += 1;
      else if (r.thisYear && !r.lastYear) thisYearOnly += 1;
    }

    ensureSpace(30);
    const baseX = margin;
    const baseY = y;
    const gapX = 160;

    const drawMetric = (label: string, value: number, x: number) => {
      page.drawText(label, {
        x,
        y: baseY,
        size: 9,
        font: bold,
        color: rgb(0.25, 0.35, 0.55),
      });
      page.drawText(String(value), {
        x,
        y: baseY - 12,
        size: 11,
        font: bold,
        color: rgb(0.05, 0.25, 0.55),
      });
    };

    drawMetric("Total", total, baseX);
    drawMetric("Last Year Only", lastYearOnly, baseX + gapX);
    drawMetric("This Year Only", thisYearOnly, baseX + 2 * gapX);
    drawMetric("Both Years", both, baseX + 3 * gapX);

    y -= 26;
  };

  const drawTableHeader = (label: string) => {
    const colIndexWidth = 30;
    const colLabelWidth = 230;
    const colFlagWidth = 70;
    const headerHeight = 18;

    ensureSpace(headerHeight + lineHeight);

    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: colIndexWidth + colLabelWidth + 3 * colFlagWidth,
      height: headerHeight,
      color: rgb(0.88, 0.93, 0.99),
      borderColor: rgb(0.6, 0.7, 0.85),
      borderWidth: 1,
    });

    let x = margin + 4;
    page.drawText("#", {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    x = margin + colIndexWidth + 4;
    page.drawText(label, {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    x = margin + colIndexWidth + colLabelWidth + 4;
    page.drawText("Last Year", {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    x += colFlagWidth;
    page.drawText("This Year", {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    x += colFlagWidth;
    page.drawText("Both", {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    y -= headerHeight;
  };

  const drawRows = (
    rows: {
      value: string;
      lastYear: boolean;
      thisYear: boolean;
      both: boolean;
    }[],
  ) => {
    const colIndexWidth = 30;
    const colLabelWidth = 230;
    const colFlagWidth = 70;

    rows.forEach((row, index) => {
      ensureSpace(lineHeight + 6);
      const rowHeight = lineHeight + 2;
      const topY = y;
      const rowY = y - lineHeight;

      // Alternate row background shading
      if (index % 2 === 1) {
        page.drawRectangle({
          x: margin,
          y: topY - rowHeight,
          width: colIndexWidth + colLabelWidth + 3 * colFlagWidth,
          height: rowHeight,
          color: rgb(0.96, 0.98, 1),
        });
      }

      // Row number
      let x = margin + 4;
      page.drawText(String(index + 1), {
        x,
        y: rowY,
        size: 9,
        font,
        color: rgb(0.1, 0.15, 0.25),
      });

      x = margin + colIndexWidth + 4;
      page.drawText(row.value, {
        x,
        y: rowY,
        size: 9,
        font,
        color: rgb(0.1, 0.15, 0.25),
        maxWidth: colLabelWidth - 8,
      });

      // Use plain ASCII so WinAnsi encoding works everywhere
      const tick = "X";

      x = margin + colLabelWidth + colFlagWidth / 2;
      if (row.lastYear) {
        page.drawText(tick, {
          x,
          y: rowY,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
      }

      x += colFlagWidth;
      if (row.thisYear) {
        page.drawText(tick, {
          x,
          y: rowY,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
      }

      x += colFlagWidth;
      if (row.both) {
        page.drawText(tick, {
          x,
          y: rowY,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        });
      }

      y -= rowHeight;
    });
  };

  drawTitle();

  // Section 1 – Email-based comparison
  drawSectionHeader("Section 1 – Email Addresses");
  drawMetrics(emailRows);
  drawTableHeader("Email");
  drawRows(emailRows);

  // Section 2 – Last-name-based comparison (always start on a new page)
  page = pdfDoc.addPage([pageWidth, pageHeight]);
  y = pageHeight - margin;
  drawSectionHeader("Section 2 – Last Names");
  drawMetrics(lastNameRows);
  drawTableHeader("Last Name");
  drawRows(lastNameRows);

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

    const [currentRaw, historyRaw] = await Promise.all([
      fetchCurrentYearDeliveryRecords({ apiKey, accountId, year: yearNum }),
      fetchHistoryRecords({ apiKey, accountId }),
    ]);

    const currentPersons = mapToCurrentPersons(currentRaw);
    const historyPersons = mapToHistoryPersons(historyRaw);

    const emailSummary = buildEmailSummary(currentPersons, historyPersons);
    const lastNameSummary = buildLastNameSummary(
      currentPersons,
      historyPersons,
    );

    const buffer = await generateComparisonPdf(
      emailSummary,
      lastNameSummary,
      yearNum,
    );

    const filename = `tomchei_comparison_report_${yearNum}.pdf`;

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
      buffer,
      filename,
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
          "Tomchei Shabbos comparison report generated and uploaded to SmartSuite",
        year: yearNum,
        currentRecordCount: currentPersons.length,
        historyRecordCount: historyPersons.length,
        emailSummaryCount: emailSummary.length,
        lastNameSummaryCount: lastNameSummary.length,
        reportsTableId: REPORTS_TABLE_ID,
        reportsRecordId: REPORTS_RECORD_ID,
        reportsFieldId: REPORTS_FILE_FIELD_ID,
        filename,
        fileSizeBytes: buffer.length,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[TOMCHEI_SHABBOS] comparison-report error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate/upload Tomchei Shabbos comparison report",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
