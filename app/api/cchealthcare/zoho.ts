export type ZohoRecordDetails = { data?: Array<Record<string, unknown>> };

// Token management for Zoho OAuth
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export async function getZohoAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const accountsDomain =
    process.env.ZOHO_ACCOUNTS_DOMAIN || "accounts.zoho.com";

  const response = await fetch(
    `https://${accountsDomain}/oauth/v2/token?` +
      `refresh_token=${process.env.ZOHO_REFRESH_TOKEN}&` +
      `client_id=${process.env.ZOHO_CLIENT_ID}&` +
      `client_secret=${process.env.ZOHO_CLIENT_SECRET}&` +
      `grant_type=refresh_token`,
    {
      method: "POST",
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
  };

  return data.access_token;
}

export async function getZohoRecord(recordId: string) {
  const accessToken = await getZohoAccessToken();
  const zohoModule = process.env.ZOHO_MODULE || "Staff_Forms";
  const apiDomain = process.env.ZOHO_API_DOMAIN || "www.zohoapis.com";

  const response = await fetch(
    `https://${apiDomain}/crm/v2/${zohoModule}/${recordId}`,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch record: ${response.status} ${errorText}`);
  }

  return response.json();
}
