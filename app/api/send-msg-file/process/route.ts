import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import {
  pluginUnauthorizedResponse,
  verifyPluginSharedSecret,
} from "../_shared/verify-plugin-shared-secret";

const HUBSPOT_DEAL_CATEGORY = "HubSpot deal";
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
    throw new Error('Missing category. Provide JSON {"category":"HubSpot deal"}.');
  }
  return category.trim();
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

async function fetchMsgFromBlob(pathname: string): Promise<Buffer> {
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

  const res = await fetch(presignedUrl);
  if (res.status === 404) {
    throw new BlobMsgNotFoundError(pathname);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to download .msg from blob storage (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const msgBuffer = Buffer.from(await res.arrayBuffer());
  if (!looksLikeMsgBuffer(msgBuffer)) {
    throw new Error(
      "Downloaded file does not look like a .msg file (missing OLE signature).",
    );
  }
  return msgBuffer;
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

// TEMP logging only — remove this webhook (and logSupportedCategoryRequest) before going live.
const LOGGING_WEBHOOK_URL =
  "https://tidystack.app.n8n.cloud/webhook/80c63112-4736-4122-b5c6-17396f23bdad";

/** TEMP logging only — remove before going live. */
async function logSupportedCategoryRequest(data: {
  category: string;
  filename: string;
  msgBase64: string;
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

async function forwardToEmailToDealMsg(
  request: NextRequest,
  msgBuffer: Buffer,
  filename: string,
): Promise<NextResponse> {
  const form = new FormData();
  form.append(
    "msg",
    new Blob([new Uint8Array(msgBuffer)], {
      type: "application/vnd.ms-outlook",
    }),
    filename.endsWith(".msg") ? filename : `${filename}.msg`,
  );

  const targetUrl = new URL(EMAIL_TO_DEAL_MSG_PATH, request.url);
  const upstream = await fetch(targetUrl, {
    method: "POST",
    body: form,
  });

  const text = await upstream.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = { details: text };
  }

  return NextResponse.json(payload, { status: upstream.status });
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
    const msgBuffer = await fetchMsgFromBlob(pathname);
    const filename = filenameFromPathname(pathname);

    if (category === HUBSPOT_DEAL_CATEGORY) {
      // TEMP logging only — remove before going live.
      await logSupportedCategoryRequest({
        category,
        filename,
        msgBase64: msgBuffer.toString("base64"),
      });

      return forwardToEmailToDealMsg(request, msgBuffer, filename);
    }

    return NextResponse.json(
      { message: "This category is not registered." },
      { status: 200 },
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
