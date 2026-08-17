import { NextRequest, NextResponse } from "next/server";

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";

const DISTRIBUTION_TABLE_ID = "6925b0fb90de6fdfbd33e096";
const CUSTOMERS_TABLE_ID = "6925a5e5faf422df3f931169";

const FREQUENCY_FIELD_ID = "s0aed9fea2";
const FREQUENCY_WEEKLY_VALUE_ID = "Vv3V4";
const DATE_FIELD_ID = "sd97abd527";
const YOM_TOV_DISTRIBUTION_FIELD_ID = "sb34ac1f9c";
const LINKED_CUSTOMERS_FIELD_ID = "sw5jjgei";

const STATUS_FIELD_ID = "s816f4c4ee";
const STATUS_ACTIVE_VALUE_ID = "iczAx";
const STATUS_YOM_TOV_ONLY_VALUE_ID = "uC1em";
const PACKAGE_TYPE_FIELD_ID = "sa31ff4bb5";
const PACKAGE_TYPE_VALUE_IDS = ["JUOoZ", "H7PsX"];
const BIWEEKLY_FIELD_ID = "s2e2f18fd2";
const WEEKLY_EXCLUDE_FLAG_FIELD_ID = "sff7c2e6fd";

const LIST_PAGE_SIZE = 1000;

type SmartSuiteRecord = {
  id: string;
  title?: string;
  [key: string]: unknown;
};

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
};

type SmartSuiteFilter = {
  operator: "and";
  fields: Array<{
    field: string;
    comparison: string;
    value: unknown;
  }>;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const runtime = "nodejs";
export const maxDuration = 120;

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

function uniqueIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat())];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRecordId(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.recordId === "string" && body.recordId) return body.recordId;
  if (isRecord(body.body) && typeof body.body.recordId === "string") {
    return body.body.recordId || null;
  }
  return null;
}

function isYomTovDistribution(record: SmartSuiteRecord): boolean {
  return record[YOM_TOV_DISTRIBUTION_FIELD_ID] === true;
}

function weeklyCustomerFilter(isYomTov: boolean): SmartSuiteFilter {
  return {
    operator: "and",
    fields: [
      isYomTov
        ? {
            field: STATUS_FIELD_ID,
            comparison: "is_any_of",
            value: [STATUS_ACTIVE_VALUE_ID, STATUS_YOM_TOV_ONLY_VALUE_ID],
          }
        : {
            field: STATUS_FIELD_ID,
            comparison: "is",
            value: STATUS_ACTIVE_VALUE_ID,
          },
      {
        field: PACKAGE_TYPE_FIELD_ID,
        comparison: "has_any_of",
        value: PACKAGE_TYPE_VALUE_IDS,
      },
      {
        field: BIWEEKLY_FIELD_ID,
        comparison: "is",
        value: false,
      },
      {
        field: WEEKLY_EXCLUDE_FLAG_FIELD_ID,
        comparison: "is",
        value: false,
      },
    ],
  };
}

function biWeeklyCustomerFilter(): SmartSuiteFilter {
  return {
    operator: "and",
    fields: [
      {
        field: STATUS_FIELD_ID,
        comparison: "is",
        value: STATUS_ACTIVE_VALUE_ID,
      },
      {
        field: PACKAGE_TYPE_FIELD_ID,
        comparison: "has_any_of",
        value: PACKAGE_TYPE_VALUE_IDS,
      },
      {
        field: BIWEEKLY_FIELD_ID,
        comparison: "is",
        value: true,
      },
    ],
  };
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
  method: "GET" | "POST" | "PATCH";
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

async function getDistributionSchedule({
  apiKey,
  accountId,
  recordId,
}: {
  apiKey: string;
  accountId: string;
  recordId: string;
}): Promise<SmartSuiteRecord> {
  const data = await smartSuiteFetch({
    apiKey,
    accountId,
    method: "GET",
    path: `/applications/${DISTRIBUTION_TABLE_ID}/records/${recordId}/`,
  });
  const record = asSmartSuiteRecord(data);
  if (!record) {
    throw new Error(`Distribution schedule ${recordId} was not a valid record`);
  }
  return record;
}

async function listAllRecords({
  apiKey,
  accountId,
  tableId,
  filter,
  sort,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  filter: SmartSuiteFilter;
  sort?: Array<{ field: string; direction: "asc" | "desc" }>;
}): Promise<SmartSuiteRecord[]> {
  const all: SmartSuiteRecord[] = [];
  let offset = 0;

  while (true) {
    const data = (await smartSuiteFetch({
      apiKey,
      accountId,
      method: "POST",
      path: `/applications/${tableId}/records/list/`,
      body: {
        filter,
        sort,
        hydrated: false,
        limit: LIST_PAGE_SIZE,
        offset,
      },
    })) as SmartSuiteListResponse;

    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const record = asSmartSuiteRecord(item);
      if (record) all.push(record);
    }

    if (items.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }

  return all;
}

async function findLastWeeksPackage({
  apiKey,
  accountId,
  currentRecordId,
}: {
  apiKey: string;
  accountId: string;
  currentRecordId: string;
}): Promise<SmartSuiteRecord | null> {
  const data = (await smartSuiteFetch({
    apiKey,
    accountId,
    method: "POST",
    path: `/applications/${DISTRIBUTION_TABLE_ID}/records/list/`,
    body: {
      filter: {
        operator: "and",
        fields: [
          {
            field: FREQUENCY_FIELD_ID,
            comparison: "is",
            value: FREQUENCY_WEEKLY_VALUE_ID,
          },
          {
            field: DATE_FIELD_ID,
            comparison: "is_before",
            value: { date_mode: "today" },
          },
        ],
      },
      sort: [{ field: DATE_FIELD_ID, direction: "desc" }],
      hydrated: false,
      limit: 10,
      offset: 0,
    },
  })) as SmartSuiteListResponse;

  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    const record = asSmartSuiteRecord(item);
    if (record && record.id !== currentRecordId) return record;
  }
  return null;
}

