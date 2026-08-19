import { NextRequest, NextResponse } from "next/server";

import { processPatientToClickUp } from "../_shared/process";
import type { JsonObject } from "../_shared/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stringValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  return value.trim();
}

function pickNormalized(record: JsonObject, candidates: string[]): string {
  const lookup = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    lookup.set(normalizeKey(key), value);
  }
  for (const candidate of candidates) {
    const value = stringValue(lookup.get(normalizeKey(candidate)));
    if (value) return value;
  }
  return "";
}

function parsePatientId(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseConvertPayload(body: unknown): {
  patientId: number;
  firstName: string;
  lastName: string;
  address: string;
  insurance: string;
} | null {
  if (!isRecord(body)) return null;

  const nested = isRecord(body.contact) ? body.contact : {};
  const customData = isRecord(body.customData) ? body.customData : {};
  const sources = [body, customData, nested];

  let patientIdRaw = "";
  for (const source of sources) {
    patientIdRaw = pickNormalized(source, [
      "Lobbie Patient ID",
      "lobbieId",
      "lobbiePatientId",
      "LobbieID",
      "Lobbie ID",
    ]);
    if (patientIdRaw) break;
  }

  const patientId = parsePatientId(patientIdRaw);
  if (!patientId) return null;

  return {
    patientId,
    firstName:
      pickNormalized(body, ["first_name", "firstName"]) ||
      pickNormalized(nested, ["first_name", "firstName"]),
    lastName:
      pickNormalized(body, ["last_name", "lastName"]) ||
      pickNormalized(nested, ["last_name", "lastName"]),
    address:
      pickNormalized(body, ["full_address", "fullAddress", "Office Address"]) ||
      pickNormalized(nested, ["full_address", "fullAddress"]),
    insurance:
      pickNormalized(body, ["Insurance", "Patient Insurance Provider"]) ||
      pickNormalized(nested, ["Insurance", "Patient Insurance Provider"]),
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST a GoHighLevel opportunity payload here to create or update a ClickUp Client from the Lobbie Patient ID.",
  });
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = parseConvertPayload(body);
    if (!parsed) {
      return NextResponse.json(
        { error: "Expected Lobbie Patient ID on the opportunity payload" },
        { status: 400 },
      );
    }

    const result = await processPatientToClickUp({
      patientId: parsed.patientId,
      fallbacks: {
        clientFirstName: parsed.firstName,
        clientLastName: parsed.lastName,
        address: parsed.address,
        insurance: parsed.insurance,
      },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to convert to ClickUp";
    console.error("[aspire/convert-to-clickup]", message);
    const notFound = /failed \(404\)/i.test(message);
    return NextResponse.json(
      { error: notFound ? "Lobbie patient was not found" : "Failed to convert to ClickUp" },
      { status: notFound ? 404 : 500 },
    );
  }
}
