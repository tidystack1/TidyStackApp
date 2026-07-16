import MsgReaderImport from "@kenjiuno/msgreader";
import type { ParsedEml } from "./parse-eml";

type MsgReaderCtor = new (buffer: ArrayBuffer | DataView) => {
  getFileData: () => {
    error?: string;
    subject?: string;
    senderName?: string;
    senderEmail?: string;
    body?: string;
    bodyHtml?: string;
    html?: Uint8Array;
    recipients?: Array<{
      name?: string;
      email?: string;
      recipType?: "to" | "cc" | "bcc";
    }>;
    attachments?: Array<{
      fileName?: string;
      fileNameShort?: string;
      name?: string;
      extension?: string;
      dataId?: number;
      contentLength?: number;
      innerMsgContent?: true;
    }>;
  };
  getAttachment: (attach: number | object) => {
    fileName: string;
    content: Uint8Array;
  };
};

const MsgReader = (
  typeof MsgReaderImport === "function"
    ? MsgReaderImport
    : (MsgReaderImport as unknown as { default: MsgReaderCtor }).default
) as MsgReaderCtor;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function formatAddress(name?: string, email?: string): string {
  const trimmedEmail = email?.trim() ?? "";
  const trimmedName = name?.trim() ?? "";
  if (trimmedName && trimmedEmail) {
    if (trimmedName.toLowerCase() === trimmedEmail.toLowerCase()) {
      return trimmedEmail;
    }
    return `${trimmedName} <${trimmedEmail}>`;
  }
  return trimmedEmail || trimmedName;
}

function mimeFromFileName(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return null;
}

function htmlFromMsg(data: {
  bodyHtml?: string;
  html?: Uint8Array;
}): string {
  if (data.bodyHtml?.trim()) return data.bodyHtml.trim();
  if (data.html && data.html.length > 0) {
    return Buffer.from(data.html).toString("utf-8").trim();
  }
  return "";
}

/**
 * Parse an Outlook .msg buffer into the same shape used by the .eml pipeline.
 */
export function parseMsg(buffer: Buffer): ParsedEml {
  if (!buffer.length) {
    throw new Error("Could not parse .msg: empty file");
  }

  const reader = new MsgReader(toArrayBuffer(buffer));
  const data = reader.getFileData();

  if (data.error) {
    throw new Error(`Could not parse .msg: ${data.error}`);
  }

  const toRecipients = (data.recipients ?? [])
    .filter((r) => !r.recipType || r.recipType === "to")
    .map((r) => formatAddress(r.name, r.email))
    .filter(Boolean);

  const images: ParsedEml["images"] = [];
  for (const attachment of data.attachments ?? []) {
    if (attachment.innerMsgContent) continue;

    const fileName =
      attachment.fileName ||
      attachment.fileNameShort ||
      attachment.name ||
      "";
    const mimeType = mimeFromFileName(fileName);
    if (!mimeType) continue;

    try {
      const file = reader.getAttachment(attachment);
      if (!file.content?.length) continue;
      images.push({
        mimeType,
        base64: Buffer.from(file.content).toString("base64"),
      });
    } catch {
      // Skip unreadable attachments; text body may still be enough.
    }
  }

  return {
    subject: data.subject?.trim() ?? "",
    from: formatAddress(data.senderName, data.senderEmail),
    to: toRecipients.join(", "),
    plainText: data.body?.trim() ?? "",
    htmlText: htmlFromMsg(data),
    images,
  };
}
