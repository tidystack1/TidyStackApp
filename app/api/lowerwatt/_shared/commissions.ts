import type {
  LowerWattCommission,
  LowerWattCommissionInput,
  LowerWattPayload,
} from "./types";

export type NormalizedRepPayload = {
  repId?: string;
  repName?: string;
  repEmail?: string;
  monthTitle: string;
  previousMonthTitle: string;
  commissionThisMonth: LowerWattCommission[];
  commissionLastMonth: LowerWattCommission[];
  totalCommissionThisMonth: number;
  totalLWThisMonth: number;
  totalCommissionLastMonth: number;
  totalLWLastMonth: number;
};

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeCommission(item: LowerWattCommissionInput): LowerWattCommission {
  return {
    id: asOptionalString(item.id),
    notes: asOptionalString(item.notes) ?? asOptionalString(item.description),
    description: asOptionalString(item.description),
    gross: asNumber(item.gross) ?? asNumber(item.gross_amount),
    commissionRate:
      asNumber(item.commissionRate) ?? asNumber(item.commission_rate),
    commissionAmount:
      asNumber(item.commissionAmount) ?? asNumber(item.commission_amount),
    commissionTotal:
      asNumber(item.commissionTotal) ?? asNumber(item.commission_total),
    adjustment: asNumber(item.adjustment) ?? 0,
    lwRate: asNumber(item.lwRate) ?? asNumber(item.lw_rate),
    lwAmount: asNumber(item.lwAmount) ?? asNumber(item.lw_amount),
  };
}

function normalizeCommissionList(
  value: unknown,
): LowerWattCommission[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) =>
    normalizeCommission((item ?? {}) as LowerWattCommissionInput),
  );
}

function sumCommissionTotals(commissions: LowerWattCommission[]) {
  return commissions.reduce(
    (totals, item) => ({
      totalCommission: totals.totalCommission + Number(item.commissionAmount ?? 0),
      totalLW: totals.totalLW + Number(item.lwAmount ?? 0),
    }),
    { totalCommission: 0, totalLW: 0 },
  );
}

export function normalizePayload(payload: LowerWattPayload): NormalizedRepPayload {
  const commissionThisMonth = normalizeCommissionList(
    payload.commissionThisMonth ??
      payload.commissions ??
      payload.records,
  );
  const commissionLastMonth = normalizeCommissionList(payload.commissionLastMonth);

  const thisMonthTotals = sumCommissionTotals(commissionThisMonth);
  const lastMonthTotals = sumCommissionTotals(commissionLastMonth);

  return {
    repId: asOptionalString(payload.repId) ?? asOptionalString(payload.rep_id),
    repName:
      asOptionalString(payload.repName) ?? asOptionalString(payload.rep_name),
    repEmail:
      asOptionalString(payload.repEmail) ?? asOptionalString(payload.rep_email),
    monthTitle: payload.monthTitle?.trim() || "Current Month",
    previousMonthTitle: payload.previousMonthTitle?.trim() || "Previous Month",
    commissionThisMonth,
    commissionLastMonth,
    totalCommissionThisMonth: thisMonthTotals.totalCommission,
    totalLWThisMonth: thisMonthTotals.totalLW,
    totalCommissionLastMonth: lastMonthTotals.totalCommission,
    totalLWLastMonth: lastMonthTotals.totalLW,
  };
}
