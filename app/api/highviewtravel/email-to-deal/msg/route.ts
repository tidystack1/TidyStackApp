import { NextRequest, NextResponse } from "next/server";
import { extractBookingFromEmail } from "../../_shared/extract-booking-from-email";
// DISABLED for Outlook testing — uncomment with HubSpot create below
// import { createHubSpotDealFromBooking } from "../../_shared/hubspot-deal";
import { parseMsg } from "../../_shared/parse-msg";

function parseInfoPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
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

function parseInfoBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const direct = parseInfoPayload(body.info);
  if (direct) return direct;

  if (
    body.data !== null &&
    body.data !== undefined &&
    typeof body.data === "object" &&
    !Array.isArray(body.data)
  ) {
    return parseInfoPayload((body.data as Record<string, unknown>).info);
  }

  return null;
}

function fieldText(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) {
    const fieldValue = (value as { value?: unknown }).value;
    return fieldValue != null ? String(fieldValue).trim() : "";
  }

  if (typeof value === "string") return value.trim();
  return "";
}

function isZapierHydrateToken(value: string): boolean {
  return value.startsWith("hydrate|||") && value.endsWith("|||hydrate");
}

function directFileUrl(value: unknown): string {
  const text = fieldText(value);
  if (!text || isZapierHydrateToken(text)) return "";
  if (text.startsWith("http://") || text.startsWith("https://")) return text;
  return "";
}

function looksLikeBase64(value: string): boolean {
  const trimmed = value.replace(/\s/g, "");
  if (trimmed.length < 32 || trimmed.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/=]+$/.test(trimmed);
}

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

function bufferFromBase64(value: string): Buffer | null {
  if (!looksLikeBase64(value)) return null;
  try {
    const buffer = Buffer.from(value.replace(/\s/g, ""), "base64");
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function msgCandidateFromValue(value: unknown): Buffer | string | null {
  if (Buffer.isBuffer(value)) {
    return value.length > 0 ? value : null;
  }

  if (value instanceof Uint8Array) {
    return value.length > 0 ? Buffer.from(value) : null;
  }

  const url = directFileUrl(value);
  if (url) return url;

  const text = fieldText(value);
  if (!text) return null;

  const asBase64 = bufferFromBase64(text);
  if (asBase64) return asBase64;

  return null;
}

function msgFromPayload(body: Record<string, unknown>): Buffer | string | null {
  const info = parseInfoBody(body);
  const source = info ?? body;

  const candidates = [
    source.msg,
    source.eml,
    source.email,
    source.emailFile,
    source.file,
    source.File,
    source.attachment,
    body.msg,
    body.eml,
    body.email,
    body.file,
    body._msgBuffer,
  ];

  for (const candidate of candidates) {
    const resolved = msgCandidateFromValue(candidate);
    if (resolved) return resolved;
  }

  const msgUrl = fieldText(source.msgUrl ?? source.url ?? body.msgUrl ?? body.url);
  if (msgUrl) return msgUrl;

  return null;
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

async function resolveMsgBuffer(body: Record<string, unknown>): Promise<Buffer> {
  const msg = msgFromPayload(body);
  if (!msg) {
    throw new Error(
      "Could not find .msg content. Provide `msg` (file, base64), `msgUrl`, or multipart field `file`/`msg`.",
    );
  }

  if (typeof msg === "string") {
    if (msg.startsWith("http://") || msg.startsWith("https://")) {
      return downloadMsg(msg);
    }
    throw new Error("Could not find .msg content. URL or base64 expected.");
  }

  return msg;
}

function extractMultipartBoundary(contentType: string): string | null {
  const match = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2] ?? null;
}

function parseMultipartLenient(
  body: Buffer,
  contentType: string,
): Record<string, unknown> {
  const boundary = extractMultipartBoundary(contentType);
  if (!boundary) {
    throw new Error("multipart/form-data missing boundary");
  }

  const raw = body.toString("binary");
  const parts = raw.split(`--${boundary}`).slice(1);
  const fields: Record<string, unknown> = {};

  for (const part of parts) {
    const trimmed = part.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");
    if (!trimmed || trimmed === "--") continue;

    const headerEnd = trimmed.search(/\r?\n\r?\n/);
    if (headerEnd === -1) continue;

    const headers = trimmed.slice(0, headerEnd);
    let content = trimmed.slice(headerEnd).replace(/^\r?\n/, "");
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    else if (content.endsWith("\n")) content = content.slice(0, -1);

    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const name = nameMatch?.[1] ?? "file";
    const filenameMatch =
      /filename="([^"]*)"/i.exec(headers) ??
      /filename\*=(?:UTF-8''|utf-8'')([^\s;]+)/i.exec(headers);

    if (filenameMatch) {
      const filename = decodeURIComponent(filenameMatch[1] ?? "");
      const buffer = Buffer.from(content, "binary");
      fields[name] = buffer;
      fields._msgBuffer = buffer;
      if (filename) fields._filename = filename;
    } else {
      fields[name] = content;
    }
  }

  return fields;
}

