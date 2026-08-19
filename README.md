# TidyStack App

A Next.js automation platform used by TidyStack for multiple clients. It is the code-owned replacement for n8n and Zapier: webhooks, CRM/database updates, PDF/email generation, and AI extraction live here instead of in visual workflow builders.

Each client has its own folder under `app/api`. External systems (HubSpot, SmartSuite, Zoho, ClickUp, Lobbie, Formstack, Outlook add-ins, etc.) call those routes; the app talks back to the same tools as needed.

## Why this instead of n8n / Zapier

- Automations are in TypeScript, reviewed, and versioned in git
- Multi-step workflows can run in one request (Vercel’s default timeout is 5 minutes)
- Shared helpers stay in `_shared` folders instead of being copied across Zaps
- Secrets stay in environment variables, not scattered across Zapier accounts

Some clients still have a thin Zapier or n8n step (for example a trigger that POSTs here, or a leftover “create person in Customer.io”). The heavy lifting belongs in this app.

## How it is organized

```
app/
├── api/
│   ├── <client>/                 # one folder per client
│   │   ├── <automation>/route.ts
│   │   └── _shared/              # helpers used only by that client
│   ├── send-msg-file/            # shared Outlook .msg plugin
│   └── send-test-email/
├── highviewtravel/               # small client UIs (e.g. PDF preview)
├── interlink/
└── playground/                   # local form previews (CCHealthcare)
```

A typical flow:

1. CRM, form tool, or add-in sends a POST to `/api/<client>/<automation>`
2. The route loads records, generates a file, calls another API, or writes fields back
3. It returns JSON (or a PDF) so the caller can continue or stop

Credentials live in `.env.local` and are usually prefixed by client name (`HIGHVIEWTRAVEL_…`, `TOMCHEI_SHABBOS_…`, `LOWERWATT_…`, and so on). Do not commit that file.

## Clients

### Aspire

Patient intake and follow-up around **Lobbie** (forms) and **ClickUp** (tasks).

| Route                                  | What it does                                                           |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `/api/aspire/webhook`                  | Lobbie form-packet webhook → maps completed intake into ClickUp        |
| `/api/aspire/process-intake`           | Manual/retry processing of a completed intake packet                   |
| `/api/aspire/clickup-webhook`          | ClickUp `taskUpdated` events for email automations                     |
| `/api/aspire/email-automations/scan`   | Daily scan of waiting-list / no-tech dates; fires due follow-up emails |
| `/api/aspire/email-automations/run`    | Run one scheduled follow-up by task id                                 |
| `/api/aspire/register-webhook`         | Register the Lobbie webhook                                            |
| `/api/aspire/register-clickup-webhook` | Register the ClickUp webhook                                           |

### CCHealthcare (original project)

Zoho CRM reimbursement forms (expense, mileage, petty cash). The original README described only this client.

`POST /api/cchealthcare` loads a Zoho record, builds a reimbursement PDF, emails the facility (Stampli) and the requester, and creates a **SmartSuite** record. Zoho OAuth setup is documented in `ZOHO_SETUP.md`. Playground form layouts live under `app/playground/cchealthcare/`.

### High View Travel

HubSpot + Formstack booking workflow (much of this used to be Zapier).

