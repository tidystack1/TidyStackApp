import { NextRequest, NextResponse } from "next/server";

import { createWebhook, listWebhooks } from "../_shared/lobbie";
import {
  isAspireRequestAuthorized,
  webhookAccessToken,
} from "../_shared/process";

export const runtime = "nodejs";
export const maxDuration = 30;

const EVENT_TYPES = ["form-packet.created", "form-packet.updated"] as const;
const WEBHOOK_NAME = "Aspire intake to TidyStack";

function publicOrigin(request: NextRequest): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = forwardedHost || request.headers.get("host");
  if (host && forwardedProto) return `${forwardedProto}://${host}`;
  if (host && !host.includes("localhost") && !host.startsWith("127.")) {
    return `https://${host}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    if (!isAspireRequestAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let requestedUrl: string | undefined;
    try {
      const body = (await request.json()) as { url?: unknown };
      if (typeof body.url === "string" && body.url.trim()) {
        requestedUrl = body.url.trim();
      }
    } catch {
      requestedUrl = undefined;
    }

    const origin = publicOrigin(request);
    const token = webhookAccessToken();
    const webhookUrl =
      requestedUrl ||
      (origin ? `${origin.replace(/\/$/, "")}/api/aspire/webhook?token=${token}` : null);

    if (!webhookUrl) {
      return NextResponse.json(
        {
          error:
            "Need a public HTTPS URL. Deploy the app, or POST { \"url\": \"https://your-host/api/aspire/webhook?token=...\" }.",
        },
        { status: 400 },
      );
    }

    if (!webhookUrl.startsWith("https://")) {
      return NextResponse.json(
        { error: "Lobbie requires an HTTPS webhook URL" },
        { status: 400 },
      );
    }

    const existing = await listWebhooks();
    const alreadyRegistered = existing.find((item) => item.url === webhookUrl);
    if (alreadyRegistered) {
      return NextResponse.json({
        ok: true,
        created: false,
        webhook: alreadyRegistered,
        webhookUrl,
      });
    }

    const created = await createWebhook({
      url: webhookUrl,
      eventTypes: [...EVENT_TYPES],
      name: WEBHOOK_NAME,
    });

    return NextResponse.json({
      ok: true,
      created: true,
      webhook: created,
      webhookUrl,
    });
  } catch (error) {
    console.error(
      "[aspire/register-webhook]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to register Lobbie webhook" },
      { status: 500 },
    );
  }
}
