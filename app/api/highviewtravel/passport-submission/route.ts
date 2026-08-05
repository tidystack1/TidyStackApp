import { NextRequest, NextResponse } from "next/server";
import { getFormstackPrefillConfig } from "../_shared/formstack-prefill";

/** HubSpot deal file property — passport uploads (append, do not replace). */
const HUBSPOT_DEAL_PASSPORT_PROPERTY = "passport";

type FormstackFieldValue = {
  field_id?: string;
  label?: string;
  value?: string;
  type?: string;
  url?: string | string[];
};

type ResolvedPassportFile = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  source: string;
  index: number;
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

function parseInfoPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (raw !== null && raw !== undefined && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

/** Zapier sends `{ info: "..." }` or `{ data: { info: "..." } }`. */
function parseInfoBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const direct = parseInfoPayload(body.info);
  if (direct) return direct;

  if (
    body.data !== null &&
    body.data !== undefined &&
    typeof body.data === "object" &&
    !Array.isArray(body.data)
  ) {
    return parseInfoPayload((body.data as Record<string, unknown>).info);
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

function fieldId(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const id = (field as FormstackFieldValue).field_id;
  return id != null ? String(id).trim() : "";
}

/** Zero-based Formstack upload indexes from `File.url` (`.../file/{id}/0`, `/1`, …). */
function fileIndexesFromField(field: unknown): number[] {
  if (!field || typeof field !== "object") return [0];

  const url = (field as FormstackFieldValue).url;
  const urls = Array.isArray(url) ? url : url ? [url] : [];
  if (urls.length === 0) return [0];

  const indexes = urls.map((entry, i) => {
    const match = /\/(\d+)\/?$/.exec(String(entry).trim());
    return match ? Number(match[1]) : i;
  });

  return [...new Set(indexes)].sort((a, b) => a - b);
}

function isZapierHydrateToken(value: string): boolean {
  return value.startsWith("hydrate|||") && value.endsWith("|||hydrate");
}

/** Direct-download URL when Zapier sends a public link (e.g. S3), not a hydrate token. */
function directFileUrl(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const value = (field as FormstackFieldValue).value?.trim() ?? "";
  if (!value || isZapierHydrateToken(value)) return "";
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return "";
}

function extensionFromFileName(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function extensionFromBytes(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  return null;
}

/** HubSpot upload name: `{dealId}_{original Formstack filename}`. */
function buildPassportFileName(dealId: string, sourceFileName: string): string {
  const name = sourceFileName.trim() || "passport";
  return `${dealId}_${name}`;
}

function mimeTypeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
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

function fileNameFromResponse(
  disposition: string | null,
  fallback: string,
): string {
  const nameMatch = /filename\*?=(?:UTF-8''|")?([^";\n]+)/i.exec(disposition ?? "");
  if (nameMatch?.[1]) {
    return decodeURIComponent(nameMatch[1].replace(/"/g, ""));
  }
  return fallback;
}

async function downloadFromUrl(
  url: string,
  fallbackFileName: string,
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string }> {
  const res = await fetch(url, { redirect: "follow" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Failed to download passport file (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  const contentType = res.headers.get("content-type");
  const fileName = fileNameFromResponse(
    res.headers.get("content-disposition"),
    fileNameFromUrl(url) || fallbackFileName,
  );
  const mimeType = guessMimeType(fileName, contentType);
  const bytes = new Uint8Array(await res.arrayBuffer());

  return { bytes, fileName, mimeType };
}

/**
 * Formstack admin URLs require login; use the v2025 API with our PAT instead.
 * @see https://developers.formstack.com/reference/getsubmissionupload-1
 */
async function downloadFromFormstackSubmission(
  submissionId: string,
  uploadFieldId: string,
  formstackToken: string,
  index: number,
): Promise<{ bytes: Uint8Array; fileName: string; mimeType: string }> {
  const params = new URLSearchParams({
    fieldId: uploadFieldId,
    index: String(index),
  });
  const url = `https://www.formstack.com/api/v2025/submissions/${encodeURIComponent(submissionId)}/upload?${params}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${formstackToken}`,
      Accept: "application/octet-stream",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Formstack file download failed (${res.status}, index=${index}): ${text.slice(0, 300)}`,
    );
  }

  const fallbackFileName = `passport_${submissionId}_${index}`;
  const fileName = fileNameFromResponse(
    res.headers.get("content-disposition"),
    fallbackFileName,
  );
  const mimeType = guessMimeType(fileName, res.headers.get("content-type"));
  const bytes = new Uint8Array(await res.arrayBuffer());

  return { bytes, fileName, mimeType };
}

async function resolvePassportFiles(
  info: Record<string, unknown>,
): Promise<ResolvedPassportFile[]> {
  const fileField = info["File"];
  const submissionId = fieldText(info["UniqueID"]);
  const uploadFieldId = fieldId(fileField);
  const publicUrl = directFileUrl(fileField);
  const indexes = fileIndexesFromField(fileField);

  if (submissionId && uploadFieldId) {
    const { token: formstackToken } = getFormstackPrefillConfig();
    console.log(
      `[passport-submission] Downloading ${indexes.length} file(s) via Formstack API (submission=${submissionId}, field=${uploadFieldId}, indexes=${indexes.join(",")})`,
    );
    const files: ResolvedPassportFile[] = [];
    for (const index of indexes) {
      const file = await downloadFromFormstackSubmission(
        submissionId,
        uploadFieldId,
        formstackToken,
        index,
      );
      files.push({ ...file, source: "formstack-api", index });
    }
    return files;
  }

  if (publicUrl) {
    console.log(`[passport-submission] Downloading from public URL ${publicUrl}`);
    const file = await downloadFromUrl(publicUrl, `passport_${Date.now()}`);
    return [{ ...file, source: "direct-url", index: 0 }];
  }

  throw new Error(
    "Could not resolve passport file: need UniqueID + File.field_id for Formstack API, or a public file URL in File.value",
  );
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

async function getDealProperties(
  dealId: string,
  properties: string[],
  token: string,
): Promise<Record<string, string>> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=${encodeURIComponent(properties.join(","))}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal read failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    properties?: Record<string, string | null | undefined>;
  };
  const result: Record<string, string> = {};
  for (const key of properties) {
    result[key] = (json.properties?.[key] ?? "").trim();
  }
  return result;
}

async function getHubSpotPortalId(token: string): Promise<string> {
  const fromEnv = process.env.HIGHVIEWTRAVEL_HUBSPOT_PORTAL_ID?.trim();
  if (fromEnv) return fromEnv;

  const res = await fetch("https://api.hubapi.com/account-info/v3/details", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot account lookup failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { portalId?: number | string };
  const portalId = json.portalId != null ? String(json.portalId).trim() : "";
  if (!portalId) {
    throw new Error("HubSpot account lookup returned no portalId");
  }
  return portalId;
}

function hubSpotDealUrl(portalId: string, dealId: string): string {
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

/** HubSpot multi-file properties use semicolon-separated file IDs. */
function appendFileIds(existing: string, newIds: string[]): string {
  const ids = existing
    .split(";")
    .map((id) => id.trim())
    .filter(Boolean);

  for (const newId of newIds) {
    if (newId && !ids.includes(newId)) ids.push(newId);
  }

  return ids.join(";");
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

    console.log(`[passport-submission] Resolving passport file(s) for deal ${dealId}`);
    const [resolvedFiles, dealProps, portalId] = await Promise.all([
      resolvePassportFiles(info),
      getDealProperties(dealId, [HUBSPOT_DEAL_PASSPORT_PROPERTY, "dealname"], token),
      getHubSpotPortalId(token),
    ]);
    const dealName = dealProps.dealname ?? "";
    const dealUrl = hubSpotDealUrl(portalId, dealId);

    const uploaded: Array<{
      fileId: string;
      fileUrl: string;
      fileName: string;
      sourceFileName: string;
      source: string;
      index: number;
    }> = [];

    for (const resolved of resolvedFiles) {
      const sourceLabel =
        resolvedFiles.length > 1
          ? `${resolved.index}_${resolved.fileName}`
          : resolved.fileName;
      const fileName = buildPassportFileName(dealId, sourceLabel);
      const ext =
        extensionFromFileName(resolved.fileName) ??
        extensionFromBytes(resolved.bytes) ??
        "bin";
      const mimeType =
        resolved.mimeType === "application/octet-stream" ||
        resolved.mimeType === "application/x-www-form-urlencoded"
          ? mimeTypeFromExtension(ext)
          : resolved.mimeType;

      console.log(
        `[passport-submission] Uploading ${fileName} to HubSpot Files (source: ${resolved.fileName}, index: ${resolved.index})`,
      );
      const { id: fileId, url: fileUrl } = await uploadFileToHubSpot(
        resolved.bytes,
        fileName,
        mimeType,
        token,
      );
      uploaded.push({
        fileId,
        fileUrl,
        fileName,
        sourceFileName: resolved.fileName,
        source: resolved.source,
        index: resolved.index,
      });
    }

    const existingPassport = dealProps[HUBSPOT_DEAL_PASSPORT_PROPERTY] ?? "";
    const passportValue = appendFileIds(
      existingPassport,
      uploaded.map((file) => file.fileId),
    );

    console.log(
      `[passport-submission] Updating deal ${dealId} property "${HUBSPOT_DEAL_PASSPORT_PROPERTY}" (append ${uploaded.length} file(s))`,
    );
    await patchDealProperties(
      dealId,
      { [HUBSPOT_DEAL_PASSPORT_PROPERTY]: passportValue },
      token,
    );

    const first = uploaded[0]!;
    const fileUrls = uploaded.map((file) => file.fileUrl);
    return NextResponse.json({
      success: true,
      dealId,
      dealName,
      dealUrl,
      passportCount: uploaded.length,
      fileUrls,
      fileUrlsText: fileUrls.join("\n"),
      fileCount: uploaded.length,
      files: uploaded,
      fileId: first.fileId,
      fileUrl: first.fileUrl,
      fileName: first.fileName,
      sourceFileName: first.sourceFileName,
      source: first.source,
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
