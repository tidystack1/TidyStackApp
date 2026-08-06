import type { DealEmailContextPayload } from "./fetch-deal-email-context";

/** Formstack field IDs for Highview booking form prefill (form 6471647). */
const FIELD = {
  hubspotDealId: "193986341",
  reservationDetails: "193868118",
  penalties: "193868119",
  ratePP: "195201281",
  agentName: "193868029",
  agencyName: "193868030",
  email: "193868031",
  ownersEmail: "195713296",
  formType: "194690055",
  issueFee: "194679743",
  commissionPP: "193868122",
  amountOfDealsOnContact: "194812236",
  baseFarePP: "194679849",
  taxesAndFeesPP: "194679850",
  dealName: "194963563",
  isFora: "195103040",
  hasPassport: "196333890",
  numberOfPassengers: "193868044",
  passenger1: "195116052",
  passenger2: "195116090",
  passenger3: "195116095",
  passenger4: "195116099",
  passenger5: "195116101",
  passenger6: "195116103",
  passenger7: "195116106",
  passenger8: "195116111",
  passenger9: "195116124",
} as const;

const PASSENGER_FIELD_IDS = [
  FIELD.passenger1,
  FIELD.passenger2,
  FIELD.passenger3,
  FIELD.passenger4,
  FIELD.passenger5,
  FIELD.passenger6,
  FIELD.passenger7,
  FIELD.passenger8,
  FIELD.passenger9,
];

const FORM_TYPE_MAP: Record<string, string> = {
  "6471647": "Net Rate + CC Fee",
  "Net Rate + CC Fee": "Net Rate + CC Fee",
  "Net Rate (NO CC Fee)": "Net Rate (NO CC Fee)",
  "Commission off Published Rate": "Commission off Published Rate",
  "Published Rate + $75 Ticketing Fee": "Published Rate + $75 Ticketing Fee",
};

const DEFAULT_PENALTIES_BY_FORM_TYPE: Record<string, string> = {
  "Net Rate + CC Fee":
    "NON-REFUNDABLE / CHANGES PERMITTED\n\nTHIS IS NONREFUNDABLE. IN CASE OF ANY CANCELATION FROM THE AIRLINE AND THEY GRANT A REFUND AS PER THEIR RULES, A $150 PROCESSING FEE PER PERSON WILL APPLY TO THE REFUND AND THE COMMISSION MUST BE RETURNED PRIOR TO SUBMITTING THE REFUND REQUEST, CC FEES ARE NEVER REFUNDABLE.",
  "Net Rate (NO CC Fee)":
    "NON-REFUNDABLE / CHANGES PERMITTED\n\nTHIS IS NONREFUNDABLE. IN CASE OF ANY CANCELATION FROM THE AIRLINE AND THEY GRANT A REFUND AS PER THEIR RULES, A $150 PROCESSING FEE PER PERSON WILL APPLY TO REFUND AND THE COMMISSION MUST BE RETURNED PRIOR SUBMITTING THE REFUND REQUEST, CC FEES ARE NEVER REFUNDABLE.",
  "Commission off Published Rate": "AS PER PUBLISHED FARE",
  "Published Rate + $75 Ticketing Fee": "AS PER PUBLISHED FARE",
};

export type PenaltiesFillMode = "auto" | "manual";

export type PenaltiesResolution = {
  mode: PenaltiesFillMode;
  penalties: string;
  formTypeLabel: string;
};

export function resolveFormTypeLabel(formType: string | undefined): string {
  const raw = formType?.trim() ?? "";
  return FORM_TYPE_MAP[raw] ?? raw;
}

/** HubSpot `penalties_fill` is "Auto Fill" / "Manual Fill"; empty is treated as Manual Fill. */
export function resolvePenaltiesFillMode(
  penaltiesFill: string | undefined,
): PenaltiesFillMode {
  const normalized = (penaltiesFill ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "auto" || normalized === "auto fill") {
    return "auto";
  }

  // Empty or Manual Fill: leave HubSpot penalties as-is; Formstack gets existing value.
  return "manual";
}

