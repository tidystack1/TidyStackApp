export const LOBBIE_TOKEN_URL = "https://api.lobbie.com/oauth2/token";
export const LOBBIE_API_BASE = "https://api-prod.lobbie.com/lobbie/api";
export const LOBBIE_TOKEN_SCOPE = "prod-lobbie-api/partner-api";

export const ASPIRE_ACCOUNT_ID = 533;
export const ASPIRE_LOCATION_ID = 971;
export const CLIENT_INTAKE_FORM_TEMPLATE_ID = 25622;

export const FORWARD_WEBHOOK_URL =
  "https://webhook.site/9d741498-adbc-49d3-90d0-a90e4af4df89";

export const INTAKE_ELEMENT_IDS = {
  firstName: 5360629,
  lastName: 5360630,
  dateOfBirth: 5360631,
  gender: 5360632,
  fullAddress: 5360635,
  diagnosticReport: 5360610,
  insurance: 5360611,
  memberId: 5360613,
  insuranceCardFront: 5360616,
  insuranceCardBack: 5360617,
  guardian1Name: 5360640,
  guardian1Email: 5360643,
  guardian1Cell: 5360646,
  guardian2Name: 5360648,
  guardian2Email: 5360651,
  guardian2Cell: 5360654,
  emergencyContact: 5360685,
  primaryCarePhysician: 5360747,
  pcpPhone: 5360748,
} as const;

export function getLobbieCredentials(): {
  clientId: string;
  clientSecret: string;
  apiKey: string;
} {
  const clientId = process.env.ASPIRE_LOBBIE_CLIENT_ID?.trim();
  const clientSecret = process.env.ASPIRE_LOBBIE_CLIENT_SECRET?.trim();
  const apiKey = process.env.ASPIRE_LOBBIE_API_KEY?.trim();

  if (!clientId || !clientSecret || !apiKey) {
    throw new Error(
      "Missing ASPIRE_LOBBIE_CLIENT_ID, ASPIRE_LOBBIE_CLIENT_SECRET, or ASPIRE_LOBBIE_API_KEY",
    );
  }

  return { clientId, clientSecret, apiKey };
}
