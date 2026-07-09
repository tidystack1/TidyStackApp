export type LowerWattCommission = {
  id?: string;
  notes?: string;
  /** @deprecated Use notes */
  description?: string;
  gross?: number;
  commissionRate?: number;
  commissionAmount?: number;
  lwRate?: number;
  lwAmount?: number;
};

/** Incoming commission row — camelCase or snake_case */
export type LowerWattCommissionInput = LowerWattCommission & {
  gross_amount?: number;
  commission_rate?: number;
  commission_amount?: number;
  lw_rate?: number;
  lw_amount?: number;
};

export type LowerWattPayload = {
  repId?: string;
  repName?: string;
  repEmail?: string;
  rep_id?: string;
  rep_name?: string;
  rep_email?: string;
  monthTitle?: string;
  previousMonthTitle?: string;
  commissionThisMonth?: LowerWattCommissionInput[];
  commissionLastMonth?: LowerWattCommissionInput[];
  /** @deprecated Use commissionThisMonth */
  commissions?: LowerWattCommissionInput[];
  /** Alias for this month's commission rows */
  records?: LowerWattCommissionInput[];
};
