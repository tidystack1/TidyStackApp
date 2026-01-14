# Zoho CRM PDF Attachment Combiner

This Next.js application receives webhooks from Zoho CRM, fetches all PDF attachments from a record, combines them into a single PDF, and sends it via email.

## Features

- ✅ Receives POST requests with Zoho CRM record IDs
- ✅ Fetches all attachments from Zoho CRM records
- ✅ Filters and downloads PDF attachments only
- ✅ Combines multiple PDFs into a single document using `pdf-lib`
- ✅ Sends combined PDF via email using nodemailer
- ✅ No third-party services required (free and open-source libraries only)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the `.env.local` file and update it with your credentials:

```env
# Zoho CRM Configuration
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here
ZOHO_REFRESH_TOKEN=your_refresh_token_here
ZOHO_MODULE=Staff_Forms

# Email Configuration (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password_here
SMTP_FROM=your_email@gmail.com
```

See `ZOHO_SETUP.md` for detailed instructions on obtaining these credentials.

### 3. Run the Development Server

```bash
npm run dev
```

The webhook endpoint will be available at: `http://localhost:3000/api/webhook`

### 4. Set Up Zoho Webhook

Configure your Zoho CRM workflow to send POST requests to your endpoint with this body:

```json
{
  "id": "7219537000000606001"
}
```

See `ZOHO_SETUP.md` for complete Zoho CRM setup instructions.

## API Endpoint

### POST `/api/webhook`

Receives a Zoho CRM record ID, fetches attachments, combines PDFs, and sends email.

**Request Body:**

```json
{
  "id": "7219537000000606001"
}
```

**Response (Success):**

```json
{
  "message": "Successfully processed and sent email",
  "recordId": "7219537000000606001",
  "attachmentCount": 5,
  "pdfCount": 3
}
```

**Response (No Attachments):**

```json
{
  "message": "No attachments found for this record",
  "recordId": "7219537000000606001"
}
```

**Response (Error):**

```json
{
  "error": "Internal server error",
  "details": "Error message here"
}
```

## Project Structure

```
cchealthcare/
├── app/
│   ├── api/
│   │   └── webhook/
│   │       └── route.ts          # Main webhook endpoint
│   ├── layout.tsx
│   └── page.tsx
├── .env.local                    # Environment variables (create this)
├── ZOHO_SETUP.md                 # Zoho CRM setup guide
├── package.json
└── README.md
```

## How It Works

1. **Webhook Receipt**: The endpoint receives a POST request with a Zoho CRM record ID
2. **Fetch Record**: Queries Zoho CRM API to get record details
3. **Fetch Attachments**: Retrieves all attachments associated with the record
4. **Filter PDFs**: Identifies and downloads only PDF attachments
5. **Combine PDFs**: Uses `pdf-lib` to merge all PDFs into a single document
6. **Send Email**: Uses nodemailer to send the combined PDF to `mspitzer@tidystack.com`

## Technologies Used

- **Next.js 16** - React framework with API routes
- **TypeScript** - Type-safe development
- **pdf-lib** - PDF manipulation (free, no account required)
- **nodemailer** - Email sending
- **Zoho CRM API v2** - Fetching records and attachments

## Production Deployment

### Environment Variables

Ensure all environment variables are set in your production environment.

### Deployment Options

- **Vercel** (Recommended for Next.js): [vercel.com](https://vercel.com)
- **Netlify**: [netlify.com](https://netlify.com)
- **Docker**: Build and deploy as a container
- **Traditional hosting**: Node.js server required

### Security Considerations

1. Always use HTTPS in production
2. Add webhook signature verification for Zoho requests
3. Never commit `.env.local` to version control
4. Consider adding rate limiting
5. Monitor logs for errors and unauthorized access

## Troubleshooting

See `ZOHO_SETUP.md` for common issues and solutions.

### Quick Checks

1. **401 Unauthorized**: Check Zoho credentials in `.env.local`
2. **No attachments found**: Verify the record has PDF attachments
3. **Email not sending**: Verify SMTP credentials (use App Password for Gmail)
4. **Module not found**: Check `ZOHO_MODULE` matches your Zoho CRM API name

## Testing Locally with ngrok

For webhook testing before deployment:

```bash
# Terminal 1: Run the app
npm run dev

# Terminal 2: Expose to internet
ngrok http 3000
```

Use the ngrok HTTPS URL in your Zoho webhook configuration.

## Support

For issues related to:

- **Zoho CRM API**: [Zoho CRM API Documentation](https://www.zoho.com/crm/developer/docs/api/v2/)
- **Next.js**: [Next.js Documentation](https://nextjs.org/docs)
- **pdf-lib**: [pdf-lib Documentation](https://pdf-lib.js.org/)
- **nodemailer**: [Nodemailer Documentation](https://nodemailer.com/)

## License

MIT
