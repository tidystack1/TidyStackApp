import type { ContactExtraction } from "./extract-contact-from-email";
import { extractEmailAddress } from "./hubspot-deal";

/** Same HubSpot automation webhook Zapier used to opt contacts into marketing. */
const MARKETING_OPT_IN_WEBHOOK_URL =
  "https://api-na1.hubapi.com/automation/v4/webhook-triggers/20596122/FRFnigz";
const MARKETING_OPT_IN_TIMEOUT_MS = 15_000;
function getHubSpotToken(): string {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  }
  return token;
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

export async function findContactByEmail(
  email: string,
  token = getHubSpotToken(),
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

function buildContactProperties(
  email: string,
  extraction: ContactExtraction,
): Record<string, string> {
  const properties: Record<string, string> = {
    email,
    contact_type: "Client",
  };
  if (extraction.firstName) properties.firstname = extraction.firstName;
  if (extraction.lastName) properties.lastname = extraction.lastName;
  if (extraction.phoneNumber) properties.phone = extraction.phoneNumber;
  return properties;
}

/** Opt a contact into marketing via HubSpot automation webhook (Zapier step 4). */
async function optInContactToMarketing(contactId: string): Promise<void> {
  const res = await fetch(MARKETING_OPT_IN_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hs_object_id: contactId }),
    signal: AbortSignal.timeout(MARKETING_OPT_IN_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `HubSpot marketing opt-in webhook failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
}

export type EnsureContactResult = {
  contactEmail: string;
  contactId: string | null;
  created: boolean;
  skippedExisting: boolean;
  marketingOptedIn: boolean;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
};

/**
 * If a HubSpot contact already exists for the sender email, skip creation.
 * Otherwise create one with email + extracted name/phone.
 */
export async function ensureHubSpotContactFromEmail(
  fromHeader: string,
  extraction: ContactExtraction,
): Promise<EnsureContactResult> {
  const token = getHubSpotToken();
  const contactEmail = extractEmailAddress(fromHeader);
  if (!contactEmail) {
    throw new Error(
      "Could not extract a contact email address from the email From header",
    );
  }

  const existingId = await findContactByEmail(contactEmail, token);
  if (existingId) {
    return {
      contactEmail,
      contactId: existingId,
      created: false,
      skippedExisting: true,
      marketingOptedIn: false,
      firstName: extraction.firstName,
      lastName: extraction.lastName,
      phoneNumber: extraction.phoneNumber,
    };
  }

  const properties = buildContactProperties(contactEmail, extraction);
  const res = await hubSpotFetch("/crm/v3/objects/contacts", token, {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot contact create failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id: string };
  await optInContactToMarketing(json.id);

  return {
    contactEmail,
    contactId: json.id,
    created: true,
    skippedExisting: false,
    marketingOptedIn: true,
    firstName: extraction.firstName,
    lastName: extraction.lastName,
    phoneNumber: extraction.phoneNumber,
  };
}
