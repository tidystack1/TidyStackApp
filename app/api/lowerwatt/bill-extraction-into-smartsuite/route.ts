import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonWithCors(
  body: unknown,
  init?: { status?: number },
): Response {
  return Response.json(body, {
    ...init,
    headers: CORS_HEADERS,
  });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

const EXTRACTION_PROMPT = `You are extracting utility invoice fields for LowerWatt / SmartSuite.

Read the attached PDF bill carefully (including tables and charge breakdowns).
Return ONLY a single JSON object with this exact shape:

{
  "mode": "new_account",
  "account": {
    "nameOnUtilityBill": string | null,
    "utility": string | null,
    "supplier": string | null,
    "accountNumber": string | null,
    "serviceAddress": string | null,
    "rateClass": string | null,
    "meterNumber": string | null,
    "meterSize": string | null,
    "netMeterSolar": "Yes" | "No" | "N/A" | null,
    "unitOfMeasurement": "CCF" | "Gallons" | "kWh" | "therms" | "N/A" | null,
    "payingSalesTax": "Yes" | "No" | null,
    "procurementAccountNumber": string | null,
    "phoneNumber": string | null,
    "typeOfService": string | null
  },
  "invoice": {
    "billingPeriodStart": string | null,
    "billingPeriodEnd": string | null,
    "usagePerBillingPeriod": number | null,
    "usageUnit": string | null,
    "deliveryCharges": number | null,
    "supplyCharges": number | null,
    "waterServiceCharge": number | null,
    "waterUsageCharge": number | null,
    "sewerServiceCharge": number | null,
    "sewerUsageCharge": number | null,
    "lineItemsOtherCharges": [{ "description": string, "amount": number }],
    "total": number | null
  },
  "notes": string[],
  "confidence": "high" | "medium" | "low"
}

Rules:
- Prefer values printed on the bill. Use null when a field is not present.
- Account #: required when visible; keep formatting as printed (spaces/dashes ok).
- Service address: street, city, state, zip when available. Do not use mailing address if a distinct service address exists.
- Supplier: null when the utility supplies the commodity itself.
- Rate class: e.g. GLP, General Service, GS-1, etc.
- Meter size / unit of measurement: mainly water; otherwise null or N/A as appropriate.
- Net meter / solar: Yes only if solar generation / net metering is evident; otherwise No or N/A.
- Paying sales tax: Yes only if a sales tax line/amount appears.
- Procurement account #: service agreement / PO / supplier agreement IDs (common on South Jersey Gas).
- Billing period: use stated billing/service period; for water, meter read start/end dates are fine.
- Usage: primary period usage number; set usageUnit (kWh, therms, CCF, etc.).
- Delivery vs supply (electric/gas):
  - Delivery = delivery / distribution / customer / demand / societal benefits when grouped under delivery.
  - Supply = BGSS / BGS / cost of energy / supply charges.
  - Gas fallback: if supply cannot be separated, put all commodity charges in deliveryCharges and note "supply included in delivery".
- Water:
  - Map ready-to-serve / water ready / service charge → waterServiceCharge
  - Map water usage → waterUsageCharge
  - Same pattern for sewer when present
  - Fallback: if service and usage are combined, put combined amount in waterServiceCharge and note "usage included".
- lineItemsOtherCharges: each non-core other charge (late fees, transfers labeled as charges, gov fees, etc.) with description + amount. Do not duplicate amounts already placed in delivery/supply/water/sewer totals unless they are separate add-ons.
- total: current bill total / amount due for this period's charges when clear.
- For multi-meter or summary bills, extract the primary account-level fields and the most recent billing period's charges; list extra meters in notes.
- mode: always "new_account" for now.
- confidence: high if key fields are clear; medium if some ambiguity; low if poor OCR/layout or conflicting totals.
- notes: short strings about fallbacks, multi-meter, missing city, credit balances, etc.

Currency amounts must be numbers (not strings). Dates preferably YYYY-MM-DD.`;

function parseJsonFromModel(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return valid JSON");
    return JSON.parse(match[0]);
  }
}

async function readPdfFromRequest(
  request: NextRequest,
): Promise<{ bytes: Buffer; filename: string }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file =
      (form.get("pdf") as File | null) ??
      (form.get("file") as File | null) ??
      (form.get("document") as File | null);

    if (!file || typeof file === "string") {
      throw new Error(
        'Multipart body must include a PDF file field named "pdf", "file", or "document"',
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    return { bytes, filename: file.name || "bill.pdf" };
  }

  const body = (await request.json()) as {
    pdfBase64?: string;
    pdf?: string;
    fileBase64?: string;
    filename?: string;
    fileName?: string;
  };

  const b64 = body.pdfBase64 ?? body.pdf ?? body.fileBase64;
  if (!b64 || typeof b64 !== "string") {
    throw new Error(
      'JSON body must include "pdfBase64" (or "pdf" / "fileBase64") with base64 PDF data',
    );
  }

  const cleaned = b64.replace(/^data:application\/pdf;base64,/, "");
  return {
    bytes: Buffer.from(cleaned, "base64"),
    filename: body.filename ?? body.fileName ?? "bill.pdf",
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return jsonWithCors(
        { error: "CLAUDE_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const { bytes, filename } = await readPdfFromRequest(request);

    if (bytes.length < 5 || bytes.subarray(0, 4).toString() !== "%PDF") {
      return jsonWithCors(
        { error: "Uploaded file does not look like a PDF" },
        { status: 400 },
      );
    }

    const client = new Anthropic({ apiKey });
    const model = "claude-opus-4-8";

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: bytes.toString("base64"),
              },
            },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );

    if (!textBlock) {
      return jsonWithCors(
        { error: "Claude did not return any text content", filename },
        { status: 502 },
      );
    }

    const extracted = parseJsonFromModel(textBlock.text);

    return jsonWithCors({
      success: true,
      filename,
      model,
      extracted,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Bill extraction failed";
    console.error("[bill-extraction-into-smartsuite]", error);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
