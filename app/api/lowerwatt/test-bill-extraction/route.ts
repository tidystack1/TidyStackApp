import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { NextRequest } from "next/server";
import {
  BILL_EXTRACTION_INPUT_SCHEMA,
  BILL_EXTRACTION_PROMPT,
  BILL_EXTRACTION_TOOL_NAME,
  extractBillFromClaudeContent,
  parseJsonFromModel,
} from "../_shared/bill-extraction";

export const runtime = "nodejs";
/** Local-only comparison route; intentionally generous. */
export const maxDuration = 300;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const OPENAI_API_KEY = process.env.LOWERWATT_OPENAI_API_KEY;
const CLAUDE_API_KEY = process.env.LOWERWATT_CLAUDE_API_KEY;
const GEMINI_API_KEY = process.env.LOWERWATT_GEMINI_API_KEY;

const OPENAI_MODEL = process.env.OPENAI_BILL_EXTRACTION_MODEL ?? "gpt-4o";
const CLAUDE_MODEL =
  process.env.CLAUDE_BILL_EXTRACTION_MODEL ?? "claude-sonnet-5";
const GEMINI_MODEL =
  process.env.GEMINI_BILL_EXTRACTION_MODEL ?? "gemini-3.6-flash";

type ProviderName = "openai" | "claude" | "gemini";

type ProviderResult = {
  provider: ProviderName;
  model: string;
  success: boolean;
  durationMs: number;
  extracted?: unknown;
  error?: string;
};

function jsonWithCors(body: unknown, init?: { status?: number }): Response {
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

function normalizeComparable(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function flattenFields(
  value: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = value;
    return out;
  }

  if (Array.isArray(value)) {
    out[prefix] = value;
    return out;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) {
      out[prefix] = value;
      return out;
    }
    for (const [key, nested] of entries) {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenFields(nested, path, out);
    }
    return out;
  }

  if (prefix) out[prefix] = value;
  return out;
}

function buildDifferenceSummary(results: ProviderResult[]) {
  const successful = results.filter((r) => r.success && r.extracted != null);
  const byProvider: Partial<Record<ProviderName, Record<string, unknown>>> = {};

  for (const result of successful) {
    byProvider[result.provider] = flattenFields(result.extracted);
  }

  const allPaths = new Set<string>();
  for (const fields of Object.values(byProvider)) {
    if (!fields) continue;
    for (const path of Object.keys(fields)) allPaths.add(path);
  }

  const fieldsDiffering: Array<{
    path: string;
    values: Partial<Record<ProviderName, unknown>>;
  }> = [];
  let identicalFieldCount = 0;

  const sortedPaths = [...allPaths].sort();
  for (const path of sortedPaths) {
    const values: Partial<Record<ProviderName, unknown>> = {};
    const normalized: string[] = [];

    for (const provider of ["openai", "claude", "gemini"] as ProviderName[]) {
      if (!(provider in byProvider)) continue;
      const raw = byProvider[provider]?.[path] ?? null;
      values[provider] = raw;
      normalized.push(normalizeComparable(raw));
    }

    const unique = new Set(normalized);
    if (unique.size <= 1) {
      identicalFieldCount += 1;
    } else {
      fieldsDiffering.push({ path, values });
    }
  }

  const providersCompared = successful.map((r) => r.provider);
  const failedProviders = results
    .filter((r) => !r.success)
    .map((r) => ({ provider: r.provider, error: r.error ?? "Unknown error" }));

  return {
    providersCompared,
    failedProviders,
    identicalFieldCount,
    differingFieldCount: fieldsDiffering.length,
    summary:
      providersCompared.length < 2
        ? `Only ${providersCompared.length} successful extraction(s); need at least 2 to compare fields.`
        : `${fieldsDiffering.length} of ${sortedPaths.length} fields differed across ${providersCompared.join(", ")}.`,
    fieldsDiffering,
  };
}

