import type Anthropic from "@anthropic-ai/sdk";

type InputSchema = Anthropic.Tool.InputSchema;

export const BILL_EXTRACTION_PROMPT = `You are extracting utility invoice fields for LowerWatt / SmartSuite.

Read the attached PDF bill carefully (including tables and charge breakdowns).
Return ONLY a single JSON object with this exact shape:

{
  "mode": "new_account",
  "details": {
    "nameOnUtilityBill": string | null,
    "utility": string | null,
    "supplier": string | null,
    "accountNumber": string | null,
    "serviceAddressStreet": string | null,
    "serviceAddressSuiteApt": string | null,
    "serviceAddressCity": string | null,
    "serviceAddressState": string | null,
    "serviceAddressZip": string | null,
    "rateClass": string | null,
    "meterNumber": string | null,
    "meterSize": string | null,
    "netMeterSolar": "Yes" | "No" | "N/A" | null,
    "unitOfMeasurement": "CCF" | "Gallons" | "kWh" | "therms" | "N/A" | null,
    "payingSalesTax": "Yes" | "No" | null,
    "procurementAccountNumber": string | null,
    "phoneNumber": string | null,
    "typeOfService": "Water" | "Gas" | "Electric" | null,
    "billingPeriodStart": string | null,
    "billingPeriodEnd": string | null,
    "usagePerBillingPeriod": number | null,
    "usageUnit": string | null,
    "deliveryCharges": number | null,
    "supplyCharges": number | null,
    "waterServiceCharge": number | null,
    "waterUsageCharge": number | null,
    "sewerServiceCharge": number | null,
    "sewerUsageCharge": number | null,
    "lineItemsOtherCharges": [{ "description": string, "amount": number }],
    "total": number | null
  },
  "notes": string[],
  "confidence": "high" | "medium" | "low"
}

Rules:
- Prefer values printed on the bill. Use null when a field is not present.
- Account #: required when visible; keep formatting as printed (spaces/dashes ok).
- Service address: split into separate fields — do NOT return one combined address string.
  - serviceAddressStreet: street number + street name only (e.g. "123 Main St").
  - serviceAddressSuiteApt: suite, apartment, unit, floor, or similar (e.g. "Apt 4B", "Suite 200"); null if none.
  - serviceAddressCity: city name only.
  - serviceAddressState: 2-letter state code when available (e.g. "NJ"), otherwise as printed.
  - serviceAddressZip: ZIP or ZIP+4 when available.
  - Prefer the service / premise address over the mailing address when both exist.
- Supplier: null when the utility supplies the commodity itself.
- Rate class: e.g. GLP, General Service, GS-1, etc.
- Type of service: classify the bill as exactly one of "Water", "Gas", or "Electric" (primary commodity). Use water/sewer/CCF/gallons cues for Water; therms/BGSS/gas cues for Gas; kWh/electric/BGS cues for Electric. If unclear or multi-commodity with no primary, use null.
- Meter size / unit of measurement: mainly water; otherwise null or N/A as appropriate.
- Net meter / solar: Yes only if solar generation / net metering is evident; otherwise No or N/A.
- Paying sales tax: Yes only if a sales tax line/amount appears.
- Procurement account #: service agreement / PO / supplier agreement IDs (common on South Jersey Gas).
- Billing period: use stated billing/service period; for water, meter read start/end dates are fine.
- Usage: primary period usage number; set usageUnit (kWh, therms, CCF, etc.).
- Delivery vs supply (electric/gas):
  - If the bill clearly labels a "Delivery Charge" (or Delivery Charges) line with an amount, use that amount for deliveryCharges — do NOT substitute "Total Usage Costs" or other rollups that also include customer / service charges.
  - Otherwise Delivery = delivery / distribution / customer / demand / societal benefits when those are grouped under delivery with no separate labeled delivery line.
  - Supply = BGSS / BGS / cost of energy / supply charges.
  - Gas fallback: if supply cannot be separated, put all commodity charges in deliveryCharges and note "supply included in delivery".
- Water:
  - Map ready-to-serve / water ready / service charge → waterServiceCharge
  - Map water usage → waterUsageCharge
  - Same pattern for sewer when present
  - Fallback: if service and usage are combined, put combined amount in waterServiceCharge and note "usage included".
- lineItemsOtherCharges: each non-core other charge (late fees, transfers labeled as charges, gov fees, etc.) with description + amount. Do not duplicate amounts already placed in delivery/supply/water/sewer totals unless they are separate add-ons.
- total: current bill total / amount due for this period's charges when clear.
- For multi-meter or summary bills, extract the primary account-level fields and the most recent billing period's charges; list extra meters in notes.
- mode: always "new_account" for now.
- confidence: high if key fields are clear; medium if some ambiguity; low if poor OCR/layout or conflicting totals.
- notes: short strings about fallbacks, multi-meter, missing city, credit balances, etc.
- Escape all quotes inside string values. Never include markdown, comments, or trailing commas.

Currency amounts must be numbers (not strings). Dates preferably YYYY-MM-DD.`;

