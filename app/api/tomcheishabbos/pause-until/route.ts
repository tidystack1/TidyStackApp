import { NextRequest, NextResponse } from "next/server";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";
const CUSTOMERS_TABLE_ID = "6925a5e5faf422df3f931169";
const PAUSE_UNTIL_FIELD_ID = "sf07be7c13";
const STATUS_FIELD_ID = "s816f4c4ee";
const STATUS_PAUSED_VALUE_ID = "UJdvw";

const PAUSE_TYPES = ["6-weeks", "rosh-hashana"] as const;
type PauseType = (typeof PAUSE_TYPES)[number];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isPauseType(value: unknown): value is PauseType {
  return typeof value === "string" && PAUSE_TYPES.includes(value as PauseType);
}

function formatDateOnlyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addWeeksFromToday(weeks: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return formatDateOnlyUtc(date);
}

async function getNextRoshHashanaDate(): Promise<string> {
  const today = formatDateOnlyUtc(new Date());
  const response = await fetch(
    "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&year=now&ny=2",
    { method: "GET" },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Hebcal request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    items?: Array<{ title?: string; date?: string }>;
  };
  const items = Array.isArray(data.items) ? data.items : [];

  const candidates = items
    .filter(
      (item) =>
        typeof item.title === "string" &&
        /^Rosh Hashana \d+$/.test(item.title) &&
        typeof item.date === "string" &&
        /^\d{4}-\d{2}-\d{2}/.test(item.date),
    )
    .map((item) => item.date!.slice(0, 10))
    .filter((date) => date >= today)
    .sort();

  if (candidates.length === 0) {
    throw new Error("Could not find next Rosh Hashana date from Hebcal");
  }

  return candidates[0];
}

async function resolvePauseUntilDate(type: PauseType): Promise<string> {
  if (type === "6-weeks") return addWeeksFromToday(6);
  return getNextRoshHashanaDate();
}

async function setPauseUntil({
  apiKey,
  accountId,
  tableId,
  recordId,
  pauseUntilDate,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  pauseUntilDate: string;
}) {
  const response = await fetch(
    `${SMARTSUITE_API_BASE}/applications/${tableId}/records/${recordId}/`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        [PAUSE_UNTIL_FIELD_ID]: {
          date: `${pauseUntilDate}T00:00:00.000Z`,
          include_time: false,
        },
        [STATUS_FIELD_ID]: STATUS_PAUSED_VALUE_ID,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `SmartSuite record update failed (${recordId}): ${response.status} ${text}`,
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as unknown;
    const id =
      body && typeof body === "object" && "id" in body
        ? (body as { id?: unknown }).id
        : undefined;
    const type =
      body && typeof body === "object" && "type" in body
        ? (body as { type?: unknown }).type
        : undefined;

    if (typeof id !== "string" || !id.trim()) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (!isPauseType(type)) {
      return NextResponse.json(
        { error: "type must be '6-weeks' or 'rosh-hashana'" },
        { status: 400, headers: corsHeaders() },
      );
    }

    const pauseUntilDate = await resolvePauseUntilDate(type);
    const apiKey = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_API_KEY");
    const accountId = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID");

    await setPauseUntil({
      apiKey,
      accountId,
      tableId: CUSTOMERS_TABLE_ID,
      recordId: id.trim(),
      pauseUntilDate,
    });

    return NextResponse.json(
      {
        message: "Tomchei Shabbos customer pause until updated",
        id: id.trim(),
        type,
        pauseUntil: pauseUntilDate,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[TOMCHEI_SHABBOS] pause-until error:", error);
    return NextResponse.json(
      {
        error: "Failed to set pause until on Tomchei Shabbos record",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
