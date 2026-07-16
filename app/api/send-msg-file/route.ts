import { NextRequest, NextResponse } from "next/server";

const HUBSPOT_DEAL_CATEGORY = "HubSpot deal";
const EMAIL_TO_DEAL_MSG_PATH = "/api/highviewtravel/email-to-deal/msg";

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

function looksLikeBase64(value: string): boolean {
  const trimmed = value.replace(/\s/g, "");
  if (trimmed.length < 32 || trimmed.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(trimmed);
}

function bufferFromBase64(value: string): Buffer | null {
  if (!looksLikeBase64(value)) return null;
  try {
    const buffer = Buffer.from(value.replace(/\s/g, ""), "base64");
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function parseJsonField(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  if (
    raw !== null &&
    raw !== undefined &&
    typeof raw === "object" &&
    !Array.isArray(raw)
  ) {
    return raw as Record<string, unknown>;
  }

  return null;
}

function categoryFromObject(fields: Record<string, unknown>): string {
  const json =
    parseJsonField(fields.json) ??
    parseJsonField(fields.data) ??
    parseJsonField(fields.info) ??
    parseJsonField(fields.payload);

  const fromJson = json?.category;
  if (typeof fromJson === "string" && fromJson.trim()) {
    return fromJson.trim();
  }

  if (typeof fields.category === "string" && fields.category.trim()) {
    return fields.category.trim();
  }

  return "";
}

function categoryFromRequest(
  request: NextRequest,
  fields?: Record<string, unknown>,
): string {
  if (fields) {
    const fromFields = categoryFromObject(fields);
    if (fromFields) return fromFields;
  }

  const header =
    request.headers.get("x-category") ?? request.headers.get("category");
  if (header?.trim()) return header.trim();

  const query = request.nextUrl.searchParams.get("category");
  if (query?.trim()) return query.trim();

  return "";
}

function requireCategory(category: string): string {
  if (!category) {
    throw new Error(
      'Missing category. Provide JSON {"category":"HubSpot deal"}, multipart field `json`/`category`, header `X-Category`, or query `?category=`.',
    );
  }
  return category;
}

async function downloadMsg(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to download .msg file (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function resolveMsgFromJson(
  body: Record<string, unknown>,
): Promise<{ msgBuffer: Buffer; filename: string }> {
  const candidates = [
    body.msg,
    body.file,
    body.email,
    body.attachment,
    body.eml,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;

    const trimmed = candidate.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return {
        msgBuffer: await downloadMsg(trimmed),
        filename: "email.msg",
      };
    }

    const asBase64 = bufferFromBase64(trimmed);
    if (asBase64 && looksLikeMsgBuffer(asBase64)) {
      return { msgBuffer: asBase64, filename: "email.msg" };
    }
  }

  const msgUrl =
    typeof body.msgUrl === "string"
      ? body.msgUrl
      : typeof body.url === "string"
        ? body.url
        : "";
  if (msgUrl.startsWith("http://") || msgUrl.startsWith("https://")) {
    return {
      msgBuffer: await downloadMsg(msgUrl),
      filename: "email.msg",
    };
  }

  throw new Error(
    "Could not find .msg content in JSON. Provide `msg` (base64), or `msgUrl` / `url`.",
  );
}

async function parseMultipart(
  request: NextRequest,
): Promise<{ msgBuffer: Buffer; filename: string; category: string }> {
  const form = await request.formData();
  const fields: Record<string, unknown> = {};
  let msgBuffer: Buffer | null = null;
  let filename = "email.msg";

  for (const [key, value] of form.entries()) {
    if (value instanceof File) {
      const buffer = Buffer.from(await value.arrayBuffer());
      fields[key] = buffer;
      if (
        !msgBuffer ||
        key === "msg" ||
        key === "file" ||
        key === "email" ||
        value.name.toLowerCase().endsWith(".msg")
      ) {
        msgBuffer = buffer;
        if (value.name) filename = value.name;
      }
    } else {
      fields[key] = String(value);
    }
  }

  if (!msgBuffer) {
    throw new Error(
      'Missing .msg file. Provide a multipart file field named "msg" or "file".',
    );
  }

  return {
    msgBuffer,
    filename,
    category: requireCategory(categoryFromRequest(request, fields)),
  };
}

async function parseRequest(request: NextRequest): Promise<{
  msgBuffer: Buffer;
  filename: string;
  category: string;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await request.arrayBuffer());

  // Option 1: multipart file upload
  if (contentType.includes("multipart/form-data")) {
    // Re-wrap so formData() can read the body we already consumed
    const rebuilt = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: buffer,
    });
    return parseMultipart(rebuilt);
  }

  // Option 3: JSON body (check before raw binary — JSON starts with `{`)
  if (contentType.includes("application/json") || buffer[0] === 0x7b) {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(buffer.toString("utf-8")) as Record<string, unknown>;
    } catch {
      throw new Error("Invalid JSON body");
    }

    const { msgBuffer, filename } = await resolveMsgFromJson(body);
    return {
      msgBuffer,
      filename,
      category: requireCategory(categoryFromRequest(request, body)),
    };
  }

  // Option 2: raw .msg body
  if (
    looksLikeMsgBuffer(buffer) ||
    contentType.includes("application/vnd.ms-outlook") ||
    contentType.includes("application/msoutlook") ||
    contentType.includes("application/x-ole-storage") ||
    contentType.includes("application/octet-stream")
  ) {
    if (!looksLikeMsgBuffer(buffer)) {
      throw new Error(
        "Raw body does not look like a .msg file (missing OLE signature).",
      );
    }

    return {
      msgBuffer: buffer,
      filename: "email.msg",
      category: requireCategory(categoryFromRequest(request)),
    };
  }

  // Raw body that is base64 of a .msg
  const asText = buffer.toString("utf-8").trim();
  const asBase64 = bufferFromBase64(asText);
  if (asBase64 && looksLikeMsgBuffer(asBase64)) {
    return {
      msgBuffer: asBase64,
      filename: "email.msg",
      category: requireCategory(categoryFromRequest(request)),
    };
  }

  throw new Error(
    "Could not find .msg content. Use multipart file upload, raw .msg body, or JSON with `msg` / `msgUrl`.",
  );
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
    const { msgBuffer, filename, category } = await parseRequest(request);

    if (category === HUBSPOT_DEAL_CATEGORY) {
      return forwardToEmailToDealMsg(request, msgBuffer, filename);
    }

    return NextResponse.json(
      {
        error: `Unsupported category: ${category}`,
        supportedCategories: [HUBSPOT_DEAL_CATEGORY],
      },
      { status: 400 },
    );
  } catch (error) {
    console.error("[send-msg-file] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const isClientError =
      message.includes("Missing") ||
      message.includes("Could not find") ||
      message.includes("Invalid JSON") ||
      message.includes("does not look like") ||
      message.includes("multipart");

    return NextResponse.json(
      {
        error: "Failed to process .msg file",
        details: message,
      },
      { status: isClientError ? 400 : 500 },
    );
  }
}
