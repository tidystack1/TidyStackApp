import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";
import {
  BILL_EXTRACTION_PROMPT,
  parseJsonFromModel,
} from "../_shared/bill-extraction";

export const runtime = "nodejs";
export const maxDuration = 120;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const GEMINI_MODEL =
  process.env.GEMINI_BILL_EXTRACTION_MODEL ?? "gemini-3.6-flash";

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
    const apiKey = process.env.LOWERWATT_GEMINI_API_KEY;
    if (!apiKey) {
      return jsonWithCors(
        { error: "LOWERWATT_GEMINI_API_KEY is not configured" },
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

    const model = GEMINI_MODEL;
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          inlineData: {
            mimeType: "application/pdf",
            data: bytes.toString("base64"),
          },
        },
        { text: BILL_EXTRACTION_PROMPT },
      ],
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error("Gemini did not return any text content");
    }

    const extracted = parseJsonFromModel(text);

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
