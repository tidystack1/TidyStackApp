import { NextRequest, NextResponse } from "next/server";
import { fetchNewDealNotification } from "../_shared/fetch-new-deal-notification";

/** Vercel serverless limit (default 10s); chains several HubSpot calls. */
export const maxDuration = 50;

function parseDealId(body: Record<string, unknown>): string {
  const direct = body.dealId ?? body.deal_id ?? body.hubspotDealId;
  if (direct != null && String(direct).trim()) {
    return String(direct).trim();
  }

  if (typeof body.info === "string") {
    try {
      const info = JSON.parse(body.info) as Record<string, unknown>;
      const nested = info.dealId ?? info.deal_id ?? info.hubspotDealId;
      if (nested != null && String(nested).trim()) {
        return String(nested).trim();
      }
    } catch {
      // ignore malformed info JSON
    }
  }

  return "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const dealId = parseDealId(body);

    if (!dealId) {
      return NextResponse.json(
        { error: "Missing required field: dealId" },
        { status: 400 },
      );
    }

    console.log(
      `[notification-of-new-deal] Evaluating deal ${dealId} for Customer.io`,
    );
    const payload = await fetchNewDealNotification(dealId);

    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("[notification-of-new-deal] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to evaluate new deal notification",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
