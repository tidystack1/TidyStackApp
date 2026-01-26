import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { PDFDocument, rgb } from "pdf-lib";

// SmartSuite Configuration
const SMARTSUITE_API_KEY = process.env.TOMCHEI_SHABBOS_SMARTSUITE_API_KEY;
const SMARTSUITE_ACCOUNT_ID = process.env.TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID;
const SMARTSUITE_RECORDS_TABLE_ID = "6925af29a4002f833ea5a0e8";
const SMARTSUITE_DELIVERY_TABLE_ID = "6925b0fb90de6fdfbd33e096";
const SMARTSUITE_DELIVERY_LIST_FIELD_ID = "sb1a7b32b6";
const SMARTSUITE_LABELS_FIELD_ID = "s3b0b4fbc0";

interface DeliveryListRequest {
  id: string;
  password: string;
}

interface SmartSuiteRecord {
  id: string;
  title: string;
  s019f88929?: unknown[][];
  s01b42a1e2?: unknown[][];
  s3eaec935f?: unknown[][];
  sb4d52576b?: string;
  s611b4bf9c?: string;
  s64a81a706?: unknown[][];
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

    // Group records by route
    const groupedByRoute = groupRecordsByRoute(records.items);

    // Generate PDF
    const pdfBuffer = await generateDeliveryListPDF(groupedByRoute);

    // Send email
    // await sendDeliveryListEmail(pdfBuffer);

    // Upload PDF to SmartSuite record
    await uploadDeliveryListPDFToSmartSuite(pdfBuffer, id);

    // Generate and upload labels PDF
    const labelsPdfBuffer = await generateLabelsListPDF(records.items);
    await uploadLabelsPDFToSmartSuite(labelsPdfBuffer, id);

