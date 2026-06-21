import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";

// SmartSuite Configuration
const SMARTSUITE_API_KEY = process.env.TOMCHEI_SHABBOS_SMARTSUITE_API_KEY;
const SMARTSUITE_ACCOUNT_ID = process.env.TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID;
const SMARTSUITE_RECORDS_TABLE_ID = "6925a5e5faf422df3f931169";
const SMARTSUITE_DELIVERY_TABLE_ID = "6925b0fb90de6fdfbd33e096";
const SMARTSUITE_DELIVERY_LIST_FIELD_ID = "sb1a7b32b6";

const PACKAGE_FILTER_FIELD_ID = "sec653610f";
const ROUTE_NUMBER_FIELD_ID = "sba911ff35";
const BOX_SIZE_FIELD_ID = "s2baca63ff";
const CUSTOMER_ID_FIELD_ID = "sc9e87f825";
const ADDRESS_FIELD_ID = "sad19ed83a";
const DELIVERY_INSTRUCTIONS_FIELD_ID = "se9d193bde";
const BOXES_TO_YI_WOODMERE_FIELD_ID = "s1a7e187fc";
const PICKUP_FIELD_ID = "s7dcf28d05";

interface DeliveryListRequest {
  id: string;
  password: string;
}

interface SmartSuiteRecord {
  id: string;
  title: string;
  [key: string]: unknown;
}

interface SmartSuiteResponse {
  items: SmartSuiteRecord[];
  total: number;
  offset: number;
  limit: number;
  time: string;
}

interface GroupedRecords {
  [route: string]: SmartSuiteRecord[];
}

