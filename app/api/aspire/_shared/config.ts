export const LOBBIE_TOKEN_URL = "https://api.lobbie.com/oauth2/token";
export const LOBBIE_API_BASE = "https://api-prod.lobbie.com/lobbie/api";
export const LOBBIE_TOKEN_SCOPE = "prod-lobbie-api/partner-api";

export const ASPIRE_ACCOUNT_ID = 533;
export const ASPIRE_LOCATION_ID = 971;
export const CLIENT_INTAKE_FORM_TEMPLATE_ID = 25622;

export const FORWARD_WEBHOOK_URL =
  "https://webhook.site/9d741498-adbc-49d3-90d0-a90e4af4df89";

export const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";
export const CLICKUP_TEAM_ID = "90141469332";
export const CLICKUP_CLIENTS_LIST_ID = "901418967819";
export const CLICKUP_NEW_CLIENT_STATUS = "onboarding";

export const CLICKUP_FIELDS = {
  memberId: "08b71c50-7fc8-4773-a329-27cd67d11941",
  guardian2Email: "18af1777-48c8-4685-8b37-aa40128addf0",
  clientFirstName: "3491cf5b-e507-4dc8-a6ae-e3e9a28c2306",
  dateAdded: "3a3132a5-e05a-459d-b192-86dad736ccf9",
  primaryCarePhysician: "42ad397a-62e8-4f05-98db-b080253f8b69",
  emergencyContact: "4347d847-7c46-4b78-86b6-b211fde64dd0",
  gender: "6281d7bc-898f-4cc1-9705-343de5519b80",
  guardian1FirstName: "697d8bef-4b21-472c-96e8-9f053ddd80a8",
  guardian1Email: "7dae677a-aded-4c92-9dec-629ee28782a9",
  lobbiePatientId: "80dc4419-3119-451f-a238-5d3cd5a852b5",
  guardian2LastName: "848a8ce9-9761-446b-afc0-4007739e6102",
  guardian1LastName: "96591599-8b12-45c5-8936-eff854696ae7",
  pcpPhone: "b6b49a1e-2220-4855-b7ea-6904dcd8bbd8",
  insuranceCardBack: "b7388a7d-968c-458d-87ce-6c08bdabd4bd",
  clientLastName: "c5cb61e3-44e6-4a80-bcde-05227bfd81f6",
  address: "cb7ba223-cebf-4446-9a82-038fa44a6822",
  guardian1CellPhone: "d57c4df0-dab3-4bae-a87c-280acd18afb8",
  insurance: "d69425c6-ecb8-46d0-9931-b0e62b7a3e8e",
  insuranceCardFront: "d71a7b84-b975-4d70-b42d-de558bca6557",
  guardian2FirstName: "e628704f-4e24-4ff4-a659-5f720c35fd37",
  dateOfBirth: "fd45c546-2941-47fa-ab63-e365230d31eb",
  guardian2CellPhone: "33547973-b2e9-4e90-99cb-e0fdc973581d",
} as const;

export const CLICKUP_GENDER_OPTIONS: Record<string, string> = {
  male: "b08dafa7-9d4c-40d4-9a4f-1953e021f1ca",
  female: "413a84fa-fa1e-4010-8c64-37869f81b3be",
  "non-binary": "7f1f5b49-70f1-4038-b40f-e5fa2aed1fe1",
  "prefer not to say": "15a70151-4476-4194-abab-8a7e704eaf88",
  other: "91553cb8-f481-4404-abec-24c0cc84add5",
};

export function getClickUpToken(): string {
  const token = process.env.ASPIRE_CLICKUP_API_KEY?.trim();
  if (!token) {
    throw new Error("Missing ASPIRE_CLICKUP_API_KEY");
  }
  return token;
}

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
