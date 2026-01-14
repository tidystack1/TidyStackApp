# Zoho CRM Setup Guide (for this project)

## What you’re fixing right now

If the playground finds subform uploads but shows **“Total Files Combined: 0”** and the server logs mention **`OAUTH_SCOPE_MISMATCH`**, your Zoho OAuth connection is missing the scope needed to **download** file-upload files.

This project needs a Zoho OAuth connection that can:

- Read the CRM record (module record GET)
- Download attachments / file-upload files so they can be converted/merged into a PDF

## Step-by-step: create a new Zoho OAuth connection

### 1) Confirm your Zoho data center

Log into Zoho CRM and look at your CRM URL:

- `crm.zoho.com` → US
- `crm.zoho.eu` → EU
- `crm.zoho.in` → IN
- `crm.zoho.com.au` → AU
- `crm.zoho.com.cn` → CN

You’ll use the matching **Accounts** + **API** domains in `.env.local` (see below).

### 2) Create an OAuth client in Zoho API Console

1. Go to `https://api-console.zoho.com/`
2. Click **Add Client**
3. Pick **one** of these:
   - **Server-based Applications** (recommended for “real” apps)
   - **Self Client** (easiest for generating tokens during local dev/testing)
4. Set **Authorized Redirect URI** (if shown) to:
   - `http://localhost:3000`
5. Save and copy:
   - **Client ID**
   - **Client Secret**

### 3) Generate a Refresh Token (two ways)

You need a one-time **Grant Token / Code**, then you exchange it for a **Refresh Token**.

#### Option A (recommended): Use the Authorization URL (works with Server-based Applications)

1. Build this URL (replace `CLIENT_ID` and make sure `redirect_uri` matches what you set in the console):

`https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCRM.modules.ALL&client_id=CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http%3A%2F%2Flocalhost%3A3000&prompt=consent`

Notes:

- The `%2C` is just a URL-encoded comma. Zoho is picky — if the commas disappear and scopes “run together”, you’ll get **Invalid OAuth Scope**.
- Zoho shows **Invalid OAuth Scope** if **any one** scope name is unknown (it won’t tell you which one).
- Start with `ZohoCRM.modules.ALL` (known-good), then add one scope at a time:
  - Try adding files scope (one of these will be accepted depending on your tenant):
    - `ZohoCRM.files.ALL`
    - `ZohoCRM.modules.files.ALL`
  - You usually do **not** need a separate “attachments” scope if you already have `ZohoCRM.modules.ALL`.

Redirect URI gotcha:

- Zoho requires `redirect_uri` to match **exactly** what you configured in **Authorized Redirect URIs** (including trailing `/`).
- In the Zoho API Console, add **both** of these to be safe, then click **Update**:
  - `http://localhost:3000`
  - `http://localhost:3000/`

Example with trailing slash (URL-encoded):

`https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCRM.modules.ALL&client_id=CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2F&prompt=consent`

Example with 2 scopes:

`https://accounts.zoho.com/oauth/v2/auth?scope=ZohoCRM.modules.ALL%2CZohoCRM.files.ALL&client_id=CLIENT_ID&response_type=code&access_type=offline&redirect_uri=http%3A%2F%2Flocalhost%3A3000&prompt=consent`

2. Open it in your browser, approve access.
3. Zoho will redirect to `http://localhost:3000/?code=...`
4. Copy the `code` value — that’s your **Grant Token**.

#### Option B: Create a “Self Client” (Zoho UI)

If you choose the **Self Client** client type in the “Choose a Client Type” dialog, Zoho will show a screen where you can enter **Scope** and generate a **Grant Token** directly.

Use this scope string:

`ZohoCRM.modules.ALL,ZohoCRM.attachments.READ,ZohoCRM.files.READ`

Copy the generated **Grant Token**.

### 4) Exchange the Grant Token for a Refresh Token

Run this in PowerShell (choose the right accounts domain for your data center):

```powershell
$clientId     = "YOUR_CLIENT_ID"
$clientSecret = "YOUR_CLIENT_SECRET"
$grantToken   = "YOUR_GRANT_TOKEN"
$redirectUri  = "http://localhost:3000"

$tokenUrl = "https://accounts.zoho.com/oauth/v2/token"

Invoke-RestMethod -Method Post -Uri $tokenUrl -ContentType "application/x-www-form-urlencoded" -Body @{
  grant_type    = "authorization_code"
  client_id     = $clientId
  client_secret = $clientSecret
  redirect_uri  = $redirectUri
  code          = $grantToken
}
```

