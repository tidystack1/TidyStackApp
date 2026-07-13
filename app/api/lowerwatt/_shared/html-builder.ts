import type { LowerWattCommission } from "./types";
import type { NormalizedRepPayload } from "./commissions";
import { escapeHtml, formatCurrency, formatPercent } from "./format";

function hasAdjustments(commissions: LowerWattCommission[]): boolean {
  return commissions.some((item) => Number(item.adjustment ?? 0) !== 0);
}

function buildCommissionRowsHtml(
  commissions: LowerWattCommission[],
  emptyMessage: string,
  showAdjustment: boolean,
): string {
  const columnCount = showAdjustment ? 5 : 4;

  if (commissions.length === 0) {
    return `
      <tr>
        <td colspan="${columnCount}" style="text-align:center; color:#64748b;">${escapeHtml(emptyMessage)}</td>
      </tr>
    `;
  }

  return commissions
    .map((item) => {
      const gross = formatCurrency(Number(item.gross ?? 0));
      const commissionRate = formatPercent(Number(item.commissionRate ?? 0));
      const commissionAmount = formatCurrency(Number(item.commissionAmount ?? 0));
      const commissionTotal = formatCurrency(Number(item.commissionTotal ?? 0));
      const adjustment = formatCurrency(Number(item.adjustment ?? 0));

      return `
        <tr>
          <td>${gross}</td>
          <td>${commissionAmount}</td>
          ${showAdjustment ? `<td class="col-adjustment">${adjustment}</td>` : ""}
          <td class="col-commission-total">${commissionTotal}</td>
          <td>${commissionRate}</td>
        </tr>
      `;
    })
    .join("");
}

function buildCommissionSectionHtml(params: {
  sectionTitle: string;
  commissions: LowerWattCommission[];
  emptyMessage: string;
  totalCommission: number;
}): string {
  const { sectionTitle, commissions, emptyMessage, totalCommission } = params;
  const showAdjustment = hasAdjustments(commissions);

  return `
    <section class="commission-section">
      <h2>${escapeHtml(sectionTitle)}</h2>
      <table>
        <thead>
          <tr>
            <th>Gross</th>
            <th>Commission Amount</th>
            ${showAdjustment ? `<th class="col-adjustment">Adjustment</th>` : ""}
            <th class="col-commission-total">Commission Total</th>
            <th>Commission Rate</th>
          </tr>
        </thead>
        <tbody>
          ${buildCommissionRowsHtml(commissions, emptyMessage, showAdjustment)}
        </tbody>
      </table>
      <div class="totals">
        <p><strong>Total Commissions:</strong> ${formatCurrency(totalCommission)}</p>
      </div>
    </section>
  `;
}

export function buildCommissionsHtml(payload: NormalizedRepPayload): string {
  const repName = escapeHtml(payload.repName?.trim() || "Unknown Rep");
  const repEmail = escapeHtml(payload.repEmail?.trim() || "No email provided");
  const monthTitle = escapeHtml(payload.monthTitle);
  const previousMonthTitle = escapeHtml(payload.previousMonthTitle);

  const thisMonthSection = buildCommissionSectionHtml({
    sectionTitle: payload.monthTitle,
    commissions: payload.commissionThisMonth,
    emptyMessage: "No commission records for this month.",
    totalCommission: payload.totalCommissionThisMonth,
  });

  const lastMonthSection = buildCommissionSectionHtml({
    sectionTitle: payload.previousMonthTitle,
    commissions: payload.commissionLastMonth,
    emptyMessage: "No commission records for last month.",
    totalCommission: payload.totalCommissionLastMonth,
  });

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
      .commission-section {
        margin-bottom: 24px;
      }
      .commission-section:last-child {
        margin-bottom: 0;
      }
      .commission-section h2 {
        margin: 0 0 12px;
        font-size: 16px;
        font-weight: 700;
        color: #0f172a;
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
      th.col-adjustment,
      td.col-adjustment {
        padding-right: 28px;
      }
      th.col-commission-total,
      td.col-commission-total {
        padding-left: 28px;
      }
      .totals {
        margin-top: 12px;
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
          <p>Monthly commission report - ${monthTitle}</p>
        </div>
        <div class="content">
          <div class="rep-meta">
            <p><strong>Report Month:</strong> ${monthTitle}</p>
            <p><strong>Previous Month:</strong> ${previousMonthTitle}</p>
            <p><strong>Rep Name:</strong> ${repName}</p>
            <p><strong>Rep Email:</strong> ${repEmail}</p>
          </div>

          ${thisMonthSection}
          ${lastMonthSection}
        </div>
      </div>
    </div>
  </body>
</html>
  `;
}
