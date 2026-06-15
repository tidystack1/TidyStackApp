import { NextRequest, NextResponse } from "next/server";

/** HubSpot deal file property — passport uploads (append, do not replace). */
const HUBSPOT_DEAL_PASSPORT_PROPERTY = "passport";

type FormstackFieldValue = {
  field_id?: string;
  label?: string;
  value?: string;
  type?: string;
  url?: string;
};

function getConfig() {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  }

  return { token };
}

function parseInfoBody(body: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof body.info === "string") {
    try {
      return JSON.parse(body.info) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (
    body.info !== null &&
    body.info !== undefined &&
    typeof body.info === "object" &&
    !Array.isArray(body.info)
  ) {
    return body.info as Record<string, unknown>;
  }
  return null;
}

function fieldText(field: unknown): string {
  if (field && typeof field === "object" && "value" in field) {
    const value = (field as FormstackFieldValue).value;
    return value != null ? String(value).trim() : "";
  }
  if (typeof field === "string") return field.trim();
  return "";
}

/** Prefer Formstack admin download URL over the Zapier S3 `value`. */
function fieldFileUrl(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const f = field as FormstackFieldValue;
  if (f.url?.trim()) return f.url.trim();
  if (f.value?.trim()) return f.value.trim();
  return "";
}

function fileNameFromUrl(url: string): string {
  try {
    const base = new URL(url).pathname.split("/").pop();
    if (base && base.includes(".")) return decodeURIComponent(base);
  } catch {
    // fall through
  }
  return `passport_${Date.now()}`;
}

function guessMimeType(fileName: string, contentType: string | null): string {
  if (
    contentType &&
    !contentType.includes("text/html") &&
    contentType !== "application/octet-stream"
  ) {
    return contentType.split(";")[0]!.trim();
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function downloadFile(
  url: string,
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string }> {
  const res = await fetch(url, { redirect: "follow" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to download passport file (${res.status}): ${text.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type");
  const disposition = res.headers.get("content-disposition") ?? "";
  const nameMatch = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(disposition);
  const fileName = nameMatch?.[1]
    ? decodeURIComponent(nameMatch[1].replace(/"/g, ""))
    : fileNameFromUrl(url);
  const mimeType = guessMimeType(fileName, contentType);
  const bytes = new Uint8Array(await res.arrayBuffer());

  return { bytes, fileName, mimeType };
}

async function uploadFileToHubSpot(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  token: string,
): Promise<{ id: string; url: string }> {
  const form = new FormData();

  form.append(
    "file",
    new Blob([Buffer.from(fileBytes)], { type: mimeType }),
    fileName,
  );

  form.append(
    "options",
    JSON.stringify({
      access: "PUBLIC_NOT_INDEXABLE",
      overwrite: false,
      duplicateValidationStrategy: "NONE",
    }),
  );

  form.append("folderPath", "/passports");
  form.append("fileName", fileName);

  const res = await fetch("https://api.hubapi.com/files/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot file upload failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { id: string; url: string };
  return { id: json.id, url: json.url };
}

async function getDealProperty(
  dealId: string,
  property: string,
  token: string,
): Promise<string> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=${encodeURIComponent(property)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal read failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { properties?: Record<string, string> };
  return (json.properties?.[property] ?? "").trim();
}

/** HubSpot multi-file properties use semicolon-separated file IDs. */
function appendFileId(existing: string, newId: string): string {
  if (!existing) return newId;

  const ids = existing
    .split(";")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.includes(newId)) return existing;
  return [...ids, newId].join(";");
}

async function patchDealProperties(
  dealId: string,
  properties: Record<string, string>,
  token: string,
): Promise<void> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal update failed (${res.status}): ${text}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { token } = getConfig();

    const body = (await request.json()) as Record<string, unknown>;
    const info = parseInfoBody(body);

    if (!info) {
      return NextResponse.json(
        { error: "Could not parse `info` field as JSON" },
        { status: 400 },
      );
    }

    const dealId = fieldText(info["Deal ID"]);
    if (!dealId) {
      return NextResponse.json(
        { error: "Deal ID is missing from the form data" },
        { status: 400 },
      );
    }

    const sourceUrl = fieldFileUrl(info["File"]);
    if (!sourceUrl) {
      return NextResponse.json(
        { error: "File URL is missing from the form data" },
        { status: 400 },
      );
    }

    console.log(
      `[passport-submission] Downloading passport for deal ${dealId} from ${sourceUrl}`,
    );
    const { bytes, fileName, mimeType } = await downloadFile(sourceUrl);

    console.log(
      `[passport-submission] Uploading ${fileName} to HubSpot Files`,
    );
    const { id: fileId, url: fileUrl } = await uploadFileToHubSpot(
      bytes,
      fileName,
      mimeType,
      token,
    );

    const existingPassport = await getDealProperty(
      dealId,
      HUBSPOT_DEAL_PASSPORT_PROPERTY,
      token,
    );
    const passportValue = appendFileId(existingPassport, fileId);

    console.log(
      `[passport-submission] Updating deal ${dealId} property "${HUBSPOT_DEAL_PASSPORT_PROPERTY}" (append)`,
    );
    await patchDealProperties(
      dealId,
      { [HUBSPOT_DEAL_PASSPORT_PROPERTY]: passportValue },
      token,
    );

    return NextResponse.json({
      success: true,
      dealId,
      fileId,
      fileUrl,
      sourceUrl,
      property: HUBSPOT_DEAL_PASSPORT_PROPERTY,
      passportValue,
      appended: Boolean(existingPassport),
    });
  } catch (error) {
    console.error("[passport-submission] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to submit passport to HubSpot",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
