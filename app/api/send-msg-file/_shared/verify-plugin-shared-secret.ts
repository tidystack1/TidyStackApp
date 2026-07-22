import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export function verifyPluginSharedSecret(provided: unknown): boolean {
  const expected = process.env.PLUGIN_SHARED_SECRET;
  if (!expected || typeof provided !== "string" || !provided.trim()) {
    return false;
  }

  const providedHash = createHash("sha256").update(provided, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function pluginUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
