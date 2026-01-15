import {
  PDFDocument,
  type PDFPage,
  type PDFFont,
  StandardFonts,
  rgb,
} from "pdf-lib";

import { getZohoAccessToken, type ZohoRecordDetails } from "./zoho";

export type FormType =
  | "expense-reimbursement"
  | "petty-cash"
  | "mileage-reimbursement";

type ExpenseRow = {
  rowNumber: number;
  date?: unknown;
  expenseType?: unknown;
  purpose?: unknown;
  amount?: unknown;
  files: Array<Record<string, unknown>>;
};

type MileageRow = {
  rowNumber: number;
  date?: unknown;
  originStreet?: unknown;
  originCity?: unknown;
  originState?: unknown;
  originZip?: unknown;
  destinationStreet?: unknown;
  destinationCity?: unknown;
  destinationState?: unknown;
  destinationZip?: unknown;
  purpose?: unknown;
  numberOfMiles?: unknown;
};

type RecordInfo = {
  reimbursementFor?: string;
  facility?: string;
  employee?: string;
  employeeLastName?: string;
  employeeEmail?: string;
  totalMiles?: unknown;
  totalMilesMultiplied?: unknown;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFiles(
  fileUploadValue: unknown
): Array<Record<string, unknown>> {
  if (!fileUploadValue) return [];
  if (Array.isArray(fileUploadValue)) return fileUploadValue.filter(isRecord);
  return isRecord(fileUploadValue) ? [fileUploadValue] : [];
}

function coerceZohoFieldText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number") return String(value);

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

function extractRecordInfo(
  recordDetails: unknown,
  formType: FormType
): RecordInfo {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) {
      return {};
    }

    const isPettyCash = formType === "petty-cash";
    const isMileage = formType === "mileage-reimbursement";

    return {
      reimbursementFor:
        coerceZohoFieldText(record["Reimbusment_For"]) ?? undefined,
      facility: coerceZohoFieldText(record["Facility"]) ?? undefined,
      employee: isPettyCash
        ? coerceZohoFieldText(record["Requested_by_First_Name"]) ?? undefined
        : coerceZohoFieldText(record["Employee"]) ?? undefined,
      employeeLastName: isPettyCash
        ? coerceZohoFieldText(record["Requested_by_Last_Name"]) ?? undefined
        : coerceZohoFieldText(record["Employee_Last_Name"]) ?? undefined,
      employeeEmail: isPettyCash
        ? coerceZohoFieldText(record["Requested_by_Email"]) ?? undefined
        : coerceZohoFieldText(record["Employee_Email"]) ?? undefined,
      totalMiles: isMileage ? record["Total_Miles"] : undefined,
      totalMilesMultiplied: isMileage
        ? record["Total_Miles_multiplied"]
        : undefined,
    };
  } catch (error) {
    console.error("[CCHEALTHCARE] Error extracting record info:", error);
    return {};
  }
}

function extractExpenseReimbursementRows(recordDetails: unknown): ExpenseRow[] {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) {
      return [];
    }

    const subformData = record["Subform_1"];
    if (!subformData || !Array.isArray(subformData)) {
      return [];
    }

    const rows: ExpenseRow[] = [];
    subformData.forEach((row: unknown, index: number) => {
      if (!isRecord(row)) return;
      const files = normalizeFiles(row["File_Upload_1"]);
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
    console.error(
      "[CCHEALTHCARE] Error extracting expense reimbursement rows:",
      error
    );
    return [];
  }
}

function extractMileageReimbursementRows(recordDetails: unknown): MileageRow[] {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) {
      return [];
    }

    const subformData = record["Mileage_Reimbursement"];
    if (!subformData || !Array.isArray(subformData)) {
      return [];
    }

    const rows: MileageRow[] = [];
    subformData.forEach((row: unknown, index: number) => {
      if (!isRecord(row)) return;
      rows.push({
        rowNumber: index + 1,
        date: row["Date"],
        originStreet: row["Origin_Street"],
        originCity: row["Origin_City"],
        originState: row["Origin_State"],
        originZip: row["Origin_Zip"],
        destinationStreet: row["Destination_Street"],
        destinationCity: row["Destination_City"],
        destinationState: row["Destination_State"],
        destinationZip: row["Destination_Zip"],
        purpose: row["Purpose"],
        numberOfMiles: row["Number_Of_Miles"],
      });
    });

    return rows;
  } catch (error) {
    console.error(
      "[CCHEALTHCARE] Error extracting mileage reimbursement rows:",
      error
    );
    return [];
  }
}

