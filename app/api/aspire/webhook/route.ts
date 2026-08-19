import { NextRequest, NextResponse } from "next/server";

import {
  isWebhookTokenValid,
  parseWebhookEnvelope,
  processWebhookEnvelope,
} from "../_shared/process";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Aspire Lobbie webhook is ready. Lobbie should POST form-packet events here.",
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
    const envelope = parseWebhookEnvelope(body);
    if (!envelope) {
      return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
    }

    const result = await processWebhookEnvelope(envelope);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[aspire/webhook]", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "Failed to process Lobbie webhook" },
      { status: 500 },
    );
  }
}
