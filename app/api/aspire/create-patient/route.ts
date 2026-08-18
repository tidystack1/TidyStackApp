import { NextRequest, NextResponse } from "next/server";

import { ASPIRE_GHL_LOBBIE_ID_WEBHOOK_URL } from "../_shared/config";
import { createPatient } from "../_shared/lobbie";
import type { JsonObject } from "../_shared/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function pickString(record: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = stringField(record[key]);
    if (value) return value;
  }
  return "";
}

function normalizeMobilePhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

function parseLeadPayload(body: unknown): {
  firstName: string;
  lastName: string;
  email?: string;
  mobilePhone?: string;
  contactId?: string;
} | null {
  if (!isRecord(body)) return null;

  const nested = isRecord(body.contact) ? body.contact : {};
  const customData = isRecord(body.customData) ? body.customData : {};
  const firstName =
    pickString(body, ["first_name", "firstName"]) ||
    pickString(nested, ["first_name", "firstName"]);
  const lastName =
    pickString(body, ["last_name", "lastName"]) ||
    pickString(nested, ["last_name", "lastName"]);
  const email =
    pickString(body, ["email"]) || pickString(nested, ["email"]) || undefined;
  const rawPhone =
    pickString(body, ["phone", "mobilePhone", "mobile_phone"]) ||
    pickString(nested, ["phone", "mobilePhone", "mobile_phone"]);
  const contactId =
    pickString(body, ["contact_id", "contactId"]) ||
    pickString(nested, ["id"]) ||
    pickString(customData, ["id"]) ||
    undefined;

  if (!firstName || !lastName) return null;

  return {
    firstName: firstName.slice(0, 80),
    lastName: lastName.slice(0, 80),
    email,
    mobilePhone: rawPhone ? normalizeMobilePhone(rawPhone) : undefined,
    contactId,
  };
}

async function notifyGhlAutomation(input: {
  contactID: string;
  LobbieID: string;
}): Promise<void> {
  const response = await fetch(ASPIRE_GHL_LOBBIE_ID_WEBHOOK_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GHL webhook failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "POST a GoHighLevel contact payload here to create a Lobbie patient, then POST contactID and LobbieID to the GHL inbound webhook.",
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

    const parsed = parseLeadPayload(body);
    if (!parsed) {
      return NextResponse.json(
        { error: "Expected first_name and last_name on the contact payload" },
        { status: 400 },
      );
    }

    const patient = await createPatient(parsed);

    let ghl: { notified: boolean; contactID?: string; error?: string } = {
      notified: false,
    };
    if (!parsed.contactId) {
      ghl = { notified: false, error: "Missing contact_id on the payload" };
    } else {
      try {
        await notifyGhlAutomation({
          contactID: parsed.contactId,
          LobbieID: String(patient.id),
        });
        ghl = { notified: true, contactID: parsed.contactId };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to notify GHL webhook";
        console.error("[aspire/create-patient] ghl webhook", message);
        ghl = { notified: false, contactID: parsed.contactId, error: message };
      }
    }

    return NextResponse.json({
      ok: true,
      patientId: patient.id,
      patient,
      ghl,
    });
  } catch (error) {
    console.error(
      "[aspire/create-patient]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to create Lobbie patient" },
      { status: 500 },
    );
  }
}