async function extractWithOpenAI(
  bytes: Buffer,
  filename: string,
): Promise<ProviderResult> {
  const started = Date.now();
  const model = OPENAI_MODEL;
  const apiKey = OPENAI_API_KEY;

  if (!apiKey) {
    return {
      provider: "openai",
      model,
      success: false,
      durationMs: Date.now() - started,
      error: "OPENAI_API_KEY is not configured",
    };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_file",
                filename,
                file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
              },
              { type: "input_text", text: BILL_EXTRACTION_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `OpenAI request failed (${res.status}): ${text.slice(0, 800)}`,
      );
    }

    const json = (await res.json()) as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    };

    let text = json.output_text?.trim() ?? "";
    if (!text && Array.isArray(json.output)) {
      for (const item of json.output) {
        if (!item.content) continue;
        for (const part of item.content) {
          if (part.type === "output_text" && part.text) {
            text += part.text;
          }
        }
      }
      text = text.trim();
    }

    if (!text) {
      throw new Error("OpenAI did not return any text content");
    }

    return {
      provider: "openai",
      model,
      success: true,
      durationMs: Date.now() - started,
      extracted: parseJsonFromModel(text),
    };
  } catch (error) {
    return {
      provider: "openai",
      model,
      success: false,
      durationMs: Date.now() - started,
      error:
        error instanceof Error ? error.message : "OpenAI extraction failed",
    };
  }
}

async function extractWithClaude(bytes: Buffer): Promise<ProviderResult> {
  const started = Date.now();
  const model = CLAUDE_MODEL;
  const apiKey = CLAUDE_API_KEY;

  if (!apiKey) {
    return {
      provider: "claude",
      model,
      success: false,
      durationMs: Date.now() - started,
      error: "CLAUDE_API_KEY is not configured",
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      tools: [
        {
          name: BILL_EXTRACTION_TOOL_NAME,
          description:
            "Extract structured utility invoice fields from the attached bill PDF.",
          input_schema: BILL_EXTRACTION_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: BILL_EXTRACTION_TOOL_NAME },
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
            { type: "text", text: BILL_EXTRACTION_PROMPT },
          ],
        },
      ],
    });

    return {
      provider: "claude",
      model,
      success: true,
      durationMs: Date.now() - started,
      extracted: extractBillFromClaudeContent(response.content),
    };
  } catch (error) {
    return {
      provider: "claude",
      model,
      success: false,
      durationMs: Date.now() - started,
      error:
        error instanceof Error ? error.message : "Claude extraction failed",
    };
  }
}

async function extractWithGemini(bytes: Buffer): Promise<ProviderResult> {
  const started = Date.now();
  const model = GEMINI_MODEL;
  const apiKey = GEMINI_API_KEY;

  if (!apiKey) {
    return {
      provider: "gemini",
      model,
      success: false,
      durationMs: Date.now() - started,
      error: "GEMINI_API_KEY is not configured",
    };
  }

  try {
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

    return {
      provider: "gemini",
      model,
      success: true,
      durationMs: Date.now() - started,
      extracted: parseJsonFromModel(text),
    };
  } catch (error) {
    return {
      provider: "gemini",
      model,
      success: false,
      durationMs: Date.now() - started,
      error:
        error instanceof Error ? error.message : "Gemini extraction failed",
    };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { bytes, filename } = await readPdfFromRequest(request);

    if (bytes.length < 5 || bytes.subarray(0, 4).toString() !== "%PDF") {
      return jsonWithCors(
        { error: "Uploaded file does not look like a PDF" },
        { status: 400 },
      );
    }

    // Sequential on purpose so each provider's result is independent and easy to compare.
    const openai = await extractWithOpenAI(bytes, filename);
    const claude = await extractWithClaude(bytes);
    const gemini = await extractWithGemini(bytes);

    const results = [openai, claude, gemini];
    const differences = buildDifferenceSummary(results);

    return jsonWithCors({
      success: true,
      filename,
      openai: {
        model: openai.model,
        success: openai.success,
        durationMs: openai.durationMs,
        extracted: openai.extracted ?? null,
        error: openai.error ?? null,
      },
      claude: {
        model: claude.model,
        success: claude.success,
        durationMs: claude.durationMs,
        extracted: claude.extracted ?? null,
        error: claude.error ?? null,
      },
      gemini: {
        model: gemini.model,
        success: gemini.success,
        durationMs: gemini.durationMs,
        extracted: gemini.extracted ?? null,
        error: gemini.error ?? null,
      },
      differences,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Test bill extraction failed";
    console.error("[test-bill-extraction]", error);
    return jsonWithCors({ error: message }, { status: 400 });
  }
}
