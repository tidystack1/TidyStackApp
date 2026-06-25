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

export type LowerWattPayload = {
  repId?: string;
  repName?: string;
  repEmail?: string;
  monthTitle?: string;
  previousMonthTitle?: string;
  commissionThisMonth?: LowerWattCommission[];
  commissionLastMonth?: LowerWattCommission[];
  /** @deprecated Use commissionThisMonth */
  commissions?: LowerWattCommission[];
};
