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
const PAUSE_FROM_FIELD_ID = "sbe3faea5e";
const PAUSE_UNTIL_FIELD_ID = "sf07be7c13";

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
export const maxDuration = 300;

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

function appOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = forwardedHost || request.headers.get("host");
  if (host) return `${forwardedProto}://${host.split(",")[0].trim()}`;
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }
  return request.nextUrl.origin;
}

async function callDeliveryListEndpoint({
  origin,
  distributionId,
}: {
  origin: string;
  distributionId: string;
}): Promise<unknown> {
  const password = requireEnv("TOMCHEI_SHABBOS_API_PASSWORD");
  const url = new URL("/api/tomcheishabbos/delivery-list", origin).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: distributionId, password }),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  if (!response.ok) {
    const details =
      typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`delivery-list failed: ${response.status} ${details}`);
  }
  return body;
}

function isYomTovDistribution(record: SmartSuiteRecord): boolean {
  return record[YOM_TOV_DISTRIBUTION_FIELD_ID] === true;
}

function toDateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return null;
  }
  if (isRecord(value) && value.date != null) {
    return toDateOnly(value.date);
  }
  return null;
}

function isPausedForPackageDate(
  customer: SmartSuiteRecord,
  packageDate: string | null,
): boolean {
  if (!packageDate) return false;
  const pauseFrom = toDateOnly(customer[PAUSE_FROM_FIELD_ID]);
  const pauseUntil = toDateOnly(customer[PAUSE_UNTIL_FIELD_ID]);
  if (!pauseFrom || !pauseUntil) return false;
  return pauseFrom <= packageDate && packageDate <= pauseUntil;
}

function excludePausedCustomers(
  customers: SmartSuiteRecord[],
  packageDate: string | null,
): { included: SmartSuiteRecord[]; excludedCount: number } {
  const included: SmartSuiteRecord[] = [];
  let excludedCount = 0;
  for (const customer of customers) {
    if (isPausedForPackageDate(customer, packageDate)) {
      excludedCount += 1;
      continue;
    }
    included.push(customer);
  }
  return { included, excludedCount };
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

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = `${error.message} ${error.cause ?? ""}`;
  return /EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|fetch failed|network/i.test(
    message,
  );
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
  const url = `${SMARTSUITE_API_BASE}${path}`;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Token ${apiKey}`,
          "ACCOUNT-ID": accountId,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      if (response.status === 429 || response.status >= 500) {
        const text = await response.text().catch(() => "");
        if (attempt < maxAttempts) {
          console.warn(
            `[TOMCHEI_SHABBOS] SmartSuite ${method} ${path} ${response.status}, retry ${attempt}/${maxAttempts}`,
          );
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(
          `SmartSuite ${method} ${path} failed: ${response.status} ${text}`,
        );
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `SmartSuite ${method} ${path} failed: ${response.status} ${text}`,
        );
      }

      return response.json();
    } catch (error) {
      if (attempt < maxAttempts && isRetryableFetchError(error)) {
        console.warn(
          `[TOMCHEI_SHABBOS] SmartSuite ${method} ${path} network error, retry ${attempt}/${maxAttempts}:`,
          error instanceof Error ? error.message : error,
        );
        await sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`SmartSuite ${method} ${path} failed after ${maxAttempts} attempts`);
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
    const packageDate = toDateOnly(distribution[DATE_FIELD_ID]);
    const existingIds = asIdArray(distribution[LINKED_CUSTOMERS_FIELD_ID]);

    const weeklyCustomers = await listAllRecords({
      apiKey,
      accountId,
      tableId: CUSTOMERS_TABLE_ID,
      filter: weeklyCustomerFilter(isYomTov),
    });
    const weeklyAfterPause = excludePausedCustomers(
      weeklyCustomers,
      packageDate,
    );
    const weeklyIds = weeklyAfterPause.included.map((customer) => customer.id);
    const afterWeeklyIds = weeklyIds;

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
    const biWeeklyAfterPause = excludePausedCustomers(
      biWeeklyCustomers,
      packageDate,
    );
    const biWeeklyIds = biWeeklyAfterPause.included.map(
      (customer) => customer.id,
    );
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

    await sleep(1000);
    const deliveryList = await callDeliveryListEndpoint({
      origin: appOrigin(request),
      distributionId: recordId,
    });

    return NextResponse.json(
      {
        success: true,
        recordId,
        title: distribution.title ?? null,
        isYomTovDistribution: isYomTov,
        packageDate,
        weeklyCustomersFound: weeklyIds.length,
        weeklyExcludedPaused: weeklyAfterPause.excludedCount,
        lastWeekRecordId: lastWeek?.id ?? null,
        lastWeekTitle: lastWeek?.title ?? null,
        biWeeklyCustomersFound: biWeeklyIds.length,
        biWeeklyExcludedPaused: biWeeklyAfterPause.excludedCount,
        biWeeklySkippedAlreadyOnLastWeek: biWeeklySkipped,
        biWeeklyAdded: biWeeklyToAdd.length,
        linkedCustomerCount,
        deliveryList,
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