function calculateTotalMiles(mileageRows: MileageRow[]): number {
  let total = 0;
  for (const row of mileageRows) {
    const miles = row.numberOfMiles;
    if (miles != null) {
      const milesNum =
        typeof miles === "number"
          ? miles
          : typeof miles === "string"
          ? Number(miles) || 0
          : 0;
      total += milesNum;
    }
  }
  return total;
}

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

  const values: string[] = [];
  values.push(`Row ${row.rowNumber}`);
  if (date) values.push(date);
  if (expenseType) values.push(expenseType);
  if (purpose) values.push(purpose);
  if (amount) values.push(amount);
  return values.length ? [values.join(" | ")] : [];
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
      const resp = await fetch(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          Accept: "*/*",
          ...(orgId ? { "X-com-zoho-crm-orgid": orgId } : {}),
        },
      });

      const ct = resp.headers.get("content-type") ?? "";

      if (!resp.ok) {
        if (resp.status === 401 && ct.includes("json")) {
          try {
            const text = await resp.text();
            if (text.includes("OAUTH_SCOPE_MISMATCH")) {
              oauthScopeMismatch = true;
              oauthScopeMismatchDetails = text.slice(0, 500);
            }
          } catch {}
        }
        continue;
      }

      if (ct.includes("json") || ct.includes("html")) {
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
        continue;
      }

      const isPdf = lowerFileName.endsWith(".pdf");
      const isJpeg =
        lowerFileName.endsWith(".jpg") || lowerFileName.endsWith(".jpeg");
      const isPng = lowerFileName.endsWith(".png");

      if (!isPdf && !isJpeg && !isPng) {
        continue;
      }

      try {
        const orgId = extractOrgId(file);
        const response = await downloadViaFilesApi(fileId, orgId);
        if (!response) {
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
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
        console.error("[CCHEALTHCARE] Error downloading file upload:", error);
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

function formatMilesValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  const s = typeof value === "string" ? value : String(value);
  const n = Number(s);
  if (!Number.isNaN(n)) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  return s;
}

function buildAddress(parts: Array<string | null>): string {
  const [street, city, state, zip] = parts;
  const cityStateZip = [city, state, zip].filter(Boolean).join(" ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

async function createSummaryPage(
  pdfDoc: PDFDocument,
  recordInfo: RecordInfo,
  subformRows: ExpenseRow[] | MileageRow[],
  formType: FormType
): Promise<void> {
  const page = pdfDoc.addPage([612, 792]);
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

  const formTitle =
    formType === "petty-cash"
      ? "Petty Cash Form"
      : formType === "mileage-reimbursement"
      ? "Mileage Reimbursement Form"
      : "Expense Reimbursement Form";
  const titleFontSize = boldFontSize + 4;
  page.drawText(formTitle, {
    x: margin,
    y,
    size: titleFontSize,
    font: boldFont,
  });
  y -= lineHeight * 2;

  const employeeName = [recordInfo.employee, recordInfo.employeeLastName]
    .filter(Boolean)
    .join(" ");
  if (employeeName) {
    const label = "Employee Name: ";
    const labelWidth = boldFont.widthOfTextAtSize(label, titleFontSize);
    const employeeNameFontSize = titleFontSize - 2;
    page.drawText(label, {
      x: margin,
      y,
      size: titleFontSize,
      font: boldFont,
    });
    page.drawText(employeeName, {
      x: margin + labelWidth,
      y,
      size: employeeNameFontSize,
      font,
    });
    y -= lineHeight;
  }
  y -= lineHeight;

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

  if (recordInfo.facility) {
    drawLabelValue("Facility:", recordInfo.facility);
    y -= lineHeight;
  }

  if (recordInfo.employeeEmail) {
    drawLabelValue("Employee Email:", recordInfo.employeeEmail);
    y -= lineHeight;
  }

  y -= lineHeight;

  const tableTopY = y;

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
    let drawY =
      yTop -
      (rowHeight + totalTextHeight) / 2 +
      (lines.length - 1) * cellLineHeight;
    for (const line of lines) {
      const textWidth = fontToUse.widthOfTextAtSize(line, size);
      const textX = x + Math.max(0, (width - textWidth) / 2);
      page.drawText(line, {
        x: textX,
        y: drawY,
        size,
        font: fontToUse,
      });
      drawY -= cellLineHeight;
    }
  }

  if (formType === "mileage-reimbursement") {
    const colWidths = {
      date: 90,
      origin: 130,
      destination: 130,
      purpose: 120,
      miles: 60,
    };
    const colX = {
      date: margin,
      origin: margin + colWidths.date + colGap,
      destination: margin + colWidths.date + colWidths.origin + colGap * 2,
      purpose:
        margin +
        colWidths.date +
        colWidths.origin +
        colWidths.destination +
        colGap * 3,
      miles:
        margin +
        colWidths.date +
        colWidths.origin +
        colWidths.destination +
        colWidths.purpose +
        colGap * 4,
    };

    function drawRowBorders(yTop: number, height: number) {
      drawCellBorder(colX.date, yTop, colWidths.date, height);
      drawCellBorder(colX.origin, yTop, colWidths.origin, height);
      drawCellBorder(colX.destination, yTop, colWidths.destination, height);
      drawCellBorder(colX.purpose, yTop, colWidths.purpose, height);
      drawCellBorder(colX.miles, yTop, colWidths.miles, height);
    }

    const headerTopY = tableTopY;
    drawRowBorders(headerTopY, baseRowHeight);

    drawCenteredText(
      "Date",
      colX.date,
      headerTopY,
      colWidths.date,
      boldFont,
      fontSize
    );
    drawCenteredText(
      "Origin Address",
      colX.origin,
      headerTopY,
      colWidths.origin,
      boldFont,
      fontSize
    );
    drawCenteredText(
      "Destination Address",
      colX.destination,
      headerTopY,
      colWidths.destination,
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
      "Miles",
      colX.miles,
      headerTopY,
      colWidths.miles,
      boldFont,
      fontSize
    );

    let currentTopY = headerTopY - baseRowHeight;

    for (const row of subformRows as MileageRow[]) {
      const dateStr = formatDateForTable(row.date);
      const originAddress = buildAddress([
        coerceZohoFieldText(row.originStreet),
        coerceZohoFieldText(row.originCity),
        coerceZohoFieldText(row.originState),
        coerceZohoFieldText(row.originZip),
      ]);
      const destinationAddress = buildAddress([
        coerceZohoFieldText(row.destinationStreet),
        coerceZohoFieldText(row.destinationCity),
        coerceZohoFieldText(row.destinationState),
        coerceZohoFieldText(row.destinationZip),
      ]);
      const purposeStr = coerceZohoFieldText(row.purpose) || "";
      const milesStr = formatMilesValue(row.numberOfMiles);

      const truncate = (text: string, maxWidth: number) => {
        const width = font.widthOfTextAtSize(text, fontSize);
        if (width <= maxWidth) return text;
        let truncated = text;
        while (font.widthOfTextAtSize(truncated + "...", fontSize) > maxWidth) {
          truncated = truncated.slice(0, -1);
        }
        return truncated + "...";
      };

      const dateLines = wrapText(dateStr, colWidths.date);
      const originLines = wrapText(originAddress, colWidths.origin);
      const destinationLines = wrapText(
        destinationAddress,
        colWidths.destination
      );
      const purposeLines = wrapText(
        truncate(purposeStr, colWidths.purpose),
        colWidths.purpose
      );
      const milesLines = wrapText(milesStr, colWidths.miles);

      const maxLines = Math.max(
        dateLines.length,
        originLines.length,
        destinationLines.length,
        purposeLines.length,
        milesLines.length
      );
      const rowHeight = Math.max(baseRowHeight, maxLines * cellLineHeight + 6);

      const rowTopY = currentTopY;
      drawRowBorders(rowTopY, rowHeight);

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
        originLines,
        colX.origin,
        rowTopY,
        colWidths.origin,
        font,
        fontSize,
        rowHeight
      );
      drawCenteredLines(
        destinationLines,
        colX.destination,
        rowTopY,
        colWidths.destination,
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
        milesLines,
        colX.miles,
        rowTopY,
        colWidths.miles,
        font,
        fontSize,
        rowHeight
      );

      currentTopY -= rowHeight;
    }

    const totalMiles = formatMilesValue(recordInfo.totalMiles) || "-";
    const totalAmount =
      recordInfo.totalMilesMultiplied != null
        ? formatAmountForTable(recordInfo.totalMilesMultiplied)
        : "-";
    let totalY = currentTopY - lineHeight * 2;
    page.drawText(`Total Miles: ${totalMiles}`, {
      x: margin,
      y: totalY,
      size: boldFontSize,
      font: boldFont,
    });
    totalY -= lineHeight + 2;
    page.drawText(`Total Amount: ${totalAmount}`, {
      x: margin,
      y: totalY,
      size: boldFontSize,
      font: boldFont,
    });

    return;
  }

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

  function drawRowBorders(yTop: number, height: number) {
    drawCellBorder(colX.rowNumber, yTop, colWidths.rowNumber, height);
    drawCellBorder(colX.date, yTop, colWidths.date, height);
    drawCellBorder(colX.expenseType, yTop, colWidths.expenseType, height);
    drawCellBorder(colX.purpose, yTop, colWidths.purpose, height);
    drawCellBorder(colX.amount, yTop, colWidths.amount, height);
  }

  const headerTopY = tableTopY;
  drawRowBorders(headerTopY, baseRowHeight);

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

  let currentTopY = headerTopY - baseRowHeight;
  let totalAmount = 0;

  for (const row of subformRows as ExpenseRow[]) {
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
  subformRows: ExpenseRow[] | MileageRow[],
  formType: FormType
): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();
  const headerFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const headerSize = 8;
  const headerColor = rgb(1, 0, 0);
  const margin = 16;
  const lineGap = 2;

  await createSummaryPage(mergedPdf, recordInfo, subformRows, formType);

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

  function getHeaderAreaHeight(lines: string[]): number {
    if (!lines.length) return 0;
    return margin + lines.length * (headerSize + lineGap) + lineGap;
  }

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

  for (let i = 0; i < pdfItems.length; i++) {
    try {
      const pdf = await PDFDocument.load(pdfItems[i].buffer);
      const sourcePages = pdf.getPages();
      const embeddedPages = await mergedPdf.embedPages(sourcePages);
      const shouldDraw = shouldDrawHeader(pdfItems[i].headerLines);
      const headerAreaHeight = shouldDraw
        ? getHeaderAreaHeight(pdfItems[i].headerLines)
        : 0;

      sourcePages.forEach((sourcePage, pageIndex) => {
        const { width, height } = sourcePage.getSize();
        const extraHeight = pageIndex === 0 ? headerAreaHeight : 0;
        const page = mergedPdf.addPage([width, height + extraHeight]);
        page.drawPage(embeddedPages[pageIndex], {
          x: 0,
          y: 0,
          width,
          height,
        });

        if (pageIndex === 0 && shouldDraw) {
          drawHeader(page, pdfItems[i].headerLines, headerFont);
        }
      });
    } catch (error) {
      console.error("[CCHEALTHCARE] Error merging PDF:", error);
    }
  }

  for (let i = 0; i < imageItems.length; i++) {
    try {
      const { buffer, type, fileName, headerLines } = imageItems[i];

      let image;
      try {
        image =
          type === "jpeg"
            ? await mergedPdf.embedJpg(buffer)
            : await mergedPdf.embedPng(buffer);
      } catch (embedError) {
        console.error(
          `[CCHEALTHCARE] Failed to embed ${type.toUpperCase()} image ${fileName}:`,
          embedError
        );
        throw embedError;
      }

      const maxWidth = 612;
      const maxHeight = 792;
      let { width, height } = image;

      if (width > maxWidth || height > maxHeight) {
        const widthRatio = maxWidth / width;
        const heightRatio = maxHeight / height;
        const ratio = Math.min(widthRatio, heightRatio);
        width = width * ratio;
        height = height * ratio;
      }

      const shouldDraw = shouldDrawHeader(headerLines);
      const headerAreaHeight = shouldDraw
        ? getHeaderAreaHeight(headerLines)
        : 0;
      const page = mergedPdf.addPage([width, height + headerAreaHeight]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: width,
        height: height,
      });

      if (shouldDraw) {
        drawHeader(page, headerLines, headerFont);
      }
    } catch (error) {
      console.error(
        `[CCHEALTHCARE] Error converting image ${imageItems[i].fileName}:`,
        error
      );
    }
  }

  const mergedPdfBytes = await mergedPdf.save();
  return Buffer.from(mergedPdfBytes);
}

