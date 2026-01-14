import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getStampliEmailForFacility } from "@/lib/facilityStampliEmails";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdfBase64, recordId, facility } = body;

    if (!pdfBase64) {
      return NextResponse.json(
        { error: "PDF data is required" },
        { status: 400 }
      );
    }

    console.log("[EMAIL TEST] Preparing to send email...");

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    const targetEmail = getStampliEmailForFacility(facility);

    // Send email
    await sendEmail(pdfBuffer, recordId || "test", {
      facility,
      targetEmail,
    });

    console.log("[EMAIL TEST] Email sent successfully");

    return NextResponse.json(
      {
        message: "Email sent successfully to mspitzer@tidystack.com",
        recordId,
        targetEmail,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[EMAIL TEST] Error sending email:", error);
    return NextResponse.json(
      {
        error: "Failed to send email",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

async function sendEmail(
  pdfBuffer: Buffer,
  recordId: string,
  details: {
    facility?: string | null;
    targetEmail?: string;
  }
) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const targetEmailNote = `In real this email address will go to '${
    details.targetEmail || "UNKNOWN"
  }'.`;

  const facilityLabel = details.facility?.trim() || "Unknown facility";

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: "mspitzer@tidystack.com",
    subject: `Test - Combined PDF Attachments - Record ${recordId}`,
    text: [
      `This is a test email with the combined PDF document from Zoho CRM record ${recordId}.`,
      `Facility: ${facilityLabel}.`,
      targetEmailNote,
    ].join(" "),
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">📄 Combined PDF Document</h2>
        <p>This is a test email with the combined PDF document from Zoho CRM.</p>
        <p><strong>Record ID:</strong> ${recordId}</p>
        <p><strong>Facility:</strong> ${facilityLabel}</p>
        <p><strong>Target email:</strong> ${
          details.targetEmail || "Unknown"
        }</p>
        <p><em>${targetEmailNote}</em></p>
        <p>Please find the combined PDF attached to this email.</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px;">
          This is an automated message from the PDF Attachment Combiner system.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `combined-${recordId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
  console.log(`[EMAIL TEST] Email sent successfully for record ${recordId}`);
}
