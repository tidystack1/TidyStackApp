import { NextRequest, NextResponse } from "next/server";
import { fetchDealEmailContext } from "../_shared/fetch-deal-email-context";

/** Vercel serverless limit (default 10s); this route chains several HubSpot calls. */
export const maxDuration = 50;

function parseDealId(body: Record<string, unknown>): string {  const direct = body.dealId ?? body.deal_id ?? body.hubspotDealId;
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

    console.log(`[get-info-for-email-file] Fetching context for deal ${dealId}`);
    const payload = await fetchDealEmailContext(dealId);

    return NextResponse.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("[get-info-for-email-file] Error:", error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("No contact") || message.includes("No company")
      ? 404
      : 500;

    return NextResponse.json(
      {
        error: "Failed to fetch deal email context",
        details: message,
      },
      { status },
    );
  }
}
