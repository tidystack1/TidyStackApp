import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const TABLE_ID = "69949c5705d7cfcaa8d702be";
const FIELD_ID = "s5ddb94a65";
const ACCOUNT_ID = "s1fk12pg";

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

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const apiKey = process.env.LOWERWATT_SMARTSUITE_API_KEY;
    if (!apiKey) {
      return jsonWithCors(
        { error: "LOWERWATT_SMARTSUITE_API_KEY is not configured" },
        { status: 500 },
      );
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonWithCors(
        {
          error:
            'Content-Type must be multipart/form-data with "record_id" and a file field ("file", "pdf", or "document")',
        },
        { status: 400 },
      );
    }

    const form = await request.formData();
    const recordIdRaw =
      form.get("record_id") ?? form.get("recordId") ?? form.get("id");
    const recordId =
      typeof recordIdRaw === "string" ? recordIdRaw.trim() : "";

    if (!recordId) {
      return jsonWithCors(
        { error: 'Missing "record_id" (or "recordId") in form data' },
        { status: 400 },
      );
    }

    const file =
      (form.get("file") as File | null) ??
      (form.get("pdf") as File | null) ??
      (form.get("document") as File | null);

    if (!file || typeof file === "string") {
      return jsonWithCors(
        {
          error:
            'Multipart body must include a file field named "file", "pdf", or "document"',
        },
        { status: 400 },
      );
    }

    const filename = file.name || "document.pdf";
    const bytes = new Uint8Array(await file.arrayBuffer());

    const uploadForm = new FormData();
    uploadForm.append(
      "files",
      new Blob([bytes], { type: file.type || "application/pdf" }),
      filename,
    );
    uploadForm.append("filename", filename);

    const uploadResponse = await fetch(
      `https://app.smartsuite.com/api/v1/recordfiles/${TABLE_ID}/${recordId}/${FIELD_ID}/`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": ACCOUNT_ID,
        },
        body: uploadForm,
      },
    );

    const responseText = await uploadResponse.text();
    let responseBody: unknown = responseText;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      // keep raw text
    }

    if (!uploadResponse.ok) {
      return jsonWithCors(
        {
          error: "SmartSuite file upload failed",
          status: uploadResponse.status,
          details: responseBody,
        },
        { status: 502 },
      );
    }

    return jsonWithCors({
      success: true,
      recordId,
      filename,
      smartsuite: responseBody,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PDF attach failed";
    console.error("[attach-pdf-after-extraction]", error);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