The response will include **`refresh_token`**. Copy it.

### 5) Put credentials in `.env.local`

Create a `.env.local` file in the project root (or update it) with:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- the correct data center domains
- `ZOHO_MODULE` (the module you’re testing in the playground)

### 6) Restart dev server + test

1. Stop dev server (Ctrl+C)
2. Start again: `npm run dev`
3. In the playground, test the ID again.

If everything is correct, you should see **Downloaded N image/PDF files** in the server logs and a **combined PDF preview** in the browser.

## Required Environment Variables

Create a `.env.local` file in the root of your project with the following variables:

```env
# Zoho OAuth Credentials
# Get these from: https://api-console.zoho.com/
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here
ZOHO_REFRESH_TOKEN=your_refresh_token_here

# Zoho OAuth Scopes (what to request when generating the Grant Token)
# For this project, you MUST include a file download scope, otherwise the app can “find” uploads but can’t download bytes.
#
# Recommended scope set (safe for development):
# - ZohoCRM.modules.ALL
# - ZohoCRM.attachments.READ
# - ZohoCRM.files.READ
#
# If you prefer tighter permissions, you can replace modules.ALL with the specific module scope(s),
# but keep ZohoCRM.files.READ for file upload downloads.
#
# Example (copy/paste into Zoho API Console “Scope”):
# ZohoCRM.modules.ALL,ZohoCRM.attachments.READ,ZohoCRM.files.READ

# Zoho Data Center Domains
# IMPORTANT: Choose based on your Zoho CRM data center location
# If you're getting connection timeout errors, you may have the wrong domain!

# For US data center (default):
ZOHO_ACCOUNTS_DOMAIN=accounts.zoho.com
ZOHO_API_DOMAIN=www.zohoapis.com

# For EU data center, use:
# ZOHO_ACCOUNTS_DOMAIN=accounts.zoho.eu
# ZOHO_API_DOMAIN=www.zohoapis.eu

# For India data center, use:
# ZOHO_ACCOUNTS_DOMAIN=accounts.zoho.in
# ZOHO_API_DOMAIN=www.zohoapis.in

# For Australia data center, use:
# ZOHO_ACCOUNTS_DOMAIN=accounts.zoho.com.au
# ZOHO_API_DOMAIN=www.zohoapis.com.au

# For China data center, use:
# ZOHO_ACCOUNTS_DOMAIN=accounts.zoho.com.cn
# ZOHO_API_DOMAIN=www.zohoapis.com.cn

# Zoho CRM Module
ZOHO_MODULE=Accounts

# SMTP Configuration for sending emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com
```

## How to Find Your Data Center

1. Log in to your Zoho CRM account
2. Look at the URL in your browser:
   - If it's `crm.zoho.com` → Use US domains (default)
   - If it's `crm.zoho.eu` → Use EU domains
   - If it's `crm.zoho.in` → Use IN domains
   - If it's `crm.zoho.com.au` → Use AU domains
   - If it's `crm.zoho.com.cn` → Use CN domains

## Troubleshooting

### "Connection Timeout Error"

This usually means you're using the wrong data center domain. Check your Zoho CRM URL and update the `ZOHO_ACCOUNTS_DOMAIN` and `ZOHO_API_DOMAIN` variables accordingly.

### "Failed to get access token"

Check that your `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and `ZOHO_REFRESH_TOKEN` are correct.

### "OAUTH_SCOPE_MISMATCH" / "invalid oauth scope to access this URL"

This means your refresh token was generated **without the right scopes**.

Fix:

1. Generate a _new_ grant token in Zoho API Console with this scope string:
   - `ZohoCRM.modules.ALL,ZohoCRM.attachments.READ,ZohoCRM.files.READ`
2. Exchange it for a new refresh token
3. Update `ZOHO_REFRESH_TOKEN` in `.env.local`
4. Restart `npm run dev`

### "Invalid OAuth Scope" / "Scope does not exist"

This almost always means your `scope=` parameter is malformed (most commonly: missing commas between scopes).

Use the URL-encoded auth URL from **Option A** (it uses `%2C` between scopes), or try one scope at a time to find the offending scope.

### "No subform data found"

Make sure your module has the `Subform_1` (Expense Reimbursement) subform with the `File_Upload_1` field.
