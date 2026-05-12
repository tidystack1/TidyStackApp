import { NextRequest, NextResponse } from "next/server";
import { parseFormPDFBody } from "../_shared/parse-form-body";
import { buildPDF, parseSafeFileName } from "../_shared/pdf-builder";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const data = parseFormPDFBody(body);

    if (!data) {
      return NextResponse.json({ error: "Could not parse `info` field as JSON" }, { status: 400 });
    }

    const pdfBytes = await buildPDF(data);
    const fileName = `${parseSafeFileName(data["HubSpot Deal Name"] ?? "")}_summary.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Length": String(pdfBytes.byteLength),
      },
    });
  } catch (error) {
    console.error("[generateFormPDF] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate PDF", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
