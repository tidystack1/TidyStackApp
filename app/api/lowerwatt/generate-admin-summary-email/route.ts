import { escapeHtml, formatCurrency, formatPercent } from "../_shared/format";

type AdminSummaryRecord = {
  notes?: unknown;
  gross_amount?: unknown;
  commission_rate?: unknown;
  commission_amount?: unknown;
  lw_rate?: unknown;
  lw_amount?: unknown;
};

type AdminSummaryRep = {
  rep_id?: unknown;
  rep_name?: unknown;
  rep_email?: unknown;
  total_commission?: unknown;
  total_lw?: unknown;
  records?: unknown;
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  return fallback;
}

function resolveReps(payload: unknown): AdminSummaryRep[] {
  if (Array.isArray(payload)) {
    return payload as AdminSummaryRep[];
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = payload as Record<string, unknown>;
  const reps =
    candidate.reps ??
    candidate.summary ??
    candidate.report ??
    candidate.data ??
    candidate.results ??
    candidate.items;

  return Array.isArray(reps) ? (reps as AdminSummaryRep[]) : [];
}

function buildRepRows(records: AdminSummaryRecord[]): string {
  if (records.length === 0) {
    return `
      <tr>
        <td colspan="6" class="empty">No records for this rep.</td>
      </tr>
    `;
  }

  return records
    .map((record) => {
      const notes = escapeHtml(asString(record.notes, "N/A"));
      const grossAmount = formatCurrency(toNumber(record.gross_amount));
      const commissionRate = formatPercent(toNumber(record.commission_rate));
      const commissionAmount = formatCurrency(toNumber(record.commission_amount));
      const lwRate = formatPercent(toNumber(record.lw_rate));
      const lwAmount = formatCurrency(toNumber(record.lw_amount));

      return `
        <tr>
          <td>${grossAmount}</td>
          <td>${commissionRate}</td>
          <td>${commissionAmount}</td>
          <td>${lwRate}</td>
          <td>${lwAmount}</td>
          <td>${notes}</td>
        </tr>
      `;
    })
    .join("");
}

function buildRepSection(rep: AdminSummaryRep): string {
  const repName = escapeHtml(asString(rep.rep_name, "Unknown Rep"));
  const repEmail = escapeHtml(asString(rep.rep_email, "No email provided"));
  const repId = escapeHtml(asString(rep.rep_id, "N/A"));
  const records = Array.isArray(rep.records)
    ? (rep.records as AdminSummaryRecord[])
    : [];

  const calculatedCommissionTotal = records.reduce(
    (sum, record) => sum + toNumber(record.commission_amount),
    0,
  );
  const calculatedLwTotal = records.reduce(
    (sum, record) => sum + toNumber(record.lw_amount),
    0,
  );

  const totalCommission = formatCurrency(
    toNumber(rep.total_commission) || calculatedCommissionTotal,
  );
  const totalLw = formatCurrency(toNumber(rep.total_lw) || calculatedLwTotal);

  return `
    <section class="rep-section">
      <div class="rep-header">
        <h2>${repName}</h2>
        <p><strong>Email:</strong> ${repEmail}</p>
        <p><strong>Rep ID:</strong> ${repId}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Gross Amount</th>
            <th>Commission Rate</th>
            <th>Commission Amount</th>
            <th>LW Rate</th>
            <th>LW Amount</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${buildRepRows(records)}
        </tbody>
      </table>
      <div class="totals">
        <p><strong>Total Commission:</strong> ${totalCommission}</p>
        <p><strong>Total LW:</strong> ${totalLw}</p>
        <p><strong>Record Count:</strong> ${records.length}</p>
      </div>
    </section>
  `;
}

function buildAdminSummaryHtml(reps: AdminSummaryRep[]): string {
  const repSections = reps.map((rep) => buildRepSection(rep)).join("");

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LowerWatt Admin Summary</title>
    <style>
      body {
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
        font-family: Arial, Helvetica, sans-serif;
      }
      .wrapper {
        width: 100%;
        padding: 24px 0;
      }
      .card {
        max-width: 1000px;
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
      }
      .header p {
        margin: 6px 0 0;
        color: #cbd5e1;
        font-size: 14px;
      }
      .content {
        padding: 20px 24px 28px;
      }
      .rep-section {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 14px 14px 12px;
        margin-bottom: 18px;
        background: #f8fafc;
      }
      .rep-section:last-child {
        margin-bottom: 0;
      }
      .rep-header {
        margin-bottom: 12px;
      }
      .rep-header h2 {
        margin: 0 0 6px;
        font-size: 18px;
      }
      .rep-header p {
        margin: 2px 0;
        font-size: 14px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
        background: #ffffff;
      }
      th, td {
        text-align: left;
        padding: 9px 10px;
        border-bottom: 1px solid #e2e8f0;
      }
      th {
        background: #f1f5f9;
        font-weight: 700;
      }
      .empty {
        text-align: center;
        color: #64748b;
      }
      .totals {
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
      }
      .totals p {
        margin: 4px 0;
        font-size: 14px;
      }
      .empty-state {
        text-align: center;
        color: #64748b;
        padding: 24px;
        border: 1px dashed #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <h1>LowerWatt Admin Summary</h1>
          <p>Monthly report snapshot grouped by rep</p>
        </div>
        <div class="content">
          ${
            reps.length > 0
              ? repSections
              : '<div class="empty-state">No rep records were provided.</div>'
          }
        </div>
      </div>
    </div>
  </body>
</html>
  `;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as unknown;
    const reps = resolveReps(payload);
    const html = buildAdminSummaryHtml(reps);

    return Response.json({
      company: "LowerWatt",
      html,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to parse request body";

    return Response.json(
      {
        error: message,
      },
      { status: 400 },
    );
  }
}
