import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const SMARTSUITE_API_BASE = "https://app.smartsuite.com/api/v1";
const APPOINTMENT_TABLE_ID = "6a6a3f6a3c3aa17a567626e0";
const SHADCHAN_TABLE_ID = "69fb65b846b5f5c3bc8584c0";
const TIME_ZONE = "America/New_York";

const APPOINTMENT = {
  title: "title",
  firstName: "sf57a9f76d",
  lastName: "s460d01cb1",
  meetingSelf: "s102d32879",
  contactName: "s565c908c6",
  contactPhone: "se68e36043",
  contactEmail: "sbb8d0aa1c",
  birthday: "se4658fd58",
  gender: "s01d2be5d7",
  height: "s1ff5221c5",
  relationship: "s86c4eb5e3",
  longTermPlan: "s5856fbff6",
  bio: "s3b2f922ba",
  resume: "s23cadef71",
  photo: "sd52564d0f",
  suggestions: "s7d62cbcbc",
  musts: "s79a91a15a",
  changes: "s4a6252eae",
  appointmentDate: "sca0983f26",
  appointmentType: "s819cdbc46",
  bookerName: "sab84707ef",
  bookerPhone: "sa8de655b7",
  bookerEmail: "s16fdc86f5",
  singleLink: "sd5pa5y8",
  shadchanLink: "sxht2aid",
  shadchanText: "s35beca45f",
} as const;

const SINGLES = {
  name: "singles_name",
  contactName: "singles_parent_name",
  contactPhone: "singles_parent_cell",
  email: "se815f0de2",
  birthday: "s4b6358f05",
  gender: "sefce01069",
  height: "singles_height",
  longTermPlan: "partner_category_type",
  bio: "sc08pj7o",
  resume: "s1b4e8cd45",
  photo: "s6390874a0",
  relationship: "s1671a52ee",
} as const;

const SHADCHAN_NAME_FIELD = "s136335e0e";

const SINGLES_GENDER_CHOICES: Array<{ value: string; label: string }> = [
  { value: "1JeIi", label: "Male" },
  { value: "8z5np", label: "Female" },
];

const SINGLES_HEIGHT_CHOICES: Array<{ value: string; label: string }> = [
  { value: "osecK", label: "4 feet 10 inches and under" },
  { value: "3SFDi", label: "4 feet 11 inches" },
  { value: "Under 5 feet", label: "5 feet" },
  { value: "5 feet 1 inch", label: "5 feet 1 inch" },
  { value: "5 feet 2 inches", label: "5 feet 2 inches" },
  { value: "5 feet 3 inches", label: "5 feet 3 inches" },
  { value: "5 feet 4 inches", label: "5 feet 4 inches" },
  { value: "5 feet 5 inches", label: "5 feet 5 inches" },
  { value: "5 feet 6 inches", label: "5 feet 6 inches" },
  { value: "5 feet 7 inches", label: "5 feet 7 inches" },
  { value: "5 feet 8 inches", label: "5 feet 8 inches" },
  { value: "5 feet 9 inches", label: "5 feet 9 inches" },
  { value: "5 feet 10 inches", label: "5 feet 10 inches" },
  { value: "5 feet 11 inches", label: "5 feet 11 inches" },
  { value: "6 feet 0 inches", label: "6 feet" },
  { value: "1U8uY", label: "6' +" },
];

const SINGLES_LONG_TERM_PLAN_CHOICES: Array<{ value: string; label: string }> = [
  { value: "Long Term Learner (4+ years)", label: "Long-Term Learner/Klei Kodesh" },
  { value: "Long Term Learner (5+ years)", label: "Long Term Learner (5+ years)" },
  { value: "Short Term Learner (1-3 years)", label: "Short Term Learner (1-3 years)" },
  {
    value: "Learner/Earner (Half Day Learning and Half Day Working)",
    label: "Learner/Earner",
  },
  { value: "Full Time Working/Kovea Itim", label: "Full Time Working/Kovya Itim" },
  { value: "3XxLI", label: "Flexible" },
  { value: "EHz8N", label: "Learner (3-5 Years)" },
];