async function patchLinkedCustomers({
  apiKey,
  accountId,
  recordId,
  customerIds,
}: {
  apiKey: string;
  accountId: string;
  recordId: string;
  customerIds: string[];
}): Promise<SmartSuiteRecord> {
  const data = await smartSuiteFetch({
    apiKey,
    accountId,
    method: "PATCH",
    path: `/applications/${DISTRIBUTION_TABLE_ID}/records/${recordId}/`,
    body: {
      [LINKED_CUSTOMERS_FIELD_ID]: customerIds,
    },
  });
  const record = asSmartSuiteRecord(data);
  if (!record) {
    throw new Error(`Patch of distribution ${recordId} did not return a record`);
  }
  return record;
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
    const recordId = extractRecordId(payload);
    if (!recordId) {
      return NextResponse.json(
        { error: "recordId is required" },
        { status: 400, headers: corsHeaders() },
      );
    }

    const apiKey = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_API_KEY");
    const accountId = requireEnv("TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID");

    const distribution = await getDistributionSchedule({
      apiKey,
      accountId,
      recordId,
    });
    const isYomTov = isYomTovDistribution(distribution);
    const existingIds = asIdArray(distribution[LINKED_CUSTOMERS_FIELD_ID]);

    const weeklyCustomers = await listAllRecords({
      apiKey,
      accountId,
      tableId: CUSTOMERS_TABLE_ID,
      filter: weeklyCustomerFilter(isYomTov),
    });
    const weeklyIds = weeklyCustomers.map((customer) => customer.id);
    const afterWeeklyIds = uniqueIds(existingIds, weeklyIds);

    await patchLinkedCustomers({
      apiKey,
      accountId,
      recordId,
      customerIds: afterWeeklyIds,
    });

    await sleep(1000);

    const lastWeek = await findLastWeeksPackage({
      apiKey,
      accountId,
      currentRecordId: recordId,
    });
    const lastWeekIds = asIdArray(lastWeek?.[LINKED_CUSTOMERS_FIELD_ID]);
    const lastWeekIdSet = new Set(lastWeekIds);

    const biWeeklyCustomers = await listAllRecords({
      apiKey,
      accountId,
      tableId: CUSTOMERS_TABLE_ID,
      filter: biWeeklyCustomerFilter(),
    });
    const biWeeklyIds = biWeeklyCustomers.map((customer) => customer.id);
    const biWeeklyToAdd = biWeeklyIds.filter((id) => !lastWeekIdSet.has(id));
    const biWeeklySkipped = biWeeklyIds.length - biWeeklyToAdd.length;

    let linkedCustomerCount = afterWeeklyIds.length;
    if (biWeeklyToAdd.length > 0) {
      let currentIds = afterWeeklyIds;
      for (const customerId of biWeeklyToAdd) {
        currentIds = uniqueIds(currentIds, [customerId]);
        await patchLinkedCustomers({
          apiKey,
          accountId,
          recordId,
          customerIds: currentIds,
        });
        await sleep(2000);
      }
      linkedCustomerCount = currentIds.length;
    }

    return NextResponse.json(
      {
        success: true,
        recordId,
        title: distribution.title ?? null,
        isYomTovDistribution: isYomTov,
        weeklyCustomersFound: weeklyIds.length,
        lastWeekRecordId: lastWeek?.id ?? null,
        lastWeekTitle: lastWeek?.title ?? null,
        biWeeklyCustomersFound: biWeeklyIds.length,
        biWeeklySkippedAlreadyOnLastWeek: biWeeklySkipped,
        biWeeklyAdded: biWeeklyToAdd.length,
        linkedCustomerCount,
      },
      { status: 200, headers: corsHeaders() },
    );
  } catch (error) {
    console.error("[TOMCHEI_SHABBOS] add-weekly-customers error:", error);
    return NextResponse.json(
      {
        error: "Failed to add weekly customers",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500, headers: corsHeaders() },
    );
  }
}
