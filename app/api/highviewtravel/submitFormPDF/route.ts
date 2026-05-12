import { NextRequest, NextResponse } from "next/server";
import { parseFormPDFBody } from "../_shared/parse-form-body";
import {
  buildPDF,
  parseSafeFileName,
  str,
  type FormData,
} from "../_shared/pdf-builder";

/** HubSpot CRM `crm/v3/pipelines/deals` — pipeline "Ticketing" */
const HUBSPOT_TICKETING_PIPELINE_ID = "9038862";
/** Same API — stage "FORM RECEIVED/SEND IN SALE" within Ticketing */
const HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID = "25756531";

function currency(value: string): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return value || "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function present(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "0" && trimmed !== "0.00";
}

function inferPassengerCount(data: FormData): number {
  const explicit = parseInt(str(data, "Number of passengers") || "0", 10);
  if (!Number.isNaN(explicit) && explicit > 0) return explicit;

  let max = 0;
  const re = /^Passenger (\d+)\s/;
  for (const key of Object.keys(data)) {
    const m = key.match(re);
    if (!m) continue;
    const n = parseInt(m[1] ?? "0", 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function withLineBreaks(value: string): string {
  return escapeHtml(value).replaceAll(/\r?\n/g, "<br/>");
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:6px 10px;border:1px solid #e6e6e6;background:#f7f7f7;font-weight:600;width:32%;">${escapeHtml(label)}</td>
      <td style="padding:6px 10px;border:1px solid #e6e6e6;">${withLineBreaks(value || "—")}</td>
    </tr>
  `;
}

function section(title: string, rows: string): string {
  return `
    <h3 style="margin:20px 0 8px;font-size:16px;color:#1a1a1a;">${escapeHtml(title)}</h3>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">
      ${rows}
    </table>
  `;
}

function buildEmailHtml(data: FormData, dealName: string, dealId: string): string {
  const formType = str(data, "Form Type");
  const isFora = formType === "Fora";
  const numPassengers = inferPassengerCount(data);
  const amountOfDeals = parseInt(str(data, "Amount of deals on contact") || "0", 10);
  const mailingAddressSame =
    str(
      data,
      "Is the mailing address for commission check the same as the agency address?",
    ) === "YES";
  const checkPayableSame =
    str(
      data,
      "Is the commission's check payable name the same as the agency name?",
    ) === "YES";

  const agentRows: string[] = [
    row("Agent Name", str(data, "Agent Name")),
    row("Agency Name", str(data, "Agency Name")),
    row("Email", str(data, "Email")),
  ];
  if (amountOfDeals === 1) {
    const agencyAddr = str(data, "Please provide your agency address");
    if (agencyAddr) agentRows.push(row("Agency Address", agencyAddr));
  }
  if (!mailingAddressSame) {
    const mailingAddr = str(data, "Mailing Address");
    if (mailingAddr) agentRows.push(row("Mailing Address", mailingAddr));
  }
  if (!checkPayableSame) {
    const checkPayable = str(data, "Check Payable to");
    if (checkPayable) agentRows.push(row("Check Payable to", checkPayable));
  }

  const bookingRows: string[] = [];
  const reservationDetails = str(data, "Reservation Details");
  const penalties = str(data, "Penalties");
  if (reservationDetails) bookingRows.push(row("Reservation Details", reservationDetails));
  if (penalties) bookingRows.push(row("Penalties", penalties));
  if (bookingRows.length === 0) bookingRows.push(row("Details", "No booking details provided."));

  const passengerSections: string[] = [];
  for (let i = 1; i <= numPassengers; i++) {
    const details: string[] = [];
    const seat = str(data, `Passenger ${i} Seat Preference`);
    const ff = str(data, `Passenger ${i} Frequent Flyer #`);
    const kt = str(data, `Passenger ${i} Known Traveler #`);
    const special = str(data, `Passenger ${i} Special Requests`);
    if (seat) details.push(row("Seat Preference", seat));
    if (ff) details.push(row("Frequent Flyer #", ff));
    if (kt) details.push(row("Known Traveler #", kt));
    if (special) details.push(row("Special Requests", special));
    if (details.length === 0) details.push(row("Details", "No additional details provided."));
    passengerSections.push(section(`Passenger ${i}`, details.join("")));
  }

  const paymentRows = row("Form of Payment", str(data, "Form of payment"));

  const fareRows: string[] = [];
  const ratePerPerson = str(data, "RATE PER PERSON");
  const basePerPerson = str(data, "Base Per Person");
  const issuingFee = str(data, "Issuing Fee");
  const commissionPP = str(data, "+ COMMISSION PP");
  const taxesAndFees = str(data, "Taxes and Fees Per Person");
  const totalPerPerson = str(data, "Total Per Person");
  const total = str(data, "Total");
  const ccFee = str(data, "+ 3.5% CC FEE (NON-REFUNDABLE)");
  const totalAuthorized = str(data, "= TOTAL AUTHORIZED TO CHARGE PP*");

  if (!isFora && present(ratePerPerson)) fareRows.push(row("Rate Per Person", currency(ratePerPerson)));
  if (isFora && present(basePerPerson)) fareRows.push(row("Base Per Person", currency(basePerPerson)));
  if (isFora && present(taxesAndFees)) fareRows.push(row("Taxes & Fees Per Person", currency(taxesAndFees)));
  if (present(issuingFee)) fareRows.push(row("Issuing Fee", currency(issuingFee)));
  if (present(commissionPP)) fareRows.push(row("+ Commission PP", currency(commissionPP)));
  if (present(totalPerPerson)) fareRows.push(row("Total Per Person", currency(totalPerPerson)));
  if (!isFora && present(total)) fareRows.push(row("Total", currency(total)));
  if (present(ccFee)) fareRows.push(row("+ 3.5% CC Fee (non-refundable)", currency(ccFee)));
  if (present(totalAuthorized)) {
    fareRows.push(row("= Total Authorized to Charge PP*", currency(totalAuthorized)));
  }
  if (fareRows.length === 0) fareRows.push(row("Fare", "No fare details provided."));

  const passengerBlock =
    passengerSections.length > 0
      ? `
        <h3 style="margin:20px 0 8px;font-size:16px;color:#1a1a1a;">Passenger Details (${numPassengers} Passenger${numPassengers > 1 ? "s" : ""})</h3>
        ${passengerSections.join("")}
      `
      : "";

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1a1a1a;max-width:780px;margin:0 auto;">
      <h2 style="margin:0 0 6px;font-size:22px;">Travel Booking Summary</h2>
      <p style="margin:0 0 14px;color:#555;">Deal: ${escapeHtml(dealName)} (${escapeHtml(dealId)})</p>
      ${section("Agent Information", agentRows.join(""))}
      ${section("Booking Details", bookingRows.join(""))}
      ${passengerBlock}
      ${section("Payment Information", paymentRows)}
      ${section("Fare Breakdown", fareRows.join(""))}
    </div>
  `;
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const token = process.env.HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN;
  const property = process.env.HIGHVIEWTRAVEL_HUBSPOT_DEAL_PDF_PROPERTY;

  if (!token)
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN is not set in environment variables",
    );
  if (!property)
    throw new Error(
      "HIGHVIEWTRAVEL_HUBSPOT_DEAL_PDF_PROPERTY is not set in environment variables",
    );

  return { token, property };
}

// ─── HubSpot helpers ──────────────────────────────────────────────────────────

/**
 * HubSpot `fieldType: "file"` properties store **file IDs** (from File Manager), not URLs.
 * Passing a URL makes the UI show a link-like row instead of a real attachment.
 */
function mergeDealFilePropertyValue(
  existing: string | undefined,
  newFileId: string,
): string {
  const segments = (existing ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  // Drop mistaken URL strings from older integrations; keep real IDs from manual uploads.
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

/**
 * Upload a PDF file to HubSpot's File Manager.
 * Returns the File Manager id and public URL.
 */
async function uploadFileToHubSpot(
  pdfBytes: Uint8Array,
  fileName: string,
  token: string,
): Promise<{ id: string; url: string }> {
  const form = new FormData();

  form.append(
    "file",
    new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" }),
    fileName,
  );

  // PUBLIC_NOT_INDEXABLE: accessible via direct URL but not indexed by search engines
  form.append(
    "options",
    JSON.stringify({
      access: "PUBLIC_NOT_INDEXABLE",
      overwrite: false,
      duplicateValidationStrategy: "NONE",
    }),
  );

  form.append("folderPath", "/form-pdfs");
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

/** PATCH deal properties (`pipeline` + `dealstage` move the deal to another pipeline/stage). */
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

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { token, property } = getConfig();

    const body = (await request.json()) as Record<string, unknown>;
    const data = parseFormPDFBody(body);

    if (!data) {
      return NextResponse.json(
        { error: "Could not parse `info` field as JSON" },
        { status: 400 },
      );
    }

    const dealId = str(data, "HubSpot Deal ID");
    if (!dealId) {
      return NextResponse.json(
        { error: "HubSpot Deal ID is missing from the form data" },
        { status: 400 },
      );
    }

    const dealName = str(data, "HubSpot Deal Name") || "booking";
    const fileName = `${parseSafeFileName(dealName)}_summary.pdf`;

    // 1. Generate the PDF
    console.log(
      `[submitFormPDF] Generating PDF for deal ${dealId} (${dealName})`,
    );
    const pdfBytes = await buildPDF(data);

    // 2. Upload to HubSpot File Manager
    console.log(`[submitFormPDF] Uploading ${fileName} to HubSpot Files`);
    const { id: fileId, url: fileUrl } = await uploadFileToHubSpot(
      pdfBytes,
      fileName,
      token,
    );
    console.log(`[submitFormPDF] Uploaded successfully: ${fileUrl} (id=${fileId})`);

    const previous = await fetchDealFileProperty(dealId, property, token);
    const propertyValue = mergeDealFilePropertyValue(previous, fileId);
    const emailHtml = buildEmailHtml(data, dealName, dealId);

    // 3. File property + Ticketing / FORM RECEIVED/SEND IN SALE (single PATCH)
    const dealProps: Record<string, string> = {
      [property]: propertyValue,
      pipeline: HUBSPOT_TICKETING_PIPELINE_ID,
      dealstage: HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID,
    };

    console.log(
      `[submitFormPDF] Updating deal ${dealId} → pipeline ${HUBSPOT_TICKETING_PIPELINE_ID}, stage ${HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID}; property "${property}"`,
    );
    await patchDealProperties(dealId, dealProps, token);
    console.log(`[submitFormPDF] Deal updated successfully`);

    return NextResponse.json({
      success: true,
      dealId,
      dealName,
      fileId,
      fileUrl,
      property,
      pipelineId: HUBSPOT_TICKETING_PIPELINE_ID,
      dealStageId: HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID,
      emailHtml,
    });
  } catch (error) {
    console.error("[submitFormPDF] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to submit PDF to HubSpot",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
