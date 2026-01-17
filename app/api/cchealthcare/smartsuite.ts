import { type FormType } from "./pdf";
import { type ZohoRecordDetails } from "./zoho";

type SmartSuiteCreateResponse = {
  id?: string;
};

type SmartSuiteAttachment = {
  filename: string;
  contentType: string;
  data: Buffer;
};

type SmartSuiteEmployeeListResponse = {
  items?: Array<{ id?: string }>;
  total?: number;
};

const SMARTSUITE_ATTACHMENT_FIELD_ID = "s1d6347da1";
const SMARTSUITE_EMPLOYEE_TABLE_ID = "69695887db422e6eb4cea61c";
const SMARTSUITE_EMPLOYEE_EMAIL_FIELD_ID = "s13b288a1b";
const SMARTSUITE_EMPLOYEE_LINK_FIELD_ID = "sf7d6cba84";
const SMARTSUITE_REIMBURSEMENT_FOR_FIELD_ID = "sc765b0e18";
const SMARTSUITE_REIMBURSEMENT_FOR: Record<FormType, string> = {
  "expense-reimbursement": "DnSFf",
  "mileage-reimbursement": "mKTXD",
  "petty-cash": "ZH8L3",
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
        [SMARTSUITE_REIMBURSEMENT_FOR_FIELD_ID]:
          SMARTSUITE_REIMBURSEMENT_FOR[formType],
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
      [SMARTSUITE_REIMBURSEMENT_FOR_FIELD_ID]:
        SMARTSUITE_REIMBURSEMENT_FOR[formType],
    };

    if (facility) {
      payload.sb5b06f6f2 = facility;
    }

    if (formType === "petty-cash") {
      if (requesterName ?? employeeName) {
        payload.s357536aaf = requesterName ?? employeeName;
      }

      if (requesterEmail ?? employeeEmail) {
        payload.s0df5a9f6c = [requesterEmail ?? employeeEmail!];
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
      [SMARTSUITE_REIMBURSEMENT_FOR_FIELD_ID]:
        SMARTSUITE_REIMBURSEMENT_FOR[formType],
    };
  }
}

function getEmployeeInfo(
  recordDetails: unknown,
  formType: FormType
): { name?: string; email?: string } {
  try {
    const details = recordDetails as ZohoRecordDetails;
    const record = details.data?.[0];
    if (!record) return {};

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

    if (formType === "petty-cash") {
      return {
        name: requesterName ?? employeeName,
        email: requesterEmail ?? employeeEmail,
      };
    }

    return { name: employeeName, email: employeeEmail };
  } catch (error) {
    console.error("[CCHEALTHCARE] Error reading employee info:", error);
    return {};
  }
}

async function findEmployeeIdByEmail({
  apiKey,
  accountId,
  email,
}: {
  apiKey: string;
  accountId: string;
  email: string;
}): Promise<string | undefined> {
  const response = await fetch(
    `https://app.smartsuite.com/api/v1/applications/${SMARTSUITE_EMPLOYEE_TABLE_ID}/records/list/?offset=0&limit=1`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sort: [],
        filter: {
         
            operator: "and",
            fields: [
              {
                comparison: "is",
                field: SMARTSUITE_EMPLOYEE_EMAIL_FIELD_ID,
                value: email,
              },
            ],
          
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite employee lookup failed: ${response.status} ${errorText}`
    );
  }

  const data = (await response.json()) as SmartSuiteEmployeeListResponse;
  return data.items?.[0]?.id;
}

async function createEmployeeRecord({
  apiKey,
  accountId,
  name,
  email,
}: {
  apiKey: string;
  accountId: string;
  name?: string;
  email: string;
}): Promise<string | undefined> {
  const response = await fetch(
    `https://app.smartsuite.com/api/v1/applications/${SMARTSUITE_EMPLOYEE_TABLE_ID}/records/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: name ?? email,
        [SMARTSUITE_EMPLOYEE_EMAIL_FIELD_ID]: email,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite employee create failed: ${response.status} ${errorText}`
    );
  }

  const record = (await response.json()) as SmartSuiteCreateResponse;
  return record?.id;
}

async function getOrCreateEmployeeId({
  apiKey,
  accountId,
  name,
  email,
}: {
  apiKey: string;
  accountId: string;
  name?: string;
  email?: string;
}): Promise<string | undefined> {
  if (!email) return undefined;
  const existingId = await findEmployeeIdByEmail({ apiKey, accountId, email });
  if (existingId) return existingId;
  return createEmployeeRecord({ apiKey, accountId, name, email });
}

export async function createSmartSuiteRecord(
  recordDetails: unknown,
  formType: FormType,
  attachment?: SmartSuiteAttachment
): Promise<SmartSuiteCreateResponse> {
  const { apiKey, accountId, tableId } = getSmartSuiteConfig();
  const payload = buildSmartSuitePayload(recordDetails, formType);
  const employeeInfo = getEmployeeInfo(recordDetails, formType);
  const employeeId = await getOrCreateEmployeeId({
    apiKey,
    accountId,
    name: employeeInfo.name,
    email: employeeInfo.email,
  });

  if (employeeId) {
    payload[SMARTSUITE_EMPLOYEE_LINK_FIELD_ID] = [employeeId];
  }

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

  const record = (await response.json()) as SmartSuiteCreateResponse;

  if (attachment && record?.id) {
    await uploadSmartSuiteAttachment({
      apiKey,
      accountId,
      tableId,
      recordId: record.id,
      fieldId: SMARTSUITE_ATTACHMENT_FIELD_ID,
      attachment,
    });
  }

  return record;
}

async function uploadSmartSuiteAttachment({
  apiKey,
  accountId,
  tableId,
  recordId,
  fieldId,
  attachment,
}: {
  apiKey: string;
  accountId: string;
  tableId: string;
  recordId: string;
  fieldId: string;
  attachment: SmartSuiteAttachment;
}) {
  const formData = new FormData();
  const fileBytes = new Uint8Array(attachment.data);
  const fileBlob = new Blob([fileBytes], {
    type: attachment.contentType,
  });

  formData.append("files", fileBlob, attachment.filename);
  formData.append("filename", attachment.filename);

  const response = await fetch(
    `https://app.smartsuite.com/api/v1/recordfiles/${tableId}/${recordId}/${fieldId}/`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "ACCOUNT-ID": accountId,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `SmartSuite attachment upload failed: ${response.status} ${errorText}`
    );
  }
}
