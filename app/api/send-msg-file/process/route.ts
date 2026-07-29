import { del, issueSignedToken, presignUrl } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import {
  CATEGORY_HUBSPOT_DEAL,
  isRegisteredCategory,
  REGISTERED_CATEGORIES,
} from "../_shared/categories";
import {
  pluginUnauthorizedResponse,
  verifyPluginSharedSecret,
} from "../_shared/verify-plugin-shared-secret";

const EMAIL_TO_DEAL_MSG_PATH = "/api/highviewtravel/email-to-deal/msg";
const READ_URL_TTL_MS = 10 * 60 * 1000;

/** OLE/CFBF compound files (including .msg) start with this signature. */
function looksLikeMsgBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  );
}

function requireCategory(category: unknown): string {
  if (typeof category !== "string" || !category.trim()) {
    throw new Error(
      `Missing category. Provide JSON with category set to one of: ${REGISTERED_CATEGORIES.join(", ")}.`,
    );
  }
  return category.trim();
}

function jsonResponse(
  payload: unknown,
  registeredCategory: boolean,
  status: number,
): NextResponse {
  const base =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : { data: payload };

  return NextResponse.json({ ...base, registeredCategory }, { status });
}

function requirePathname(pathname: unknown): string {
  if (typeof pathname !== "string" || !pathname.trim()) {
    throw new Error(
      "Missing pathname. Upload the .msg via /api/send-msg-file/get-upload-url first, then send pathname in JSON.",
    );
  }
  const normalized = pathname.trim();
  if (
    !normalized.startsWith("msg/") ||
    normalized.includes("..") ||
    !normalized.endsWith(".msg")
  ) {
    throw new Error("Invalid pathname.");
  }
  return normalized;
}

async function createMsgReadUrl(pathname: string): Promise<string> {
  const validUntil = Date.now() + READ_URL_TTL_MS;

  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });

  const { presignedUrl } = await presignUrl(token, {
    operation: "get",
    pathname,
    access: "private",
  });

  return presignedUrl;
}

/** Confirms the blob exists and looks like a .msg without buffering the whole file. */
async function assertMsgBlobReady(
  pathname: string,
  readUrl: string,
): Promise<void> {
  const res = await fetch(readUrl, {
    headers: { Range: "bytes=0-7" },
  });
  if (res.status === 404) {
    throw new BlobMsgNotFoundError(pathname);
  }
  if (!res.ok && res.status !== 206) {
    const text = await res.text();
    throw new Error(
      `Failed to read .msg from blob storage (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const header = await readFirstBytes(res, 8);
  if (!looksLikeMsgBuffer(header)) {
    throw new Error(
      "Downloaded file does not look like a .msg file (missing OLE signature).",
    );
  }
}

async function readFirstBytes(res: Response, n: number): Promise<Buffer> {
  if (!res.body) {
    return Buffer.from(await res.arrayBuffer()).subarray(0, n);
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < n) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, n);
}

class BlobMsgNotFoundError extends Error {
  readonly pathname: string;

  constructor(pathname: string) {
    super(
      `No .msg file found at pathname "${pathname}". Complete the Blob PUT upload before calling this endpoint.`,
    );
    this.name = "BlobMsgNotFoundError";
    this.pathname = pathname;
  }
}

function filenameFromPathname(pathname: string): string {
  const base = pathname.split("/").pop() ?? "email.msg";
  return base.endsWith(".msg") ? base : `${base}.msg`;
}

function optionalTriggeredBy(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

// TEMP logging only — remove this webhook (and logSupportedCategoryRequest) before going live.
const LOGGING_WEBHOOK_URL =
  "https://tidystack.app.n8n.cloud/webhook/80c63112-4736-4122-b5c6-17396f23bdad";

/** TEMP logging only — remove before going live. */
async function logSupportedCategoryRequest(data: {
  category: string;
  filename: string;
  triggeredBy?: string;
}): Promise<void> {
  try {
    await fetch(LOGGING_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (error) {
    console.error("[send-msg-file/process] Logging webhook failed:", error);
  }
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.info(`[send-msg-file/process] ${label}: ${Date.now() - start}ms`);
  }
}

/**
 * Forward a Blob read URL (not the file bytes) so large .msg files stay under
 * Vercel's ~4.5MB serverless request body limit. Downstream routes download.
 */
async function forwardToEmailToDealMsg(
  request: NextRequest,
  msgUrl: string,
): Promise<{ payload: unknown; status: number }> {
  const targetUrl = new URL(EMAIL_TO_DEAL_MSG_PATH, request.url);
  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgUrl }),
  });

  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = { details: text };
  }

  return { payload, status: upstream.status };
}

async function deleteUploadedMsgBlob(pathname: string): Promise<void> {
  try {
    await del(pathname);
    console.info(
      `[send-msg-file/process] Deleted .msg blob at pathname "${pathname}"`,
    );
  } catch (error) {
    console.error(
      `[send-msg-file/process] Failed to delete .msg blob at pathname "${pathname}":`,
      error,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON body");
    }

    if (!verifyPluginSharedSecret(body.secret)) {
      return pluginUnauthorizedResponse();
    }

    const pathname = requirePathname(body.pathname);
    if (typeof body.messageId === "string" && body.messageId.trim()) {
      const id = body.messageId.trim();
      const expected = `msg/${id}.msg`;
      if (pathname !== expected) {
        throw new Error(
          `pathname "${pathname}" does not match messageId (expected "${expected}").`,
        );
      }
    }
    const category = requireCategory(body.category);
    const triggeredBy = optionalTriggeredBy(body.triggeredBy);
    const registeredCategory = isRegisteredCategory(category);

    if (!registeredCategory) {
      await deleteUploadedMsgBlob(pathname);
      return NextResponse.json(
        {
          message: "This category is not registered.",
          registeredCategory: false,
        },
        { status: 200 },
      );
    }

    const requestStart = Date.now();
    const msgUrl = await timed("createMsgReadUrl", () =>
      createMsgReadUrl(pathname),
    );
    await timed("assertMsgBlobReady", () =>
      assertMsgBlobReady(pathname, msgUrl),
    );
    const filename = filenameFromPathname(pathname);

    if (category === CATEGORY_HUBSPOT_DEAL) {
      // TEMP logging only — remove before going live.
      await timed("logSupportedCategoryRequest", () =>
        logSupportedCategoryRequest({
          category,
          filename,
          ...(triggeredBy !== undefined ? { triggeredBy } : {}),
        }),
      );

      const { payload, status } = await timed("forwardToEmailToDealMsg", () =>
        forwardToEmailToDealMsg(request, msgUrl),
      );
      if (status >= 200 && status < 300) {
        await timed("deleteUploadedMsgBlob", () =>
          deleteUploadedMsgBlob(pathname),
        );
      }
      console.info(
        `[send-msg-file/process] total: ${Date.now() - requestStart}ms (status=${status})`,
      );
      return jsonResponse(payload, true, status);
    }

    return NextResponse.json(
      {
        message: "This category is registered but has no handler configured.",
        registeredCategory: true,
      },
      { status: 501 },
    );
  } catch (error) {
    console.error("[send-msg-file/process] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BlobMsgNotFoundError) {
      return NextResponse.json(
        {
          error: "Failed to process .msg file",
          details: message,
          pathname: error.pathname,
        },
        { status: 404 },
      );
    }

    const isClientError =
      message.includes("Missing") ||
      message.includes("Invalid") ||
      message.includes("does not look like");

    return NextResponse.json(
      {
        error: "Failed to process .msg file",
        details: message,
      },
      { status: isClientError ? 400 : 500 },
    );
  }
}
