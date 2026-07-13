import { escapeHtml, formatCurrency } from "../_shared/format";

type AdminSummaryRecord = {
  notes?: unknown;
  commission_amount?: unknown;
  commissionAmount?: unknown;
  lw_amount?: unknown;
  lwAmount?: unknown;
};

type AdminSummaryRep = {
  rep_name?: unknown;
  repName?: unknown;
  commissionThisMonth?: unknown;
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

function resolvePayload(payload: unknown): {
  reps: AdminSummaryRep[];
  monthLabel: string;
} {
  if (Array.isArray(payload)) {
    return { reps: payload as AdminSummaryRep[], monthLabel: "N/A" };
  }

  if (!payload || typeof payload !== "object") {
    return { reps: [], monthLabel: "N/A" };
  }

  const candidate = payload as Record<string, unknown>;
  const reps =
    candidate.reps ??
    candidate.summary ??
    candidate.report ??
    candidate.data ??
    candidate.results ??
    candidate.items;

  return {
    reps: Array.isArray(reps) ? (reps as AdminSummaryRep[]) : [],
    monthLabel: asString(candidate.month_label, "N/A"),
  };
}

function buildSummaryRows(reps: AdminSummaryRep[], monthLabel: string): string {
  const rows: string[] = [];
  const month = escapeHtml(monthLabel);

  for (const rep of reps) {
    const repName = escapeHtml(asString(rep.rep_name ?? rep.repName, "Unknown Rep"));
    const records = Array.isArray(rep.commissionThisMonth)
      ? (rep.commissionThisMonth as AdminSummaryRecord[])
      : [];

    for (const record of records) {
      const commissionAmount = formatCurrency(
        toNumber(record.commission_amount ?? record.commissionAmount),
      );
      const lwAmount = formatCurrency(
        toNumber(record.lw_amount ?? record.lwAmount),
      );
      const notes = escapeHtml(asString(record.notes, "N/A"));

      rows.push(`
        <tr>
          <td>${repName}</td>
          <td>${month}</td>
          <td>${commissionAmount}</td>
          <td>${lwAmount}</td>
          <td>${notes}</td>
        </tr>
      `);
    }
  }

  if (rows.length === 0) {
    return `
      <tr>
        <td colspan="5" class="empty">No records were provided.</td>
      </tr>
    `;
  }

  return rows.join("");
}

function buildAdminSummaryHtml(
  reps: AdminSummaryRep[],
  monthLabel: string,
): string {
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
        max-width: 900px;
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
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <h1>LowerWatt Admin Summary</h1>
          <p>Monthly commission snapshot</p>
        </div>
        <div class="content">
          <table>
            <thead>
              <tr>
                <th>Rep Name</th>
                <th>Month</th>
                <th>Commission Amount</th>
                <th>LW</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              ${buildSummaryRows(reps, monthLabel)}
            </tbody>
          </table>
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
    const { reps, monthLabel } = resolvePayload(payload);
    const html = buildAdminSummaryHtml(reps, monthLabel);

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
