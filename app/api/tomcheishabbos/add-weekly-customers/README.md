# add-weekly-customers

Fills this week's Tomchei Shabbos distribution with the customers who should get a package.

**Weekly customers** are always added (existing people already on the week are kept).

**Bi-weekly customers** are added only if they were **not** on last week's package. If they got a package last week, they skip this week.

## Endpoint

```
POST /api/tomcheishabbos/add-weekly-customers
```

## Request

SmartSuite webhook body:

```json
{
  "recordId": "6a33dbae1e617f950757631c",
  "s0aed9fea2": "Weekly",
  "sd97abd527": "Thu, 18 Jun 2026"
}
```

Only `recordId` is required. That is this week's distribution schedule record.

**Required env:** `TOMCHEI_SHABBOS_SMARTSUITE_API_KEY`, `TOMCHEI_SHABBOS_SMARTSUITE_ACCOUNT_ID`

## What it does

1. Load this week's distribution schedule.
2. If it is a **Yom Tov** week, include Active + Yom Tov Only weekly customers. Otherwise include Active weekly customers only (not Yom Tov Only).
3. Merge those customer IDs onto this week without dropping anyone already linked.
4. Wait 1 second.
5. Find the most recent weekly package before today (not this same record).
6. Load active bi-weekly customers.
7. For each bi-weekly customer:
   - If they **were** on last week's list → skip them.
   - If they **were not** on last week's list → add them to this week, wait 2 seconds, then continue.

## Response

```json
{
  "success": true,
  "recordId": "6a33dbae1e617f950757631c",
  "title": "Weekly: 6/18/2026",
  "isYomTovDistribution": false,
  "weeklyCustomersFound": 42,
  "lastWeekRecordId": "6a280dbcce280087e60f4a10",
  "lastWeekTitle": "Weekly: 8/13/2026",
  "biWeeklyCustomersFound": 5,
  "biWeeklySkippedAlreadyOnLastWeek": 3,
  "biWeeklyAdded": 2,
  "linkedCustomerCount": 50
}
```
