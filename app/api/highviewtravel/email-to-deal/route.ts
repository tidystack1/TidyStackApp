import { NextRequest, NextResponse } from "next/server";
import { extractBookingFromEmail } from "../_shared/extract-booking-from-email";
import { createHubSpotDealFromBooking } from "../_shared/hubspot-deal";
import { parseEml } from "../_shared/parse-eml";

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

function looksLikeBase64Eml(value: string): boolean {
  const trimmed = value.replace(/\s/g, "");
  if (trimmed.length < 32 || trimmed.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) return false;

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
    return /^(From:|MIME-Version:|Return-Path:|Received:)/im.test(decoded);
  } catch {
    return false;
  }
}

function looksLikeRawEml(value: string): boolean {
  return /^(From:|MIME-Version:|Return-Path:|Received:)/im.test(value.trim());
}

function decodeEmlString(value: string): string {
  if (looksLikeRawEml(value)) return value;
  if (looksLikeBase64Eml(value)) {
    return Buffer.from(value.replace(/\s/g, ""), "base64").toString("utf-8");
  }
  return value;
}

function emlFromPayload(body: Record<string, unknown>): string | null {
  const info = parseInfoBody(body);
  const source = info ?? body;

  const candidates = [
    source.eml,
    source.email,
    source.emailFile,
    source.file,
    source.File,
    source.attachment,
    body.eml,
    body.email,
    body.file,
  ];

  for (const candidate of candidates) {
    const text = fieldText(candidate);
    if (!text) continue;

    const url = directFileUrl(candidate);
    if (url) return url;

    if (looksLikeRawEml(text) || looksLikeBase64Eml(text)) {
      return decodeEmlString(text);
    }
  }

  const emlUrl = fieldText(source.emlUrl ?? source.url ?? body.emlUrl ?? body.url);
  if (emlUrl) return emlUrl;

  return null;
}

async function downloadEml(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to download .eml file (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  return res.text();
}

async function resolveEmlContent(body: Record<string, unknown>): Promise<string> {
  const eml = emlFromPayload(body);
  if (!eml) {
    throw new Error(
      "Could not find .eml content. Provide `eml` (raw or base64), `emlUrl`, or Zapier `info.eml`.",
    );
  }

  if (eml.startsWith("http://") || eml.startsWith("https://")) {
    return downloadEml(eml);
  }

  return eml;
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
      fields[name] = Buffer.from(content, "binary").toString("utf-8");
      if (filename) fields._filename = filename;
    } else {
      fields[name] = content;
    }
  }

  return fields;
}

async function parseRequestBody(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const buffer = Buffer.from(await request.arrayBuffer());
    const preview = buffer.toString("utf-8", 0, Math.min(buffer.length, 120));

    if (looksLikeRawEml(preview)) {
      return { eml: buffer.toString("utf-8"), _contentType: contentType };
    }

    try {
      const form = await new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: buffer,
      }).formData();

      const file = form.get("eml") ?? form.get("file") ?? form.get("email");

      if (file instanceof File) {
        return {
          eml: await file.text(),
          _contentType: contentType,
        };
      }

      const fields: Record<string, unknown> = { _contentType: contentType };
      for (const [key, value] of form.entries()) {
        fields[key] = value instanceof File ? await value.text() : String(value);
      }
      return fields;
    } catch {
      const fields = parseMultipartLenient(buffer, contentType);
      fields._contentType = contentType;

      const fileField =
        fields.eml ?? fields.file ?? fields.email ?? fields.File ?? fields.attachment;
      if (typeof fileField === "string" && fileField) {
        return { eml: fileField, _contentType: contentType, _filename: fields._filename };
      }

      return fields;
    }
  }

  if (
    contentType.includes("message/rfc822") ||
    contentType.includes("application/octet-stream") ||
    contentType.includes("text/plain")
  ) {
    const text = await request.text();
    if (looksLikeRawEml(text)) {
      return { eml: text, _contentType: contentType };
    }
  }

  return (await request.json()) as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await parseRequestBody(request);
    const rawEml = await resolveEmlContent(body);
    const parsed = parseEml(rawEml);
    const booking = await extractBookingFromEmail(parsed);
    const deal = await createHubSpotDealFromBooking(booking, parsed.from);

    return NextResponse.json({
      success: true,
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
    });
  } catch (error) {
    console.error("[email-to-deal] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const isClientError =
      message.includes("Could not find .eml content") ||
      message.includes("Could not parse") ||
      message.includes("Could not extract a contact email address");

    return NextResponse.json(
      {
        error: "Failed to process email and create HubSpot deal",
        details: message,
      },
      { status: isClientError ? 400 : 500 },
    );
  }
}
