import type { FormData } from "./pdf-builder";

/**
 * HubSpot / Zapier often send `{ "info": "<stringified JSON>" }`.
 * For manual testing, `{ "info": { ...flat fields } }` is also accepted.
 */
export function parseFormPDFBody(body: Record<string, unknown>): FormData | null {
  if (typeof body.info === "string") {
    try {
      return JSON.parse(body.info) as FormData;
    } catch {
      return null;
    }
  }
  if (
    body.info !== null &&
    body.info !== undefined &&
    typeof body.info === "object" &&
    !Array.isArray(body.info)
  ) {
    return body.info as FormData;
  }
  return body as FormData;
}
