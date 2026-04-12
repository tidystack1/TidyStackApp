import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";
const HISTORY_BASE_YEAR = 2025;

// Current year delivery list (Pesach)
const DELIVERY_LIST_TABLE_ID = "6925af29a4002f833ea5a0e8";
const PACKAGE_TYPE_FIELD_ID = "sa8cc7c261";
const PACKAGE_TYPE_PESACH_VALUE_ID = "nuNTD";
const PACKAGE_YEAR_FIELD_ID = "s008955138";

// Current delivery list person fields
const CURRENT_FIRST_NAME_FIELD_ID = "sbrcclv0";
const CURRENT_LAST_NAME_FIELD_ID = "s305be42b5";
const CURRENT_EMAIL_FIELD_ID = "s18619e9be";
// Cards total for current year (lookup field — treat as string)
const CURRENT_CARDS_FIELD_ID = "s83940c544";

// Base historical dataset table + fields (Pesach Data 2025)
const HISTORY_TABLE_ID = "69b1eb49b0d89dba92f87fe2";
const HISTORY_FIRST_NAME_FIELD_ID = "s8e14ebc53";
const HISTORY_LAST_NAME_FIELD_ID = "s9babce950";
const HISTORY_EMAIL_FIELD_ID = "s699f104ae";
// Cards value for previous year (text field — treat as string)
const HISTORY_CARDS_FIELD_ID = "se8b4ea831";

// Reports table + fields (Comparison report slot)
const REPORTS_TABLE_ID = "69af983fd4df284d80aa4f6b";
const REPORTS_RECORD_ID = "69afea9689052b7b2c10cdca";
const REPORTS_FILE_FIELD_ID = "s0297450dc";
const REPORTS_CSV_FIELD_ID = "s8bdd40da8";
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
  year: number;
  cardsValue: string;
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
  email: string;
  lastName: string;
  yearValues: Partial<Record<number, string>>;
  isDuplicate: boolean;
};

function buildReportYears(requestedYear: number): number[] {
  if (requestedYear < HISTORY_BASE_YEAR) {
    return [requestedYear];
  }

  return Array.from(
    { length: requestedYear - HISTORY_BASE_YEAR + 1 },
    (_, index) => HISTORY_BASE_YEAR + index,
  );
}

