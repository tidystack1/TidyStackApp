import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { PDFDocument } from "pdf-lib";

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

    console.log(`Processing record ID: ${recordId}`);

    // Step 1: Get the record details from Zoho CRM
    const recordDetails = await getZohoRecord(recordId);

    // Step 2: Extract file uploads from Expense Reimbursement subform
    const fileUploads = extractFileUploadsFromSubform(recordDetails);
    console.log(`Found ${fileUploads.length} file uploads in subform`);

    if (!fileUploads || fileUploads.length === 0) {
      return NextResponse.json(
        {
          message: "No file uploads found in Expense Reimbursement subform",
          recordId,
        },
        { status: 200 }
      );
    }

    // Step 3: Download PDF and image files from subform
    const { pdfBuffers, imageBuffers } = await downloadFileUploads(
      fileUploads,
      recordId
    );

    if (pdfBuffers.length === 0 && imageBuffers.length === 0) {
      return NextResponse.json(
        {
          message: "No PDF or image files found in subform uploads",
          recordId,
        },
        { status: 200 }
      );
    }

    // Step 4: Combine PDFs and images into one
    const combinedPdf = await combinePDFsAndImages(pdfBuffers, imageBuffers);

    // Step 5: Send email with combined PDF
    await sendEmail(combinedPdf, recordId);

    return NextResponse.json(
      {
        message: "Successfully processed and sent email",
        recordId,
        attachmentCount: fileUploads.length,
        pdfCount: pdfBuffers.length + imageBuffers.length,
        pdfFiles: pdfBuffers.length,
        imageFiles: imageBuffers.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
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

  // Assuming the module is Staff_Forms based on the screenshot
  // You can make this configurable via environment variable
  const module = process.env.ZOHO_MODULE || "Staff_Forms";

  const response = await fetch(
    `https://www.zohoapis.com/crm/v2/${module}/${recordId}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch record: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

function extractFileUploadsFromSubform(recordDetails: any) {
  try {
    // Get the first record from the data array
    const record = recordDetails.data?.[0];
    if (!record) {
      console.log("No record data found");
      return [];
    }

    // Get the Subform_1 (Expense Reimbursement) field
    const subformData = record.Subform_1;
    if (!subformData || !Array.isArray(subformData)) {
      console.log("No subform data found or it's not an array");
      return [];
    }

    console.log(
      `Found ${subformData.length} rows in Expense Reimbursement subform`
    );

    // Extract all file uploads from the subform rows11
    const fileUploads: any[] = [];
    subformData.forEach((row: any, index: number) => {
      const fileUpload = row.File_Upload_1;
      if (fileUpload) {
        console.log(`Row ${index + 1}: Found file upload`, fileUpload);
        fileUploads.push(fileUpload);
      } else {
        console.log(`Row ${index + 1}: No file upload found`);
      }
    });

    return fileUploads;
  } catch (error) {
    console.error("Error extracting file uploads from subform:", error);
    return [];
  }
}

async function downloadFileUploads(fileUploads: any[], recordId: string) {
  const accessToken = await getZohoAccessToken();
  const pdfBuffers: Buffer[] = [];
  const imageBuffers: Array<{
    buffer: Buffer;
    type: "jpeg" | "png";
    fileName: string;
  }> = [];

  for (let i = 0; i < fileUploads.length; i++) {
    const fileUpload = fileUploads[i];

    // File upload can be a single file object or an array of files
    const files = Array.isArray(fileUpload) ? fileUpload : [fileUpload];

    for (const file of files) {
      // File object structure in Zoho: { file_Id: "...", file_Name: "..." }
      const fileId = file.file_Id;
      const fileName = file.file_Name || `file_${i}`;
      const lowerFileName = fileName.toLowerCase();

      // Check if it's a PDF or supported image
      const isPdf = lowerFileName.endsWith(".pdf");
      const isJpeg =
        lowerFileName.endsWith(".jpg") || lowerFileName.endsWith(".jpeg");
      const isPng = lowerFileName.endsWith(".png");

      if (!isPdf && !isJpeg && !isPng) {
        console.log(`Skipping unsupported file: ${fileName}`);
        continue;
      }

      const fileType = isPdf ? "PDF" : isJpeg ? "JPEG" : "PNG";

      console.log(
        `Downloading ${fileType} from subform: ${fileName} (ID: ${fileId})`
      );

      try {
        // Download the file using the file_Id
        const response = await fetch(
          `https://content.zohoapis.com/crm/v2/files?id=${fileId}`,
          {
            headers: {
              Authorization: `Zoho-oauthtoken ${accessToken}`,
            },
          }
        );

        if (!response.ok) {
          console.error(
            `Failed to download file ${fileId}: ${response.statusText}`
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (isPdf) {
          pdfBuffers.push(buffer);
        } else if (isJpeg) {
          imageBuffers.push({ buffer, type: "jpeg", fileName });
        } else if (isPng) {
          imageBuffers.push({ buffer, type: "png", fileName });
        }

        console.log(`Successfully downloaded: ${fileName}`);
      } catch (error) {
        console.error(`Error downloading file ${fileName}:`, error);
        continue;
      }
    }
  }

  return { pdfBuffers, imageBuffers };
}