export const BILL_EXTRACTION_TOOL_NAME = "extract_utility_bill";

const nullableString = { type: ["string", "null"] };
const nullableNumber = { type: ["number", "null"] };

/** Tool input schema for Claude — prefer tool_use so args arrive already parsed. */
export const BILL_EXTRACTION_INPUT_SCHEMA: InputSchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["new_account"] },
    details: {
      type: "object",
      properties: {
        nameOnUtilityBill: nullableString,
        utility: nullableString,
        supplier: nullableString,
        accountNumber: nullableString,
        serviceAddressStreet: nullableString,
        serviceAddressSuiteApt: nullableString,
        serviceAddressCity: nullableString,
        serviceAddressState: nullableString,
        serviceAddressZip: nullableString,
        rateClass: nullableString,
        meterNumber: nullableString,
        meterSize: nullableString,
        netMeterSolar: {
          type: ["string", "null"],
          enum: ["Yes", "No", "N/A", null],
        },
        unitOfMeasurement: {
          type: ["string", "null"],
          enum: ["CCF", "Gallons", "kWh", "therms", "N/A", null],
        },
        payingSalesTax: {
          type: ["string", "null"],
          enum: ["Yes", "No", null],
        },
        procurementAccountNumber: nullableString,
        phoneNumber: nullableString,
        typeOfService: {
          type: ["string", "null"],
          enum: ["Water", "Gas", "Electric", null],
        },
        billingPeriodStart: nullableString,
        billingPeriodEnd: nullableString,
        usagePerBillingPeriod: nullableNumber,
        usageUnit: nullableString,
        deliveryCharges: nullableNumber,
        supplyCharges: nullableNumber,
        waterServiceCharge: nullableNumber,
        waterUsageCharge: nullableNumber,
        sewerServiceCharge: nullableNumber,
        sewerUsageCharge: nullableNumber,
        lineItemsOtherCharges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              amount: { type: "number" },
            },
            required: ["description", "amount"],
            additionalProperties: false,
          },
        },
        total: nullableNumber,
      },
      required: [
        "nameOnUtilityBill",
        "utility",
        "supplier",
        "accountNumber",
        "serviceAddressStreet",
        "serviceAddressSuiteApt",
        "serviceAddressCity",
        "serviceAddressState",
        "serviceAddressZip",
        "rateClass",
        "meterNumber",
        "meterSize",
        "netMeterSolar",
        "unitOfMeasurement",
        "payingSalesTax",
        "procurementAccountNumber",
        "phoneNumber",
        "typeOfService",
        "billingPeriodStart",
        "billingPeriodEnd",
        "usagePerBillingPeriod",
        "usageUnit",
        "deliveryCharges",
        "supplyCharges",
        "waterServiceCharge",
        "waterUsageCharge",
        "sewerServiceCharge",
        "sewerUsageCharge",
        "lineItemsOtherCharges",
        "total",
      ],
      additionalProperties: false,
    },
    notes: {
      type: "array",
      items: { type: "string" },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["mode", "details", "notes", "confidence"],
  additionalProperties: false,
};

export function parseJsonFromModel(text: string): unknown {
  let trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Model did not return valid JSON");
  }

  // Strip common markdown fences before parsing.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    trimmed = fenced[1].trim();
  }

  const attempts = [trimmed];

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0] !== trimmed) {
    attempts.push(objectMatch[0]);
  }

  let lastError: unknown;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }

    // Trailing commas before } or ] are a frequent model slip.
    const withoutTrailingCommas = candidate.replace(/,\s*([\]}])/g, "$1");
    if (withoutTrailingCommas !== candidate) {
      try {
        return JSON.parse(withoutTrailingCommas);
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Model did not return valid JSON");
}

/** Prefer structured tool_use input (already parsed); fall back to text JSON. */
export function extractBillFromClaudeContent(
  content: Anthropic.ContentBlock[],
): unknown {
  const toolBlock = content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === BILL_EXTRACTION_TOOL_NAME,
  );
  if (toolBlock) {
    return toolBlock.input;
  }

  const textBlock = content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Claude did not return tool_use or text content");
  }

  return parseJsonFromModel(textBlock.text);
}
