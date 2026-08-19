import { NextRequest, NextResponse } from "next/server";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";
const DISTRIBUTION_TABLE_ID = "6925b0fb90de6fdfbd33e096";
const LINKED_CUSTOMERS_FIELD_ID = "sw5jjgei";

type SmartSuiteRecord = {
  id: string;
  title?: string;
  [key: string]: unknown;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asSmartSuiteRecord(value: unknown): SmartSuiteRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  return value as SmartSuiteRecord;
}

function asIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item) {
      ids.push(item);
      continue;
    }
    if (isRecord(item) && typeof item.id === "string" && item.id) {
      ids.push(item.id);
    }
  }
  return ids;
}

function extractDistributionId(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const nested = isRecord(body.body) ? body.body : null;
  const candidates = [
    body.recordId,
    body.distributionId,
    body.id,
    nested?.recordId,
    nested?.distributionId,
    nested?.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

async function smartSuiteFetch({
  apiKey,
  accountId,
  path,
  method,
  body,
}: {
  apiKey: string;
  accountId: string;
  path: string;
  method: "GET" | "PATCH";
  body?: unknown;
}): Promise<unknown> {
  const response = await fetch(`${SMARTSUITE_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Token ${apiKey}`,
      "ACCOUNT-ID": accountId,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `SmartSuite ${method} ${path} failed: ${response.status} ${text}`,
    );
  }

  return response.json();
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const recordId = extractDistributionId(payload);
    if (!recordId) {
      return NextResponse.json(
        { error: "Distribution id is required (recordId, distributionId, or id)" },
        { status: 400, headers: corsHeaders() },
      );
    }

    const apiKey = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_API_KEY");
    const accountId = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID");
    const path = `/applications/${DISTRIBUTION_TABLE_ID}/records/${recordId}/`;

    const before = asSmartSuiteRecord(
      await smartSuiteFetch({
        apiKey,
        accountId,
        method: "GET",
        path,
      }),
    );
    if (!before) {
      throw new Error(`Distribution ${recordId} was not a valid record`);
    }

    const linkedCountBefore = asIdArray(before[LINKED_CUSTOMERS_FIELD_ID]).length;

    const after = asSmartSuiteRecord(
      await smartSuiteFetch({
        apiKey,
        accountId,
        method: "PATCH",
        path,
        body: { [LINKED_CUSTOMERS_FIELD_ID]: [] },
      }),
    );
    if (!after) {
      throw new Error(`Patch of distribution ${recordId} did not return a record`);
    }

    const linkedCountAfter = asIdArray(after[LINKED_CUSTOMERS_FIELD_ID]).length;

    return NextResponse.json(
      {
        success: true,
        recordId,
        title: after.title ?? before.title ?? null,
        linkedCountBefore,
        linkedCountAfter,
        fieldCleared: linkedCountAfter === 0,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[TOMCHEI_SHABBOS] clear-delivery-list-field error:", error);
    return NextResponse.json(
      {
        error: "Failed to clear weekly delivery list",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
