import { NextRequest, NextResponse } from "next/server";
import { parseFormPDFBody } from "../_shared/parse-form-body";
import {
  buildPDF,
  parseSafeFileName,
  str,
  type FormData,
} from "../_shared/pdf-builder";

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;
  const property = process.env.HIGHVIEWTRAVEL_HUBSPOT_DEAL_PDF_PROPERTY;

  if (!token)
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  if (!property)
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_DEAL_PDF_PROPERTY is not set in environment variables",
    );

  return { token, property };
}

// ─── HubSpot helpers ──────────────────────────────────────────────────────────

/**
 * Upload a PDF file to HubSpot's File Manager.
 * Returns the public URL of the uploaded file.
 */
async function uploadFileToHubSpot(
  pdfBytes: Uint8Array,
  fileName: string,
  token: string,
): Promise<{ id: string; url: string }> {
  const form = new FormData();

  form.append(
    "file",
    new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" }),
    fileName,
  );

  // PUBLIC_NOT_INDEXABLE: accessible via direct URL but not indexed by search engines
  form.append(
    "options",
    JSON.stringify({
      access: "PUBLIC_NOT_INDEXABLE",
      overwrite: false,
      duplicateValidationStrategy: "NONE",
    }),
  );

  form.append("folderPath", "/form-pdfs");
  form.append("fileName", fileName);

  const res = await fetch("https://api.hubapi.com/files/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot file upload failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id: string; url: string };
  return { id: json.id, url: json.url };
}

/**
 * Update a HubSpot deal property.
 */
async function updateDealProperty(
  dealId: string,
  property: string,
  value: string,
  token: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { [property]: value } }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal update failed (${res.status}): ${text}`);
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { token, property } = getConfig();

    const body = (await request.json()) as Record<string, unknown>;
    const data = parseFormPDFBody(body);

    if (!data) {
      return NextResponse.json(
        { error: "Could not parse `info` field as JSON" },
        { status: 400 },
      );
    }

    const dealId = str(data, "HubSpot Deal ID");
    if (!dealId) {
      return NextResponse.json(
        { error: "HubSpot Deal ID is missing from the form data" },
        { status: 400 },
      );
    }

    const dealName = str(data, "HubSpot Deal Name") || "booking";
    const fileName = `${parseSafeFileName(dealName)}_summary.pdf`;

    // 1. Generate the PDF
    console.log(
      `[submitFormPDF] Generating PDF for deal ${dealId} (${dealName})`,
    );
    const pdfBytes = await buildPDF(data);

    // 2. Upload to HubSpot File Manager
    console.log(`[submitFormPDF] Uploading ${fileName} to HubSpot Files`);
    const { url: fileUrl } = await uploadFileToHubSpot(
      pdfBytes,
      fileName,
      token,
    );
    console.log(`[submitFormPDF] Uploaded successfully: ${fileUrl}`);

    // 3. Update the deal property with the file URL
    console.log(
      `[submitFormPDF] Updating deal ${dealId} property "${property}"`,
    );
    await updateDealProperty(dealId, property, fileUrl, token);
    console.log(`[submitFormPDF] Deal updated successfully`);

    return NextResponse.json({
      success: true,
      dealId,
      dealName,
      fileUrl,
      property,
    });
  } catch (error) {
    console.error("[submitFormPDF] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to submit PDF to HubSpot",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