export function resolvePenaltiesText(input: {
  penaltiesFill?: string;
  formType?: string;
  hubspotPenalties?: string;
}): PenaltiesResolution {
  const formTypeLabel = resolveFormTypeLabel(input.formType);
  const mode = resolvePenaltiesFillMode(input.penaltiesFill);

  if (mode === "manual") {
    return {
      mode,
      formTypeLabel,
      penalties: input.hubspotPenalties ?? "",
    };
  }

  return {
    mode,
    formTypeLabel,
    penalties: DEFAULT_PENALTIES_BY_FORM_TYPE[formTypeLabel] ?? "",
  };
}

const DEFAULT_FORMSTACK_FORM_ID = "6471647";

export type FormstackPrefillField = {
  id: string;
  value: { value: string };
};

export type GenerateEmailFormstackInput = {
  reservationDetails: string;
  hubspotDealId: string;
  penalties?: string;
  ratePP?: string;
  contactFirstName?: string;
  contactLastName?: string;
  contactEmail?: string;
  ownersEmail?: string;
  formType?: string;
  issuingFee?: string;
  commissionRate?: string;
  dealsOnContact?: unknown;
  baseFarePP?: string;
  taxesAndFeesPP?: string;
  dealName?: string;
  isFora?: string;
  gotPassportPictures?: string;
};

function makeField(id: string, value: string | undefined | null): FormstackPrefillField {
  return { id, value: { value: value ?? "" } };
}