| Route                                          | What it does                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/highviewtravel/generateEmailFile`        | On deal `send_form = Send Form`: prefill Formstack, build a booking `.eml`, attach it to the deal |
| `/api/highviewtravel/auto-fill-penalties`      | Fill default penalty text on the deal from form type                                              |
| `/api/highviewtravel/submitFormPDF`            | Formstack submission → summary PDF/DOCX, HubSpot deal updates (stage, dates, collaborators)       |
| `/api/highviewtravel/generateFormPDF`          | Preview-only summary PDF                                                                          |
| `/api/highviewtravel/passport-submission`      | Attach passport files from Formstack onto the HubSpot deal                                        |
| `/api/highviewtravel/email-to-deal`            | Parse a booking `.eml` and create a HubSpot deal                                                  |
| `/api/highviewtravel/email-to-deal/msg`        | Same idea for Outlook `.msg` (prefer `/api/send-msg-file` for the add-in)                         |
| `/api/highviewtravel/notification-of-new-deal` | Decide whether a new deal’s contact should go into Customer.io                                    |
| `/api/highviewtravel/getnextwebinar`           | Next Zoom webinar for High View                                                                   |

More detail: `app/api/highviewtravel/generateEmailFile/README.md` and `app/api/highviewtravel/notification-of-new-deal/README.md`. A PDF preview page lives at `/highviewtravel/pdf-preview`.

### Interlink

Outlook add-in to file an email against a **SmartSuite** record.

- UI: `/interlink/outlook-ui`
- `GET /api/interlink/records?q=` — search records by title
- `POST /api/interlink/save-email` — upload the email and attachments onto the selected record

### LowerWatt

Utility bills, commissions, and QuickBooks.

| Route                                            | What it does                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| `/api/lowerwatt/bill-extraction-into-smartsuite` | Gemini reads a utility-bill PDF and returns structured fields         |
| `/api/lowerwatt/attach-pdf-after-extraction`     | Attach the source PDF onto the SmartSuite bill record                 |
| `/api/lowerwatt/generate-monthly-report`         | Commission HTML + PDF for a rep/month                                 |
| `/api/lowerwatt/generate-admin-summary-email`    | Admin summary email HTML                                              |
| `/api/lowerwatt/quickbooks`                      | QuickBooks Web Connector (QBWC) SOAP endpoint for invoice sync/create |
| `/api/lowerwatt/test-bill-extraction`            | Test harness for bill extraction                                      |

### Project Ninveh

SmartSuite report PDFs (matchmaking / committee data). Each route builds a PDF and writes it back to a SmartSuite file field.

- `/api/projectninveh/simply-book-to-ss` — SimplyBook appointment → SmartSuite singles/shadchan records
- `/api/projectninveh/singles-pdf`
- `/api/projectninveh/birthdays`
- `/api/projectninveh/committee-pdf`
- `/api/projectninveh/basic-committee-pdf`
- `/api/projectninveh/partner-advocates-pdf`

### Tomchei Shabbos

Weekly food-package distribution in SmartSuite.

| Route                                           | What it does                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `/api/tomcheishabbos/add-weekly-customers`      | Add weekly (and alternating bi-weekly) customers onto this week’s distribution |
| `/api/tomcheishabbos/delivery-list`             | Generate a delivery-list PDF for a distribution record                         |
| `/api/tomcheishabbos/delivery-list-export`      | Pesach delivery-list export PDFs onto a reports record                         |
| `/api/tomcheishabbos/comparison-report`         | Year-over-year Pesach comparison PDF + CSV                                     |
| `/api/tomcheishabbos/find-records-to-resume`    | Un-pause customers whose pause window has ended                                |
| `/api/tomcheishabbos/clear-delivery-list-field` | Clear linked customers on a distribution record                                |

See `app/api/tomcheishabbos/add-weekly-customers/README.md`.

## Shared routes

These are not tied to a single client folder, but are used by add-ins or for testing.

| Route                               | What it does                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `/api/send-msg-file`                | Outlook plugin: upload a `.msg`, then create a HubSpot deal or High View contact from it |
| `/api/send-msg-file/get-upload-url` | Presigned Vercel Blob URL for the `.msg` upload                                          |
| `/api/send-test-email`              | Send a test SMTP email                                                                   |
| `/api/test-pdf`                     | PDF smoke test                                                                           |

## Quick start

```bash
npm install
```

Copy `.env.local` from the template below and fill in credentials for the clients you are working on. Then:

```bash
npm run dev
```

Routes are at `http://localhost:3000/api/<client>/<automation>`.

To receive real webhooks locally, expose the dev server (for example with ngrok) and point the CRM/form tool at that HTTPS URL.

```bash
ngrok http 3000
```

## Environment variables

Only secrets should be stored here

## Adding a new client

1. Create `app/api/<client>/` (lowercase, no spaces)
2. Put each automation in its own `route.ts`
3. Put client-only helpers in `_shared/`
4. Prefix env vars with the client name
5. Add a short section for that client in this README

## Stack

- **Next.js 16** (App Router API routes) and **TypeScript**
- **pdf-lib** / **docx** for generated files
- **nodemailer** for email
- **Gemini** (`@google/genai`) for LowerWatt bill extraction
- **Vercel Blob** for Outlook `.msg` uploads
- Deployed on **Vercel**
- The URL of the App in Vercel is `https://tidystack-app.vercel.app/`

Integrations in use today include HubSpot, SmartSuite, Zoho CRM, ClickUp, Lobbie, Formstack, Zoom, QuickBooks Web Connector, and SimplyBook.

## License

MIT