const SINGLES_RELATIONSHIP_CHOICES: Array<{ value: string; label: string }> = [
  { value: "C4rLY", label: "Self" },
  { value: "hRId3", label: "Mother" },
  { value: "nftMf", label: "Father" },
  { value: "OTHER_VALUE", label: "Other" },
];

type SmartSuiteListResponse = {
  items?: unknown[];
  total?: number;
};

type DownloadedFile = {
  filename: string;
  contentType: string;
  data: Buffer;
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function nonempty(value: unknown): string | undefined {
  const s = text(value);
  return s.length ? s : undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (trimmed[0] !== "{" && trimmed[0] !== "[") return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractBooking(body: unknown): Record<string, unknown> {
  let current: unknown = body;
  for (let i = 0; i < 4; i++) {
    current = parseMaybeJson(current);
    if (!isRecord(current)) break;
    const nested =
      typeof current.payload === "string" || isRecord(current.payload)
        ? current.payload
        : typeof current.data === "string" || isRecord(current.data)
          ? current.data
          : undefined;
    if (nested === undefined) break;
    const parent = current;
    const parsed = parseMaybeJson(nested);
    if (!isRecord(parsed)) {
      current = nested;
      continue;
    }
    const merged: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parent)) {
      if (key === "payload" || key === "data") continue;
      merged[key] = value;
    }
    Object.assign(merged, parsed);
    current = merged;
  }
  current = parseMaybeJson(current);
  if (!isRecord(current)) {
    throw new Error("Request body did not contain a booking object");
  }
  return current;
}

function splitName(value: unknown): { first: string; last: string } {
  if (isRecord(value)) {
    const first = text(value.first_name);
    const last = text(value.last_name);
    if (first || last) return { first, last };
    return splitName(value.sys_root ?? value.display_value ?? "");
  }
  const full = text(value);
  if (!full) return { first: "", last: "" };
  const parts = full.split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/kovya/g, "kovea")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function matchChoice(
  raw: unknown,
  choices: Array<{ value: string; label: string }>,
): string | undefined {
  const input = nonempty(raw);
  if (!input) return undefined;
  const folded = fold(input);
  const exact = choices.find(
    (c) => fold(c.value) === folded || fold(c.label) === folded,
  );
  if (exact) return exact.value;
  const contains = choices.find(
    (c) => fold(c.label).includes(folded) || folded.includes(fold(c.label)),
  );
  return contains?.value;
}

function fullNamePayload(first?: string, last?: string) {
  if (!first && !last) return undefined;
  return {
    first_name: first ?? "",
    last_name: last ?? "",
  };
}

function phonePayload(raw: unknown) {
  const value = nonempty(raw);
  if (!value) return undefined;
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) return undefined;
  return [
    {
      phone_number: digits,
      phone_country: "US",
      phone_type: 1,
    },
  ];
}

function emailPayload(raw: unknown) {
  const value = nonempty(raw);
  if (!value || !value.includes("@")) return undefined;
  return [value.toLowerCase()];
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function naiveInTimeZoneToIso(naive: string, timeZone: string): string {
  const isoLocal = naive.includes("T") ? naive : naive.replace(" ", "T");
  const [datePart, timePart = "00:00:00"] = isoLocal.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart.split(":").map((part) => Number(part) || 0);

  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const asTz = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    utc += desired - asTz;
  }
  return new Date(utc).toISOString();
}

function datePayload(raw: unknown, includeTime: boolean) {
  const value = nonempty(raw);
  if (!value) return undefined;
  if (!includeTime || isDateOnly(value)) {
    const dateOnly = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return undefined;
    return { date: `${dateOnly}T00:00:00.000Z`, include_time: false };
  }
  return {
    date: naiveInTimeZoneToIso(value, TIME_ZONE),
    include_time: true,
  };
}

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) {
    if ("date" in value) return isBlank(value.date);
    if ("first_name" in value || "last_name" in value) {
      return !text(value.first_name) && !text(value.last_name);
    }
    if ("phone_number" in value) return !text(value.phone_number);
    if ("email_address" in value || "email" in value) {
      return !text(value.email_address ?? value.email);
    }
    if ("sys_root" in value) return isBlank(value.sys_root);
    return Object.keys(value).length === 0;
  }
  return false;
}

