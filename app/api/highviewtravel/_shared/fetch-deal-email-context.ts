/** HubSpot deal properties used when assembling generateEmailFile input. */
const DEAL_PROPERTIES = [
  "dealname",
  "hubspot_owner_id",
  "reservation_details",
  "penalties",
  "passenger_name",
  "commission",
  "form_type",
  "issuing_fee",
  "commission_rate",
  "base_fare_per_person",
  "taxes__fees_per_person",
  "is_fora",
  "got_passport_pictures_",
] as const;

const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "passport_name",
] as const;

const COMPANY_PROPERTIES = ["name", "domain"] as const;

export type DealEmailContextPayload = {
  reservationDetails: string;
  hubspotDealId: string;
  Penalties: string;
  PassengerName: string;
  RatePP: string;
  ContactFirstName: string;
  ContactLastName: string;
  ContactEmail: string;
  formType: string;
  issuingFee: string;
  commissionRate: string;
  DealsOnContact: string;
  BaseFarePP: string;
  DealName: string;
  IsFora: string;
  TaxesAndFeesPP: string;
  ownersEmail: string;
  GotPassportPictures: string;
  companyId: string;
  companyName: string;
  contactId: string;
  contactPassportName: string;
  dealCountOnContact: number;
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

async function getObject<T extends { id: string; properties: Record<string, string | null | undefined> }>(
  objectType: "deals" | "contacts" | "companies",
  objectId: string,
  properties: readonly string[],
  token: string,
): Promise<T> {
  const query = new URLSearchParams({
    properties: properties.join(","),
  });
  const res = await hubSpotFetch(
    `/crm/v3/objects/${objectType}/${objectId}?${query}`,
    token,
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `HubSpot ${objectType} lookup failed (${res.status}): ${text}`,
    );
  }

  return (await res.json()) as T;
}

async function getAssociationIds(
  fromType: "deals" | "contacts",
  fromId: string,
  toType: "contacts" | "companies" | "deals",
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

async function getOwnerEmail(ownerId: string, token: string): Promise<string> {
  const res = await hubSpotFetch(`/crm/v3/owners/${ownerId}`, token);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot owner lookup failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { email?: string };
  return json.email?.trim() ?? "";
}

/** Replaces Zapier steps 3–9: load deal, contact, company, deal count, and owner. */
export async function fetchDealEmailContext(
  dealId: string,
): Promise<DealEmailContextPayload> {
  const token = getHubSpotToken();

  const deal = await getObject<{
    id: string;
    properties: Record<string, string | null | undefined>;
  }>("deals", dealId, DEAL_PROPERTIES, token);

  const contactIds = await getAssociationIds("deals", dealId, "contacts", token);
  if (contactIds.length === 0) {
    throw new Error(`No contact associated with deal ${dealId}`);
  }

  const contactId = contactIds[0]!;
  const contact = await getObject<{
    id: string;
    properties: Record<string, string | null | undefined>;
  }>("contacts", contactId, CONTACT_PROPERTIES, token);

  const companyIds = await getAssociationIds(
    "contacts",
    contactId,
    "companies",
    token,
  );
  if (companyIds.length === 0) {
    throw new Error(`No company associated with contact ${contactId}`);
  }

  const companyId = companyIds[0]!;
  let companyName = "";
  try {
    const company = await getObject<{
      id: string;
      properties: Record<string, string | null | undefined>;
    }>("companies", companyId, COMPANY_PROPERTIES, token);
    companyName = prop(company.properties, "name");
  } catch (error) {
    console.warn(
      `[fetch-deal-email-context] Company ${companyId} found but details could not be loaded:`,
      error instanceof Error ? error.message : error,
    );
  }

  const contactDealIds = await getAssociationIds(
    "contacts",
    contactId,
    "deals",
    token,
  );

  const ownerId = prop(deal.properties, "hubspot_owner_id");
  const ownersEmail = ownerId ? await getOwnerEmail(ownerId, token) : "";

  return {
    reservationDetails: prop(deal.properties, "reservation_details"),
    hubspotDealId: deal.id,
    Penalties: prop(deal.properties, "penalties"),
    PassengerName: prop(deal.properties, "passenger_name"),
    RatePP: prop(deal.properties, "commission"),
    ContactFirstName: prop(contact.properties, "firstname"),
    ContactLastName: prop(contact.properties, "lastname"),
    ContactEmail: prop(contact.properties, "email"),
    formType: prop(deal.properties, "form_type"),
    issuingFee: prop(deal.properties, "issuing_fee"),
    commissionRate: prop(deal.properties, "commission_rate"),
    DealsOnContact: String(contactDealIds.length || 1),
    BaseFarePP: prop(deal.properties, "base_fare_per_person"),
    DealName: prop(deal.properties, "dealname"),
    IsFora: prop(deal.properties, "is_fora"),
    TaxesAndFeesPP: prop(deal.properties, "taxes__fees_per_person"),
    ownersEmail,
    GotPassportPictures: prop(deal.properties, "got_passport_pictures_"),
    companyId,
    companyName,
    contactId,
    contactPassportName: prop(contact.properties, "passport_name"),
    dealCountOnContact: contactDealIds.length || 1,
  };
}
