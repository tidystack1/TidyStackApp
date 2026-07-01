const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "registered_for_the_webinar",
] as const;

export type NewDealNotificationResult = {
  "add to customer.io": boolean;
  filterReason: string | null;
  dealId: string;
  hasResults: "yes" | "no";
  hubSpotContactId: string;
  dealLength: number;
  firstName: string;
  lastName: string;
  email: string;
  registeredForWebinar: "Yes" | "No";
  hasDeals: "Yes" | "No";
  dealIds: string;
  shouldEnterSequence: "Yes" | "No";
};

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

function prop(
  properties: Record<string, string | null | undefined>,
  key: string,
): string {
  const value = properties[key];
  return value != null ? String(value) : "";
}

async function getContact(
  contactId: string,
  token: string,
): Promise<{
  id: string;
  properties: Record<string, string | null | undefined>;
}> {
  const query = new URLSearchParams({
    properties: CONTACT_PROPERTIES.join(","),
  });
  const res = await hubSpotFetch(
    `/crm/v3/objects/contacts/${contactId}?${query}`,
    token,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot contact lookup failed (${res.status}): ${text}`);
  }

  return (await res.json()) as {
    id: string;
    properties: Record<string, string | null | undefined>;
  };
}

async function getAssociationIds(
  fromType: "deals" | "contacts",
  fromId: string,
  toType: "contacts" | "deals",
  token: string,
): Promise<string[]> {
  const res = await hubSpotFetch(
    `/crm/v4/objects/${fromType}/${fromId}/associations/${toType}`,
    token,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `HubSpot ${fromType}->${toType} associations failed (${res.status}): ${text}`,
    );
  }

  const json = (await res.json()) as {
    results?: Array<{ toObjectId: number | string }>;
  };

  return (json.results ?? []).map((row) => String(row.toObjectId));
}

function buildContactFields(
  contact: { id: string; properties: Record<string, string | null | undefined> },
  dealIds: string[],
): Pick<
  NewDealNotificationResult,
  | "hubSpotContactId"
  | "firstName"
  | "lastName"
  | "email"
  | "registeredForWebinar"
  | "hasDeals"
  | "dealIds"
  | "shouldEnterSequence"
> {
  const registeredRaw = prop(
    contact.properties,
    "registered_for_the_webinar",
  ).toUpperCase();
  const registeredForWebinar: "Yes" | "No" =
    registeredRaw === "YES" ? "Yes" : "No";
  const hasDeals: "Yes" | "No" = dealIds.length > 0 ? "Yes" : "No";
  const shouldEnterSequence: "Yes" | "No" =
    dealIds.length > 0 && registeredRaw !== "YES" ? "Yes" : "No";

  return {
    hubSpotContactId: contact.id,
    firstName: prop(contact.properties, "firstname"),
    lastName: prop(contact.properties, "lastname"),
    email: prop(contact.properties, "email"),
    registeredForWebinar,
    hasDeals,
    dealIds: dealIds.length > 0 ? dealIds.join(",") : "None",
    shouldEnterSequence,
  };
}

function filteredResult(
  dealId: string,
  filterReason: string,
  partial: Partial<NewDealNotificationResult> = {},
): NewDealNotificationResult {
  return {
    "add to customer.io": false,
    filterReason,
    dealId,
    hasResults: partial.hasResults ?? "no",
    hubSpotContactId: partial.hubSpotContactId ?? "",
    dealLength: partial.dealLength ?? 0,
    firstName: partial.firstName ?? "",
    lastName: partial.lastName ?? "",
    email: partial.email ?? "",
    registeredForWebinar: partial.registeredForWebinar ?? "No",
    hasDeals: partial.hasDeals ?? "No",
    dealIds: partial.dealIds ?? "None",
    shouldEnterSequence: partial.shouldEnterSequence ?? "No",
  };
}

/** Replaces Zapier steps 2–10 for the new-deal Customer.io notification flow. */
export async function fetchNewDealNotification(
  dealId: string,
): Promise<NewDealNotificationResult> {
  const token = getHubSpotToken();

  const contactIds = await getAssociationIds("deals", dealId, "contacts", token);
  const hasResults: "yes" | "no" = contactIds.length > 0 ? "yes" : "no";

  if (hasResults === "no") {
    return filteredResult(
      dealId,
      "No associated contacts found on deal (Zapier filter step 4)",
      { hasResults },
    );
  }

  const contactId = contactIds[0]!;
  const contactDealIds = await getAssociationIds(
    "contacts",
    contactId,
    "deals",
    token,
  );
  const dealLength = contactDealIds.length;

  if (dealLength <= 0 || dealLength >= 2) {
    let contactFields: ReturnType<typeof buildContactFields> | null = null;
    try {
      const contact = await getContact(contactId, token);
      contactFields = buildContactFields(contact, contactDealIds);
    } catch (error) {
      console.warn(
        `[fetch-new-deal-notification] Could not load contact ${contactId} for filtered response:`,
        error instanceof Error ? error.message : error,
      );
    }

    const reason =
      dealLength <= 0
        ? "Contact has no associated deals (Zapier filter step 8 requires exactly 1)"
        : `Contact has ${dealLength} associated deals; expected exactly 1 (Zapier filter step 8)`;

    return filteredResult(dealId, reason, {
      hasResults,
      hubSpotContactId: contactId,
      dealLength,
      ...contactFields,
    });
  }

  const contact = await getContact(contactId, token);
  const contactFields = buildContactFields(contact, contactDealIds);

  return {
    "add to customer.io": true,
    filterReason: null,
    dealId,
    hasResults,
    dealLength,
    ...contactFields,
  };
}
