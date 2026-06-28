import type { ParsedEml } from "./parse-eml";
import { emlToPromptText } from "./parse-eml";

export type BookingExtraction = {
  passengerName: string | null;
  departureAirport: string | null;
  arrivalAirport: string | null;
  outboundDate: string | null;
  returnDate: string | null;
  cabinClass: "Business" | "Economy" | null;
  route: "Domestic" | "International" | null;
  passengers: number | null;
  departureRegion: "US" | "Non-US" | null;
};

const BOOKING_JSON_SCHEMA = {
  name: "booking_extraction",
  strict: true,
  schema: {
    type: "object",
    properties: {
      passengerName: {
        type: ["string", "null"],
        description:
          "Primary passenger full name as First Last (e.g. Julie Ann Hargett). Null if not found.",
      },
      departureAirport: {
        type: ["string", "null"],
        description:
          "Verified 3-letter IATA departure airport code only when explicitly stated in the email or attachments. Null if not verified.",
      },
      arrivalAirport: {
        type: ["string", "null"],
        description:
          "Verified 3-letter IATA arrival airport code only when explicitly stated in the email or attachments. Null if not verified.",
      },
      outboundDate: {
        type: ["string", "null"],
        description: "Outbound departure date in DDMMM format (e.g. 18JUN). Null if not found.",
      },
      returnDate: {
        type: ["string", "null"],
        description:
          "Return date in DDMMM format for round trips. Null for one-way trips or if not found.",
      },
      cabinClass: {
        type: ["string", "null"],
        enum: ["Business", "Economy", null],
      },
      route: {
        type: ["string", "null"],
        enum: ["Domestic", "International", null],
      },
      passengers: {
        type: ["integer", "null"],
        description: "Total number of passengers on the request. Null if not found.",
      },
      departureRegion: {
        type: ["string", "null"],
        enum: ["US", "Non-US", null],
        description:
          "Whether the departure airport is in the United States (US) or not (Non-US). Null if unknown.",
      },
    },
    required: [
      "passengerName",
      "departureAirport",
      "arrivalAirport",
      "outboundDate",
      "returnDate",
      "cabinClass",
      "route",
      "passengers",
      "departureRegion",
    ],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You extract structured flight booking details from travel agency emails.

Rules:
- The email has no standard template. Use the full email body and any attached images/screenshots.
- Passenger name: return as "First Last" (middle names allowed), using the primary passenger on the request.
- Departure and arrival airports: return ONLY verified 3-letter IATA codes that are explicitly stated or clearly shown in the email or images. Never guess, assume, or fabricate airport codes. If a code cannot be verified, return null.
- Outbound date: DDMMM in uppercase (e.g. 18JUN). Return date: same format for round trips; null for one-way trips or if unknown.
- Cabin class: exactly "Business" or "Economy", or null if unknown.
- Route: "Domestic" if both airports are in the same country, otherwise "International", or null if unknown.
- Passengers: total passenger count on the request, or null if unknown.
- Departure region: "US" if the departure airport is in the United States, otherwise "Non-US", or null if unknown.
- Always include every field in the response. Use null for any field that is missing, unknown, or cannot be verified.`;

function getOpenAiConfig() {
  const apiKey = process.env.HIGHVIEWTRAVEL_OPENAI_API_KEY;
  const model = process.env.HIGHVIEWTRAVEL_OPENAI_MODEL ?? "gpt-4o";

  if (!apiKey) {
    throw new Error(
      "HIGHVIEWTRAVEL_OPENAI_API_KEY is not set in environment variables",
    );
  }

  return { apiKey, model };
}

function toNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNullableIata(value: string | null | undefined): string | null {
  const trimmed = toNullableString(value);
  return trimmed ? trimmed.toUpperCase() : null;
}

function toNullableDate(value: string | null | undefined): string | null {
  const trimmed = toNullableString(value);
  return trimmed ? trimmed.toUpperCase() : null;
}

function toNullablePassengers(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 1) return null;
  return Math.trunc(value);
}

export function normalizeExtraction(raw: Partial<BookingExtraction>): BookingExtraction {
  return {
    passengerName: toNullableString(raw.passengerName ?? null),
    departureAirport: toNullableIata(raw.departureAirport ?? null),
    arrivalAirport: toNullableIata(raw.arrivalAirport ?? null),
    outboundDate: toNullableDate(raw.outboundDate ?? null),
    returnDate: toNullableDate(raw.returnDate ?? null),
    cabinClass:
      raw.cabinClass === "Business" || raw.cabinClass === "Economy"
        ? raw.cabinClass
        : null,
    route:
      raw.route === "Domestic" || raw.route === "International" ? raw.route : null,
    passengers: toNullablePassengers(raw.passengers ?? null),
    departureRegion:
      raw.departureRegion === "US" || raw.departureRegion === "Non-US"
        ? raw.departureRegion
        : null,
  };
}

function buildUserContent(parsed: ParsedEml) {
  const text = emlToPromptText(parsed);
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text }];

  for (const image of parsed.images.slice(0, 8)) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
      },
    });
  }

  return content;
}

export async function extractBookingFromEmail(
  parsed: ParsedEml,
): Promise<BookingExtraction> {
  const { apiKey, model } = getOpenAiConfig();

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(parsed) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: BOOKING_JSON_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  const parsedResult = JSON.parse(content) as Partial<BookingExtraction>;

  return normalizeExtraction(parsedResult);
}
