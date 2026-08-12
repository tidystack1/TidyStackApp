import { NextRequest, NextResponse } from "next/server";
import { defaultPenaltiesForFormType } from "../_shared/formstack-prefill";

const MANUAL_FILL_VALUE = "Manual Fill";

function getHubSpotToken(): string {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  }
  return token;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function webhookEventsFromBody(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.map(asRecord).filter((event): event is Record<string, unknown> => event !== null);
  }

  const record = asRecord(body);
  if (!record) return [];

  if (Array.isArray(record.events)) {
    return record.events
      .map(asRecord)
      .filter((event): event is Record<string, unknown> => event !== null);
  }

  if (record.objectId != null || record.propertyValue != null) {
    return [record];
  }

  return [];
}

function parseDealIdFromLegacyBody(body: Record<string, unknown>): string {
  const direct = body.dealId ?? body.deal_id ?? body.hubspotDealId;
  if (direct != null && String(direct).trim()) {
    return String(direct).trim();
  }

  return "";
}

function isManualFillValue(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return normalized === "manual fill" || normalized === "manual";
}

type IncomingRequest =
  | { kind: "skip" }
  | { kind: "deal"; dealId: string }
  | { kind: "invalid" };

function parseIncomingRequest(body: unknown): IncomingRequest {
  const events = webhookEventsFromBody(body);
  if (events.length > 0) {
    const match = events.find((event) => isManualFillValue(event.propertyValue));
    if (!match) return { kind: "skip" };

    const dealId = String(match.objectId ?? "").trim();
    return dealId ? { kind: "deal", dealId } : { kind: "invalid" };
  }

  const record = asRecord(body);
  if (!record) return { kind: "invalid" };

  const dealId = parseDealIdFromLegacyBody(record);
  return dealId ? { kind: "deal", dealId } : { kind: "invalid" };
}

async function fetchDealFormType(
  dealId: string,
  token: string,
): Promise<{ formType: string; penalties: string }> {
  const query = new URLSearchParams({
    properties: "form_type,penalties",
  });
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}?${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal lookup failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    properties?: Record<string, string | null | undefined>;
  };
  const properties = json.properties ?? {};

  return {
    formType: properties.form_type != null ? String(properties.form_type) : "",
    penalties: properties.penalties != null ? String(properties.penalties) : "",
  };
}

async function patchDealPenalties(
  dealId: string,
  penalties: string,
  token: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { penalties } }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal update failed (${res.status}): ${text}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const incoming = parseIncomingRequest(body);

    if (incoming.kind === "skip") {
      console.log(
        `[auto-fill-penalties] Ignoring webhook: propertyValue is not "${MANUAL_FILL_VALUE}"`,
      );
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: `propertyValue is not "${MANUAL_FILL_VALUE}"`,
      });
    }

    if (incoming.kind === "invalid") {
      return NextResponse.json(
        {
          error: `Missing required field: objectId with propertyValue "${MANUAL_FILL_VALUE}"`,
        },
        { status: 400 },
      );
    }

    const { dealId } = incoming;
    const token = getHubSpotToken();

    console.log(`[auto-fill-penalties] Fetching form_type for deal ${dealId}`);
    const deal = await fetchDealFormType(dealId, token);

    if (!deal.formType.trim()) {
      return NextResponse.json(
        {
          error: "Deal is missing form_type",
          dealId,
        },
        { status: 400 },
      );
    }

    const { formTypeLabel, penalties } = defaultPenaltiesForFormType(deal.formType);
    if (!penalties) {
      return NextResponse.json(
        {
          error: `No default penalties text for form type "${formTypeLabel}"`,
          dealId,
          formType: formTypeLabel,
        },
        { status: 400 },
      );
    }

    await patchDealPenalties(dealId, penalties, token);
    console.log(
      `[auto-fill-penalties] Deal ${dealId}: penalties set for form type "${formTypeLabel}"`,
    );

    return NextResponse.json({
      success: true,
      dealId,
      formType: formTypeLabel,
      previousPenalties: deal.penalties,
      penalties,
    });
  } catch (error) {
    console.error("[auto-fill-penalties] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("HubSpot deal lookup failed (404)") ? 404 : 500;

    return NextResponse.json(
      {
        error: "Failed to auto-fill penalties on HubSpot deal",
        details: message,
      },
      { status },
    );
  }
}
