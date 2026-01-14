import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  type PDFPage,
  type PDFFont,
  StandardFonts,
  rgb,
} from "pdf-lib";

const ZOHO_DEBUG = process.env.ZOHO_DEBUG === "true";
function dbg(...args: unknown[]) {
  if (ZOHO_DEBUG) console.log("[TEST:debug]", ...args);
}

// Updated to use subform file uploads instead of attachments
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const recordId = body.id;

    if (!recordId) {
      return NextResponse.json(
        { error: "Record ID is required" },
        { status: 400 }
      );
    }

    console.log(`[TEST] /api/test-pdf recordId=${recordId}`);

    // Step 1: Get the record details from Zoho CRM
    const recordDetails = await getZohoRecord(recordId);
    dbg(`[TEST] Record fetched successfully`);

    // Step 2: Extract record info and rows (including all subform fields) + file uploads
    const recordInfo = extractRecordInfo(recordDetails);
    const subformRows = extractExpenseReimbursementRows(recordDetails);
    const totalFilesInSubform = subformRows.reduce(
      (sum, row) => sum + row.files.length,
      0
    );
    console.log(
      `[TEST] Found ${subformRows.length} subform row(s), ${totalFilesInSubform} file(s)`
    );

    if (subformRows.length === 0 || totalFilesInSubform === 0) {
      return NextResponse.json(
        {
          message: "No file uploads found in Expense Reimbursement subform",
          recordId,
          attachmentCount: 0,
          pdfCount: 0,
        },
        { status: 200 }
      );
    }

    // Step 3: Download PDF and image files from subform
    const { pdfItems, imageItems } = await downloadFileUploads(subformRows);
    console.log(
      `[TEST] Downloaded ${pdfItems.length} PDF(s) and ${imageItems.length} image(s)`
    );

    if (pdfItems.length === 0 && imageItems.length === 0) {
      return NextResponse.json(
        {
          message: "No PDF or image files found in subform uploads",
          recordId,
          attachmentCount: totalFilesInSubform,
          pdfCount: 0,
        },
        { status: 200 }
      );
    }

    // Step 4: Combine PDFs and images into one (with summary page first)
    const combinedPdf = await combinePDFsAndImages(
      pdfItems,
      imageItems,
      recordInfo,
      subformRows
    );
    console.log(`[TEST] Combined into a single PDF successfully`);

    // Convert to base64 for frontend display
    const base64Pdf = combinedPdf.toString("base64");

    return NextResponse.json(
      {
        message: "Successfully processed PDFs and images",
        recordId,
        attachmentCount: totalFilesInSubform,
        pdfCount: pdfItems.length + imageItems.length,
        pdfFiles: pdfItems.length,
        imageFiles: imageItems.length,
        pdfBase64: base64Pdf,
        pdfSize: combinedPdf.length,
        facility: recordInfo.facility ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[TEST] Error processing:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

async function getZohoRecord(recordId: string) {
  const accessToken = await getZohoAccessToken();

  const zohoModule = process.env.ZOHO_MODULE || "Staff_Forms";
  const apiDomain = process.env.ZOHO_API_DOMAIN || "www.zohoapis.com";

  const url = `https://${apiDomain}/crm/v2/${zohoModule}/${recordId}`;
  dbg(`[TEST] Fetching record from: ${url}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[TEST] Failed to fetch record:", response.status, errorText);
    throw new Error(`Failed to fetch record: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

type ZohoRecordDetails = { data?: Array<Record<string, unknown>> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type ExpenseRow = {
  // API names from CRM: Date_1, Expense_Type, Purpose, Amount, File_Upload_1
  rowNumber: number;
  date?: unknown;
  expenseType?: unknown;
  purpose?: unknown;
  amount?: unknown;
  files: Array<Record<string, unknown>>;
};

type RecordInfo = {
  reimbursementFor?: string;
  facility?: string;
  employee?: string;
  employeeLastName?: string;
  employeeEmail?: string;
};

function normalizeFiles(
  fileUploadValue: unknown
): Array<Record<string, unknown>> {
  if (!fileUploadValue) return [];
  if (Array.isArray(fileUploadValue)) return fileUploadValue.filter(isRecord);
  return isRecord(fileUploadValue) ? [fileUploadValue] : [];
}

function extractRecordInfo(recordDetails: unknown): RecordInfo {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) {
      return {};
    }

    return {
      reimbursementFor:
        coerceZohoFieldText(record["Reimbusment_For"]) ?? undefined,
      facility: coerceZohoFieldText(record["Facility"]) ?? undefined,
      employee: coerceZohoFieldText(record["Employee"]) ?? undefined,
      employeeLastName:
        coerceZohoFieldText(record["Employee_Last_Name"]) ?? undefined,
      employeeEmail: coerceZohoFieldText(record["Employee_Email"]) ?? undefined,
    };
  } catch (error) {
    console.error("[TEST] Error extracting record info:", error);
    return {};
  }
}

function extractExpenseReimbursementRows(recordDetails: unknown): ExpenseRow[] {
  try {
    const details = recordDetails as ZohoRecordDetails;
    // Get the first record from the data array
    const record = details.data?.[0];
    if (!record) {
      console.log("[TEST] No record data found");
      return [];
    }

    // Get the Subform_1 (Expense Reimbursement) field
    const subformData = record["Subform_1"];
    if (!subformData || !Array.isArray(subformData)) {
      console.log("[TEST] No subform data found or it's not an array");
      return [];
    }

    dbg(`[TEST] Subform rows: ${subformData.length}`);

    const rows: ExpenseRow[] = [];
    subformData.forEach((row: unknown, index: number) => {
      if (!isRecord(row)) return;
      const files = normalizeFiles(row["File_Upload_1"]);
      if (files.length) dbg(`[TEST] Row ${index + 1}: ${files.length} file(s)`);
      rows.push({
        rowNumber: index + 1,
        date: row["Date_1"],
        expenseType: row["Expense_Type"],
        purpose: row["Purpose"],
        amount: row["Amount"],
        files,
      });
    });

    return rows;
  } catch (error) {
    console.error("[TEST] Error extracting file uploads from subform:", error);
    return [];
  }
}

type PdfItem = {
  buffer: Buffer;
  fileName: string;
  headerLines: string[];
  rowNumber: number;
};

type ImageItem = {
  buffer: Buffer;
  type: "jpeg" | "png";
  fileName: string;
  headerLines: string[];
  rowNumber: number;
};

function formatDateForHeader(value: unknown): string | null {
  if (value == null) return null;
  const s = typeof value === "string" ? value : String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const months = [
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
  return `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

function formatAmountForHeader(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") return `$${value}`;
  const s = typeof value === "string" ? value : String(value);
  const n = Number(s);
  if (!Number.isNaN(n)) return `$${n}`;
  return s;
}

function headerLinesForRow(row: ExpenseRow): string[] {
  const date = formatDateForHeader(row.date);
  const expenseType = coerceZohoFieldText(row.expenseType);
  const purpose = coerceZohoFieldText(row.purpose);
  const amount = formatAmountForHeader(row.amount);

  const lines: string[] = [];
  lines.push(`Row Number: ${row.rowNumber}`);
  if (date) lines.push(`Date: ${date}`);
  if (expenseType) lines.push(`Expense Type: ${expenseType}`);
  if (purpose) lines.push(`Purpose: ${purpose}`);
  if (amount) lines.push(`Amount: ${amount}`);
  return lines;
}

function coerceZohoFieldText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number") return String(value);

  // Zoho sometimes returns objects for lookups/picklists.
  if (isRecord(value)) {
    const candidates = [
      value["display_value"],
      value["name"],
      value["value"],
      value["label"],
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length) return c.trim();
      if (typeof c === "number") return String(c);
    }
  }

  const s = String(value).trim();
  return s.length ? s : null;
}

async function downloadFileUploads(subformRows: ExpenseRow[]) {
  const accessToken = await getZohoAccessToken();
  const pdfItems: PdfItem[] = [];
  const imageItems: ImageItem[] = [];
  let oauthScopeMismatch = false;
  let oauthScopeMismatchDetails: string | null = null;

  function extractOrgId(file: unknown): string | undefined {
    if (!isRecord(file)) return;
    const urlPath = file["download_Url"] || file["preview_Url"];
    if (!urlPath || typeof urlPath !== "string") return;
    const orgMatch = urlPath.match(/\/crm\/org(\d+)\//i);
    return orgMatch?.[1];
  }

  async function downloadViaFilesApi(fileId: string, orgId?: string) {
    const apiDomain = process.env.ZOHO_API_DOMAIN || "www.zohoapis.com";
    const contentDomain = apiDomain.replace("www.", "content.");
    const urls = [
      `https://${apiDomain}/crm/v2/files?id=${encodeURIComponent(fileId)}`,
      `https://${contentDomain}/crm/v2/files?id=${encodeURIComponent(fileId)}`,
    ];

    for (const url of urls) {
      dbg(`[TEST] Files API GET ${url}`);
      const resp = await fetch(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          Accept: "*/*",
          ...(orgId ? { "X-com-zoho-crm-orgid": orgId } : {}),
        },
      });

      const ct = resp.headers.get("content-type") ?? "";

      if (!resp.ok) {
        // Capture a clear scope error so we can surface it at the end.
        if (resp.status === 401 && ct.includes("json")) {
          try {
            const text = await resp.text();
            if (text.includes("OAUTH_SCOPE_MISMATCH")) {
              oauthScopeMismatch = true;
              oauthScopeMismatchDetails = text.slice(0, 500);
            }
            dbg(
              `[TEST] Files API error (${resp.status}): ${text.slice(0, 300)}`
            );
          } catch {}
        } else {
          dbg(`[TEST] Files API failed (${resp.status}) content-type=${ct}`);
        }
        continue;
      }

      // Zoho sometimes returns JSON/HTML for error pages even with 200 OK.
      if (ct.includes("json") || ct.includes("html")) {
        dbg(`[TEST] Files API non-binary content-type=${ct}`);
        try {
          const text = await resp.text();
          dbg(`[TEST] Files API non-binary preview: ${text.slice(0, 300)}`);
        } catch {}
        continue;
      }

      return resp;
    }

    return null;
  }

  for (let rowIndex = 0; rowIndex < subformRows.length; rowIndex++) {
    const row = subformRows[rowIndex];
    const headerLines = headerLinesForRow(row);

    for (const file of row.files) {
      const fileIdRaw = file["file_Id"] ?? file["id"];
      const fileNameRaw = file["file_Name"] ?? file["name"];

      const fileId = typeof fileIdRaw === "string" ? fileIdRaw : undefined;
      const fileName =
        typeof fileNameRaw === "string" ? fileNameRaw : `file_${rowIndex}`;
      const lowerFileName = fileName.toLowerCase();

      if (!fileId) {
        dbg(`[TEST] No file ID found in file object, skipping`);
        continue;
      }

      // Check if it's a PDF or supported image
      const isPdf = lowerFileName.endsWith(".pdf");
      const isJpeg =
        lowerFileName.endsWith(".jpg") || lowerFileName.endsWith(".jpeg");
      const isPng = lowerFileName.endsWith(".png");

      if (!isPdf && !isJpeg && !isPng) {
        dbg(`[TEST] Skipping unsupported file: ${fileName}`);
        continue;
      }

      try {
        const orgId = extractOrgId(file);
        const response = await downloadViaFilesApi(fileId, orgId);
        if (!response) {
          console.warn(
            `[TEST] Failed to download file ${fileName} (${fileId})`
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Validate basic file signatures (avoid accidentally embedding an HTML/JSON error page).
        const isValidJpeg =
          buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        const isValidPng =
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47;
        const isValidPdf =
          buffer[0] === 0x25 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x44 &&
          buffer[3] === 0x46;

        if (!isValidJpeg && !isValidPng && !isValidPdf) {
          dbg(
            `[TEST] Downloaded data is not a valid image/PDF for ${fileName}. First bytes: ${buffer
              .slice(0, 8)
              .toString("hex")}`
          );
          continue;
        }

        if (isPdf) {
          pdfItems.push({
            buffer,
            fileName,
            headerLines,
            rowNumber: row.rowNumber,
          });
        } else if (isJpeg) {
          imageItems.push({
            buffer,
            type: "jpeg",
            fileName,
            headerLines,
            rowNumber: row.rowNumber,
          });
        } else if (isPng) {
          imageItems.push({
            buffer,
            type: "png",
            fileName,
            headerLines,
            rowNumber: row.rowNumber,
          });
        }
      } catch (error) {
        console.error(`[TEST] Error downloading file ${fileName}:`, error);
        continue;
      }
    }
  }

  if (oauthScopeMismatch) {
    throw new Error(
      `Zoho OAuth scope mismatch while downloading files. Your refresh token likely lacks a required scope for file download (e.g. ZohoCRM.files.READ). Details: ${
        oauthScopeMismatchDetails ?? "OAUTH_SCOPE_MISMATCH"
      }`
    );
  }

  return { pdfItems, imageItems };
}

function formatDateForTable(value: unknown): string {
  if (value == null) return "";
  const s = typeof value === "string" ? value : String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const months = [
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
  return `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

function formatAmountForTable(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return `$${value.toFixed(2)}`;
  const s = typeof value === "string" ? value : String(value);
  const n = Number(s);
  if (!Number.isNaN(n)) return `$${n.toFixed(2)}`;
  return s;
}

async function createSummaryPage(
  pdfDoc: PDFDocument,
  recordInfo: RecordInfo,
  subformRows: ExpenseRow[]
): Promise<void> {
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  const boldFontSize = 12;
  const margin = 50;
  const lineHeight = 15;
  const baseRowHeight = 20;
  const cellLineHeight = fontSize + 2;
  const colGap = 0;

  let y = 792 - margin;

  // Title
  page.drawText("Expense Reimbursement Form", {
    x: margin,
    y,
    size: boldFontSize + 4,
    font: boldFont,
  });
  y -= lineHeight * 2;

  // Record information (bold labels, regular values)
  const labelGap = 4;
  function drawLabelValue(label: string, value: string) {
    const labelWidth = boldFont.widthOfTextAtSize(label, fontSize);
    page.drawText(label, {
      x: margin,
      y,
      size: fontSize,
      font: boldFont,
    });
    page.drawText(value, {
      x: margin + labelWidth + labelGap,
      y,
      size: fontSize,
      font,
    });
  }

  if (recordInfo.reimbursementFor) {
    drawLabelValue("Reimbursement For:", recordInfo.reimbursementFor);
    y -= lineHeight;
  }

  if (recordInfo.facility) {
    drawLabelValue("Facility:", recordInfo.facility);
    y -= lineHeight;
  }

  const employeeName = [recordInfo.employee, recordInfo.employeeLastName]
    .filter(Boolean)
    .join(" ");
  if (employeeName) {
    drawLabelValue("Employee:", employeeName);
    y -= lineHeight;
  }

  if (recordInfo.employeeEmail) {
    drawLabelValue("Employee Email:", recordInfo.employeeEmail);
    y -= lineHeight;
  }

  y -= lineHeight;

  // Table headers
  const tableTopY = y;
  const colWidths = {
    rowNumber: 60,
    date: 100,
    expenseType: 120,
    purpose: 160,
    amount: 90,
  };
  const colX = {
    rowNumber: margin,
    date: margin + colWidths.rowNumber + colGap,
    expenseType: margin + colWidths.rowNumber + colWidths.date + colGap * 2,
    purpose:
      margin +
      colWidths.rowNumber +
      colWidths.date +
      colWidths.expenseType +
      colGap * 3,
    amount:
      margin +
      colWidths.rowNumber +
      colWidths.date +
      colWidths.expenseType +
      colWidths.purpose +
      colGap * 4,
  };

  const rowBorderColor = rgb(0.55, 0.55, 0.55);
  const borderWidth = 0.5;

  function drawCellBorder(
    x: number,
    yTop: number,
    width: number,
    height: number
  ) {
    page.drawRectangle({
      x,
      y: yTop - height,
      width,
      height,
      borderColor: rowBorderColor,
      borderWidth,
    });
  }

  function drawRowBorders(yTop: number, height: number) {
    drawCellBorder(colX.rowNumber, yTop, colWidths.rowNumber, height);
    drawCellBorder(colX.date, yTop, colWidths.date, height);
    drawCellBorder(colX.expenseType, yTop, colWidths.expenseType, height);
    drawCellBorder(colX.purpose, yTop, colWidths.purpose, height);
    drawCellBorder(colX.amount, yTop, colWidths.amount, height);
  }

  function drawCenteredText(
    text: string,
    x: number,
    yTop: number,
    width: number,
    fontToUse: PDFFont,
    size: number
  ) {
    const textWidth = fontToUse.widthOfTextAtSize(text, size);
    const textX = x + Math.max(0, (width - textWidth) / 2);
    const textY = yTop - (baseRowHeight + size) / 2;
    page.drawText(text, {
      x: textX,
      y: textY,
      size,
      font: fontToUse,
    });
  }

  function wrapText(text: string, maxWidth: number): string[] {
    if (!text) return [""];
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const testLine = current ? `${current} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width <= maxWidth || !current) {
        current = testLine;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [text];
  }

  function drawCenteredLines(
    lines: string[],
    x: number,
    yTop: number,
    width: number,
    fontToUse: PDFFont,
    size: number,
    rowHeight: number
  ) {
    const totalTextHeight = lines.length * cellLineHeight;
    let y =
      yTop -
      (rowHeight + totalTextHeight) / 2 +
      (lines.length - 1) * cellLineHeight;
    for (const line of lines) {
      const textWidth = fontToUse.widthOfTextAtSize(line, size);
      const textX = x + Math.max(0, (width - textWidth) / 2);
      page.drawText(line, {
        x: textX,
        y,
        size,
        font: fontToUse,
      });
      y -= cellLineHeight;
    }
  }

  const headerTopY = tableTopY;
  drawRowBorders(headerTopY, baseRowHeight);

  // Draw table header row (no header for row number column)
  drawCenteredText(
    "Date",
    colX.date,
    headerTopY,
    colWidths.date,
    boldFont,
    fontSize
  );
  drawCenteredText(
    "Expense Type",
    colX.expenseType,
    headerTopY,
    colWidths.expenseType,
    boldFont,
    fontSize
  );
  drawCenteredText(
    "Purpose",
    colX.purpose,
    headerTopY,
    colWidths.purpose,
    boldFont,
    fontSize
  );
  drawCenteredText(
    "Amount ($)",
    colX.amount,
    headerTopY,
    colWidths.amount,
    boldFont,
    fontSize
  );

  // Draw table rows
  let currentTopY = headerTopY - baseRowHeight;
  let totalAmount = 0;

  for (const row of subformRows) {
    const dateStr = formatDateForTable(row.date);
    const expenseTypeStr = coerceZohoFieldText(row.expenseType) || "";
    const purposeStr = coerceZohoFieldText(row.purpose) || "";
    const amountStr = formatAmountForTable(row.amount);
    const amountNum =
      typeof row.amount === "number"
        ? row.amount
        : typeof row.amount === "string"
        ? Number(row.amount) || 0
        : 0;
    totalAmount += amountNum;

    // Truncate long text to fit columns
    const truncate = (text: string, maxWidth: number) => {
      const width = font.widthOfTextAtSize(text, fontSize);
      if (width <= maxWidth) return text;
      let truncated = text;
      while (font.widthOfTextAtSize(truncated + "...", fontSize) > maxWidth) {
        truncated = truncated.slice(0, -1);
      }
      return truncated + "...";
    };

    const rowNumberLines = wrapText(String(row.rowNumber), colWidths.rowNumber);
    const dateLines = wrapText(dateStr, colWidths.date);
    const expenseTypeLines = wrapText(
      truncate(expenseTypeStr, colWidths.expenseType),
      colWidths.expenseType
    );
    const purposeLines = wrapText(
      truncate(purposeStr, colWidths.purpose),
      colWidths.purpose
    );
    const amountLines = wrapText(amountStr, colWidths.amount);

    const maxLines = Math.max(
      rowNumberLines.length,
      dateLines.length,
      expenseTypeLines.length,
      purposeLines.length,
      amountLines.length
    );
    const rowHeight = Math.max(baseRowHeight, maxLines * cellLineHeight + 6);

    const rowTopY = currentTopY;
    drawRowBorders(rowTopY, rowHeight);

    drawCenteredLines(
      rowNumberLines,
      colX.rowNumber,
      rowTopY,
      colWidths.rowNumber,
      font,
      fontSize,
      rowHeight
    );
    drawCenteredLines(
      dateLines,
      colX.date,
      rowTopY,
      colWidths.date,
      font,
      fontSize,
      rowHeight
    );
    drawCenteredLines(
      expenseTypeLines,
      colX.expenseType,
      rowTopY,
      colWidths.expenseType,
      font,
      fontSize,
      rowHeight
    );
    drawCenteredLines(
      purposeLines,
      colX.purpose,
      rowTopY,
      colWidths.purpose,
      font,
      fontSize,
      rowHeight
    );
    drawCenteredLines(
      amountLines,
      colX.amount,
      rowTopY,
      colWidths.amount,
      font,
      fontSize,
      rowHeight
    );

    currentTopY -= rowHeight;
  }

  // Total Amount at the bottom
  const totalY = currentTopY - lineHeight * 2;
  page.drawText(`Total Amount: $${totalAmount.toFixed(2)}`, {
    x: margin,
    y: totalY,
    size: boldFontSize,
    font: boldFont,
  });
}

async function combinePDFsAndImages(
  pdfItems: PdfItem[],
  imageItems: ImageItem[],
  recordInfo: RecordInfo,
  subformRows: ExpenseRow[]
): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();
  const headerFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const headerSize = 8;
  const headerColor = rgb(1, 0, 0);
  const margin = 16;
  const lineGap = 2;

  // Create summary page as the first page
  await createSummaryPage(mergedPdf, recordInfo, subformRows);

  function drawHeader(page: PDFPage, lines: string[], font: PDFFont) {
    if (!lines.length) return;
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    let y = pageHeight - margin - headerSize;

    for (const line of lines) {
      const textWidth = font.widthOfTextAtSize(line, headerSize);
      const x = Math.max(margin, pageWidth - margin - textWidth);
      page.drawText(line, {
        x,
        y,
        size: headerSize,
        font,
        color: headerColor,
      });
      y -= headerSize + lineGap;
    }
  }

  // Track which headers have been drawn to avoid duplicates
  // Use a string representation of headerLines to identify unique headers
  const drawnHeaders = new Set<string>();

  function getHeaderKey(headerLines: string[]): string {
    return headerLines.join("|||");
  }

  function shouldDrawHeader(headerLines: string[]): boolean {
    if (!headerLines.length) return false;
    const key = getHeaderKey(headerLines);
    if (drawnHeaders.has(key)) return false;
    drawnHeaders.add(key);
    return true;
  }

  // Add all PDF pages
  for (let i = 0; i < pdfItems.length; i++) {
    try {
      dbg(`[TEST] Merging PDF ${i + 1}/${pdfItems.length}`);
      const pdf = await PDFDocument.load(pdfItems[i].buffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

      // Only draw header on first page if this header hasn't been drawn yet
      const shouldDraw = shouldDrawHeader(pdfItems[i].headerLines);
      if (shouldDraw && copiedPages.length > 0) {
        // Draw header only on the first page of this attachment
        drawHeader(copiedPages[0], pdfItems[i].headerLines, headerFont);
      }

      copiedPages.forEach((page) => mergedPdf.addPage(page));
      dbg(`[TEST] Added ${copiedPages.length} pages from PDF ${i + 1}`);
    } catch (error) {
      console.error(`[TEST] Error merging PDF ${i + 1}:`, error);
      // Continue with other PDFs even if one fails
    }
  }

  // Convert images to PDF pages
  for (let i = 0; i < imageItems.length; i++) {
    try {
      const { buffer, type, fileName, headerLines } = imageItems[i];
      dbg(`[TEST] Converting image: ${fileName} (${type})`);

      // Embed the image
      let image;
      try {
        image =
          type === "jpeg"
            ? await mergedPdf.embedJpg(buffer)
            : await mergedPdf.embedPng(buffer);
      } catch (embedError) {
        console.error(
          `[TEST] Failed to embed ${type.toUpperCase()} image ${fileName}:`,
          embedError
        );
        throw embedError;
      }

      // Calculate page size to fit image (max Letter size: 612x792 points)
      const maxWidth = 612;
      const maxHeight = 792;
      let { width, height } = image;

      // Scale down if image is too large
      if (width > maxWidth || height > maxHeight) {
        const widthRatio = maxWidth / width;
        const heightRatio = maxHeight / height;
        const ratio = Math.min(widthRatio, heightRatio);
        width = width * ratio;
        height = height * ratio;
      }

      // Create page with calculated dimensions
      const page = mergedPdf.addPage([width, height]);

      // Draw image to fill the entire page
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: width,
        height: height,
      });

      // Only draw header if this header hasn't been drawn yet
      if (shouldDrawHeader(headerLines)) {
        drawHeader(page, headerLines, headerFont);
      }

      dbg(
        `[TEST] Added image page: ${fileName} (${Math.round(
          width
        )}x${Math.round(height)})`
      );
    } catch (error) {
      console.error(
        `[TEST] Error converting image ${imageItems[i].fileName}:`,
        error
      );
      // Continue with other images even if one fails
    }
  }

  const mergedPdfBytes = await mergedPdf.save();
  dbg(`[TEST] Final combined PDF size: ${mergedPdfBytes.length} bytes`);
  return Buffer.from(mergedPdfBytes);
}

// Token management for Zoho OAuth
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getZohoAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    dbg("[TEST] Using cached access token");
    return cachedAccessToken.token;
  }

  dbg("[TEST] Fetching new access token...");

  // Zoho accounts domain can be different based on data center
  // accounts.zoho.com (US), accounts.zoho.eu (EU), accounts.zoho.in (IN), etc.
  const accountsDomain =
    process.env.ZOHO_ACCOUNTS_DOMAIN || "accounts.zoho.com";

  // Get new access token using refresh token
  const url =
    `https://${accountsDomain}/oauth/v2/token?` +
    `refresh_token=${process.env.ZOHO_REFRESH_TOKEN}&` +
    `client_id=${process.env.ZOHO_CLIENT_ID}&` +
    `client_secret=${process.env.ZOHO_CLIENT_SECRET}&` +
    `grant_type=refresh_token`;

  dbg(`[TEST] Fetching access token from: ${accountsDomain}`);

  const response = await fetch(url, {
    method: "POST",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      "[TEST] Failed to get access token:",
      response.status,
      errorText
    );
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();

  // Cache the token (expires in 1 hour, we'll refresh 5 minutes early)
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  dbg("[TEST] New access token obtained successfully");

  return data.access_token;
}
