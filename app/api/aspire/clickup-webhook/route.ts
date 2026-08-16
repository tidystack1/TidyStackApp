import { NextRequest, NextResponse } from "next/server";

import {
  emailAutomationsCallbackUrl,
  processClickUpTaskEvent,
} from "../_shared/email-automations";
import {
  aspirePublicOrigin,
  isWebhookTokenValid,
  webhookAccessToken,
} from "../_shared/process";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "Aspire ClickUp webhook is ready. ClickUp should POST taskUpdated events here.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const token =
      request.nextUrl.searchParams.get("token") ??
      request.headers.get("x-aspire-webhook-token");

    if (!isWebhookTokenValid(token)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const origin = aspirePublicOrigin(request);
    const callbackUrl = origin
      ? emailAutomationsCallbackUrl(origin, webhookAccessToken())
      : null;

    const result = await processClickUpTaskEvent(body, callbackUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[aspire/clickup-webhook]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to process ClickUp webhook" },
      { status: 500 },
    );
  }
}