async function fetchDeliveryRecords(opts: {
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
      `SmartSuite list delivery records failed (${year}): ${response.status} ${text}`,
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

function mapToCurrentPersons(rawRecords: unknown[], year: number): PersonRecord[] {
  const persons: PersonRecord[] = [];

  for (const record of rawRecords) {
    if (!isRecord(record)) continue;

    const id = typeof record["id"] === "string" ? record["id"] : "";
    const firstName = coerceDisplayText(record[CURRENT_FIRST_NAME_FIELD_ID]);
    const lastName = coerceDisplayText(record[CURRENT_LAST_NAME_FIELD_ID]);
    const emailsRaw = record[CURRENT_EMAIL_FIELD_ID];
    const emails = extractEmailArray(emailsRaw);
    const cardsValue = coerceDisplayText(record[CURRENT_CARDS_FIELD_ID]);

    if (!firstName && !lastName && emails.length === 0) continue;

    persons.push({
      id,
      firstName,
      lastName,
      emails,
      year,
      cardsValue,
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
    const cardsValue = coerceDisplayText(record[HISTORY_CARDS_FIELD_ID]);

    if (!firstName && !lastName && emails.length === 0) continue;

    persons.push({
      id,
      firstName,
      lastName,
      emails,
      year: HISTORY_BASE_YEAR,
      cardsValue,
    });
  }

  return persons;
}

function buildEmailSummary(
  persons: PersonRecord[],
  years: number[],
): EmailSummaryRow[] {
  type RowEntry = {
    email: string;
    lastName: string;
    yearValues: Partial<Record<number, string>>;
    key: string;
  };

  const rows: RowEntry[] = [];
  const yearSet = new Set(years);
  const keyToIndices = new Map<string, number[]>();

  for (const person of persons) {
    if (!yearSet.has(person.year)) continue;

    const emailList = person.emails.length > 0 ? person.emails : [""];
    for (const email of emailList) {
      const normEmail = normalizeEmail(email) ?? "";
      const normLastName = normalizeLastName(person.lastName) ?? "";
      const key = `${normEmail}|${normLastName}`;
      const matchingIndex = (keyToIndices.get(key) ?? []).find(
        (idx) => !rows[idx].yearValues[person.year],
      );

      if (matchingIndex != null) {
        rows[matchingIndex].yearValues[person.year] = person.cardsValue;
      } else {
        rows.push({
          email,
          lastName: person.lastName,
          yearValues: { [person.year]: person.cardsValue },
          key,
        });
        const arr = keyToIndices.get(key) ?? [];
        arr.push(rows.length - 1);
        keyToIndices.set(key, arr);
      }
    }
  }

  // Count key occurrences to flag duplicates (same email+lastname appears >1 time)
  const keyCount = new Map<string, number>();
  for (const row of rows) {
    keyCount.set(row.key, (keyCount.get(row.key) ?? 0) + 1);
  }

  // Sort by last name then email
  rows.sort((a, b) => {
    const lnCmp = a.lastName.localeCompare(b.lastName);
    if (lnCmp !== 0) return lnCmp;
    return a.email.localeCompare(b.email);
  });

  return rows.map((r) => ({
    email: r.email,
    lastName: r.lastName,
    yearValues: r.yearValues,
    isDuplicate: (keyCount.get(r.key) ?? 0) > 1,
  }));
}

function escapeCsvCell(value: string): string {
  const safe = String(value).replace(/"/g, '""');
  return `"${safe}"`;
}

function buildComparisonCsv(
  emailRows: EmailSummaryRow[],
  years: number[],
): string {
  const header = ["#", "Last Name", "Email", ...years.map(String)]
    .map(escapeCsvCell)
    .join(",");

  const dataRows = emailRows.map((r, i) =>
    [
      String(i + 1),
      r.lastName,
      r.email,
      ...years.map((year) => r.yearValues[year] ?? ""),
    ]
      .map(escapeCsvCell)
      .join(","),
  );

  return [header, ...dataRows].join("\r\n");
}

async function generateComparisonPdf(
  emailRows: EmailSummaryRow[],
  years: number[],
  yearTotals: Partial<Record<number, number>>,
): Promise<Buffer> {
  const requestedYear = years[years.length - 1];

  const rows = emailRows.filter(
    (r) => years.some((year) => (r.yearValues[year] ?? "") !== ""),
  );

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const basePageWidth = 595;
  const pageHeight = 842;
  const margin = 36;
  const lineHeight = 12;

  // Column widths
  const colIndexWidth = 25;
  const colLastNameWidth = 115;
  const colEmailWidth = 185;
  const colYearWidth =
    years.length <= 4 ? 82 : years.length <= 6 ? 68 : 58;
  const tableWidth =
    colIndexWidth +
    colLastNameWidth +
    colEmailWidth +
    years.length * colYearWidth;
  const pageWidth = Math.max(basePageWidth, margin * 2 + tableWidth);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawTitle = () => {
    const title = `Tomchei Shabbos - Comparison Report (${requestedYear})`;

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
    y -= 20;
    const totalsChunks: string[] = [];
    for (let i = 0; i < years.length; i += 4) {
      totalsChunks.push(
        years
          .slice(i, i + 4)
          .map((year) => `${year}: ${yearTotals[year] ?? 0}`)
          .join("  |  "),
      );
    }

    for (const line of totalsChunks) {
      page.drawText(line, {
        x: margin,
        y,
        size: 10,
        font: bold,
        color: rgb(0.05, 0.25, 0.55),
      });
      y -= 14;
    }

    y -= 10;
  };

  const ensureSpace = (height: number) => {
    if (y - height < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawSectionHeader = (text: string) => {
    ensureSpace(24);

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

  const drawMetrics = (rows: EmailSummaryRow[]) => {
    const total = rows.length;
    const yearOnlyCounts: Partial<Record<number, number>> = {};

    for (const r of rows) {
      const populatedYears = years.filter(
        (year) => (r.yearValues[year] ?? "") !== "",
      );
      if (populatedYears.length === 1) {
        const onlyYear = populatedYears[0];
        yearOnlyCounts[onlyYear] = (yearOnlyCounts[onlyYear] ?? 0) + 1;
      }
    }

    const metricEntries = [
      { label: "Total", value: total },
      ...years.map((year) => ({
        label: `${year} Only`,
        value: yearOnlyCounts[year] ?? 0,
      })),
    ];
    const perRow = 4;
    const rowHeight = 26;
    const totalMetricRows = Math.ceil(metricEntries.length / perRow);

    ensureSpace(totalMetricRows * rowHeight + 4);
    const baseX = margin;
    const baseY = y;
    const gapX = 120;

    const drawMetric = (label: string, value: number, x: number, yPos: number) => {
      page.drawText(label, {
        x,
        y: yPos,
        size: 9,
        font: bold,
        color: rgb(0.25, 0.35, 0.55),
      });
      page.drawText(String(value), {
        x,
        y: yPos - 12,
        size: 11,
        font: bold,
        color: rgb(0.05, 0.25, 0.55),
      });
    };

    metricEntries.forEach((entry, index) => {
      const column = index % perRow;
      const row = Math.floor(index / perRow);
      drawMetric(
        entry.label,
        entry.value,
        baseX + column * gapX,
        baseY - row * rowHeight,
      );
    });

    y = baseY - totalMetricRows * rowHeight;
  };

  const drawTableHeader = () => {
    const headerHeight = 18;
    ensureSpace(headerHeight + lineHeight);

    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: tableWidth,
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
    page.drawText("Last Name", {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    x = margin + colIndexWidth + colLastNameWidth + 4;
    page.drawText("Email", {
      x,
      y: y - 12,
      size: 9,
      font: bold,
      color: rgb(0.05, 0.25, 0.55),
    });

    x = margin + colIndexWidth + colLastNameWidth + colEmailWidth + 4;
    years.forEach((year) => {
      page.drawText(String(year), {
        x,
        y: y - 12,
        size: 9,
        font: bold,
        color: rgb(0.05, 0.25, 0.55),
      });
      x += colYearWidth;
    });

    y -= headerHeight;
  };

  const drawRows = (rows: EmailSummaryRow[]) => {
    rows.forEach((row, index) => {
      ensureSpace(lineHeight + 6);
      const rowHeight = lineHeight + 2;
      const topY = y;
      const rowY = y - lineHeight;

      // Row background: pink for duplicates, alternating blue-tint otherwise
      if (row.isDuplicate) {
        page.drawRectangle({
          x: margin,
          y: topY - rowHeight,
          width: tableWidth,
          height: rowHeight,
          color: rgb(1, 0.82, 0.88),
        });
      } else if (index % 2 === 1) {
        page.drawRectangle({
          x: margin,
          y: topY - rowHeight,
          width: tableWidth,
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

      // Last Name
      x = margin + colIndexWidth + 4;
      page.drawText(row.lastName, {
        x,
        y: rowY,
        size: 9,
        font,
        color: rgb(0.1, 0.15, 0.25),
        maxWidth: colLastNameWidth - 8,
      });

      // Email
      x = margin + colIndexWidth + colLastNameWidth + 4;
      page.drawText(row.email, {
        x,
        y: rowY,
        size: 9,
        font,
        color: rgb(0.1, 0.15, 0.25),
        maxWidth: colEmailWidth - 8,
      });

      x = margin + colIndexWidth + colLastNameWidth + colEmailWidth + 4;
      years.forEach((year) => {
        const yearValue = row.yearValues[year] ?? "";
        if (yearValue) {
          page.drawText(yearValue, {
            x,
            y: rowY,
            size: 9,
            font,
            color: rgb(0.1, 0.15, 0.25),
            maxWidth: colYearWidth - 8,
          });
        }
        x += colYearWidth;
      });

      y -= rowHeight;
    });
  };

  drawTitle();
  drawSectionHeader("Email Addresses");
  drawMetrics(rows);
  drawTableHeader();
  drawRows(rows);

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

    const reportYears = buildReportYears(yearNum);
    const deliveryYears = reportYears.filter((year) => year !== HISTORY_BASE_YEAR);

    const [historyRaw, deliveryYearRecords] = await Promise.all([
      reportYears.includes(HISTORY_BASE_YEAR)
        ? fetchHistoryRecords({ apiKey, accountId })
        : Promise.resolve([]),
      Promise.all(
        deliveryYears.map(async (year) => ({
          year,
          records: await fetchDeliveryRecords({ apiKey, accountId, year }),
        })),
      ),
    ]);

    const yearTotals: Partial<Record<number, number>> = {};
    const persons: PersonRecord[] = [];

    if (reportYears.includes(HISTORY_BASE_YEAR)) {
      const historyPersons = mapToHistoryPersons(historyRaw);
      yearTotals[HISTORY_BASE_YEAR] = historyPersons.length;
      persons.push(...historyPersons);
    }

    for (const { year, records } of deliveryYearRecords) {
      const currentPersons = mapToCurrentPersons(records, year);
      yearTotals[year] = currentPersons.length;
      persons.push(...currentPersons);
    }

    const emailSummary = buildEmailSummary(persons, reportYears);

    const csvContent = buildComparisonCsv(emailSummary, reportYears);
    const csvBuffer = Buffer.from(csvContent, "utf-8");

    const buffer = await generateComparisonPdf(
      emailSummary,
      reportYears,
      yearTotals,
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

    await clearSmartSuiteFileField({
      apiKey,
      accountId,
      tableId: REPORTS_TABLE_ID,
      recordId: REPORTS_RECORD_ID,
      fieldId: REPORTS_CSV_FIELD_ID,
    });
    await uploadSmartSuiteFileToRecord({
      apiKey,
      accountId,
      tableId: REPORTS_TABLE_ID,
      recordId: REPORTS_RECORD_ID,
      fieldId: REPORTS_CSV_FIELD_ID,
      buffer: csvBuffer,
      filename: `tomchei_comparison_report_${yearNum}.csv`,
      contentType: "text/csv",
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
        yearsIncluded: reportYears,
        currentRecordCount: yearTotals[yearNum] ?? 0,
        historyRecordCount: yearTotals[HISTORY_BASE_YEAR] ?? 0,
        yearRecordCounts: yearTotals,
        emailSummaryCount: emailSummary.length,
        reportsTableId: REPORTS_TABLE_ID,
        reportsRecordId: REPORTS_RECORD_ID,
        reportsFieldId: REPORTS_FILE_FIELD_ID,
        filename,
        fileSizeBytes: buffer.length,
        csvFieldId: REPORTS_CSV_FIELD_ID,
        csvFilename: `tomchei_comparison_report_${yearNum}.csv`,
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
