import type { LowerWattCommission, LowerWattPayload } from "./types";

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
  const commissionThisMonth = Array.isArray(payload.commissionThisMonth)
    ? payload.commissionThisMonth
    : Array.isArray(payload.commissions)
      ? payload.commissions
      : [];
  const commissionLastMonth = Array.isArray(payload.commissionLastMonth)
    ? payload.commissionLastMonth
    : [];

  const thisMonthTotals = sumCommissionTotals(commissionThisMonth);
  const lastMonthTotals = sumCommissionTotals(commissionLastMonth);

  return {
    repId: payload.repId,
    repName: payload.repName,
    repEmail: payload.repEmail,
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
