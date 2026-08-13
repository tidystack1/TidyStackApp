import type { BookingExtraction } from "./extract-booking-from-email";
import { buildDealName } from "./build-deal-name";

/** HubSpot Sales Pipeline — internal name from deal `pipeline` property */
const HUBSPOT_SALES_PIPELINE_ID = "default";
/** Pending (Sales Pipeline) — internal name from deal `dealstage` property */
const HUBSPOT_PENDING_DEAL_STAGE_ID = "1418176129";

type ResolvedPipelineStage = {
  pipelineId: string;
  stageId: string;
};

function resolvePipelineAndStage(): ResolvedPipelineStage {
  const pipelineFromEnv = process.env.HIGHVIEWTRAVEL_HUBSPOT_SALES_PIPELINE_ID?.trim();
  const stageFromEnv = process.env.HIGHVIEWTRAVEL_HUBSPOT_PENDING_DEAL_STAGE_ID?.trim();

  return {
    pipelineId: pipelineFromEnv || HUBSPOT_SALES_PIPELINE_ID,
    stageId: stageFromEnv || HUBSPOT_PENDING_DEAL_STAGE_ID,
  };
}

function getHubSpotToken(): string {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  }
  return token;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function extractEmailAddress(headerValue: string): string | null {
  return extractAllEmailAddresses(headerValue)[0] ?? null;
}

export function extractAllEmailAddresses(headerValue: string): string[] {
  const trimmed = headerValue.trim();
  if (!trimmed) return [];

  const emails: string[] = [];
  for (const match of trimmed.matchAll(/<([^>]+)>/g)) {
    const email = match[1]!.trim().toLowerCase();
    if (EMAIL_PATTERN.test(email)) emails.push(email);
  }
  if (emails.length > 0) return emails;

  for (const part of trimmed.split(",")) {
    const email = part.trim().toLowerCase();
    if (EMAIL_PATTERN.test(email)) emails.push(email);
  }

  return emails;
}

async function hubSpotFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function buildDealProperties(
  booking: BookingExtraction,
  pipelineId: string,
  stageId: string,
  ownerId?: string,
): Record<string, string> {
  const properties: Record<string, string> = {
    dealname: buildDealName(booking),
    pipeline: pipelineId,
    dealstage: stageId,
    quote_request_type: "New request",
  };

  if (ownerId) properties.hubspot_owner_id = ownerId;

  const cabinClass = cabinClassPropertyValue(booking.cabinClass);
  if (cabinClass) properties.cabin_class = cabinClass;

  if (booking.route) properties.route = booking.route;
  if (booking.passengers != null) {
    properties.passengers = String(booking.passengers);
  }
  if (booking.departureRegion) {
    properties.departure_region = booking.departureRegion;
  }

  return properties;
}

function cabinClassPropertyValue(
  cabinClass: BookingExtraction["cabinClass"],
): string | undefined {
  // HubSpot `cabin_class` is a boolean: true = Business, false = Economy.
  if (cabinClass === "Business") return "true";
  if (cabinClass === "Economy") return "false";
  return undefined;
}

async function findContactByEmail(
  email: string,
  token: string,
): Promise<string | null> {
  const res = await hubSpotFetch("/crm/v3/objects/contacts/search", token, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email,
            },
          ],
        },
      ],
      properties: ["email"],
      limit: 1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot contact search failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { results?: Array<{ id: string }> };
  return json.results?.[0]?.id ?? null;
}

async function findOwnerIdByEmail(
  email: string,
  token: string,
): Promise<string | null> {
  const res = await hubSpotFetch(
    `/crm/v3/owners?email=${encodeURIComponent(email)}&limit=1`,
    token,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot owner lookup failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { results?: Array<{ id: string }> };
  return json.results?.[0]?.id ?? null;
}

async function resolveOwnerFromToHeader(
  toHeader: string,
  token: string,
): Promise<{ ownerId: string | null; ownerEmail: string | null }> {
  for (const email of extractAllEmailAddresses(toHeader)) {
    const ownerId = await findOwnerIdByEmail(email, token);
    if (ownerId) return { ownerId, ownerEmail: email };
  }

  return { ownerId: null, ownerEmail: null };
}

async function associateDealWithContact(
  dealId: string,
  contactId: string,
  token: string,
): Promise<void> {
  const res = await hubSpotFetch(
    `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/3`,
    token,
    { method: "PUT" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `HubSpot deal-contact association failed (${res.status}): ${text}`,
    );
  }
}

export type CreateDealResult = {
  dealId: string;
  dealName: string;
  contactEmail: string;
  contactId: string | null;
  contactAssociated: boolean;
  ownerEmail: string | null;
  ownerId: string | null;
  ownerAssigned: boolean;
};

export async function createHubSpotDealFromBooking(
  booking: BookingExtraction,
  fromHeader: string,
  toHeader: string,
): Promise<CreateDealResult> {
  const token = getHubSpotToken();
  const contactEmail = extractEmailAddress(fromHeader);
  if (!contactEmail) {
    throw new Error("Could not extract a contact email address from the .eml From header");
  }

  const { pipelineId, stageId } = resolvePipelineAndStage();
  const { ownerId, ownerEmail } = await resolveOwnerFromToHeader(toHeader, token);
  const properties = buildDealProperties(
    booking,
    pipelineId,
    stageId,
    ownerId ?? undefined,
  );

  const res = await hubSpotFetch("/crm/v3/objects/deals", token, {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal create failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id: string };

  const contactId = await findContactByEmail(contactEmail, token);
  if (contactId) {
    await associateDealWithContact(json.id, contactId, token);
  }

  return {
    dealId: json.id,
    dealName: properties.dealname,
    contactEmail,
    contactId,
    contactAssociated: contactId !== null,
    ownerEmail,
    ownerId,
    ownerAssigned: ownerId !== null,
  };
}
