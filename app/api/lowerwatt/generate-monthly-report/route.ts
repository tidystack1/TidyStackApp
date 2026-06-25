import { normalizePayload } from "../_shared/commissions";
import { buildCommissionsHtml } from "../_shared/html-builder";
import {
  buildCommissionsPdf,
  buildCommissionsPdfFilename,
} from "../_shared/pdf-builder";
import type { LowerWattPayload } from "../_shared/types";

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as LowerWattPayload;
    const normalized = normalizePayload(payload);
    const html = buildCommissionsHtml(normalized);
    const pdfBuffer = await buildCommissionsPdf(normalized);
    const pdfFilename = buildCommissionsPdfFilename(normalized);

    return Response.json({
      company: "LowerWatt",
      repId: normalized.repId ?? null,
      repName: normalized.repName ?? null,
      repEmail: normalized.repEmail ?? null,
      monthTitle: normalized.monthTitle ?? null,
      previousMonthTitle: normalized.previousMonthTitle ?? null,
      html,
      pdfFilename,
      pdfMimeType: "application/pdf",
      pdfBase64: pdfBuffer.toString("base64"),
      pdfSizeBytes: pdfBuffer.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to parse request body";

    return Response.json(
      { error: message },
      { status: 400 },
    );
  }
}
