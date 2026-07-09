import { NextRequest, NextResponse } from "next/server";
import { buildFormstackDefaultDataStyleDocx } from "../_shared/docx-builder";
import { parseFormPDFBody } from "../_shared/parse-form-body";
import {
  // buildFormstackDefaultDataStylePDF, // gray “client email” PDF — see commented block in POST
  buildPDF,
  isForaBooking,
  isNetRateForm,
  isNetRateWithCcFeeForm,
  isPublishedRateTicketingFeeForm,
  parseSafeFileName,
  str,
  type FormData,
} from "../_shared/pdf-builder";

/** HubSpot CRM `crm/v3/pipelines/deals` — pipeline "Ticketing" */
const HUBSPOT_TICKETING_PIPELINE_ID = "9038862";
/** Same API — stage "FORM RECEIVED/SEND IN SALE" within Ticketing */
const HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID = "25756531";
/** Deal file property internal name — gray Formstack-style PDF for client email (disabled in POST) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-enable with commented gray-PDF block
const HUBSPOT_DEAL_FORMSTACK_DEFAULT_PDF_PROPERTY = "form_result__client_email";
/** Deal single-line text — set to "Completed" when form PDF is generated */
const HUBSPOT_DEAL_LINK_STATUS_PROPERTY = "link_status";
/** Deal dropdown — Payment type */
const HUBSPOT_DEAL_PAYMENT_TYPE_PROPERTY = "what_kind_of_sale_";
/** Deal date — Start Travel Date */
const HUBSPOT_DEAL_START_TRAVEL_DATE_PROPERTY = "start_travel_date";
/** Deal date — Sale Date */
const HUBSPOT_DEAL_SALE_DATE_PROPERTY = "sale_date";
/** Deal multi-owner — collaborators (semicolon-prepended owner IDs) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-enable with collaborator block in POST
const HUBSPOT_DEAL_COLLABORATOR_PROPERTY = "hs_all_collaborator_owner_ids";

/** Sales agent email → Assist team collaborator email */
const SALES_AGENT_TO_COLLABORATOR_EMAIL: Record<string, string> = {
  "lisa@highviewtravel.com": "alison@highviewtravel.com",
  "becca@highviewtravel.com": "alison@highviewtravel.com",
  "dina@highviewtravel.com": "doris@highviewtravel.com",
  "kathy@highviewtravel.com": "laiza@highviewtravel.com",
  "emily@highviewtravel.com": "andrely@highviewtravel.com",
};

const MONTH_ABBREV_TO_INDEX: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

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

/** HubSpot date properties expect YYYY-MM-DD. */
function formatHubSpotDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Payment type (`what_kind_of_sale_`) from Form Type / Form of payment.
 * Wire/Check takes priority when Form of payment is Wire or Check.
 */
function resolvePaymentType(data: FormData): string | null {
  const formOfPayment = str(data, "Form of payment").toLowerCase();
  if (formOfPayment === "wire" || formOfPayment === "check") {
    return "Wire/Check";
  }

  const formType = str(data, "Form Type");
  if (formType === "Net Rate + CC Fee") {
    return "Internal Charge";
  }
  if (
    formType === "Commission off Published Rate" ||
    formType === "Net Rate (NO CC Fee)"
  ) {
    return "On PAX CC";
  }

  return null;
}

/**
 * Parse first DDMMM (e.g. 11NOV) from deal name.
 * Year is the next occurrence of that month/day from today (today counts).
 */
function parseStartTravelDateFromDealName(
  dealName: string,
  now = new Date(),
): string | null {
  const re = /(\d{1,2})([A-Za-z]{3})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(dealName)) !== null) {
    const day = parseInt(match[1] ?? "", 10);
    const monthKey = (match[2] ?? "").toUpperCase();
    const month = MONTH_ABBREV_TO_INDEX[monthKey];
    if (month === undefined || Number.isNaN(day) || day < 1 || day > 31) {
      continue;
    }

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let candidate = new Date(today.getFullYear(), month, day);
    if (candidate.getMonth() !== month || candidate.getDate() !== day) {
      continue; // invalid calendar date (e.g. 31FEB)
    }
    if (candidate < today) {
      candidate = new Date(today.getFullYear() + 1, month, day);
    }

    return formatHubSpotDate(candidate);
  }

  return null;
}

