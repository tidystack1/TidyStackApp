# get-info-for-email-file

Consolidates **Zapier steps 3–9** of the Highview “send booking link email” workflow into a single HubSpot lookup. Step 10 (`generateEmailFile`) stays separate in Zapier because it is slow (Formstack prefill + `.eml` build + HubSpot file upload).

## Endpoint

```
POST /api/highviewtravel/get-info-for-email-file
```

**Vercel timeout:** `maxDuration = 50` (seconds).

## What it replaced

| Old Zapier step | What it did |
|-----------------|-------------|
| 3 | Get Deal |
| 4 | Find Associations (deal → contact) |
| 5 | Get Contact |
| 6 | Find Associations (contact → company) |
| 7 | Get Company |
| 8 | Find amount of deals on contact |
| 9 | Get Owner by ID |

## Request

```json
{ "dealId": "61244792214" }
```

Also accepts `deal_id`, `hubspotDealId`, or `dealId` nested inside a stringified `info` field (Zapier-style).

**Required env:** `HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN`

## What the code does

1. Loads the deal and custom properties (`reservation_details`, `penalties`, `form_type`, etc.).
2. Finds associated contacts on the deal; uses the **first** contact if there are several.
3. Loads contact `firstname`, `lastname`, `email`, `passport_name`.
4. Finds the first company associated with that contact.
5. Counts **all** deals associated with the contact.
6. Loads the deal owner’s email via `hubspot_owner_id`.

HubSpot logic lives in `_shared/fetch-deal-email-context.ts`.

## Response

Returns fields shaped for the next Zapier step (`generateEmailFile`), using the same key names the old Zapier webhook sent:

| Field | Source |
|-------|--------|
| `reservationDetails` | Deal `reservation_details` |
| `hubspotDealId` | Deal ID |
| `Penalties`, `PassengerName`, `RatePP`, `formType`, `issuingFee`, `commissionRate`, `BaseFarePP`, `DealName`, `IsFora`, `TaxesAndFeesPP`, `GotPassportPictures` | Deal properties |
| `ContactFirstName`, `ContactLastName`, `ContactEmail` | Contact |
| `ownersEmail` | Deal owner |
| `DealsOnContact` | **Count** of deals on the contact (e.g. `"19"`), not a list of IDs |
| `dealCountOnContact` | Same count as a number (debugging) |
| `companyId`, `companyName`, `contactId`, `contactPassportName` | Extra context (not required by `generateEmailFile`) |

### `DealsOnContact` note

`generateEmailFile` only needs the **number** of deals on the contact (Formstack field “Amount of deals on contact”). Old Zapier step 8 returned a single deal ID, which always counted as `1`. This route returns the real count. `formstack-prefill.ts` was updated so plain numeric strings like `"19"` are handled correctly.

## Errors

| Situation | HTTP status |
|-----------|-------------|
| Missing `dealId` | 400 |
| No contact on deal | 404 |
| No company on contact | 404 |
| HubSpot / server error | 500 |

Company **name** may be empty if the HubSpot token lacks `crm.objects.companies.read`; `companyId` is still returned.

## Zapier wiring

```
Trigger
  → Webhooks by Zapier → POST get-info-for-email-file   (send dealId)
  → Webhooks by Zapier → POST generateEmailFile           (spread full response)
```

## Example

**Request**

```json
{ "dealId": "61244792214" }
```

**Response (truncated)**

```json
{
  "success": true,
  "reservationDetails": "Please fill in Reservation Details.",
  "hubspotDealId": "61244792214",
  "ContactFirstName": "Nancy",
  "ContactLastName": "Bender",
  "ContactEmail": "nancy@example.com",
  "DealsOnContact": "19",
  "dealCountOnContact": 19,
  "ownersEmail": "owner@highviewtravel.com"
}
```
