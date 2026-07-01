# notification-of-new-deal

Consolidates **Zapier steps 2–10** of the Highview “new deal → Customer.io” workflow into one HubSpot evaluation. Step 11 (Create or Update Person in Customer.io) stays in Zapier.

## Endpoint

```
POST /api/highviewtravel/notification-of-new-deal
```

**Vercel timeout:** `maxDuration = 50` (seconds).

## What it replaced

| Old Zapier step | What it did |
|-----------------|-------------|
| 2 | Custom request — deal → contact associations |
| 3 | JavaScript — `hasResults` yes/no |
| 4 | **Filter** — continue only if contacts exist |
| 5 | JavaScript — first contact ID |
| 6 | Custom request — contact → deal associations |
| 7 | JavaScript — `dealLength` |
| 8 | **Filter** — continue only if `dealLength` is exactly 1 |
| 9 | Custom request — get contact properties |
| 10 | JavaScript — build Customer.io field values |

Instead of halting the Zap at filters 4 and 8, this route always returns **200** with `"add to customer.io": true` or `false` plus a `filterReason` when filtered out.

## Request

```json
{ "dealId": "61873132207" }
```

Also accepts `deal_id`, `hubspotDealId`, or `dealId` inside stringified `info`.

**Required env:** `HIGHVIEWTRAVEL_HUBSPOT_ACCESS_TOKEN`

## What the code does

1. Loads contacts associated with the deal.
2. If none → `"add to customer.io": false`, `filterReason` explains step 4 would have stopped.
3. Takes the **first** contact ID (same as old Zapier step 5).
4. Loads all deals associated with that contact.
5. If count is not exactly **1** → `"add to customer.io": false`, `filterReason` explains step 8; contact details are still returned for debugging.
6. Loads contact `firstname`, `lastname`, `email`, `registered_for_the_webinar`.
7. Builds the same derived fields the old step 10 JavaScript produced.

HubSpot logic lives in `_shared/fetch-new-deal-notification.ts`.

## Filters → `add to customer.io`

| Condition | `add to customer.io` | Example `filterReason` |
|-----------|----------------------|-------------------------|
| No contacts on deal | `false` | No associated contacts found on deal (Zapier filter step 4) |
| Contact has 0 deals | `false` | Contact has no associated deals (Zapier filter step 8 requires exactly 1) |
| Contact has 2+ deals | `false` | Contact has 19 associated deals; expected exactly 1 (Zapier filter step 8) |
| Contact has exactly 1 deal | `true` | `filterReason: null` |

## Response fields

### For Zapier filter + Customer.io (step 11)

| Field | Customer.io / Zapier use |
|-------|--------------------------|
| `add to customer.io` | Zapier filter before step 11 — continue only if `true` |
| `filterReason` | Debugging when filtered out; `null` when passing |
| `email` | Person Id + Email Address |
| `firstName` | First Name |
| `lastName` | Last Name |
| `registeredForWebinar` | Registered for Webinar (`Yes` / `No`) |
| `hasDeals` | Has Deals (`Yes` / `No`) |
| `hubSpotContactId` | HubSpot Contact ID |

### Extra (from old JS steps, useful for debugging)

| Field | Meaning |
|-------|---------|
| `hasResults` | `yes` / `no` — step 3 output |
| `dealLength` | Number of deals on contact — step 7 output |
| `dealIds` | Comma-separated deal IDs, or `"None"` |
| `shouldEnterSequence` | `Yes` if contact has deals and `registered_for_the_webinar` ≠ `YES` (step 10) |

`shouldEnterSequence` is informational; the Zapier filters are represented by `add to customer.io`.

## Zapier wiring

```
Trigger
  → Webhooks by Zapier → POST notification-of-new-deal   (send dealId)
  → Filter: only continue if "add to customer.io" is true
  → Customer.io: Create or Update Person                  (map response fields)
```

Step 11 still sets **New Contact Registered for Webinar** to `True` statically in Zapier (unchanged).

## Examples

**Passes (first deal for this contact)**

```json
{
  "success": true,
  "add to customer.io": true,
  "filterReason": null,
  "dealId": "61873132207",
  "hasResults": "yes",
  "dealLength": 1,
  "hubSpotContactId": "232459260499",
  "firstName": "Vinny",
  "lastName": "Jaswal",
  "email": "vinny.jaswal@fora.travel",
  "registeredForWebinar": "No",
  "hasDeals": "Yes",
  "dealIds": "61873132207",
  "shouldEnterSequence": "Yes"
}
```

**Filtered (repeat customer with many deals)**

```json
{
  "success": true,
  "add to customer.io": false,
  "filterReason": "Contact has 19 associated deals; expected exactly 1 (Zapier filter step 8)",
  "dealLength": 19,
  "firstName": "Nancy",
  "lastName": "Bender",
  "email": "nancy@example.com"
}
```

## Errors

| Situation | HTTP status |
|-----------|-------------|
| Missing `dealId` | 400 |
| HubSpot / server error | 500 |

Filtered-out cases are **not** errors — they return `success: true` with `"add to customer.io": false`.
