import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { getStampliEmailForFacility } from "@/lib/facilityStampliEmails";
import { buildReimbursementPdf, type FormType } from "./pdf";
import { createSmartSuiteRecord } from "./smartsuite";
import { getZohoRecord, type ZohoRecordDetails } from "./zoho";

type RecordInfo = {
  facility?: string;
  employeeEmail?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getRequestRecordId(body: Record<string, unknown>): string | undefined {
  return (
    coerceString(body.recordId) ??
    coerceString(body.recordID) ??
    coerceString(body.id)
  );
}

function getRequestPassword(body: Record<string, unknown>): string | undefined {
  return coerceString(body.password);
}

function normalizeReimbursementType(
  value: string | undefined,
): FormType | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "expense reimbursement") return "expense-reimbursement";
  if (normalized === "mileage reimbursement") return "mileage-reimbursement";
  if (normalized === "petty cash") return "petty-cash";
  return null;
}

function getRequestReimbursementType(
  body: Record<string, unknown>,
): FormType | null {
  const raw =
    coerceString(body["Reimbursement type"]) ??
    coerceString(body.reimbursementType) ??
    coerceString(body.reimbursement_type);
  return normalizeReimbursementType(raw);
}

function extractRecordInfo(
  recordDetails: unknown,
  formType: FormType,
): RecordInfo {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) return {};

    const isPettyCash = formType === "petty-cash";

    return {
      facility: coerceString(record["Facility"]) ?? undefined,
      employeeEmail: isPettyCash
        ? (coerceString(record["Requested_by_Email"]) ?? undefined)
        : (coerceString(record["Employee_Email"]) ?? undefined),
    };
  } catch (error) {
    console.error("[CCHEALTHCARE] Error extracting record info:", error);
    return {};
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 },
      );
    }

    const recordId = getRequestRecordId(body);
    if (!recordId) {
      return NextResponse.json(
        { error: "Record ID is required" },
        { status: 400 },
      );
    }

    const expectedPassword = process.env.CCHEALTHCARE_API_PASSWORD;
    if (!expectedPassword) {
      return NextResponse.json(
        { error: "Missing CCHEALTHCARE_API_PASSWORD" },
        { status: 500 },
      );
    }

    const password = getRequestPassword(body);
    if (password !== expectedPassword) {
      return NextResponse.json(
        { error: "incorrect password" },
        { status: 401 },
      );
    }

    const reimbursementType = getRequestReimbursementType(body);
    if (!reimbursementType) {
      return NextResponse.json(
        { error: "invalid Reimbursement type" },
        { status: 400 },
      );
    }

    const recordDetails = await getZohoRecord(recordId);
    const recordInfo = extractRecordInfo(recordDetails, reimbursementType);
    const facilityEmail =
      getStampliEmailForFacility(recordInfo.facility) ??
      "unknown facility email";
    const requesterEmail =
      recordInfo.employeeEmail ?? "unknown requester email";

    const pdfBuffer = await buildReimbursementPdf(
      recordDetails,
      reimbursementType,
    );
    const pdfFilename = `combined-${recordId}.pdf`;

    await sendSubmittedEmail({
      recordId,
      facilityEmail,
      reimbursementType,
      pdfBuffer,
    });

    await sendRequesterEmail({
      requesterEmail,
      reimbursementType,
      recordDetails,
    });

    const smartSuiteRecord = await createSmartSuiteRecord(
      recordDetails,
      reimbursementType,
      {
        filename: pdfFilename,
        contentType: "application/pdf",
        data: pdfBuffer,
      },
    );

    return NextResponse.json(
      {
        message: "Successfully sent notifications",
        recordId,
        reimbursementType,
        facilityEmail,
        requesterEmail,
        smartSuiteRecordId: smartSuiteRecord?.id,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[CCHEALTHCARE] Error processing webhook:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

async function sendSubmittedEmail({
  recordId,
  facilityEmail,
  reimbursementType,
  pdfBuffer,
}: {
  recordId: string;
  facilityEmail: string;
  reimbursementType: FormType;
  pdfBuffer: Buffer;
}) {
  const transporter = createTransporter();
  // in testing mode it will be sent to mspitzer@tidystack.com otherwise facilityEmail
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: facilityEmail,
    subject: `CCHealthcare ${humanizeFormType(reimbursementType)} submitted`,
    text: `A form was submitted`,
    attachments: [
      {
        filename: `combined-${recordId}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}

async function sendRequesterEmail({
  requesterEmail,
  reimbursementType,
  recordDetails,
}: {
  requesterEmail: string;
  reimbursementType: FormType;
  recordDetails: unknown;
}) {
  const transporter = createTransporter();

  const details = recordDetails as ZohoRecordDetails;
  const record = details.data?.[0] || {};

  const formTypeName = humanizeFormType(reimbursementType);
  const submissionDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #f0f0f0; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
          .header h1 { margin: 0; color: #2c3e50; font-size: 24px; }
          .details { background-color: #fafafa; padding: 15px; border-left: 4px solid #3498db; margin: 15px 0; }
          .detail-row { margin: 10px 0; }
          .detail-label { font-weight: bold; color: #2c3e50; display: inline-block; width: 150px; }
          .detail-value { color: #555; }
          .footer { font-size: 12px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✓ Submission Received</h1>
            <p style="margin: 10px 0 0 0; color: #666;">Your ${formTypeName} has been successfully submitted</p>
          </div>
          
          <p>Hi,</p>
          <p>Thank you for submitting your ${formTypeName}. We've received your submission and will process it shortly.</p>
          
          <div class="details">
            <div class="detail-row">
              <span class="detail-label">Form Type:</span>
              <span class="detail-value">${formTypeName}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Submission Date:</span>
              <span class="detail-value">${submissionDate}</span>
            </div>
            ${
              record["Facility"]
                ? `
            <div class="detail-row">
              <span class="detail-label">Facility:</span>
              <span class="detail-value">${coerceString(record["Facility"]) || "N/A"}</span>
            </div>
            `
                : ""
            }
            ${
              record["Amount"]
                ? `
            <div class="detail-row">
              <span class="detail-label">Amount:</span>
              <span class="detail-value">$${record["Amount"]}</span>
            </div>
            `
                : ""
            }
            ${
              record["Description"]
                ? `
            <div class="detail-row">
              <span class="detail-label">Description:</span>
              <span class="detail-value">${coerceString(record["Description"]) || "N/A"}</span>
            </div>
            `
                : ""
            }
          </div>
          
          <p>You can expect to receive updates about your submission as it progresses through our approval process.</p>
          
          <p>If you have any questions, please don't hesitate to reach out.</p>
          
          <p>Best regards,<br>CCHealthcare Reimbursement Team</p>
          
        
        </div>
      </body>
    </html>
  `;

  // in testing mode it will be sent to mspitzer@tidystack.com otherwise requesterEmail
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: requesterEmail,
    subject: `CCHealthcare ${formTypeName} - Submission Received`,
    html,
    text: `Your ${formTypeName} submission to CCHealthcare was successfully received on ${submissionDate}.`,
  });
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function humanizeFormType(formType: FormType) {
  switch (formType) {
    case "expense-reimbursement":
      return "Expense Reimbursement";
    case "mileage-reimbursement":
      return "Mileage Reimbursement";
    case "petty-cash":
      return "Petty Cash";
  }
}
