# generateEmailFile

One-shot booking-link email for a HubSpot deal: looks up deal/contact/company/owner, prefills Formstack, builds a `.eml`, uploads it to HubSpot, and writes `prefilled_link` + the file onto the deal.

This used to be two Zapier webhook steps (`get-info-for-email-file` then `generateEmailFile`) because of Vercel’s short timeout. They are combined here; Vercel’s default 5-minute limit is enough.

## Endpoint

```
POST /api/highviewtravel/generateEmailFile
```

No `maxDuration` override — uses the project default (5 minutes).

## What it does

| Step | Source |
|------|--------|
| Load deal, contact, company, deal count, owner | HubSpot (`_shared/fetch-deal-email-context.ts`) |
| Resolve Penalties from `penalties_fill` + form type | Auto Fill defaults, or Manual HubSpot `penalties` |
| Prefill Formstack booking form | Formstack (`_shared/formstack-prefill.ts`) |
| Write `prefilled_link`, clear `send_form` (and `penalties` when Auto Fill) | HubSpot deal |
| Build booking-link `.eml` and upload | HubSpot Files (`/form-emails`) |
| Set deal file property | `form_email_attachment` (or `HIGHVIEWTRAVEL_HUBSPOT_DEAL_FORM_EMAIL_PROPERTY`) |

## Request

```json
{ "dealId": "61244792214" }
```

Also accepts `deal_id`, `hubspotDealId`, or `dealId` nested inside a stringified `info` field (Zapier-style).

**Required env**

- `HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN`
- `HIGHVIEW_FORMSTACK_PREFILL_TOKEN`
- optional: `HIGHVIEW_FORMSTACK_FORM_ID` (default `6471647`)
- optional: `HIGHVIEWTRAVEL_HUBSPOT_DEAL_FORM_EMAIL_PROPERTY` (default `form_email_attachment`)

## Response

```json
{
  "success": true,
  "dealId": "61244792214",
  "prefilledUrl": "https://highviewtravel.formstack.com/forms/...",
  "fileId": "123456789",
  "fileUrl": "https://...",
  "property": "form_email_attachment",
  "penaltiesFill": {
    "mode": "auto",
    "formType": "Net Rate + CC Fee",
    "value": "NON-REFUNDABLE / CHANGES PERMITTED\n\n..."
  },
  "context": {
    "reservationDetails": "...",
    "hubspotDealId": "61244792214",
    "ContactFirstName": "Nancy",
    "ContactLastName": "Bender",
    "ContactEmail": "nancy@example.com",
    "DealsOnContact": "19",
    "dealCountOnContact": 19,
    "ownersEmail": "owner@highviewtravel.com"
  }
}
```

`context` is the HubSpot lookup payload (same fields the old `get-info-for-email-file` route returned).

### `DealsOnContact`

Formstack only needs the **number** of deals on the contact. The lookup returns the real count (e.g. `"19"`), not a single deal ID.

### Penalties Fill

HubSpot deal dropdown `penalties_fill` (`Auto Fill` / `Manual Fill`). Empty is treated as Auto Fill.

| Mode | Formstack Penalties | HubSpot `penalties` |
|------|---------------------|---------------------|
| **Auto Fill** (default) | Default text for the deal’s `form_type` | Updated to that same default text |
| **Manual Fill** | Whatever is already on the deal | Left unchanged |

Default text:

- **Net Rate + CC Fee** — non-refundable / changes permitted + $150 processing fee language (CC fees never refundable)
- **Net Rate (NO CC Fee)** — same idea, slightly different wording
- **Commission off Published Rate** / **Published Rate + $75 Ticketing Fee** — `AS PER PUBLISHED FARE`

## Errors

| Situation | HTTP status |
|-----------|-------------|
| Missing `dealId` | 400 |
| Deal has empty `reservation_details` | 400 |
| No contact on deal | 404 |
| No company on contact | 404 |
| HubSpot / Formstack / server error | 500 |

Company **name** may be empty if the HubSpot token lacks `crm.objects.companies.read`; `companyId` is still returned.

## Zapier wiring

```
Trigger
  → Webhooks by Zapier → POST generateEmailFile   (send dealId only)
```

Remove the old `get-info-for-email-file` step. That route no longer exists.

**Caller timeout:** Zapier’s webhook action still waits only ~30s for a response, even though Vercel can run for 5 minutes. If the Zap errors with a timeout while HubSpot still gets the file and prefilled link, the work likely finished on the server — check the deal before retrying (retries will upload another `.eml`).
