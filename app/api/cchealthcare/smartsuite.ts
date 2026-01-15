import { type FormType } from "./pdf";
import { type ZohoRecordDetails } from "./zoho";

type SmartSuiteCreateResponse = {
  id?: string;
};

const SMARTSUITE_REIMBURSEMENT_FOR: Record<FormType, string> = {
  "expense-reimbursement": "Expense Reimbursement",
  "mileage-reimbursement": "Mileage Reimbursement",
  "petty-cash": "Petty Cash",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceZohoFieldText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  if (typeof value === "number") return String(value);
  if (isRecord(value)) {
    const candidates = [
      value["display_value"],
      value["name"],
      value["value"],
      value["label"],
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length) return c.trim();
      if (typeof c === "number") return String(c);
    }
  }
  const stringified = String(value).trim();
  return stringified.length ? stringified : undefined;
}

function buildFullName(first?: string, last?: string): string | undefined {
  const trimmedFirst = first?.trim();
  const trimmedLast = last?.trim();
  if (trimmedFirst && trimmedLast) return `${trimmedFirst} ${trimmedLast}`;
  return trimmedFirst ?? trimmedLast ?? undefined;
}

function getSmartSuiteConfig() {
  const apiKey = process.env.SMARTSUITE_API_KEY;
  const accountId = process.env.SMARTSUITE_ACCOUNT_ID;
  const tableId = process.env.SMARTSUITE_TABLE_ID;

  const missing: string[] = [];
  if (!apiKey) missing.push("SMARTSUITE_API_KEY");
  if (!accountId) missing.push("SMARTSUITE_ACCOUNT_ID");
  if (!tableId) missing.push("SMARTSUITE_TABLE_ID");

  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}`);
  }

  return {
    apiKey: apiKey!,
    accountId: accountId!,
    tableId: tableId!,
  };
}

function buildSmartSuitePayload(
  recordDetails: unknown,
  formType: FormType
): Record<string, unknown> {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) {
      return {
        s99efbed72: SMARTSUITE_REIMBURSEMENT_FOR[formType],
      };
    }

    const facility = coerceZohoFieldText(record["Facility"]);
    const employeeFirst = coerceZohoFieldText(record["Employee"]);
    const employeeLast = coerceZohoFieldText(record["Employee_Last_Name"]);
    const employeeEmail = coerceZohoFieldText(record["Employee_Email"]);

    const requesterFirst = coerceZohoFieldText(
      record["Requested_by_First_Name"]
    );
    const requesterLast = coerceZohoFieldText(record["Requested_by_Last_Name"]);
    const requesterEmail = coerceZohoFieldText(record["Requested_by_Email"]);

    const employeeName = buildFullName(employeeFirst, employeeLast);
    const requesterName = buildFullName(requesterFirst, requesterLast);

    const payload: Record<string, unknown> = {
      s99efbed72: SMARTSUITE_REIMBURSEMENT_FOR[formType],
    };

    if (facility) {
      payload.sb5b06f6f2 = facility;
    }

    if (formType === "petty-cash") {
      if (requesterName) {
        payload.sf2bbc6208 = requesterName;
      }

      if (requesterEmail) {
        payload.s22ba4c7b9 = [requesterEmail];
      }
    } else {
      if (employeeName) {
        payload.s357536aaf = employeeName;
      }

      if (employeeEmail) {
        payload.s0df5a9f6c = [employeeEmail];
      }
    }

    return payload;
  } catch (error) {
    console.error("[CCHEALTHCARE] Error building SmartSuite payload:", error);
    return {
      s99efbed72: SMARTSUITE_REIMBURSEMENT_FOR[formType],
    };
  }
}

export async function createSmartSuiteRecord(
  recordDetails: unknown,
  formType: FormType
): Promise<SmartSuiteCreateResponse> {
  const { apiKey, accountId, tableId } = getSmartSuiteConfig();
  const payload = buildSmartSuitePayload(recordDetails, formType);

  const response = await fetch(
    `https://app.smartsuite.com/api/v1/applications/${tableId}/records/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite record create failed: ${response.status} ${errorText}`
    );
  }

  return response.json();
}