function pickString(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = body[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

function countDealsOnContact(value: unknown): number {
  if (value === undefined || value === null) return 1;
  if (Array.isArray(value)) {
    const n = value.filter((x) => x !== undefined && x !== null && String(x).trim() !== "")
      .length;
    return n || 1;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : 1;
  }
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const n = parseInt(text, 10);
    return n > 0 ? n : 1;
  }
  const segments = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.length || 1;
}

function parsePassengerNames(reservationDetails: string): string[] {
  const passengerRegex = /\d+\.1([A-Z][A-Z/\s]+?)(?=\s*\d+\.1|\s*\n|$)/g;
  const passengers: string[] = [];
  for (const match of reservationDetails.matchAll(passengerRegex)) {
    const name = match[1].trim();
    if (name) passengers.push(name);
    if (passengers.length === 9) break;
  }
  return passengers;
}

/** Maps HubSpot deal-email context into Formstack prefill input. */
export function dealEmailContextToFormstackInput(
  ctx: DealEmailContextPayload,
): GenerateEmailFormstackInput {
  const { penalties } = resolvePenaltiesText({
    penaltiesFill: ctx.penaltiesFill,
    formType: ctx.formType,
    hubspotPenalties: ctx.Penalties,
  });

  return {
    reservationDetails: ctx.reservationDetails,
    hubspotDealId: ctx.hubspotDealId,
    penalties,
    ratePP: ctx.RatePP,
    contactFirstName: ctx.ContactFirstName,
    contactLastName: ctx.ContactLastName,
    contactEmail: ctx.ContactEmail,
    ownersEmail: ctx.ownersEmail,
    formType: ctx.formType,
    issuingFee: ctx.issuingFee,
    commissionRate: ctx.commissionRate,
    dealsOnContact: ctx.DealsOnContact,
    baseFarePP: ctx.BaseFarePP,
    taxesAndFeesPP: ctx.TaxesAndFeesPP,
    dealName: ctx.DealName,
    isFora: ctx.IsFora,
    gotPassportPictures: ctx.GotPassportPictures,
  };
}

/** Maps Zapier / HubSpot webhook body keys into normalized prefill input. */
export function parseGenerateEmailFormstackInput(
  body: Record<string, unknown>,
): GenerateEmailFormstackInput | null {
  const reservationDetails = pickString(
    body,
    "reservationDetails",
    "ReservationDetails",
  );
  const hubspotDealId = pickString(
    body,
    "hubspotDealId",
    "hubSpotDealId",
    "HubspotDealId",
    "HubspotId",
    "hubspotId",
  );

  if (!reservationDetails || !hubspotDealId) return null;

  return {
    reservationDetails,
    hubspotDealId,
    penalties: pickString(body, "Penalties", "penalties"),
    ratePP: pickString(body, "RatePP", "ratePP"),
    contactFirstName: pickString(body, "ContactFirstName", "contactFirstName"),
    contactLastName: pickString(body, "ContactLastName", "contactLastName"),
    contactEmail: pickString(body, "ContactEmail", "contactEmail"),
    ownersEmail: pickString(body, "ownersEmail", "OwnersEmail"),
    formType: pickString(body, "formType", "FormType"),
    issuingFee: pickString(body, "issuingFee", "IssuingFee", "issueFee"),
    commissionRate: pickString(
      body,
      "commissionRate",
      "CommissionRate",
      "commissionPP",
    ),
    dealsOnContact: body.DealsOnContact ?? body.dealsOnContact,
    baseFarePP: pickString(body, "BaseFarePP", "baseFarePP"),
    taxesAndFeesPP: pickString(
      body,
      "TaxesAndFeesPP",
      "taxesAndFeesPP",
      "TaxedfessPP",
      "taxedfessPP",
    ),
    dealName: pickString(body, "DealName", "dealName"),
    isFora: pickString(body, "IsFora", "isFora"),
    gotPassportPictures: pickString(
      body,
      "GotPassportPictures",
      "gotPassportPictures",
    ),
  };
}

/** Builds the Formstack prefill `fields` array (same shape as the former Zapier code step). */
export function buildFormstackPrefillFields(
  input: GenerateEmailFormstackInput,
): FormstackPrefillField[] {
  const passengers = parsePassengerNames(input.reservationDetails);
  const numberOfPassengers = passengers.length;
  const amountOfDeals = countDealsOnContact(input.dealsOnContact);
  const agentName = `${input.contactFirstName ?? ""} ${input.contactLastName ?? ""}`.trim();
  const isFora = input.isFora === "true";
  const hasPassport = input.gotPassportPictures?.toLowerCase() === "yes";
  const formTypeLabel = resolveFormTypeLabel(input.formType);

  const passengerFields = PASSENGER_FIELD_IDS.map((fieldId, i) =>
    makeField(fieldId, passengers[i] ?? ""),
  );

  return [
    makeField(FIELD.hubspotDealId, input.hubspotDealId),
    makeField(FIELD.reservationDetails, input.reservationDetails),
    makeField(FIELD.penalties, input.penalties),
    makeField(FIELD.ratePP, input.ratePP),
    makeField(FIELD.amountOfDealsOnContact, String(amountOfDeals)),
    makeField(FIELD.agentName, agentName),
    makeField(FIELD.agencyName, isFora ? "Fora" : ""),
    makeField(FIELD.email, input.contactEmail),
    makeField(FIELD.ownersEmail, input.ownersEmail),
    makeField(FIELD.formType, formTypeLabel),
    makeField(FIELD.issueFee, input.issuingFee),
    makeField(FIELD.commissionPP, input.commissionRate),
    makeField(FIELD.baseFarePP, input.baseFarePP),
    makeField(FIELD.taxesAndFeesPP, input.taxesAndFeesPP),
    makeField(FIELD.dealName, input.dealName),
    makeField(FIELD.isFora, isFora ? "Yes" : ""),
    makeField(FIELD.hasPassport, hasPassport ? "Yes" : ""),
    makeField(FIELD.numberOfPassengers, String(numberOfPassengers)),
    ...passengerFields,
  ];
}

export function getFormstackPrefillConfig(): {
  token: string;
  formId: string;
} {
  const token = process.env.HIGHVIEW_FORMSTACK_PREFILL_TOKEN;
  const formId =
    process.env.HIGHVIEW_FORMSTACK_FORM_ID ?? DEFAULT_FORMSTACK_FORM_ID;

  if (!token) {
    throw new Error(
      "HIGHVIEW_FORMSTACK_PREFILL_TOKEN is not set in environment variables",
    );
  }

  return { token, formId };
}

/** POSTs to Formstack prefill API and returns the prefilled form URL. */
export async function fetchFormstackPrefilledUrl(
  fields: FormstackPrefillField[],
  options?: { formId?: string; token?: string },
): Promise<string> {
  const { token: envToken, formId: envFormId } = getFormstackPrefillConfig();
  const token = options?.token ?? envToken;
  const formId = options?.formId ?? envFormId;
  const url = `https://www.formstack.com/api/v2025/forms/${encodeURIComponent(formId)}/prefill`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Formstack prefill failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { prefilledUrl?: string };
  const prefilledUrl = json.prefilledUrl?.trim();
  if (!prefilledUrl) {
    throw new Error("Formstack prefill response missing prefilledUrl");
  }

  try {
    const u = new URL(prefilledUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error(`Formstack returned invalid prefilledUrl: ${prefilledUrl}`);
  }

  return prefilledUrl;
}
