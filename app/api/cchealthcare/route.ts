import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { getStampliEmailForFacility } from "@/lib/facilityStampliEmails";

type ZohoRecordDetails = { data?: Array<Record<string, unknown>> };

type FormType =
  | "expense-reimbursement"
  | "petty-cash"
  | "mileage-reimbursement";

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
  value: string | undefined
): FormType | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "expense reimbursement") return "expense-reimbursement";
  if (normalized === "mileage reimbursement") return "mileage-reimbursement";
  if (normalized === "petty cash") return "petty-cash";
  return null;
}

function getRequestReimbursementType(
  body: Record<string, unknown>
): FormType | null {
  const raw =
    coerceString(body["Reimbursement type"]) ??
    coerceString(body.reimbursementType) ??
    coerceString(body.reimbursement_type);
  return normalizeReimbursementType(raw);
}

function extractRecordInfo(
  recordDetails: unknown,
  formType: FormType
): RecordInfo {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) return {};

    const isPettyCash = formType === "petty-cash";

    return {
      facility: coerceString(record["Facility"]) ?? undefined,
      employeeEmail: isPettyCash
        ? coerceString(record["Requested_by_Email"]) ?? undefined
        : coerceString(record["Employee_Email"]) ?? undefined,
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
        { status: 400 }
      );
    }

    const recordId = getRequestRecordId(body);
    if (!recordId) {
      return NextResponse.json(
        { error: "Record ID is required" },
        { status: 400 }
      );
    }

    const expectedPassword = process.env.CCHEALTHCARE_API_PASSWORD;
    if (!expectedPassword) {
      return NextResponse.json(
        { error: "Missing CCHEALTHCARE_API_PASSWORD" },
        { status: 500 }
      );
    }

    const password = getRequestPassword(body);
    if (password !== expectedPassword) {
      return NextResponse.json(
        { error: "incorrect password" },
        { status: 401 }
      );
    }

    const reimbursementType = getRequestReimbursementType(body);
    if (!reimbursementType) {
      return NextResponse.json(
        { error: "invalid Reimbursement type" },
        { status: 400 }
      );
    }

    console.log(
      `[CCHEALTHCARE] recordId=${recordId} formType=${reimbursementType}`
    );

    const recordDetails = await getZohoRecord(recordId);
    const recordInfo = extractRecordInfo(recordDetails, reimbursementType);
    const facilityEmail =
      getStampliEmailForFacility(recordInfo.facility) ??
      "unknown facility email";
    const requesterEmail =
      recordInfo.employeeEmail ?? "unknown requester email";

    const testPdfUrl = new URL("/api/test-pdf", request.nextUrl.origin);
    const pdfResponse = await fetch(testPdfUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: recordId, formType: reimbursementType }),
    });

    const pdfData = (await pdfResponse.json()) as {
      pdfBase64?: string;
      error?: string;
    };

    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: pdfData.error || "Failed to build PDF attachment" },
        { status: pdfResponse.status }
      );
    }

    if (!pdfData.pdfBase64) {
      return NextResponse.json(
        { error: "Missing PDF attachment" },
        { status: 500 }
      );
    }

    const pdfBuffer = Buffer.from(pdfData.pdfBase64, "base64");

    await sendSubmittedEmail({
      recordId,
      facilityEmail,
      reimbursementType,
      pdfBuffer,
    });

    await sendRequesterEmail({
      requesterEmail,
      reimbursementType,
    });

    return NextResponse.json(
      {
        message: "Successfully sent notifications",
        recordId,
        reimbursementType,
        facilityEmail,
        requesterEmail,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[CCHEALTHCARE] Error processing webhook:", error);
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

  const response = await fetch(
    `https://${apiDomain}/crm/v2/${zohoModule}/${recordId}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch record: ${response.status} ${errorText}`);
  }

  return response.json();
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

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: "mspitzer@tidystack.com",
    subject: `CCHealthcare ${humanizeFormType(reimbursementType)} submitted`,
    text: `a form was submitted, in real this would go to the stampli email address: ${facilityEmail}`,
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
}: {
  requesterEmail: string;
  reimbursementType: FormType;
}) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: "mspitzer+requester@tidystack.com",
    subject: `CCHealthcare ${humanizeFormType(reimbursementType)} received`,
    text: `your reimbursement request was submitted Successfully, in real this would go to ${requesterEmail}`,
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

// Token management for Zoho OAuth
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function getZohoAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const accountsDomain =
    process.env.ZOHO_ACCOUNTS_DOMAIN || "accounts.zoho.com";

  const response = await fetch(
    `https://${accountsDomain}/oauth/v2/token?` +
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

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return data.access_token;
}
