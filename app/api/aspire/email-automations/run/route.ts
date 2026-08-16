import { NextRequest, NextResponse } from "next/server";

import {
  emailAutomationsCallbackUrl,
  parseRunRequest,
  runScheduledAutomation,
} from "../../_shared/email-automations";
import {
  aspirePublicOrigin,
  isAspireRequestAuthorized,
  webhookAccessToken,
} from "../../_shared/process";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "n8n should POST { taskId, automation } here after a Wait node. This app checks ClickUp and, if the condition still holds, webhooks n8n to send the email.",
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAspireRequestAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseRunRequest(await request.json());
    if (!parsed) {
      return NextResponse.json(
        { error: "Expected JSON body with taskId and automation" },
        { status: 400 },
      );
    }

    const origin = aspirePublicOrigin(request);
    const callbackUrl = origin
      ? emailAutomationsCallbackUrl(origin, webhookAccessToken())
      : null;

    const result = await runScheduledAutomation({
      ...parsed,
      callbackUrl,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[aspire/email-automations/run]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to run Aspire email automation" },
      { status: 500 },
    );
  }
}