function pickBlanks(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return incoming;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (isBlank(existing[key])) out[key] = value;
  }
  return out;
}

function meetingSelfValue(booking: Record<string, unknown>): string | undefined {
  const explicit = nonempty(booking.meeting_self);
  if (explicit) return explicit;
  const service = text(booking.service_name).toLowerCase();
  if (service.includes("someone else") || service.includes("on behalf")) return "No";
  const relationship = text(booking.relationship).toLowerCase();
  if (relationship === "self") return "Yes";
  return undefined;
}

function birthdayValue(booking: Record<string, unknown>): string | undefined {
  return nonempty(booking.birthday_single) ?? nonempty(booking.birthday_self);
}

const SUGGESTIONS_FIELD_LABEL =
  "Please include the names of the individuals in an effort to allow the shadchanim to make the most of your time. :";

const SUGGESTIONS_ALIASES = new Set([
  "suggestions",
  "namesofsuggestions",
  "suggestionnames",
]);

const SUGGESTIONS_NEEDLES = [
  fold(SUGGESTIONS_FIELD_LABEL),
  "pleaseincludethenamesoftheindividuals",
  "shadchanimtomakethemostofyourtime",
];

function fieldText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => fieldText(item))
      .filter((part): part is string => Boolean(part));
    return parts.length ? parts.join(", ") : undefined;
  }
  if (isRecord(value)) {
    return (
      nonempty(value.value) ??
      nonempty(value.display_value) ??
      nonempty(value.sys_root) ??
      nonempty(value.text) ??
      nonempty(value.answer)
    );
  }
  return nonempty(value);
}

function isSuggestionsLabel(label: string): boolean {
  const folded = fold(label);
  if (!folded) return false;
  if (SUGGESTIONS_ALIASES.has(folded)) return true;
  return SUGGESTIONS_NEEDLES.some((needle) => folded === needle || folded.includes(needle));
}

function* fieldCandidates(
  booking: Record<string, unknown>,
): Generator<{ label: string; value: unknown }> {
  for (const [key, value] of Object.entries(booking)) {
    yield { label: key, value };
  }
  const collections = [
    booking.additional_fields,
    booking.additionalFields,
    booking.intake_fields,
    booking.intakeFields,
    booking.custom_fields,
    booking.customFields,
    booking.fields,
  ];
  for (const collection of collections) {
    if (Array.isArray(collection)) {
      for (const item of collection) {
        if (!isRecord(item)) continue;
        const label = text(
          item.name ?? item.field_name ?? item.title ?? item.label ?? item.field ?? item.id,
        );
        yield { label, value: item.value ?? item };
      }
    } else if (isRecord(collection)) {
      for (const [key, value] of Object.entries(collection)) {
        if (isRecord(value)) {
          const label = text(value.name ?? value.field_name ?? value.title ?? value.label ?? key);
          yield { label, value: value.value ?? value };
        } else {
          yield { label: key, value };
        }
      }
    }
  }
}

function suggestionsMatch(booking: Record<string, unknown>): {
  value?: string;
  label?: string;
} {
  const directKeys = ["Suggestions", "suggestions"] as const;
  for (const key of directKeys) {
    const extracted = fieldText(booking[key]);
    if (extracted) return { value: extracted, label: key };
  }
  for (const { label, value } of fieldCandidates(booking)) {
    if (!isSuggestionsLabel(label)) continue;
    const extracted = fieldText(value);
    if (extracted) return { value: extracted, label };
  }
  return {};
}

function suggestionsValue(booking: Record<string, unknown>): string | undefined {
  return suggestionsMatch(booking).value;
}

function cleanProviderName(raw: unknown): string {
  const full = text(raw).replace(/\s+/g, " ");
  if (!full) return "";
  return full.split(",")[0]?.trim() ?? full;
}

