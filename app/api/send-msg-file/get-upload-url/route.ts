import { issueSignedToken, presignUrl } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import {
  isRegisteredCategory,
  REGISTERED_CATEGORIES,
} from "../_shared/categories";
import {
  pluginUnauthorizedResponse,
  verifyPluginSharedSecret,
} from "../_shared/verify-plugin-shared-secret";

const MSG_CONTENT_TYPES = [
  "application/vnd.ms-outlook",
  "application/octet-stream",
] as const;

const MSG_MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

function pathnameForMessageId(messageId: unknown): string {
  if (typeof messageId !== "string" || !messageId.trim()) {
    throw new Error("Missing or invalid messageId.");
  }
  const id = messageId.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(
      "Invalid messageId. Use only letters, numbers, dots, underscores, and hyphens.",
    );
  }
  return `msg/${id}.msg`;
}

function requireCategory(category: unknown): string {
  if (typeof category !== "string" || !category.trim()) {
    throw new Error(
      `Missing category. Provide JSON with category set to one of: ${REGISTERED_CATEGORIES.join(", ")}.`,
    );
  }
  return category.trim();
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!verifyPluginSharedSecret(body.secret)) {
      return pluginUnauthorizedResponse();
    }

    const category = requireCategory(body.category);
    const registeredCategory = isRegisteredCategory(category);
    if (!registeredCategory) {
      return NextResponse.json(
        {
          message: "This category is not registered.",
          registeredCategory: false,
        },
        { status: 200 },
      );
    }

    const pathname = pathnameForMessageId(body.messageId);
    const validUntil = Date.now() + UPLOAD_URL_TTL_MS;

    const token = await issueSignedToken({
      pathname,
      operations: ["put"],
      allowedContentTypes: [...MSG_CONTENT_TYPES],
      maximumSizeInBytes: MSG_MAX_BYTES,
      validUntil,
    });

    const { presignedUrl } = await presignUrl(token, {
      operation: "put",
      pathname,
      access: "private",
      allowedContentTypes: [...MSG_CONTENT_TYPES],
      maximumSizeInBytes: MSG_MAX_BYTES,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({
      uploadUrl: presignedUrl,
      pathname,
      registeredCategory: true,
    });
  } catch (error) {
    console.error("[send-msg-file/get-upload-url] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const isClientError =
      message.includes("Missing") ||
      message.includes("Invalid messageId") ||
      message.includes("Invalid JSON");

    return NextResponse.json(
      { error: "Failed to create upload URL", details: message },
      { status: isClientError ? 400 : 500 },
    );
  }
}
