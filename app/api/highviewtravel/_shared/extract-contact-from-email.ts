import type { ParsedEml } from "./parse-eml";
import { emlToPromptText } from "./parse-eml";

export type ContactExtraction = {
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
};

const CONTACT_JSON_SCHEMA = {
  name: "contact_extraction",
  strict: true,
  schema: {
    type: "object",
    properties: {
      firstName: {
        type: ["string", "null"],
        description:
          "Contact first name from the From header or email signature. Null if not found.",
      },
      lastName: {
        type: ["string", "null"],
        description:
          "Contact last name from the From header or email signature. Null if not found.",
      },
      phoneNumber: {
        type: ["string", "null"],
        description:
          "Best phone number for the sender. Prefer toll-free (800/888/877/866/855/844/833). Check the signature. Null if none found.",
      },
    },
    required: ["firstName", "lastName", "phoneNumber"],
    additionalProperties: false,
  },
} as const;

const SYSTEM_PROMPT = `You extract contact details from a travel-agency email so we can create a HubSpot contact.

Rules:
- Use the From header and the email body/signature. Do not invent values.
- firstName / lastName: prefer the sender's personal name (From display name or signature). Ignore company names for these fields when a person name is present.
- phoneNumber: find the sender's phone in the body or signature. Prefer a toll-free number (US/Canada 800, 888, 877, 866, 855, 844, 833) when multiple numbers exist. Otherwise pick the primary business/mobile number. Return digits with optional leading + and separators as written (or a clean normalized form). Null if no phone is found.
- Always include every field. Use null when missing or unknown.`;

const MAX_PROMPT_CHARS = 24_000;

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

export function normalizeContactExtraction(
  raw: Partial<ContactExtraction>,
): ContactExtraction {
  return {
    firstName: toNullableString(raw.firstName ?? null),
    lastName: toNullableString(raw.lastName ?? null),
    phoneNumber: toNullableString(raw.phoneNumber ?? null),
  };
}

/** Text-only prompt; keeps signature-heavy end of long bodies to avoid huge OpenAI payloads. */
function buildContactPromptText(parsed: ParsedEml): string {
  const withoutImages: ParsedEml = { ...parsed, images: [] };
  const full = emlToPromptText(withoutImages);
  if (full.length <= MAX_PROMPT_CHARS) return full;

  const head = Math.floor(MAX_PROMPT_CHARS * 0.25);
  const tail = MAX_PROMPT_CHARS - head - 80;
  return `${full.slice(0, head)}\n\n...[truncated]...\n\n${full.slice(-tail)}`;
}

export async function extractContactFromEmail(
  parsed: ParsedEml,
): Promise<ContactExtraction> {
  const { apiKey, model } = getOpenAiConfig();
  const promptText = buildContactPromptText(parsed);

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
        { role: "user", content: promptText },
      ],
      response_format: {
        type: "json_schema",
        json_schema: CONTACT_JSON_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `OpenAI request failed (${res.status}): ${text.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned an empty response");
  }

  const parsedResult = JSON.parse(content) as Partial<ContactExtraction>;
  return normalizeContactExtraction(parsedResult);
}
