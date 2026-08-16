import {
  CLICKUP_API_BASE,
  CLICKUP_CLIENTS_LIST_ID,
  CLICKUP_FIELDS,
  CLICKUP_GENDER_OPTIONS,
  CLICKUP_NEW_CLIENT_STATUS,
  CLICKUP_TEAM_ID,
  getClickUpToken,
} from "./config";
import type { FileRef, JsonObject, MappedIntake } from "./types";

export type ClickUpSyncResult = {
  taskId: string;
  taskUrl: string;
  created: boolean;
};

export type ClickUpDropdownOption = {
  id: string;
  name: string;
  orderindex?: number;
};

export type ClickUpTaskCustomField = {
  id: string;
  name?: string;
  type?: string;
  value?: unknown;
  type_config?: {
    options?: ClickUpDropdownOption[];
  };
};

export type ClickUpTask = {
  id: string;
  name: string;
  url?: string;
  status?: { status?: string };
  custom_fields?: ClickUpTaskCustomField[];
};

export type ClickUpWebhookRecord = {
  id: string;
  userid?: number;
  team_id?: string;
  endpoint: string;
  client_id?: string;
  events: string[];
  task_id?: string | null;
  list_id?: string | null;
  folder_id?: string | null;
  space_id?: string | null;
  health?: { status?: string };
  secret?: string;
};

type ClickUpCustomField = {
  id: string;
  value: unknown;
};

function clickUpHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: getClickUpToken(),
    Accept: "application/json",
    ...extra,
  };
}

