import { FORWARD_WEBHOOK_URL } from "./config";
import type { JsonObject } from "./types";

export async function forwardToWebhookSite(payload: JsonObject): Promise<{
  status: number;
  webhookSiteId: string | null;
}> {
  const response = await fetch(FORWARD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `webhook.site forward failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }

  return {
    status: response.status,
    webhookSiteId: response.headers.get("x-request-id"),
  };
}
