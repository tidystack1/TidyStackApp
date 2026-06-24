export type LowerWattCommission = {
  description?: string;
  gross?: number;
  commissionRate?: number;
  commissionAmount?: number;
  lwAmount?: number;
};

export type LowerWattPayload = {
  repId?: string;
  repName?: string;
  repEmail?: string;
  monthTitle?: string;
  commissions?: LowerWattCommission[];
  totalCommission?: number;
  totalLW?: number;
};