export async function POST(request: NextRequest) {
  try {
    const body: DeliveryListRequest = await request.json();
    const { id, password } = body;

    // Validate password
    if (password?.trim() !== process.env.TOMCHEI_SHABBOS_API_PASSWORD?.trim()) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    if (!id) {
      return NextResponse.json({ error: "ID is required" }, { status: 400 });
    }

    // Fetch delivery list records from SmartSuite
    const records = await fetchSmartSuiteRecords(id);

    if (!records || records.items.length === 0) {
      return NextResponse.json(
        {
          message: "No delivery records found for this package",
          recordCount: 0,
          routeCount: 0,
        },
        { status: 200 },
      );
    }

    const withBoxSize = records.items.filter(hasBoxSize);
    const routeRecords = withBoxSize.filter(
      (record) =>
        !isTrue(record, BOXES_TO_YI_WOODMERE_FIELD_ID) &&
        !isTrue(record, PICKUP_FIELD_ID),
    );
    const woodmereMain = withBoxSize.filter(
      (record) =>
        isTrue(record, BOXES_TO_YI_WOODMERE_FIELD_ID) && isEmptyRoute(record),
    );
    const woodmerePickup = withBoxSize.filter(
      (record) =>
        isTrue(record, BOXES_TO_YI_WOODMERE_FIELD_ID) &&
        isEmptyRoute(record) &&
        isTrue(record, PICKUP_FIELD_ID),
    );
    const pickupsOnly = withBoxSize.filter(
      (record) =>
        isTrue(record, PICKUP_FIELD_ID) &&
        isTrue(record, BOXES_TO_YI_WOODMERE_FIELD_ID) &&
        isEmptyRoute(record),
    );

    const groupedByRoute = groupRecordsByRoute(routeRecords);
    const dateStamp = new Date().toISOString().split("T")[0];

    const pdfBuffer = await generateDeliveryListPDF(groupedByRoute);
    await clearAndUploadPdfToSmartSuite(
      pdfBuffer,
      id,
      `delivery_list_${dateStamp}.pdf`,
    );

    const labelsPdfBuffer = await generateLabelsListPDF(routeRecords);
    await uploadPdfToSmartSuite(
      labelsPdfBuffer,
      id,
      `labels_${dateStamp}.pdf`,
    );

    const woodmerePdfBuffer = await generateWoodmerePDF(
      woodmereMain,
      woodmerePickup,
    );
    await uploadPdfToSmartSuite(
      woodmerePdfBuffer,
      id,
      `woodmere_${dateStamp}.pdf`,
    );

    const pickupsPdfBuffer = await generatePickupsOnlyPDF(pickupsOnly);
    await uploadPdfToSmartSuite(
      pickupsPdfBuffer,
      id,
      `pickups_only_${dateStamp}.pdf`,
    );

    return NextResponse.json(
      {
        message:
          "Routes, labels, Woodmere, and Pickups Only PDFs generated and uploaded successfully",
        recordCount: routeRecords.length,
        routeCount: Object.keys(groupedByRoute).length,
        woodmereMainCount: woodmereMain.length,
        woodmerePickupCount: woodmerePickup.length,
        pickupsOnlyCount: pickupsOnly.length,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[DELIVERY LIST] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate delivery list",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

async function fetchSmartSuiteRecords(
  packageId: string,
): Promise<SmartSuiteResponse> {
  const url = `https://app.smartsuite.com/api/v1/applications/${SMARTSUITE_RECORDS_TABLE_ID}/records/list/`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${SMARTSUITE_API_KEY}`,
      "ACCOUNT-ID": SMARTSUITE_ACCOUNT_ID || "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        operator: "and",
        fields: [
          {
            field: PACKAGE_FILTER_FIELD_ID,
            comparison: "has_any_of",
            value: [packageId],
          },
        ],
      },
      hydrated: true,
      limit: 1000,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `SmartSuite API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<SmartSuiteResponse>;
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

function isTrue(record: SmartSuiteRecord, fieldId: string): boolean {
  return record[fieldId] === true;
}

function isEmptyRoute(record: SmartSuiteRecord): boolean {
  return !coerceDisplayText(record[ROUTE_NUMBER_FIELD_ID]);
}

function hasBoxSize(record: SmartSuiteRecord): boolean {
  return Boolean(coerceDisplayText(record[BOX_SIZE_FIELD_ID]));
}

function groupRecordsByRoute(records: SmartSuiteRecord[]): GroupedRecords {
  const grouped: GroupedRecords = {};

  records.forEach((record) => {
    const route =
      coerceDisplayText(record[ROUTE_NUMBER_FIELD_ID]) || "Unassigned Route";
    if (!grouped[route]) {
      grouped[route] = [];
    }
    grouped[route].push(record);
  });

  return grouped;
}

const DELIVERY_TABLE_HEADERS = [
  "Box Size",
  "Address",
  "Delivery Instructions",
  "Customer ID",
];

function getDeliveryColumnWidths(contentWidth: number): number[] {
  return [
    contentWidth * 0.24,
    contentWidth * 0.31,
    contentWidth * 0.31,
    contentWidth * 0.14,
  ];
}

function drawDeliverySection(
  pdfDoc: PDFDocument,
  sectionTitle: string,
  records: SmartSuiteRecord[],
  footerText?: string,
): void {
  const pageSize: [number, number] = [612, 792];
  const margin = 40;
  let page = pdfDoc.addPage(pageSize);
  const { height, width } = page.getSize();
  const contentWidth = width - 2 * margin;
  const columnWidths = getDeliveryColumnWidths(contentWidth);
  const rowHeight = 20;
  const headerHeight = 25;
  let yPosition = height - margin;

  const drawTableHeader = (targetPage: PDFPage, headerY: number) => {
    targetPage.drawRectangle({
      x: margin,
      y: headerY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
      color: rgb(0.95, 0.95, 0.95),
    });

    let headerColumnX = margin;
    DELIVERY_TABLE_HEADERS.forEach((header, columnIndex) => {
      targetPage.drawText(header, {
        x: headerColumnX + 5,
        y: headerY - 17,
        size: 10,
        color: rgb(0, 0, 0),
        maxWidth: columnWidths[columnIndex] - 10,
      });

      if (columnIndex < DELIVERY_TABLE_HEADERS.length - 1) {
        targetPage.drawLine({
          start: {
            x: headerColumnX + columnWidths[columnIndex],
            y: headerY,
          },
          end: {
            x: headerColumnX + columnWidths[columnIndex],
            y: headerY - headerHeight,
          },
          color: rgb(0.8, 0.8, 0.8),
        });
      }

      headerColumnX += columnWidths[columnIndex];
    });
  };

  page.drawText(sanitizePdfText(sectionTitle), {
    x: margin,
    y: yPosition,
    size: 24,
    color: rgb(0, 0, 0),
    maxWidth: contentWidth,
  });

  yPosition -= 40;
  drawTableHeader(page, yPosition);
  yPosition -= headerHeight;

  for (const record of records) {
    const item = coerceDisplayText(record[BOX_SIZE_FIELD_ID]);
    const location = coerceDisplayText(record[ADDRESS_FIELD_ID]);
    const instructions = coerceDisplayText(record[DELIVERY_INSTRUCTIONS_FIELD_ID]);
    const customerId = coerceDisplayText(record[CUSTOMER_ID_FIELD_ID]);

    const itemLines = wrapText(item, columnWidths[0] - 10, 9);
    const locationLines = wrapText(location, columnWidths[1] - 10, 9);
    const instructionLines = wrapText(instructions, columnWidths[2] - 10, 9);
    const customerIdLines = wrapText(customerId, columnWidths[3] - 10, 9);

    const maxLines = Math.max(
      itemLines.length,
      locationLines.length,
      instructionLines.length,
      customerIdLines.length,
    );
    const currentRowHeight = Math.max(rowHeight, maxLines * 12 + 4);

    if (yPosition - currentRowHeight < margin) {
      page = pdfDoc.addPage(pageSize);
      yPosition = page.getHeight() - margin;
      drawTableHeader(page, yPosition);
      yPosition -= headerHeight;
    }

    page.drawRectangle({
      x: margin,
      y: yPosition - currentRowHeight,
      width: contentWidth,
      height: currentRowHeight,
      borderColor: rgb(0.8, 0.8, 0.8),
      borderWidth: 1,
    });

    let columnX = margin;
    const columnTexts = [
      itemLines,
      locationLines,
      instructionLines,
      customerIdLines,
    ];

    columnTexts.forEach((lines, columnIndex) => {
      let textY = yPosition - 15;
      lines.forEach((line) => {
        page.drawText(line, {
          x: columnX + 5,
          y: textY,
          size: 9,
          color: rgb(0, 0, 0),
          maxWidth: columnWidths[columnIndex] - 10,
        });
        textY -= 12;
      });

      if (columnIndex < columnTexts.length - 1) {
        page.drawLine({
          start: { x: columnX + columnWidths[columnIndex], y: yPosition },
          end: {
            x: columnX + columnWidths[columnIndex],
            y: yPosition - currentRowHeight,
          },
          color: rgb(0.8, 0.8, 0.8),
        });
      }

      columnX += columnWidths[columnIndex];
    });

    yPosition -= currentRowHeight;
  }

  if (footerText) {
    page.drawText(sanitizePdfText(footerText), {
      x: margin,
      y: Math.max(yPosition - 30, margin),
      size: 16,
      color: rgb(0, 0, 0),
      maxWidth: contentWidth,
    });
  }
}

async function generateDeliveryListPDF(
  groupedRecords: GroupedRecords,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const routes = Object.keys(groupedRecords).sort();
  const totalRecords = routes.reduce(
    (sum, route) => sum + groupedRecords[route].length,
    0,
  );

  const summaryPage = pdfDoc.addPage([612, 792]);
  const { height: summaryHeight, width: summaryWidth } = summaryPage.getSize();
  summaryPage.drawText(sanitizePdfText("Tomchei Shabbos - Delivery List"), {
    x: 40,
    y: summaryHeight - 80,
    size: 24,
    color: rgb(0, 0, 0),
    maxWidth: summaryWidth - 80,
  });
  summaryPage.drawText(sanitizePdfText(`Total deliveries: ${totalRecords}`), {
    x: 40,
    y: summaryHeight - 140,
    size: 36,
    color: rgb(0, 0, 0),
    maxWidth: summaryWidth - 80,
  });
  summaryPage.drawText(sanitizePdfText(`Routes: ${routes.join(", ")}`), {
    x: 40,
    y: summaryHeight - 200,
    size: 14,
    color: rgb(0.3, 0.3, 0.3),
    maxWidth: summaryWidth - 80,
  });

  for (const route of routes) {
    const records = groupedRecords[route];
    drawDeliverySection(
      pdfDoc,
      `Route ${route}`,
      records,
      `Total boxes for Route ${route}:     ${records.length} boxes`,
    );
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function generateWoodmerePDF(
  mainRecords: SmartSuiteRecord[],
  pickupRecords: SmartSuiteRecord[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const summaryPage = pdfDoc.addPage([612, 792]);
  const { height: summaryHeight, width: summaryWidth } = summaryPage.getSize();
  summaryPage.drawText(sanitizePdfText("Tomchei Shabbos - Woodmere"), {
    x: 40,
    y: summaryHeight - 80,
    size: 24,
    color: rgb(0, 0, 0),
    maxWidth: summaryWidth - 80,
  });
  summaryPage.drawText(
    sanitizePdfText(`Total records (main): ${mainRecords.length}`),
    {
      x: 40,
      y: summaryHeight - 140,
      size: 24,
      color: rgb(0, 0, 0),
      maxWidth: summaryWidth - 80,
    },
  );
  summaryPage.drawText(
    sanitizePdfText(`Woodmere Pickup: ${pickupRecords.length}`),
    {
      x: 40,
      y: summaryHeight - 180,
      size: 24,
      color: rgb(0, 0, 0),
      maxWidth: summaryWidth - 80,
    },
  );

  drawDeliverySection(
    pdfDoc,
    "main",
    mainRecords,
    `Total boxes for main:     ${mainRecords.length} boxes`,
  );
  drawDeliverySection(
    pdfDoc,
    "Woodmere Pickup",
    pickupRecords,
    `Total boxes for Woodmere Pickup:     ${pickupRecords.length} boxes`,
  );

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function generatePickupsOnlyPDF(
  records: SmartSuiteRecord[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const summaryPage = pdfDoc.addPage([612, 792]);
  const { height: summaryHeight, width: summaryWidth } = summaryPage.getSize();
  summaryPage.drawText(sanitizePdfText("Tomchei Shabbos - Pickups Only"), {
    x: 40,
    y: summaryHeight - 80,
    size: 24,
    color: rgb(0, 0, 0),
    maxWidth: summaryWidth - 80,
  });
  summaryPage.drawText(sanitizePdfText(`Total pickups: ${records.length}`), {
    x: 40,
    y: summaryHeight - 140,
    size: 36,
    color: rgb(0, 0, 0),
    maxWidth: summaryWidth - 80,
  });

  drawDeliverySection(
    pdfDoc,
    "Pickups Only",
    records,
    `Total boxes for Pickups Only:     ${records.length} boxes`,
  );

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function sanitizePdfText(text: string): string {
  // pdf-lib default fonts use WinAnsi (Latin-1); drop unsupported chars (emoji, Hebrew, etc.)
  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      result += char;
    }
  }
  return result;
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  if (!text) return [];

  const sanitized = sanitizePdfText(text);

  const estimatedCharsPerLine = Math.floor(maxWidth / (fontSize * 0.6));
  const lines: string[] = [];

  let currentLine = "";
  const words = sanitized.split(" ");

  words.forEach((word) => {
    if ((currentLine + " " + word).length > estimatedCharsPerLine) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + " " + word : word;
    }
  });

  if (currentLine) lines.push(currentLine);
  return lines;
}

// async function sendDeliveryListEmail(pdfBuffer: Buffer): Promise<void> {
//   const transporter = nodemailer.createTransport({
//     host: process.env.SMTP_HOST,
//     port: parseInt(process.env.SMTP_PORT || "587"),
//     secure: process.env.SMTP_SECURE === "true",
//     auth: {
//       user: process.env.SMTP_USER,
//       pass: process.env.SMTP_PASS,
//     },
//   });

//   const mailOptions = {
//     from: process.env.SMTP_FROM || process.env.SMTP_USER,
//     to: "mspitzer@tidystack.com",
//     subject: "Tomchei Shabbos - Delivery List",
//     text: "Please find the delivery list PDF attached.",
//     html: `
//       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//         <h2 style="color: #2563eb;">📦 Tomchei Shabbos - Delivery List</h2>
//         <p>Please find the delivery list PDF attached.</p>
//         <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
//         <p style="color: #6b7280; font-size: 12px;">
//           This is an automated message from the Delivery List system.
//         </p>
//       </div>
//     `,
//     attachments: [
//       {
//         filename: `delivery_list_${new Date().toISOString().split("T")[0]}.pdf`,
//         content: pdfBuffer,
//         contentType: "application/pdf",
//       },
//     ],
//   };

//   await transporter.sendMail(mailOptions);
// }

async function generateLabelsListPDF(
  records: SmartSuiteRecord[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  // Avery label sizing for A4 (2 across, 10 down)
  // Each label: 4 inches wide x 1 inch tall
  const labelWidth = 280; // points (slightly less for gaps)
  const labelHeight = 70; // points (slightly less for gaps)
  const gapX = 8; // horizontal gap between labels
  const gapY = 5; // vertical gap between labels
  const marginLeft = 8;
  const marginTop = 8;
  const labelsPerRow = 2;
  const labelsPerColumn = 10;

  const pageWidth = 595; // A4 width in points
  const pageHeight = 842; // A4 height in points

  // Exclude records with no box size text (empty labels)
  const labelRecords = records.filter((record) =>
    Boolean(coerceDisplayText(record[BOX_SIZE_FIELD_ID])),
  );

  // Sort records by item text to group same values together
  const sortedRecords = [...labelRecords].sort((a, b) => {
    const itemA = coerceDisplayText(a[BOX_SIZE_FIELD_ID]);
    const itemB = coerceDisplayText(b[BOX_SIZE_FIELD_ID]);
    return itemA.localeCompare(itemB);
  });

  const totalBoxes = sortedRecords.length;

  // Summary page with total box count
  const summaryPage = pdfDoc.addPage([pageWidth, pageHeight]);
  summaryPage.drawText(sanitizePdfText("Tomchei Shabbos - Box Labels"), {
    x: marginLeft,
    y: pageHeight - marginTop - 40,
    size: 24,
    color: rgb(0, 0, 0),
  });
  summaryPage.drawText(sanitizePdfText(`Total boxes: ${totalBoxes}`), {
    x: marginLeft,
    y: pageHeight - marginTop - 90,
    size: 36,
    color: rgb(0, 0, 0),
  });

  let labelIndex = 0;
  let page: ReturnType<PDFDocument["addPage"]> | null = null;

  for (const record of sortedRecords) {
    const rowIndex = Math.floor(labelIndex / labelsPerRow);

    if (page === null || rowIndex >= labelsPerColumn) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      labelIndex = 0;
    }

    const activePage = page;
    const recalculatedRowIndex = Math.floor(labelIndex / labelsPerRow);
    const recalculatedColIndex = labelIndex % labelsPerRow;

    const xPosition = marginLeft + recalculatedColIndex * (labelWidth + gapX);
    const yPosition =
      pageHeight -
      marginTop -
      (recalculatedRowIndex + 1) * (labelHeight + gapY);

    // Draw label border
    activePage.drawRectangle({
      x: xPosition,
      y: yPosition,
      width: labelWidth,
      height: labelHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });

    // Extract and draw item text - centered both horizontally and vertically
    const itemText = coerceDisplayText(record[BOX_SIZE_FIELD_ID]);
    const fontSize = 18;
    const lines = wrapText(itemText, labelWidth - 10, fontSize);

    const lineSpacing = fontSize + 2;
    const totalTextHeight = lines.length * lineSpacing - 2;
    const labelCenterY = yPosition + labelHeight / 2;
    const startY = labelCenterY + totalTextHeight / 2 - fontSize / 2;

    let textY = startY;

    lines.forEach((line) => {
      // For horizontal centering, we need to measure the text width
      // pdf-lib doesn't have built-in text measurement, so we estimate
      const estimatedLineWidth = line.length * (fontSize * 0.5);
      const centeredX = xPosition + (labelWidth - estimatedLineWidth) / 2;

      activePage.drawText(line, {
        x: centeredX,
        y: textY,
        size: fontSize,
        color: rgb(0, 0, 0),
        maxWidth: labelWidth - 10,
      });
      textY -= lineSpacing;
    });

    labelIndex++;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function uploadPdfToSmartSuite(
  pdfBuffer: Buffer,
  recordId: string,
  filename: string,
): Promise<void> {
  if (!SMARTSUITE_API_KEY || !SMARTSUITE_ACCOUNT_ID) {
    console.error("[DELIVERY LIST] Missing SmartSuite credentials");
    return;
  }

  try {
    const formData = new FormData();
    const pdfBytes = new Uint8Array(pdfBuffer);
    const fileBlob = new Blob([pdfBytes], {
      type: "application/pdf",
    });

    formData.append("files", fileBlob, filename);
    formData.append("filename", filename);

    const uploadResponse = await fetch(
      `https://app.smartsuite.com/api/v1/recordfiles/${SMARTSUITE_DELIVERY_TABLE_ID}/${recordId}/${SMARTSUITE_DELIVERY_LIST_FIELD_ID}/`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${SMARTSUITE_API_KEY}`,
          "ACCOUNT-ID": SMARTSUITE_ACCOUNT_ID,
        },
        body: formData,
      },
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(
        `[DELIVERY LIST] SmartSuite upload failed (${filename}): ${uploadResponse.status} ${errorText}`,
      );
      return;
    }

    console.log(`[DELIVERY LIST] ${filename} uploaded to SmartSuite successfully`);
  } catch (error) {
    console.error(
      `[DELIVERY LIST] Error uploading ${filename} to SmartSuite:`,
      error,
    );
  }
}

async function clearAndUploadPdfToSmartSuite(
  pdfBuffer: Buffer,
  recordId: string,
  filename: string,
): Promise<void> {
  if (!SMARTSUITE_API_KEY || !SMARTSUITE_ACCOUNT_ID) {
    console.error("[DELIVERY LIST] Missing SmartSuite credentials");
    return;
  }

  try {
    const clearResponse = await fetch(
      `https://app.smartsuite.com/api/v1/applications/${SMARTSUITE_DELIVERY_TABLE_ID}/records/${recordId}/`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Token ${SMARTSUITE_API_KEY}`,
          "ACCOUNT-ID": SMARTSUITE_ACCOUNT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [SMARTSUITE_DELIVERY_LIST_FIELD_ID]: null,
        }),
      },
    );

    if (!clearResponse.ok) {
      console.warn(
        `[DELIVERY LIST] Failed to clear existing file: ${clearResponse.status}`,
      );
    }

    await uploadPdfToSmartSuite(pdfBuffer, recordId, filename);
  } catch (error) {
    console.error("[DELIVERY LIST] Error uploading PDF to SmartSuite:", error);
  }
}
