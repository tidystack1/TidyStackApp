import { NextRequest, NextResponse } from "next/server";

import { CLICKUP_CLIENTS_LIST_ID } from "../_shared/config";
import { createClickUpWebhook, listClickUpWebhooks } from "../_shared/clickup";
import {
  aspirePublicOrigin,
  isAspireRequestAuthorized,
  webhookAccessToken,
} from "../_shared/process";

export const runtime = "nodejs";
export const maxDuration = 30;

const EVENTS = ["taskCreated", "taskUpdated"] as const;

export async function GET(request: NextRequest) {
  try {
    if (!isAspireRequestAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const webhooks = await listClickUpWebhooks();
    return NextResponse.json({ ok: true, webhooks });
  } catch (error) {
    console.error(
      "[aspire/register-clickup-webhook]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to list ClickUp webhooks" },
      { status: 500 },
    );
  }
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

    const origin = aspirePublicOrigin(request);
    const token = webhookAccessToken();
    const webhookUrl =
      requestedUrl ||
      (origin
        ? `${origin.replace(/\/$/, "")}/api/aspire/clickup-webhook?token=${token}`
        : null);

    if (!webhookUrl) {
      return NextResponse.json(
        {
          error:
            "Need a public HTTPS URL. Deploy the app, or POST { \"url\": \"https://your-host/api/aspire/clickup-webhook?token=...\" }.",
        },
        { status: 400 },
      );
    }

    if (!webhookUrl.startsWith("https://")) {
      return NextResponse.json(
        { error: "ClickUp requires an HTTPS webhook URL" },
        { status: 400 },
      );
    }

    const existing = await listClickUpWebhooks();
    const alreadyRegistered = existing.find(
      (item) => item.endpoint === webhookUrl,
    );
    if (alreadyRegistered) {
      return NextResponse.json({
        ok: true,
        created: false,
        webhook: alreadyRegistered,
        webhookUrl,
      });
    }

    const created = await createClickUpWebhook({
      endpoint: webhookUrl,
      events: [...EVENTS],
      listId: CLICKUP_CLIENTS_LIST_ID,
    });

    return NextResponse.json({
      ok: true,
      created: true,
      webhook: created,
      webhookUrl,
    });
  } catch (error) {
    console.error(
      "[aspire/register-clickup-webhook]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to register ClickUp webhook" },
      { status: 500 },
    );
  }
}