async function clickUpJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(
    path.startsWith("http") ? path : `${CLICKUP_API_BASE}${path}`,
    {
      ...init,
      headers: clickUpHeaders({
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init.headers,
      }),
    },
  );

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 300) };
    }
  }

  if (!response.ok) {
    throw new Error(
      `ClickUp ${init.method || "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  return parsed as T;
}

export function parseDateToMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    const year = Number(us[3]);
    return Date.UTC(year, month - 1, day);
  }

  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return Date.UTC(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatPhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

export function genderOptionId(value: string): string | null {
  const key = value.trim().toLowerCase();
  return CLICKUP_GENDER_OPTIONS[key] ?? null;
}

async function geocodeAddress(address: string): Promise<{
  lat: number;
  lng: number;
  formatted_address: string;
} | null> {
  const query = address.trim();
  if (!query) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "TidyStack Aspire intake sync (https://tidystack-app.vercel.app)",
    },
  });
  if (!response.ok) return null;

  const results = (await response.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  const first = results[0];
  if (!first?.lat || !first?.lon) return null;

  return {
    lat: Number(first.lat),
    lng: Number(first.lon),
    formatted_address: first.display_name || query,
  };
}

function pushText(
  fields: ClickUpCustomField[],
  id: string,
  value: string,
): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  fields.push({ id, value: trimmed });
}

async function buildCustomFields(
  mapped: MappedIntake,
  patientId: number,
  options: { includeDateAdded: boolean },
): Promise<ClickUpCustomField[]> {
  const fields: ClickUpCustomField[] = [];

  pushText(fields, CLICKUP_FIELDS.clientFirstName, mapped.clientFirstName);
  pushText(fields, CLICKUP_FIELDS.clientLastName, mapped.clientLastName);
  pushText(fields, CLICKUP_FIELDS.insurance, mapped.insurance);
  pushText(fields, CLICKUP_FIELDS.memberId, mapped.memberId);
  pushText(fields, CLICKUP_FIELDS.guardian1FirstName, mapped.guardian1FirstName);
  pushText(fields, CLICKUP_FIELDS.guardian1LastName, mapped.guardian1LastName);
  pushText(fields, CLICKUP_FIELDS.guardian2FirstName, mapped.guardian2FirstName);
  pushText(fields, CLICKUP_FIELDS.guardian2LastName, mapped.guardian2LastName);
  pushText(fields, CLICKUP_FIELDS.emergencyContact, mapped.emergencyContact);
  pushText(
    fields,
    CLICKUP_FIELDS.primaryCarePhysician,
    mapped.primaryCarePhysician,
  );
  fields.push({ id: CLICKUP_FIELDS.lobbiePatientId, value: String(patientId) });

  if (mapped.guardian1Email.includes("@")) {
    fields.push({ id: CLICKUP_FIELDS.guardian1Email, value: mapped.guardian1Email });
  }
  if (mapped.guardian2Email.includes("@")) {
    fields.push({ id: CLICKUP_FIELDS.guardian2Email, value: mapped.guardian2Email });
  }

  const guardian1Phone = formatPhone(mapped.guardian1CellPhone);
  if (guardian1Phone) {
    fields.push({ id: CLICKUP_FIELDS.guardian1CellPhone, value: guardian1Phone });
  }
  const guardian2Phone = formatPhone(mapped.guardian2CellPhone);
  if (guardian2Phone) {
    fields.push({ id: CLICKUP_FIELDS.guardian2CellPhone, value: guardian2Phone });
  }
  const pcpPhone = formatPhone(mapped.pcpPhone);
  if (pcpPhone) {
    fields.push({ id: CLICKUP_FIELDS.pcpPhone, value: pcpPhone });
  }

  const dob = parseDateToMs(mapped.dateOfBirth);
  if (dob != null) {
    fields.push({ id: CLICKUP_FIELDS.dateOfBirth, value: dob });
  }

  const genderId = genderOptionId(mapped.gender);
  if (genderId) {
    fields.push({ id: CLICKUP_FIELDS.gender, value: genderId });
  }

  if (options.includeDateAdded) {
    fields.push({ id: CLICKUP_FIELDS.dateAdded, value: Date.now() });
  }

  const geo = await geocodeAddress(mapped.address);
  if (geo) {
    fields.push({
      id: CLICKUP_FIELDS.address,
      value: {
        location: { lat: geo.lat, lng: geo.lng },
        formatted_address: mapped.address || geo.formatted_address,
      },
    });
  }

  return fields;
}

async function findTaskByLobbiePatientId(
  patientId: number,
): Promise<string | null> {
  const customFields = encodeURIComponent(
    JSON.stringify([
      {
        field_id: CLICKUP_FIELDS.lobbiePatientId,
        operator: "=",
        value: String(patientId),
      },
    ]),
  );
  const result = await clickUpJson<{ tasks?: Array<{ id: string }> }>(
    `/team/${CLICKUP_TEAM_ID}/task?list_ids[]=${CLICKUP_CLIENTS_LIST_ID}&include_closed=true&custom_fields=${customFields}`,
  );
  return result.tasks?.[0]?.id ?? null;
}

async function setCustomFields(
  taskId: string,
  fields: ClickUpCustomField[],
): Promise<void> {
  for (const field of fields) {
    await setClickUpCustomField(taskId, field.id, field.value);
  }
}

export async function setClickUpCustomField(
  taskId: string,
  fieldId: string,
  value: unknown,
  valueOptions?: { time?: boolean },
): Promise<void> {
  await clickUpJson(`/task/${encodeURIComponent(taskId)}/field/${fieldId}`, {
    method: "POST",
    body: JSON.stringify(
      valueOptions ? { value, value_options: valueOptions } : { value },
    ),
  });
}

export async function listClickUpListFields(): Promise<
  Array<{ id: string; name: string; type: string }>
> {
  const result = await clickUpJson<{
    fields?: Array<{ id: string; name: string; type: string }>;
  }>(`/list/${CLICKUP_CLIENTS_LIST_ID}/field`);
  return result.fields ?? [];
}

export async function createClickUpListField(input: {
  name: string;
  type: string;
}): Promise<{ id: string; name: string; type: string }> {
  const result = await clickUpJson<{
    id?: string;
    name?: string;
    type?: string;
    field?: { id?: string; name?: string; type?: string };
  }>(`/list/${CLICKUP_CLIENTS_LIST_ID}/field`, {
    method: "POST",
    body: JSON.stringify({ name: input.name, type: input.type }),
  });
  const field = result.field ?? result;
  if (!field.id) {
    throw new Error(`ClickUp did not return an id for field "${input.name}"`);
  }
  return {
    id: field.id,
    name: field.name || input.name,
    type: field.type || input.type,
  };
}

export async function searchClickUpListTasks(input: {
  customFields?: Array<{
    field_id: string;
    operator: string;
    value: string | number;
  }>;
  statuses?: string[];
  includeClosed?: boolean;
}): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  for (let page = 0; page < 50; page += 1) {
    const params = new URLSearchParams();
    params.set("list_ids[]", CLICKUP_CLIENTS_LIST_ID);
    params.set("page", String(page));
    params.set("include_closed", input.includeClosed ? "true" : "false");
    if (input.customFields?.length) {
      params.set("custom_fields", JSON.stringify(input.customFields));
    }
    if (input.statuses?.length) {
      for (const status of input.statuses) {
        params.append("statuses[]", status);
      }
    }
    const result = await clickUpJson<{
      tasks?: ClickUpTask[];
      last_page?: boolean;
    }>(`/team/${CLICKUP_TEAM_ID}/task?${params.toString()}`);
    tasks.push(...(result.tasks ?? []));
    if (result.last_page || (result.tasks?.length ?? 0) < 100) break;
  }
  return tasks;
}

async function attachFile(
  taskId: string,
  _file: FileRef,
  bytes: Uint8Array,
  filename: string,
): Promise<string | null> {
  const form = new FormData();
  const payload = new Uint8Array(bytes);
  form.append(
    "attachment",
    new Blob([payload.buffer as ArrayBuffer], {
      type: "application/octet-stream",
    }),
    filename,
  );

  const result = await clickUpJson<{ url?: string }>(
    `/task/${taskId}/attachment`,
    { method: "POST", body: form },
  );
  return typeof result.url === "string" ? result.url : null;
}

export async function getClickUpTask(taskId: string): Promise<ClickUpTask> {
  return clickUpJson<ClickUpTask>(`/task/${encodeURIComponent(taskId)}`);
}

export async function listClickUpWebhooks(): Promise<ClickUpWebhookRecord[]> {
  const result = await clickUpJson<{ webhooks?: ClickUpWebhookRecord[] }>(
    `/team/${CLICKUP_TEAM_ID}/webhook`,
  );
  return result.webhooks ?? [];
}

export async function createClickUpWebhook(input: {
  endpoint: string;
  events: string[];
  listId: string;
}): Promise<ClickUpWebhookRecord> {
  const result = await clickUpJson<{ webhook?: ClickUpWebhookRecord } & ClickUpWebhookRecord>(
    `/team/${CLICKUP_TEAM_ID}/webhook`,
    {
      method: "POST",
      body: JSON.stringify({
        endpoint: input.endpoint,
        events: input.events,
        list_id: input.listId,
      }),
    },
  );
  return result.webhook ?? result;
}

export async function upsertClickUpClient(input: {
  mapped: MappedIntake;
  patientId: number;
  files?: Array<{ file: FileRef; bytes: Uint8Array; filename: string }>;
}): Promise<ClickUpSyncResult> {
  const existingId = await findTaskByLobbiePatientId(input.patientId);
  const name =
    `${input.mapped.clientFirstName} ${input.mapped.clientLastName}`.trim() ||
    `Client ${input.patientId}`;

  if (existingId) {
    const fields = await buildCustomFields(input.mapped, input.patientId, {
      includeDateAdded: false,
    });
    await clickUpJson(`/task/${existingId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
    await setCustomFields(existingId, fields);
    await attachIntakeFiles(existingId, input.files ?? [], input.mapped);
    return {
      taskId: existingId,
      taskUrl: `https://app.clickup.com/t/${existingId}`,
      created: false,
    };
  }

  const fields = await buildCustomFields(input.mapped, input.patientId, {
    includeDateAdded: true,
  });
  const created = await clickUpJson<{ id: string }>(
    `/list/${CLICKUP_CLIENTS_LIST_ID}/task`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        status: CLICKUP_NEW_CLIENT_STATUS,
        custom_fields: fields,
      }),
    },
  );

  await attachIntakeFiles(created.id, input.files ?? [], input.mapped);
  return {
    taskId: created.id,
    taskUrl: `https://app.clickup.com/t/${created.id}`,
    created: true,
  };
}

async function attachIntakeFiles(
  taskId: string,
  files: Array<{ file: FileRef; bytes: Uint8Array; filename: string }>,
  mapped: MappedIntake,
): Promise<void> {
  let frontUrl: string | null = null;
  let backUrl: string | null = null;

  for (const item of files) {
    const url = await attachFile(taskId, item.file, item.bytes, item.filename);
    if (mapped.insuranceCardFront && item.file.path === mapped.insuranceCardFront.path) {
      frontUrl = url;
    }
    if (mapped.insuranceCardBack && item.file.path === mapped.insuranceCardBack.path) {
      backUrl = url;
    }
  }

  if (frontUrl) {
    await clickUpJson(`/task/${taskId}/field/${CLICKUP_FIELDS.insuranceCardFront}`, {
      method: "POST",
      body: JSON.stringify({ value: frontUrl }),
    });
  }
  if (backUrl) {
    await clickUpJson(`/task/${taskId}/field/${CLICKUP_FIELDS.insuranceCardBack}`, {
      method: "POST",
      body: JSON.stringify({ value: backUrl }),
    });
  }
}

export type { JsonObject };
