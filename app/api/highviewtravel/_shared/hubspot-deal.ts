import type { BookingExtraction } from "./extract-booking-from-email";
import { buildDealName } from "./build-deal-name";

/** Pending to be reached out — internal stage id from HubSpot deal stage property */
const HUBSPOT_PENDING_DEAL_STAGE_ID = "46623793";

type HubSpotPipeline = {
  id: string;
  label: string;
  stages: Array<{ id: string; label: string }>;
};

type ResolvedPipelineStage = {
  pipelineId: string;
  stageId: string;
};

let cachedPipelineStage: ResolvedPipelineStage | null = null;

async function fetchDealPipelines(token: string): Promise<HubSpotPipeline[]> {
  const res = await hubSpotFetch("/crm/v3/pipelines/deals", token);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot pipeline lookup failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { results?: HubSpotPipeline[] };
  return json.results ?? [];
}

async function resolvePipelineAndStage(token: string): Promise<ResolvedPipelineStage> {
  const pipelineFromEnv = process.env.HIGHVIEWTRAVEL_HUBSPOT_SALES_PIPELINE_ID?.trim();
  const stageFromEnv = process.env.HIGHVIEWTRAVEL_HUBSPOT_PENDING_DEAL_STAGE_ID?.trim();
  const stageId = stageFromEnv || HUBSPOT_PENDING_DEAL_STAGE_ID;

  if (pipelineFromEnv) {
    return { pipelineId: pipelineFromEnv, stageId };
  }

  if (cachedPipelineStage?.stageId === stageId) {
    return cachedPipelineStage;
  }

  const pipelines = await fetchDealPipelines(token);
  for (const pipeline of pipelines) {
    const stage = pipeline.stages.find((item) => item.id === stageId);
    if (stage) {
      cachedPipelineStage = { pipelineId: pipeline.id, stageId: stage.id };
      return cachedPipelineStage;
    }
  }

  throw new Error(
    `HubSpot stage ${stageId} was not found in any deal pipeline`,
  );
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

export function extractEmailAddress(headerValue: string): string | null {
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  const angle = /<([^>]+)>/.exec(trimmed);
  if (angle?.[1]) {
    return angle[1].trim().toLowerCase();
  }

  const email = trimmed.toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return email;
  }

  return null;
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
): Record<string, string> {
  const properties: Record<string, string> = {
    dealname: buildDealName(booking),
    pipeline: pipelineId,
    dealstage: stageId,
    quote_request_type: "New request",
  };

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
};

export async function createHubSpotDealFromBooking(
  booking: BookingExtraction,
  fromHeader: string,
): Promise<CreateDealResult> {
  const token = getHubSpotToken();
  const contactEmail = extractEmailAddress(fromHeader);
  if (!contactEmail) {
    throw new Error("Could not extract a contact email address from the .eml From header");
  }

  const { pipelineId, stageId } = await resolvePipelineAndStage(token);
  const properties = buildDealProperties(booking, pipelineId, stageId);

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
  };
}