function mimeFromName(filename: string, fallback = "application/octet-stream"): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return fallback;
  }
}

function smartSuiteHeaders(apiKey: string, accountId: string, json = true) {
  const headers: Record<string, string> = {
    Authorization: `Token ${apiKey}`,
    "ACCOUNT-ID": accountId,
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function smartSuiteJson<T>({
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
}): Promise<T> {
  const response = await fetch(`${SMARTSUITE_API_BASE}${path}`, {
    method,
    headers: smartSuiteHeaders(apiKey, accountId),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textBody = await response.text();
  let parsed: unknown = textBody;
  try {
    parsed = textBody ? JSON.parse(textBody) : null;
  } catch {
    // keep raw text
  }
  if (!response.ok) {
    throw new Error(
      `SmartSuite ${method} ${path} failed: ${response.status} ${textBody.slice(0, 2000)}`,
    );
  }
  return parsed as T;
}

async function listRecords({
  apiKey,
  accountId,
  tableId,
  filter,
  limit = 50,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  filter: unknown;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const data = await smartSuiteJson<SmartSuiteListResponse>({
    apiKey,
    accountId,
    path: `/applications/${tableId}/records/list/?offset=0&limit=${limit}`,
    method: "POST",
    body: {
      filter,
      hydrated: true,
      limit,
      offset: 0,
    },
  });
  return (data.items ?? []).filter(isRecord);
}

async function createRecord({
  apiKey,
  accountId,
  tableId,
  fields,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  fields: Record<string, unknown>;
}): Promise<string> {
  const record = await smartSuiteJson<{ id?: string }>({
    apiKey,
    accountId,
    path: `/applications/${tableId}/records/`,
    method: "POST",
    body: fields,
  });
  if (!record?.id) throw new Error(`SmartSuite create on ${tableId} returned no id`);
  return record.id;
}

async function updateRecord({
  apiKey,
  accountId,
  tableId,
  recordId,
  fields,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
}): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  await smartSuiteJson({
    apiKey,
    accountId,
    path: `/applications/${tableId}/records/${recordId}/`,
    method: "PATCH",
    body: fields,
  });
}

async function uploadFile({
  apiKey,
  accountId,
  tableId,
  recordId,
  fieldId,
  file,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
  file: DownloadedFile;
}): Promise<void> {
  const formData = new FormData();
  formData.append(
    "files",
    new Blob([new Uint8Array(file.data)], { type: file.contentType }),
    file.filename,
  );
  formData.append("filename", file.filename);

  const response = await fetch(
    `${SMARTSUITE_API_BASE}/recordfiles/${tableId}/${recordId}/${fieldId}/`,
    {
      method: "POST",
      headers: smartSuiteHeaders(apiKey, accountId, false),
      body: formData,
    },
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite file upload failed (${fieldId}): ${response.status} ${errorText.slice(0, 1000)}`,
    );
  }
}

function driveDownloadUrl(url: string): string[] {
  const urls = [url];
  try {
    const parsed = new URL(url);
    const id =
      parsed.searchParams.get("id") ??
      parsed.pathname.match(/\/d\/([^/]+)/)?.[1];
    if (id) {
      urls.push(`https://drive.google.com/uc?export=download&id=${id}&confirm=t`);
    } else if (!parsed.searchParams.has("confirm")) {
      parsed.searchParams.set("confirm", "t");
      urls.push(parsed.toString());
    }
  } catch {
    // keep original
  }
  return [...new Set(urls)];
}

async function downloadFile(url: string, filename: string): Promise<DownloadedFile> {
  let lastError: Error | undefined;
  for (const candidate of driveDownloadUrl(url)) {
    try {
      const response = await fetch(candidate, { redirect: "follow" });
      if (!response.ok) {
        lastError = new Error(`Download failed ${response.status} for ${filename}`);
        continue;
      }
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length) {
        lastError = new Error(`Empty download for ${filename}`);
        continue;
      }
      if (contentType.includes("text/html")) {
        lastError = new Error(`Google Drive returned HTML instead of a file for ${filename}`);
        continue;
      }
      return {
        filename,
        contentType: mimeFromName(filename, contentType || "application/octet-stream"),
        data,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error(`Could not download ${filename}`);
}

async function maybeDownload(
  url: unknown,
  name: unknown,
  fallbackName: string,
): Promise<DownloadedFile | undefined> {
  const fileUrl = nonempty(url);
  if (!fileUrl) return undefined;
  const filename = nonempty(name) ?? fallbackName;
  return downloadFile(fileUrl, filename);
}

function recordHasFiles(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function namesMatch(
  record: Record<string, unknown>,
  first: string,
  last: string,
  nameField: string,
): boolean {
  const { first: recFirst, last: recLast } = splitName(record[nameField] ?? record.title);
  return fold(recFirst) === fold(first) && fold(recLast) === fold(last);
}

async function findSingleId({
  apiKey,
  accountId,
  tableId,
  first,
  last,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  first: string;
  last: string;
}): Promise<Record<string, unknown> | undefined> {
  if (!first && !last) return undefined;
  const fields = [];
  if (last) {
    fields.push({
      comparison: "contains",
      field: SINGLES.name,
      value: last,
    });
  } else if (first) {
    fields.push({
      comparison: "contains",
      field: SINGLES.name,
      value: first,
    });
  }
  const items = await listRecords({
    apiKey,
    accountId,
    tableId,
    filter: { operator: "and", fields },
    limit: 50,
  });
  return items.find((item) => namesMatch(item, first, last, SINGLES.name));
}

async function findShadchanId({
  apiKey,
  accountId,
  providerName,
}: {
  apiKey: string;
  accountId: string;
  providerName: string;
}): Promise<string | undefined> {
  const cleaned = cleanProviderName(providerName);
  if (!cleaned) return undefined;
  const { first, last } = splitName(cleaned);
  const items = await listRecords({
    apiKey,
    accountId,
    tableId: SHADCHAN_TABLE_ID,
    filter: { operator: "and", fields: [] },
    limit: 200,
  });
  const match = items.find((item) => {
    if (namesMatch(item, first, last, SHADCHAN_NAME_FIELD)) return true;
    const title = fold(text(item.title));
    return title.length > 0 && title === fold(cleaned);
  });
  return match && typeof match.id === "string" ? match.id : undefined;
}

function singlesIncomingFields(booking: Record<string, unknown>) {
  const first = nonempty(booking.first_name);
  const last = nonempty(booking.last_name);
  const contact = splitName(booking.contact_name);
  const gender = matchChoice(booking.gender, SINGLES_GENDER_CHOICES);
  const height = matchChoice(booking.height, SINGLES_HEIGHT_CHOICES);
  const longTermPlan = matchChoice(booking.long_term_plan, SINGLES_LONG_TERM_PLAN_CHOICES);
  const relationship =
    matchChoice(booking.relationship, SINGLES_RELATIONSHIP_CHOICES) ??
    (nonempty(booking.relationship) ? "OTHER_VALUE" : undefined);

  const fields: Record<string, unknown> = {};
  const name = fullNamePayload(first, last);
  if (name) fields[SINGLES.name] = name;
  const contactName = fullNamePayload(contact.first, contact.last);
  if (contactName) fields[SINGLES.contactName] = contactName;
  const contactPhone = phonePayload(booking.contact_phone);
  if (contactPhone) fields[SINGLES.contactPhone] = contactPhone;
  const email = emailPayload(booking.contact_email);
  if (email) fields[SINGLES.email] = email;
  const birthday = datePayload(birthdayValue(booking), false);
  if (birthday) fields[SINGLES.birthday] = birthday;
  if (gender) fields[SINGLES.gender] = gender;
  if (height) fields[SINGLES.height] = height;
  if (longTermPlan) fields[SINGLES.longTermPlan] = [longTermPlan];
  const bio = nonempty(booking.bio);
  if (bio) fields[SINGLES.bio] = bio;
  if (relationship) fields[SINGLES.relationship] = relationship;
  return fields;
}

function appointmentFields({
  booking,
  singleId,
  shadchanId,
}: {
  booking: Record<string, unknown>;
  singleId?: string;
  shadchanId?: string;
}) {
  const fields: Record<string, unknown> = {};
  const bookingCode = nonempty(booking.booking_code);
  if (bookingCode) fields[APPOINTMENT.title] = bookingCode;

  const first = nonempty(booking.first_name);
  const last = nonempty(booking.last_name);
  if (first) fields[APPOINTMENT.firstName] = first;
  if (last) fields[APPOINTMENT.lastName] = last;

  const meetingSelf = meetingSelfValue(booking);
  if (meetingSelf) fields[APPOINTMENT.meetingSelf] = meetingSelf;

  const contactName = nonempty(booking.contact_name);
  if (contactName) fields[APPOINTMENT.contactName] = contactName;

  const contactPhone = phonePayload(booking.contact_phone);
  if (contactPhone) fields[APPOINTMENT.contactPhone] = contactPhone;

  const contactEmail = emailPayload(booking.contact_email);
  if (contactEmail) fields[APPOINTMENT.contactEmail] = contactEmail;

  const birthday = datePayload(birthdayValue(booking), false);
  if (birthday) fields[APPOINTMENT.birthday] = birthday;

  const gender = nonempty(booking.gender);
  if (gender) fields[APPOINTMENT.gender] = gender;

  const height = nonempty(booking.height);
  if (height) fields[APPOINTMENT.height] = height;

  const relationship = nonempty(booking.relationship);
  if (relationship) fields[APPOINTMENT.relationship] = relationship;

  const longTermPlan = nonempty(booking.long_term_plan);
  if (longTermPlan) fields[APPOINTMENT.longTermPlan] = longTermPlan;

  const bio = nonempty(booking.bio);
  if (bio) fields[APPOINTMENT.bio] = bio;

  const suggestions = suggestionsValue(booking);
  if (suggestions) fields[APPOINTMENT.suggestions] = suggestions;

  const musts = nonempty(booking.musts);
  if (musts) fields[APPOINTMENT.musts] = musts;

  const changes = nonempty(booking.changes);
  if (changes) fields[APPOINTMENT.changes] = changes;

  const appointmentDate = datePayload(
    nonempty(booking.start_datetime) ?? nonempty(booking.end_datetime),
    true,
  );
  if (appointmentDate) fields[APPOINTMENT.appointmentDate] = appointmentDate;

  const appointmentType = nonempty(booking.service_name);
  if (appointmentType) fields[APPOINTMENT.appointmentType] = appointmentType;

  const bookerName = nonempty(booking.client_name);
  if (bookerName) fields[APPOINTMENT.bookerName] = bookerName;

  const bookerPhone = phonePayload(booking.client_phone);
  if (bookerPhone) fields[APPOINTMENT.bookerPhone] = bookerPhone;

  const bookerEmail = emailPayload(booking.client_email);
  if (bookerEmail) fields[APPOINTMENT.bookerEmail] = bookerEmail;

  const shadchanText = cleanProviderName(booking.provider_name);
  if (shadchanText) fields[APPOINTMENT.shadchanText] = shadchanText;

  if (singleId) fields[APPOINTMENT.singleLink] = [singleId];
  if (shadchanId) fields[APPOINTMENT.shadchanLink] = [shadchanId];

  return fields;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const booking = extractBooking(body);

    const apiKey = requireEnv("PROJECT_NINVEH_SMARTSUITE_API_KEY");
    const accountId = requireEnv("PROJECT_NINVEH_SMARTSUITE_ACCOUNT_ID");
    const singlesTableId = requireEnv("PROJECT_NINVEH_SMARTSUITE_SINGLES_TABLE_ID");
    const appointmentTableId =
      process.env.PROJECT_NINVEH_SMARTSUITE_APPOINTMENT_TABLE_ID ?? APPOINTMENT_TABLE_ID;

    const first = nonempty(booking.first_name) ?? "";
    const last = nonempty(booking.last_name) ?? "";

    const warnings: string[] = [];

    const [resumeFile, photoFile] = await Promise.all([
      maybeDownload(booking.resume_url, booking.resume_name, "resume").catch((error) => {
        warnings.push(error instanceof Error ? error.message : String(error));
        return undefined;
      }),
      maybeDownload(booking.photo_url, booking.photo_name, "photo").catch((error) => {
        warnings.push(error instanceof Error ? error.message : String(error));
        return undefined;
      }),
    ]);

    const existingSingle = await findSingleId({
      apiKey,
      accountId,
      tableId: singlesTableId,
      first,
      last,
    });

    const singlesFields = singlesIncomingFields(booking);
    let singleId: string | undefined;
    let singleAction: "created" | "updated" | "linked" | "skipped" = "skipped";

    if (existingSingle && typeof existingSingle.id === "string") {
      singleId = existingSingle.id;
      const blanks = pickBlanks(existingSingle, singlesFields);
      if (Object.keys(blanks).length) {
        await updateRecord({
          apiKey,
          accountId,
          tableId: singlesTableId,
          recordId: singleId,
          fields: blanks,
        });
        singleAction = "updated";
      } else {
        singleAction = "linked";
      }
    } else if (first || last) {
      singleId = await createRecord({
        apiKey,
        accountId,
        tableId: singlesTableId,
        fields: singlesFields,
      });
      singleAction = "created";
    }

    if (singleId) {
      const uploads: Array<Promise<void>> = [];
      if (resumeFile && (!existingSingle || !recordHasFiles(existingSingle[SINGLES.resume]))) {
        uploads.push(
          uploadFile({
            apiKey,
            accountId,
            tableId: singlesTableId,
            recordId: singleId,
            fieldId: SINGLES.resume,
            file: resumeFile,
          }),
        );
      }
      if (photoFile && (!existingSingle || !recordHasFiles(existingSingle[SINGLES.photo]))) {
        uploads.push(
          uploadFile({
            apiKey,
            accountId,
            tableId: singlesTableId,
            recordId: singleId,
            fieldId: SINGLES.photo,
            file: photoFile,
          }),
        );
      }
      const results = await Promise.allSettled(uploads);
      for (const result of results) {
        if (result.status === "rejected") {
          warnings.push(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
        }
      }
    }

    const shadchanId = await findShadchanId({
      apiKey,
      accountId,
      providerName: text(booking.provider_name),
    });
    if (cleanProviderName(booking.provider_name) && !shadchanId) {
      warnings.push(
        `No SHADCHAN record matched provider "${cleanProviderName(booking.provider_name)}"`,
      );
    }

    const suggestions = suggestionsMatch(booking);
    const appointmentId = await createRecord({
      apiKey,
      accountId,
      tableId: appointmentTableId,
      fields: appointmentFields({ booking, singleId, shadchanId }),
    });

    const appointmentUploads: Array<Promise<void>> = [];
    if (resumeFile) {
      appointmentUploads.push(
        uploadFile({
          apiKey,
          accountId,
          tableId: appointmentTableId,
          recordId: appointmentId,
          fieldId: APPOINTMENT.resume,
          file: resumeFile,
        }),
      );
    }
    if (photoFile) {
      appointmentUploads.push(
        uploadFile({
          apiKey,
          accountId,
          tableId: appointmentTableId,
          recordId: appointmentId,
          fieldId: APPOINTMENT.photo,
          file: photoFile,
        }),
      );
    }
    const uploadResults = await Promise.allSettled(appointmentUploads);
    for (const result of uploadResults) {
      if (result.status === "rejected") {
        warnings.push(
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        );
      }
    }

    return json({
      ok: true,
      appointment_id: appointmentId,
      single_id: singleId ?? null,
      single_action: singleAction,
      shadchan_id: shadchanId ?? null,
      files: {
        resume: Boolean(resumeFile),
        photo: Boolean(photoFile),
      },
      suggestions: suggestions.value ?? null,
      suggestions_label: suggestions.label ?? null,
      booking_keys: Object.keys(booking),
      warnings,
    });
  } catch (error) {
    console.error("[PROJECT_NINVEH] simply-book-to-ss error:", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}