async function parseRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await request.arrayBuffer());

  if (contentType.includes("multipart/form-data")) {
    if (looksLikeMsgBuffer(buffer)) {
      return { _msgBuffer: buffer, _contentType: contentType };
    }

    try {
      const form = await new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: buffer,
      }).formData();

      const file =
        form.get("msg") ?? form.get("file") ?? form.get("email") ?? form.get("eml");

      if (file instanceof File) {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        return {
          _msgBuffer: fileBuffer,
          msg: fileBuffer,
          _filename: file.name,
          _contentType: contentType,
        };
      }

      const fields: Record<string, unknown> = { _contentType: contentType };
      for (const [key, value] of form.entries()) {
        if (value instanceof File) {
          const fileBuffer = Buffer.from(await value.arrayBuffer());
          fields[key] = fileBuffer;
          if (!fields._msgBuffer) fields._msgBuffer = fileBuffer;
          fields._filename = value.name;
        } else {
          fields[key] = String(value);
        }
      }
      return fields;
    } catch {
      const fields = parseMultipartLenient(buffer, contentType);
      fields._contentType = contentType;
      return fields;
    }
  }

  if (
    contentType.includes("application/vnd.ms-outlook") ||
    contentType.includes("application/octet-stream") ||
    contentType.includes("application/x-ole-storage") ||
    !contentType ||
    contentType.includes("application/msoutlook")
  ) {
    if (looksLikeMsgBuffer(buffer)) {
      return { _msgBuffer: buffer, _contentType: contentType };
    }
  }

  if (contentType.includes("application/json") || buffer[0] === 0x7b /* { */) {
    try {
      return JSON.parse(buffer.toString("utf-8")) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  if (looksLikeMsgBuffer(buffer)) {
    return { _msgBuffer: buffer, _contentType: contentType };
  }

  const asText = buffer.toString("utf-8");
  const asBase64 = bufferFromBase64(asText.trim());
  if (asBase64 && looksLikeMsgBuffer(asBase64)) {
    return { _msgBuffer: asBase64, _contentType: contentType };
  }

  throw new Error(
    "Could not find .msg content. Provide multipart file `msg`/`file`, raw .msg body, or JSON `{ msg: <base64> }` / `{ msgUrl }`.",
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestBody(request);
    const rawMsg = await resolveMsgBuffer(body);
    const parsed = parseMsg(rawMsg);
    const booking = await extractBookingFromEmail(parsed);

    // --- HubSpot create (DISABLED for Outlook testing) ---
    // Uncomment the block below and remove the stub `deal` object when ready
    // to create HubSpot deals again.
    //
    // const deal = await createHubSpotDealFromBooking(
    //   booking,
    //   parsed.from,
    //   parsed.to,
    // );
    const deal = {
      dealId: "TEST_DEAL_ID",
      dealName: `${booking.passengerName ?? "Unknown"} ${booking.departureAirport ?? ""} ${booking.arrivalAirport ?? ""} ${booking.outboundDate ?? ""}/${booking.returnDate ?? ""}`.trim(),
      contactId: null as string | null,
      contactEmail: parsed.from || "unknown@example.com",
      contactAssociated: false,
      ownerId: null as string | null,
      ownerEmail: null as string | null,
      ownerAssigned: false,
    };
    // --- end HubSpot create (DISABLED) ---

    return NextResponse.json({
      success: true,
      hubspotDisabled: true, // remove when HubSpot create is re-enabled
      passengerName: booking.passengerName,
      departureAirport: booking.departureAirport,
      arrivalAirport: booking.arrivalAirport,
      outboundDate: booking.outboundDate,
      returnDate: booking.returnDate,
      cabinClass: booking.cabinClass,
      route: booking.route,
      passengers: booking.passengers,
      departureRegion: booking.departureRegion,
      dealId: deal.dealId,
      dealName: deal.dealName,
      contactId: deal.contactId,
      contactEmail: deal.contactEmail,
      contactAssociated: deal.contactAssociated,
      ownerId: deal.ownerId,
      ownerEmail: deal.ownerEmail,
      ownerAssigned: deal.ownerAssigned,
    });
  } catch (error) {
    console.error("[email-to-deal/msg] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const isClientError =
      message.includes("Could not find .msg content") ||
      message.includes("Could not parse") ||
      message.includes("Could not extract a contact email address");

    return NextResponse.json(
      {
        error: "Failed to process .msg email and create HubSpot deal",
        details: message,
      },
      { status: isClientError ? 400 : 500 },
    );
  }
}
