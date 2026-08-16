import { NextRequest, NextResponse } from "next/server";

import { CLIENT_INTAKE_FORM_TEMPLATE_ID } from "../_shared/config";
import { findLatestCompletedIntakePacket, getFormPacket } from "../_shared/lobbie";
import {
  isAspireRequestAuthorized,
  processIntakePacket,
} from "../_shared/process";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    if (!isAspireRequestAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let packetId: number | undefined;
    try {
      const body = (await request.json()) as { packetId?: unknown };
      if (typeof body.packetId === "number") packetId = body.packetId;
      if (typeof body.packetId === "string" && body.packetId.trim()) {
        packetId = Number(body.packetId);
      }
    } catch {
      packetId = undefined;
    }

    const packet = packetId
      ? await getFormPacket(packetId)
      : await findLatestCompletedIntakePacket(CLIENT_INTAKE_FORM_TEMPLATE_ID);

    if (!packet) {
      return NextResponse.json(
        { error: "No completed Client Intake Form packet was found" },
        { status: 404 },
      );
    }

    const result = await processIntakePacket({
      packet,
      trigger: "manual",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[aspire/process-intake]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to process intake packet" },
      { status: 500 },
    );
  }
}
