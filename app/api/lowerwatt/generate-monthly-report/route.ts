import { buildCommissionsHtml } from "../_shared/html-builder";
import {
  buildCommissionsPdf,
  buildCommissionsPdfFilename,
} from "../_shared/pdf-builder";
import type { LowerWattPayload } from "../_shared/types";

export async function POST(request: Request): Promise<Response> {
  try {
    const payload = (await request.json()) as LowerWattPayload;
    const html = buildCommissionsHtml(payload);
    const pdfBuffer = await buildCommissionsPdf(payload);
    const pdfFilename = buildCommissionsPdfFilename(payload);

    return Response.json({
      company: "LowerWatt",
      repId: payload.repId ?? null,
      repName: payload.repName ?? null,
      repEmail: payload.repEmail ?? null,
      monthTitle: payload.monthTitle ?? null,
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