async function findOwnerIdByEmail(
  email: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/owners?email=${encodeURIComponent(email)}&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot owner lookup failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { results?: Array<{ id: string }> };
  return json.results?.[0]?.id ?? null;
}

async function getDealOwnerEmail(
  dealId: string,
  token: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=hubspot_owner_id`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot deal read failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    properties?: { hubspot_owner_id?: string | null };
  };
  const ownerId = json.properties?.hubspot_owner_id?.trim();
  if (!ownerId) return null;

  const ownerRes = await fetch(
    `https://api.hubapi.com/crm/v3/owners/${ownerId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!ownerRes.ok) {
    const text = await ownerRes.text();
    throw new Error(`HubSpot owner lookup failed (${ownerRes.status}): ${text}`);
  }

  const ownerJson = (await ownerRes.json()) as { email?: string };
  return ownerJson.email?.trim().toLowerCase() || null;
}

/**
 * Map deal sales agent → Assist collaborator; returns HubSpot property value
 * (`;{ownerId}`) or null if no match / owner not found.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- re-enable with collaborator block in POST
async function resolveCollaboratorOwnerIds(
  dealId: string,
  token: string,
): Promise<string | null> {
  const ownerEmail = await getDealOwnerEmail(dealId, token);
  if (!ownerEmail) {
    console.log(
      `[submitFormPDF] Deal ${dealId} has no owner; skipping collaborator`,
    );
    return null;
  }

  const collaboratorEmail = SALES_AGENT_TO_COLLABORATOR_EMAIL[ownerEmail];
  if (!collaboratorEmail) {
    console.log(
      `[submitFormPDF] No collaborator mapping for owner ${ownerEmail}; skipping`,
    );
    return null;
  }

  const collaboratorId = await findOwnerIdByEmail(collaboratorEmail, token);
  if (!collaboratorId) {
    console.warn(
      `[submitFormPDF] Collaborator owner not found for ${collaboratorEmail}`,
    );
    return null;
  }

  return `;${collaboratorId}`;
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

function buildEmailHtml(
  data: FormData,
  dealName: string,
): string {
  const isFora = isForaBooking(data);
  const numPassengers = inferPassengerCount(data);
  const amountOfDeals = parseInt(
    str(data, "Amount of deals on contact") || "0",
    10,
  );
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
  if (reservationDetails)
    bookingRows.push(row("Reservation Details", reservationDetails));
  if (penalties) bookingRows.push(row("Penalties", penalties));
  if (bookingRows.length === 0)
    bookingRows.push(row("Details", "No booking details provided."));

  const passengerSections: string[] = [];
  for (let i = 1; i <= numPassengers; i++) {
    const details: string[] = [];
    const passengerName = str(data, `Passenger ${i} Name`);
    const passengerLabel = passengerName
      ? `Passenger ${i} - ${passengerName}`
      : `Passenger ${i}`;
    const seat = str(data, `Passenger ${i} Seat Preference`);
    const ff = str(data, `Passenger ${i} Frequent Flyer #`);
    const kt = str(data, `Passenger ${i} Known Traveler #`);
    const airline = str(data, `Passenger ${i} Airline`);
    const special = str(data, `Passenger ${i} Special Requests`);
    if (seat) details.push(row("Seat Preference", seat));
    if (ff) details.push(row("Frequent Flyer #", ff));
    if (kt) details.push(row("Known Traveler #", kt));
    if (airline) details.push(row("Airline", airline));
    if (special) details.push(row("Special Requests", special));
    if (details.length === 0)
      details.push(row("Details", "No additional details provided."));
    passengerSections.push(section(passengerLabel, details.join("")));
  }

  const paymentRows: string[] = [
    row("Form of Payment", str(data, "Form of payment")),
  ];
  if (isPublishedRateTicketingFeeForm(data)) {
    const feePayment = str(data, "How will you pay the fee?");
    if (present(feePayment)) {
      paymentRows.push(row("How will you pay the fee?", feePayment));
    }
  }

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

  if (present(ratePerPerson))
    fareRows.push(row("Rate Per Person", currency(ratePerPerson)));
  if (isFora && present(basePerPerson))
    fareRows.push(row("Base Per Person", currency(basePerPerson)));
  if (isFora && present(taxesAndFees))
    fareRows.push(row("Taxes & Fees Per Person", currency(taxesAndFees)));
  if (present(issuingFee))
    fareRows.push(row("Issuing Fee", currency(issuingFee)));
  if (present(commissionPP))
    fareRows.push(row("+ Commission PP", currency(commissionPP)));
  if (present(totalPerPerson))
    fareRows.push(row("Total Per Person", currency(totalPerPerson)));
  if (isNetRateForm(data) && present(total)) fareRows.push(row("Total", currency(total)));
  if (present(ccFee))
    fareRows.push(row("+ 3.5% CC Fee (non-refundable)", currency(ccFee)));
  if (isNetRateWithCcFeeForm(data) && present(totalAuthorized)) {
    fareRows.push(
      row("= Total Authorized to Charge PP*", currency(totalAuthorized)),
    );
  }
  if (fareRows.length === 0)
    fareRows.push(row("Fare", "No fare details provided."));

  const passengerBlock =
    passengerSections.length > 0
      ? `
        <h3 style="margin:20px 0 8px;font-size:16px;color:#1a1a1a;">Passenger Details (${numPassengers} Passenger${numPassengers > 1 ? "s" : ""})</h3>
        ${passengerSections.join("")}
      `
      : "";
  const submissionId = str(data, "submissionID");
  const submissionUrl = submissionId
    ? `https://www.formstack.com/admin/submission/view/${encodeURIComponent(submissionId)}/58429290`
    : "";
  const submissionLinkHtml = submissionId
    ? `
        <div style="font-size:18px;font-weight:700;color:#126181;margin:14px 0 8px;">Here's a link to the submission ${escapeHtml(submissionId)}</div>
        <a href="${submissionUrl}" style="font-size:16px;font-weight:700;color:#0b5cad;text-decoration:underline;word-break:break-all;">${submissionUrl}</a>
      `
    : "";
  const topHighlightBlock = `
      <div style="margin:0 0 18px;padding:16px 18px;border:2px solid #126181;border-radius:8px;background:#eef8fc;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:24px;font-weight:700;color:#126181;line-height:1.3;">Hubspot Deal: ${escapeHtml(dealName)}</div>
        ${submissionLinkHtml}
      </div>
    `;

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1a1a1a;max-width:780px;margin:0 auto;">
      ${topHighlightBlock}
      <h2 style="margin:0 0 14px;font-size:22px;">Travel Booking Summary</h2>
      ${section("Agent Information", agentRows.join(""))}
      ${section("Booking Details", bookingRows.join(""))}
      ${passengerBlock}
      ${section("Payment Information", paymentRows.join(""))}
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
 * Upload a file to HubSpot's File Manager.
 * Returns the File Manager id and public URL.
 */
