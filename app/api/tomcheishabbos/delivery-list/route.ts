import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { PDFDocument, rgb } from "pdf-lib";

interface DeliveryListRequest {
  id: string;
  password: string;
}

interface SmartSuiteRecord {
  id: string;
  title: string;
  s019f88929?: unknown[][];
  s01b42a1e2?: unknown[][];
  sb4d52576b?: string;
  s611b4bf9c?: string;
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
        { error: "No delivery records found for this package" },
        { status: 404 },
      );
    }

    // Group records by route
    const groupedByRoute = groupRecordsByRoute(records.items);

    // Generate PDF
    const pdfBuffer = await generateDeliveryListPDF(groupedByRoute);

    // Send email
    await sendDeliveryListEmail(pdfBuffer);

    // Upload PDF to SmartSuite record
    await uploadDeliveryListPDFToSmartSuite(pdfBuffer, id);

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
  const apiKey = process.env.TOMCHEI_SHABBOS_SMARTSUITE_API_KEY;
  const accountId = process.env.TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID;

  const url =
    "https://app.smartsuite.com/api/v1/applications/6925af29a4002f833ea5a0e8/records/list/";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "ACCOUNT-ID": accountId || "",
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
    page.drawText(route, {
      x: margin,
      y: yPosition,
      size: 24,
      color: rgb(0, 0, 0),
      maxWidth: contentWidth,
    });

    yPosition -= 40;

    // Table headers
    const columnWidths = [
      contentWidth * 0.3,
      contentWidth * 0.35,
      contentWidth * 0.35,
    ];
    const rowHeight = 20;

    // Draw records
    for (const record of records) {
      const item = extractItemValue(record.s019f88929);
      const location = extractLocationValue(record.s01b42a1e2);
      const instructions = record.sb4d52576b || "";

      const itemLines = wrapText(item, columnWidths[0] - 10, 9);
      const locationLines = wrapText(location, columnWidths[1] - 10, 9);
      const instructionLines = wrapText(instructions, columnWidths[2] - 10, 9);

      const maxLines = Math.max(
        itemLines.length,
        locationLines.length,
        instructionLines.length,
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
      const columnTexts = [itemLines, locationLines, instructionLines];

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
    const totalText = `Total boxes for ${route}       ${records.length} boxes`;
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

async function uploadDeliveryListPDFToSmartSuite(
  pdfBuffer: Buffer,
  recordId: string,
): Promise<void> {
  const apiKey = process.env.TOMCHEI_SHABBOS_SMARTSUITE_API_KEY;
  const accountId = process.env.TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    console.error("[DELIVERY LIST] Missing SmartSuite credentials");
    return;
  }

  const tableId = "6925b0fb90de6fdfbd33e096";
  const fieldId = "sb1a7b32b6";

  try {
    // Clear the existing file field by setting it to null
    const clearResponse = await fetch(
      `https://app.smartsuite.com/api/v1/applications/${tableId}/records/${recordId}/`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": accountId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [fieldId]: null,
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
      `https://app.smartsuite.com/api/v1/recordfiles/${tableId}/${recordId}/${fieldId}/`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": accountId,
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
