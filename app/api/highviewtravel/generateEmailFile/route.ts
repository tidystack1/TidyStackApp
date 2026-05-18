import { randomBytes } from "crypto";
// import { readFile } from "fs/promises";
// import path from "path";
import { NextRequest, NextResponse } from "next/server";

// PNG signature (booking-email-signature.png in this folder) — not embedded in .eml at the moment.
// /** Embedded signature image (extracted from the reference `.eml` in this folder). */
// const SIGNATURE_PNG_FILE = "booking-email-signature.png";
// /** Content-ID for `multipart/related` — must match `cid:` in HTML. */
// const SIGNATURE_CID = "booking-signature@highviewtravel.local";

/** HubSpot deal property for the booking-link `.eml` attachment (internal name). */
const DEFAULT_FORM_EMAIL_DEAL_PROPERTY = "form_email_attachment";

function getConfig() {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;
  const property =
    process.env.HIGHVIEWTRAVEL_HUBSPOT_DEAL_FORM_EMAIL_PROPERTY ??
    DEFAULT_FORM_EMAIL_DEAL_PROPERTY;

  if (!token) {
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  }

  return { token, property };
}

function mergeDealFilePropertyValue(
  existing: string | undefined,
  newFileId: string,
): string {
  const segments = (existing ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = segments.filter((s) => !/^https?:\/\//i.test(s));
  const ids = [...new Set([...kept, newFileId])];
  return ids.join(";");
}

async function fetchDealFileProperty(
  dealId: string,
  property: string,
  token: string,
): Promise<string | undefined> {
  const url = new URL(
    `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
  );
  url.searchParams.set("properties", property);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal fetch failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    properties?: Record<string, string | null>;
  };
  const raw = json.properties?.[property];
  return raw ?? undefined;
}

async function uploadEmlToHubSpot(
  emlBytes: Uint8Array,
  fileName: string,
  token: string,
): Promise<{ id: string; url: string }> {
  const form = new FormData();

  form.append(
    "file",
    new Blob([Buffer.from(emlBytes)], { type: "message/rfc822" }),
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

  form.append("folderPath", "/form-emails");
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replaceAll("\n", "&#10;").replaceAll("\r", "&#13;");
}

function withLineBreaksHtml(value: string): string {
  return escapeHtml(value).replaceAll(/\r?\n/g, "<br/>");
}

// PNG signature — not using at the moment (see commented block in buildBookingLinkEml).
// function toBase64MimeLines(buf: Buffer): string {
//   const b64 = buf.toString("base64");
//   const CRLF = "\r\n";
//   const lines: string[] = [];
//   for (let i = 0; i < b64.length; i += 76) {
//     lines.push(b64.slice(i, i + 76));
//   }
//   return lines.join(CRLF);
// }
//
// async function loadSignaturePng(): Promise<Buffer> {
//   const filePath = path.join(
//     process.cwd(),
//     "app",
//     "api",
//     "highviewtravel",
//     "generateEmailFile",
//     SIGNATURE_PNG_FILE,
//   );
//   return readFile(filePath);
// }

/**
 * Builds a `.eml` matching the booking-link template (plain + HTML), with
 * dynamic reservation text and a form URL whose visible anchor text is `link`.
 */
function buildBookingLinkEml(
  reservationDetails: string,
  formLink: string,
): string {
  const CRLF = "\r\n";
  const boundary = `----=_Part_${randomBytes(16).toString("hex")}`;

  const resPlain = reservationDetails.replace(/\r?\n/g, CRLF);

  const plainBody = [
    "Hi,",
    "",
    "The reservation is on hold.",
    "",
    resPlain,
    "",
    "Please ensure that the names and flights are booked correctly.",
    "",
    "Airlines do not allow name changes. We will not be responsible for any fees",
    "or fare differences that will occur if a reservation needs to be rebooked.",
    "",
    "If all is in order, here's the form link to proceed with issuance:",
    "",
    formLink,
    "",
    "The submission gives us consent that these flights will be paid in full.",
    "",
    "Forms that come through by 5:45 pm will be issued same day. Otherwise, it'll",
    "be handled on the next business day.",
    "",
    "INSERT SIGNATURE HERE",
    "",
    "Paste this on top of full conversation we had until flights were finalized",
  ].join(CRLF);

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Booking link</title>
</head>
<body style="margin:0;font-family:Calibri,sans-serif;font-size:12pt;color:#000;">
<p>Hi,</p>
<p>The reservation is on hold.</p>
<p style="white-space:pre-wrap;margin:0;">${withLineBreaksHtml(reservationDetails)}</p>
<p>Please ensure that the names and flights are booked correctly.</p>
<p>Airlines do not allow name changes. We will not be responsible for any fees or fare differences that will occur if a reservation needs to be rebooked.</p>
<p>If all is in order, here's the form <a href="${escapeHtmlAttr(formLink)}">LINK</a> to proceed with issuance:</p>
<p>The submission gives us consent that these flights will be paid in full.</p>
<p><strong>Forms that come through by 5:45 pm will be issued same day. Otherwise, it'll be handled on the next business day.</strong></p>
<p style="margin:12px 0 0;"><strong>INSERT SIGNATURE HERE</strong></p>
<p>Paste this on top of full conversation we had until flights were finalized</p>
</body>
</html>`;

  const mime = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plainBody,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
    `--${boundary}--`,
  ].join(CRLF);

  const headers = [
    "MIME-Version: 1.0",
    'From: "Lisa F" <lisa@highviewtravel.com>',
    "To: undisclosed-recipients:;",
    "Subject: this is the email we use when sending the booking link",
    `Content-Type: multipart/alternative;`,
    `\tboundary="${boundary}"`,
    "",
    mime,
  ].join(CRLF);

  return headers + CRLF;
}

// PNG signature — not using at the moment. To re-enable booking-email-signature.png in the .eml:
// uncomment SIGNATURE_* constants, fs/path imports, loadSignaturePng, toBase64MimeLines, and the
// POST loader; change buildBookingLinkEml to accept signaturePng: Buffer; use multipart/related
// (outer boundary) wrapping multipart/alternative (plain + html) plus an image/png part with
// Content-ID matching <img src="cid:..."> in HTML (see git history for full implementation).
function parsePayload(body: Record<string, unknown>): {
  reservationDetails: string;
  formLink: string;
  hubspotDealId: string;
} | null {
  const reservationDetails = String(body.reservationDetails ?? "").trim();
  const formLinkRaw = String(body.formLink ?? "").trim();
  const hubspotDealId = String(
    body.hubspotDealId ?? body.hubSpotDealId ?? "",
  ).trim();

  if (!reservationDetails || !formLinkRaw || !hubspotDealId) return null;

  let formLink: string;
  try {
    const u = new URL(formLinkRaw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    formLink = u.toString();
  } catch {
    return null;
  }

  return { reservationDetails, formLink, hubspotDealId };
}

export async function POST(request: NextRequest) {
  try {
    const { token, property } = getConfig();

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parsePayload(body);

    if (!parsed) {
      return NextResponse.json(
        {
          error:
            "Invalid payload: require reservationDetails, formLink (valid URL), and hubspotDealId",
        },
        { status: 400 },
      );
    }

    const { reservationDetails, formLink, hubspotDealId } = parsed;
    // PNG signature — not using at the moment
    // const signaturePng = await loadSignaturePng();
    // const eml = buildBookingLinkEml(reservationDetails, formLink, signaturePng);
    const eml = buildBookingLinkEml(reservationDetails, formLink);
    const emlBytes = Buffer.from(eml, "utf-8");
    const fileName = `deal_${hubspotDealId}_booking_link.eml`;

    console.log(
      `[generateEmailFile] Uploading ${fileName} for deal ${hubspotDealId}`,
    );
    const { id: fileId, url: fileUrl } = await uploadEmlToHubSpot(
      emlBytes,
      fileName,
      token,
    );

    const previous = await fetchDealFileProperty(
      hubspotDealId,
      property,
      token,
    );
    const propertyValue = mergeDealFilePropertyValue(previous, fileId);

    await patchDealProperties(
      hubspotDealId,
      { [property]: propertyValue },
      token,
    );

    console.log(`[generateEmailFile] Deal ${hubspotDealId} updated`);

    return NextResponse.json({
      success: true,
      dealId: hubspotDealId,
      fileId,
      fileUrl,
      property,
    });
  } catch (error) {
    console.error("[generateEmailFile] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to generate email file or update HubSpot deal",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