export async function buildReimbursementPdf(
  recordDetails: unknown,
  formType: FormType
): Promise<Buffer> {
  const recordInfo = extractRecordInfo(recordDetails, formType);

  if (formType === "mileage-reimbursement") {
    const subformRows = extractMileageReimbursementRows(recordDetails);
    const totalMiles = calculateTotalMiles(subformRows);
    const totalAmount = totalMiles * 0.73;
    recordInfo.totalMiles = totalMiles;
    recordInfo.totalMilesMultiplied = totalAmount;
    return combinePDFsAndImages([], [], recordInfo, subformRows, formType);
  }

  const subformRows = extractExpenseReimbursementRows(recordDetails);
  const totalFilesInSubform = subformRows.reduce(
    (sum, row) => sum + row.files.length,
    0
  );

  if (!subformRows.length || totalFilesInSubform === 0) {
    const message =
      formType === "petty-cash"
        ? "No file uploads found in Petty Cash subform"
        : "No file uploads found in Expense Reimbursement subform";
    throw new Error(message);
  }

  const { pdfItems, imageItems } = await downloadFileUploads(subformRows);

  if (pdfItems.length === 0 && imageItems.length === 0) {
    throw new Error("No PDF or image files found in subform uploads");
  }

  return combinePDFsAndImages(
    pdfItems,
    imageItems,
    recordInfo,
    subformRows,
    formType
  );
}
