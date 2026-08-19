import { NextRequest, NextResponse } from "next/server";

import {
  emailAutomationsCallbackUrl,
  scanEmailAutomations,
} from "../../_shared/email-automations";
import {
  aspirePublicOrigin,
  isAspireRequestAuthorized,
  webhookAccessToken,
} from "../../_shared/process";

export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      // TESTING: n8n is hourly; follow-up thresholds are hours not days. Switch back with the scan schedule logic.
      "n8n should POST here on an hourly schedule (testing; production is daily). This app checks ClickUp waiting-list and no-tech dates and webhooks n8n for any due emails.",
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAspireRequestAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const origin = aspirePublicOrigin(request);
    const callbackUrl = origin
      ? emailAutomationsCallbackUrl(origin, webhookAccessToken())
      : null;

    const result = await scanEmailAutomations(callbackUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[aspire/email-automations/scan]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to scan Aspire email automations" },
      { status: 500 },
    );
  }
}