async function uploadFileToHubSpot(
  fileBytes: Uint8Array,
  fileName: string,
  mimeType: string,
  token: string,
  folderPath = "/form-pdfs",
): Promise<{ id: string; url: string }> {
  const form = new FormData();

  form.append(
    "file",
    new Blob([Buffer.from(fileBytes)], { type: mimeType }),
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

  form.append("folderPath", folderPath);
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
    const wordFileName = `${parseSafeFileName(dealName)}_default_data.docx`;

    // 1. Generate the PDF and Word doc
    console.log(
      `[submitFormPDF] Generating PDF for deal ${dealId} (${dealName})`,
    );
    const pdfBytes = await buildPDF(data);

    console.log(
      `[submitFormPDF] Generating Word doc for deal ${dealId} (${dealName})`,
    );
    const docxBytes = await buildFormstackDefaultDataStyleDocx(data);

    // 2. Upload to HubSpot File Manager
    console.log(`[submitFormPDF] Uploading ${fileName} to HubSpot Files`);
    const { id: fileId, url: fileUrl } = await uploadFileToHubSpot(
      pdfBytes,
      fileName,
      "application/pdf",
      token,
    );
    console.log(
      `[submitFormPDF] Uploaded successfully: ${fileUrl} (id=${fileId})`,
    );

    console.log(`[submitFormPDF] Uploading ${wordFileName} to HubSpot Files`);
    const { id: wordFileId, url: wordFileUrl } = await uploadFileToHubSpot(
      docxBytes,
      wordFileName,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      token,
      "/form-docx",
    );
    console.log(
      `[submitFormPDF] Word doc uploaded: ${wordFileUrl} (id=${wordFileId})`,
    );

    // Gray Formstack-style PDF for client email (HubSpot `form_result__client_email`).
    // Disabled — we only attach the colorful summary PDF for now; uncomment to restore.
    // const formstackFileName = `${parseSafeFileName(dealName)}_default_data.pdf`;
    // console.log(
    //   `[submitFormPDF] Generating Formstack-style PDF for deal ${dealId} (${dealName})`,
    // );
    // const formstackPdfBytes = await buildFormstackDefaultDataStylePDF(data);
    // console.log(
    //   `[submitFormPDF] Uploading ${formstackFileName} to HubSpot Files`,
    // );
    // const {
    //   id: formstackFileId,
    //   url: formstackFileUrl,
    // } = await uploadFileToHubSpot(formstackPdfBytes, formstackFileName, token);
    // console.log(
    //   `[submitFormPDF] Formstack-style PDF uploaded: ${formstackFileUrl} (id=${formstackFileId})`,
    // );

    // Store both file IDs in the single configured HubSpot file property.
    const propertyValue = `${fileId};${wordFileId}`;
    // const formstackPropertyValue = formstackFileId;
    const emailHtml = buildEmailHtml(data, dealName);

    // 3. File properties + Ticketing / FORM RECEIVED/SEND IN SALE (single PATCH)
    const dealProps: Record<string, string> = {
      [property]: propertyValue,
      // [HUBSPOT_DEAL_FORMSTACK_DEFAULT_PDF_PROPERTY]: formstackPropertyValue,
      [HUBSPOT_DEAL_LINK_STATUS_PROPERTY]: "Completed",
      pipeline: HUBSPOT_TICKETING_PIPELINE_ID,
      dealstage: HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID,
      [HUBSPOT_DEAL_SALE_DATE_PROPERTY]: formatHubSpotDate(new Date()),
    };

    const paymentType = resolvePaymentType(data);
    if (paymentType) {
      dealProps[HUBSPOT_DEAL_PAYMENT_TYPE_PROPERTY] = paymentType;
    }

    const startTravelDate = parseStartTravelDateFromDealName(dealName);
    if (startTravelDate) {
      dealProps[HUBSPOT_DEAL_START_TRAVEL_DATE_PROPERTY] = startTravelDate;
    }

    // Deal collaborator (`hs_all_collaborator_owner_ids`) — disabled until mapping is confirmed.
    // try {
    //   const collaboratorIds = await resolveCollaboratorOwnerIds(dealId, token);
    //   if (collaboratorIds) {
    //     dealProps[HUBSPOT_DEAL_COLLABORATOR_PROPERTY] = collaboratorIds;
    //   }
    // } catch (error) {
    //   console.warn(
    //     `[submitFormPDF] Collaborator assignment skipped:`,
    //     error instanceof Error ? error.message : error,
    //   );
    // }

    console.log(
      `[submitFormPDF] Updating deal ${dealId} → pipeline ${HUBSPOT_TICKETING_PIPELINE_ID}, stage ${HUBSPOT_FORM_RECEIVED_DEAL_STAGE_ID}; property "${property}"` +
        (paymentType ? `; payment_type=${paymentType}` : "") +
        (startTravelDate ? `; start_travel_date=${startTravelDate}` : ""),
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
      form_result_word_doc: wordFileUrl,
      // formstackFileId,
      // formstackFileUrl,
      // formstackPdfProperty: HUBSPOT_DEAL_FORMSTACK_DEFAULT_PDF_PROPERTY,
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