    return NextResponse.json(
      {
        message: "Delivery list PDF generated and sent successfully",
        recordCount: records.items.length,
        routeCount: Object.keys(groupedByRoute).length,
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
  const url =
    "https://app.smartsuite.com/api/v1/applications/6925af29a4002f833ea5a0e8/records/list/";

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
            field: "sd5bd00296",
            comparison: "contains",
            value: packageId,
          },
          {
            field: "sf44659fe6",
            comparison: "is",
            value: "0Nnwo",
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

function groupRecordsByRoute(records: SmartSuiteRecord[]): GroupedRecords {
  const grouped: GroupedRecords = {};

  records.forEach((record) => {
    const route = record.s611b4bf9c || "Unassigned Route";
    if (!grouped[route]) {
      grouped[route] = [];
    }
    grouped[route].push(record);
  });

  return grouped;
}

async function generateDeliveryListPDF(
  groupedRecords: GroupedRecords,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  const routes = Object.keys(groupedRecords).sort();

  for (const route of routes) {
    const records = groupedRecords[route];
    const page = pdfDoc.addPage([612, 792]); // Standard letter size
    const { height, width } = page.getSize();

    const margin = 40;
    const contentWidth = width - 2 * margin;
    let yPosition = height - margin;

    // Title
    page.drawText(`Route ${route}`, {
      x: margin,
      y: yPosition,
      size: 24,
      color: rgb(0, 0, 0),
      maxWidth: contentWidth,
    });

    yPosition -= 40;

    // Table headers
    const columnWidths = [
      contentWidth * 0.28,
      contentWidth * 0.3,
      contentWidth * 0.32,
      contentWidth * 0.1,
    ];
    const rowHeight = 20;

    // Draw records
    for (const record of records) {
      const item = extractItemValue(record.s019f88929);
      const location = extractLocationValue(record.s01b42a1e2);
      const instructions = extractInstructionsValue(record.s3eaec935f);
      const customerId = extractCustomerIdsValue(record.s64a81a706);

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

      // Check if we need a new page
      if (yPosition - currentRowHeight < margin) {
        const newPage = pdfDoc.addPage([612, 792]);
        const { height: newHeight } = newPage.getSize();
        yPosition = newHeight - margin;
      }

      // Draw row border/background
      page.drawRectangle({
        x: margin,
        y: yPosition - currentRowHeight,
        width: contentWidth,
        height: currentRowHeight,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 1,
      });

      // Draw column dividers and text
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

        // Draw vertical dividers (except after last column)
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

    // Add total boxes text at the bottom
    const totalText = `Total boxes for Route ${route}:     ${records.length} boxes`;
    page.drawText(totalText, {
      x: margin,
      y: Math.max(yPosition - 30, margin),
      size: 16,
      color: rgb(0, 0, 0),
      maxWidth: contentWidth,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function extractItemValue(itemArray?: unknown[][]): string {
  if (!itemArray || !Array.isArray(itemArray) || itemArray.length === 0) {
    return "";
  }

  const labels: string[] = [];

  for (const item of itemArray) {
    if (Array.isArray(item)) {
      for (const element of item) {
        if (element && typeof element === "object" && "label" in element) {
          const label = (element as { label?: unknown }).label;
          if (typeof label === "string") {
            labels.push(label);
          } else if (label !== undefined) {
            labels.push(String(label));
          }
        }
      }
    }
  }

  return labels.join(", ");
}

function extractLocationValue(locationArray?: unknown[][]): string {
  if (
    !locationArray ||
    !Array.isArray(locationArray) ||
    locationArray.length === 0
  ) {
    return "";
  }
  const firstLocation = locationArray[0];
  if (
    Array.isArray(firstLocation) &&
    firstLocation.length > 0 &&
    firstLocation[0]
  ) {
    const loc = firstLocation[0];
    if (loc && typeof loc === "object" && "sys_root" in loc) {
      const sysRoot = (loc as { sys_root?: unknown }).sys_root;
      if (typeof sysRoot === "string") {
        return sysRoot;
      }
      if (sysRoot !== undefined) {
        return String(sysRoot);
      }
    }
  }
  return "";
}

function extractInstructionsValue(instructionsArray?: unknown[][]): string {
  if (
    !instructionsArray ||
    !Array.isArray(instructionsArray) ||
    instructionsArray.length === 0
  ) {
    return "";
  }
  const firstInstructions = instructionsArray[0];
  if (Array.isArray(firstInstructions) && firstInstructions.length > 0) {
    const instruction = firstInstructions[0];
    if (instruction === null || instruction === undefined) {
      return "";
    }
    if (typeof instruction === "string") {
      return instruction;
    }
    return String(instruction);
  }
  return "";
}

function extractCustomerIdsValue(customerIdsArray?: unknown[][]): string {
  if (
    !customerIdsArray ||
    !Array.isArray(customerIdsArray) ||
    customerIdsArray.length === 0
  ) {
    return "";
  }

  const values: string[] = [];

  for (const item of customerIdsArray) {
    if (Array.isArray(item)) {
      for (const element of item) {
        if (element !== null && element !== undefined) {
          if (typeof element === "string") {
            values.push(element);
          } else if (typeof element === "number") {
            values.push(String(element));
          } else if (typeof element === "object" && "label" in element) {
            const label = (element as { label?: unknown }).label;
            if (typeof label === "string") {
              values.push(label);
            } else if (label !== undefined) {
              values.push(String(label));
            }
          } else {
            values.push(String(element));
          }
        }
      }
    }
  }

  return values.join(", ");
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  if (!text) return [];

  const estimatedCharsPerLine = Math.floor(maxWidth / (fontSize * 0.6));
  const lines: string[] = [];

  let currentLine = "";
  const words = text.split(" ");

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

async function sendDeliveryListEmail(pdfBuffer: Buffer): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: "mspitzer@tidystack.com",
    subject: "Tomchei Shabbos - Delivery List",
    text: "Please find the delivery list PDF attached.",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">📦 Tomchei Shabbos - Delivery List</h2>
        <p>Please find the delivery list PDF attached.</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px;">
          This is an automated message from the Delivery List system.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `delivery_list_${new Date().toISOString().split("T")[0]}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
}

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

  let labelIndex = 0;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);

  for (const record of records) {
    // Calculate position on page
    const rowIndex = Math.floor(labelIndex / labelsPerRow);
    const colIndex = labelIndex % labelsPerRow;

    // If we've filled the page, create a new one
    if (rowIndex >= labelsPerColumn) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      labelIndex = 0;
    }

    const recalculatedRowIndex = Math.floor(labelIndex / labelsPerRow);
    const recalculatedColIndex = labelIndex % labelsPerRow;

    const xPosition = marginLeft + recalculatedColIndex * (labelWidth + gapX);
    const yPosition =
      pageHeight -
      marginTop -
      (recalculatedRowIndex + 1) * (labelHeight + gapY);

    // Draw label border
    page.drawRectangle({
      x: xPosition,
      y: yPosition,
      width: labelWidth,
      height: labelHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 0.5,
    });

    // Extract and draw item text - centered both horizontally and vertically
    const itemText = extractItemValue(record.s019f88929);
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

      page.drawText(line, {
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

async function uploadLabelsPDFToSmartSuite(
  pdfBuffer: Buffer,
  recordId: string,
): Promise<void> {
  if (!SMARTSUITE_API_KEY || !SMARTSUITE_ACCOUNT_ID) {
    console.error("[DELIVERY LIST] Missing SmartSuite credentials");
    return;
  }

  try {
    // Upload the labels PDF to the same field as delivery list (don't clear to keep both files)
    const formData = new FormData();
    const pdfBytes = new Uint8Array(pdfBuffer);
    const fileBlob = new Blob([pdfBytes], {
      type: "application/pdf",
    });
    const filename = `labels_${new Date().toISOString().split("T")[0]}.pdf`;

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
        `[DELIVERY LIST] Labels upload failed: ${uploadResponse.status} ${errorText}`,
      );
      return;
    }

    console.log(
      "[DELIVERY LIST] Labels PDF uploaded to SmartSuite successfully",
    );
  } catch (error) {
    console.error(
      "[DELIVERY LIST] Error uploading labels PDF to SmartSuite:",
      error,
    );
  }
}

async function uploadDeliveryListPDFToSmartSuite(
  pdfBuffer: Buffer,
  recordId: string,
): Promise<void> {
  if (!SMARTSUITE_API_KEY || !SMARTSUITE_ACCOUNT_ID) {
    console.error("[DELIVERY LIST] Missing SmartSuite credentials");
    return;
  }

  try {
    // Clear the existing file field by setting it to null
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

    // Now upload the new file
    const formData = new FormData();
    const pdfBytes = new Uint8Array(pdfBuffer);
    const fileBlob = new Blob([pdfBytes], {
      type: "application/pdf",
    });
    const filename = `delivery_list_${new Date().toISOString().split("T")[0]}.pdf`;

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
        `[DELIVERY LIST] SmartSuite upload failed: ${uploadResponse.status} ${errorText}`,
      );
      return;
    }

    console.log("[DELIVERY LIST] PDF uploaded to SmartSuite successfully");
  } catch (error) {
    console.error("[DELIVERY LIST] Error uploading PDF to SmartSuite:", error);
  }
}
