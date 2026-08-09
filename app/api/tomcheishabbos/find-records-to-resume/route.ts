import { NextResponse } from "next/server";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";
const CUSTOMERS_TABLE_ID = "6925a5e5faf422df3f931169";

const PAUSE_UNTIL_FIELD_ID = "sf07be7c13";
const STATUS_FIELD_ID = "s816f4c4ee";
const STATUS_ACTIVE_VALUE_ID = "iczAx";

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

type SmartSuiteRecord = {
  id: string;
  [key: string]: unknown;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asSmartSuiteRecord(value: unknown): SmartSuiteRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  return value as SmartSuiteRecord;
}

async function findRecordsPausedUntilToday({
  apiKey,
  accountId,
  tableId,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
}): Promise<SmartSuiteRecord[]> {
  const limit = 1000;
  let offset = 0;
  const all: SmartSuiteRecord[] = [];

  while (true) {
    const response = await fetch(
      `${SMARTSUITE_API_BASE}/applications/${tableId}/records/list/`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": accountId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            operator: "and",
            fields: [
              {
                field: PAUSE_UNTIL_FIELD_ID,
                comparison: "is",
                value: {
                  date_mode: "today",
                },
              },
            ],
          },
          hydrated: false,
          limit,
          offset,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `SmartSuite list records failed: ${response.status} ${text}`,
      );
    }

    const data = (await response.json()) as SmartSuiteListResponse;
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const record = asSmartSuiteRecord(item);
      if (record) all.push(record);
    }

    if (items.length < limit) break;
    offset += limit;
  }

  return all;
}

async function setRecordStatusActive({
  apiKey,
  accountId,
  tableId,
  recordId,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
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
        [STATUS_FIELD_ID]: STATUS_ACTIVE_VALUE_ID,
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

async function resumePausedRecords() {
  const apiKey = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_API_KEY");
  const accountId = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID");

  const records = await findRecordsPausedUntilToday({
    apiKey,
    accountId,
    tableId: CUSTOMERS_TABLE_ID,
  });

  const updatedIds: string[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const record of records) {
    try {
      await setRecordStatusActive({
        apiKey,
        accountId,
        tableId: CUSTOMERS_TABLE_ID,
        recordId: record.id,
      });
      updatedIds.push(record.id);
    } catch (error) {
      errors.push({
        id: record.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    matched: records.length,
    updated: updatedIds.length,
    updatedIds,
    errors,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function GET() {
  try {
    const result = await resumePausedRecords();
    return NextResponse.json(
      {
        message:
          "Tomchei Shabbos records with Pause Until = today set to Active",
        ...result,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[TOMCHEI_SHABBOS] find-records-to-resume error:", error);
    return NextResponse.json(
      {
        error: "Failed to resume paused Tomchei Shabbos records",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}

export async function POST() {
  return GET();
}