async function combinePDFsAndImages(
  pdfBuffers: Buffer[],
  imageBuffers: Array<{
    buffer: Buffer;
    type: "jpeg" | "png";
    fileName: string;
  }>
): Promise<Buffer> {
  const mergedPdf = await PDFDocument.create();

  // Add all PDF pages
  for (let i = 0; i < pdfBuffers.length; i++) {
    try {
      console.log(`Merging PDF ${i + 1}/${pdfBuffers.length}`);
      const pdf = await PDFDocument.load(pdfBuffers[i]);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
      console.log(`Added ${copiedPages.length} pages from PDF ${i + 1}`);
    } catch (error) {
      console.error(`Error merging PDF ${i + 1}:`, error);
      // Continue with other PDFs even if one fails
    }
  }

  // Convert images to PDF pages
  for (let i = 0; i < imageBuffers.length; i++) {
    try {
      const { buffer, type, fileName } = imageBuffers[i];
      console.log(`Converting image to PDF page: ${fileName}`);

      // Embed the image
      const image =
        type === "jpeg"
          ? await mergedPdf.embedJpg(buffer)
          : await mergedPdf.embedPng(buffer);

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

      console.log(
        `Added image page: ${fileName} (${Math.round(width)}x${Math.round(
          height
        )})`
      );
    } catch (error) {
      console.error(
        `Error converting image ${imageBuffers[i].fileName}:`,
        error
      );
      // Continue with other images even if one fails
    }
  }

  const mergedPdfBytes = await mergedPdf.save();
  console.log(`Final combined PDF size: ${mergedPdfBytes.length} bytes`);
  return Buffer.from(mergedPdfBytes);
}

async function sendEmail(pdfBuffer: Buffer, recordId: string) {
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
    subject: `Combined PDF Attachments - Record ${recordId}`,
    text: `Please find attached the combined PDF document from Zoho CRM record ${recordId}.`,
    html: `<p>Please find attached the combined PDF document from Zoho CRM record <strong>${recordId}</strong>.</p>`,
    attachments: [
      {
        filename: `combined-${recordId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
  console.log(`Email sent successfully for record ${recordId}`);
}

// Token management for Zoho OAuth
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getZohoAccessToken(): Promise<string> {
  // Check if we have a valid cached token
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  // Get new access token using refresh token
  const response = await fetch(
    `https://accounts.zoho.com/oauth/v2/token?` +
      `refresh_token=${process.env.ZOHO_REFRESH_TOKEN}&` +
      `client_id=${process.env.ZOHO_CLIENT_ID}&` +
      `client_secret=${process.env.ZOHO_CLIENT_SECRET}&` +
      `grant_type=refresh_token`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();

  // Cache the token (expires in 1 hour, we'll refresh 5 minutes early)
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return data.access_token;
}
