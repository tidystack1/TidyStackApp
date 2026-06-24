type LowerWattCommission = {
  description?: string;
  gross?: number;
  commissionRate?: number;
  commissionAmount?: number;
  lwAmount?: number;
};

type LowerWattPayload = {
  repId?: string;
  repName?: string;
  repEmail?: string;
  commissions?: LowerWattCommission[];
  totalCommission?: number;
  totalLW?: number;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace(/\.00$/, "")}%`;
}

function buildCommissionsHtml(payload: LowerWattPayload): string {
  const repName = escapeHtml(payload.repName?.trim() || "Unknown Rep");
  const repEmail = escapeHtml(payload.repEmail?.trim() || "No email provided");
  const commissions = Array.isArray(payload.commissions) ? payload.commissions : [];

  const rowsHtml =
    commissions.length > 0
      ? commissions
          .map((item) => {
            const description = escapeHtml(item.description?.trim() || "N/A");
            const gross = formatCurrency(Number(item.gross ?? 0));
            const commissionRate = formatPercent(Number(item.commissionRate ?? 0));
            const commissionAmount = formatCurrency(Number(item.commissionAmount ?? 0));
            const lwAmount = formatCurrency(Number(item.lwAmount ?? 0));

            return `
              <tr>
                <td>${description}</td>
                <td>${gross}</td>
                <td>${commissionRate}</td>
                <td>${commissionAmount}</td>
                <td>${lwAmount}</td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td colspan="5" style="text-align:center; color:#64748b;">No commission records for this period.</td>
        </tr>
      `;

  const totalCommission = formatCurrency(Number(payload.totalCommission ?? 0));
  const totalLW = formatCurrency(Number(payload.totalLW ?? 0));

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LowerWatt Commission Summary</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background: #f8fafc;
        font-family: Arial, Helvetica, sans-serif;
        color: #0f172a;
      }
      .wrapper {
        width: 100%;
        padding: 24px 0;
      }
      .card {
        max-width: 760px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
      }
      .header {
        background: #0f172a;
        color: #ffffff;
        padding: 20px 24px;
      }
      .header h1 {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
      }
      .header p {
        margin: 6px 0 0;
        font-size: 14px;
        color: #cbd5e1;
      }
      .content {
        padding: 20px 24px 24px;
      }
      .rep-meta {
        margin-bottom: 18px;
        padding: 14px 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      .rep-meta p {
        margin: 4px 0;
        font-size: 14px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th, td {
        padding: 10px 12px;
        border-bottom: 1px solid #e2e8f0;
        text-align: left;
      }
      th {
        background: #f1f5f9;
        font-weight: 700;
      }
      .totals {
        margin-top: 18px;
        padding: 14px 16px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      .totals p {
        margin: 6px 0;
        font-size: 15px;
      }
      .totals strong {
        color: #0f172a;
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <h1>LowerWatt Commission Summary</h1>
          <p>Monthly commission report</p>
        </div>
        <div class="content">
          <div class="rep-meta">
            <p><strong>Rep Name:</strong> ${repName}</p>
            <p><strong>Rep Email:</strong> ${repEmail}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Gross</th>
                <th>Commission Rate</th>
                <th>Commission Amount</th>
                <th>LW Amount</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <div class="totals">
            <p><strong>Total Commissions:</strong> ${totalCommission}</p>
            <p><strong>Total LW:</strong> ${totalLW}</p>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
  `;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as LowerWattPayload;
    const html = buildCommissionsHtml(payload);

    return Response.json({
      company: "LowerWatt",
      repId: payload.repId ?? null,
      repName: payload.repName ?? null,
      repEmail: payload.repEmail ?? null,
      html,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to parse request body";

    return Response.json(
      { error: message },
      { status: 400 },
    );
  }
}
