import {
  ASPIRE_ACCOUNT_ID,
  ASPIRE_LOCATION_ID,
  getLobbieCredentials,
  LOBBIE_API_BASE,
  LOBBIE_TOKEN_SCOPE,
  LOBBIE_TOKEN_URL,
} from "./config";
import type {
  JsonObject,
  LobbieForm,
  LobbieFormPacket,
  LobbiePatient,
} from "./types";

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAtMs) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret, apiKey } = getLobbieCredentials();
  const response = await fetch(LOBBIE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": apiKey,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: LOBBIE_TOKEN_SCOPE,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const body = (await response.json()) as JsonObject;
  const accessToken =
    typeof body.access_token === "string" ? body.access_token : "";
  const expiresIn =
    typeof body.expires_in === "number" ? body.expires_in : 3600;

  if (!response.ok || !accessToken) {
    throw new Error(
      `Lobbie token request failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }

  tokenCache = {
    accessToken,
    expiresAtMs: now + Math.max(expiresIn - 60, 30) * 1000,
  };
  return accessToken;
}

async function lobbieFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { apiKey } = getLobbieCredentials();
  const accessToken = await getAccessToken();
  const url = path.startsWith("http") ? path : `${LOBBIE_API_BASE}${path}`;

  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function lobbieJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await lobbieFetch(path, init);
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
      `Lobbie ${init.method || "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  return parsed as T;
}

export async function getFormPacket(packetId: number): Promise<LobbieFormPacket> {
  return lobbieJson<LobbieFormPacket>(
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/location/${ASPIRE_LOCATION_ID}/form-packet/${packetId}`,
  );
}

export async function getFormPacketForms(packetId: number): Promise<LobbieForm[]> {
  const result = await lobbieJson<unknown>(
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/location/${ASPIRE_LOCATION_ID}/form-packet/${packetId}/form`,
  );
  return Array.isArray(result) ? (result as LobbieForm[]) : [];
}

export async function getPatient(patientId: number): Promise<LobbiePatient> {
  return lobbieJson<LobbiePatient>(
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/patient/${patientId}`,
  );
}

export type CreatePatientInput = {
  firstName: string;
  lastName: string;
  email?: string;
  mobilePhone?: string;
};

export async function createPatient(
  input: CreatePatientInput,
): Promise<LobbiePatient> {
  const body: Record<string, string> = {
    firstName: input.firstName,
    lastName: input.lastName,
  };
  if (input.email) body.email = input.email;
  if (input.mobilePhone) body.mobilePhone = input.mobilePhone;

  return lobbieJson<LobbiePatient>(
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/patient`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

export async function listFormPackets(cursor?: string): Promise<{
  formPackets: LobbieFormPacket[];
  nextCursor: string | null;
}> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);

  const result = await lobbieJson<{
    formPackets?: LobbieFormPacket[];
    nextCursor?: string | null;
  }>(
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/location/${ASPIRE_LOCATION_ID}/form-packet?${query}`,
  );

  return {
    formPackets: result.formPackets ?? [],
    nextCursor: result.nextCursor ?? null,
  };
}

export async function findLatestCompletedIntakePacket(
  templateId: number,
): Promise<LobbieFormPacket | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const { formPackets, nextCursor } = await listFormPackets(cursor);
    const match = formPackets.find(
      (packet) =>
        Boolean(packet.completedAt) &&
        (packet.formTemplateIds ?? []).includes(templateId),
    );
    if (match) return match;
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return null;
}

export async function listWebhooks(): Promise<JsonObject[]> {
  const result = await lobbieJson<{ items?: JsonObject[] }>(
    "/partner/v2/webhook",
  );
  return result.items ?? [];
}

export async function createWebhook(input: {
  url: string;
  eventTypes: string[];
  name?: string;
}): Promise<JsonObject> {
  return lobbieJson<JsonObject>("/partner/v2/webhook", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function downloadFormFile(filePath: string): Promise<Uint8Array | null> {
  const encoded = encodeURIComponent(filePath);
  const candidates = [
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/location/${ASPIRE_LOCATION_ID}/file?path=${encoded}`,
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/file?path=${encoded}`,
    `/partner/v2/account/${ASPIRE_ACCOUNT_ID}/location/${ASPIRE_LOCATION_ID}/files/${filePath}`,
  ];

  for (const path of candidates) {
    const response = await lobbieFetch(path, {
      headers: { Accept: "*/*" },
    });
    if (!response.ok) continue;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("json")) {
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 0) return bytes;
  }

  return null;
}

export function parsePacketFromUnknown(value: unknown): LobbieFormPacket | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "number" ? value.id : Number(value.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  return {
    id,
    completedAt:
      typeof value.completedAt === "string" ? value.completedAt : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    dueDate: typeof value.dueDate === "string" ? value.dueDate : null,
    formTemplateIds: Array.isArray(value.formTemplateIds)
      ? value.formTemplateIds.filter((item): item is number => typeof item === "number")
      : [],
    isActive: typeof value.isActive === "boolean" ? value.isActive : undefined,
    isArchived:
      typeof value.isArchived === "boolean" ? value.isArchived : undefined,
    locationId:
      typeof value.locationId === "number" ? value.locationId : undefined,
    locationName:
      typeof value.locationName === "string" ? value.locationName : undefined,
    patientId:
      typeof value.patientId === "number" ? value.patientId : undefined,
    patientName:
      typeof value.patientName === "string" ? value.patientName : undefined,
  };
}
