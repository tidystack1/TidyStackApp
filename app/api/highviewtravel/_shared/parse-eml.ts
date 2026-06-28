export type ParsedEml = {
  subject: string;
  from: string;
  to: string;
  plainText: string;
  htmlText: string;
  images: Array<{ mimeType: string; base64: string }>;
};

type MimePart = {
  headers: Record<string, string>;
  body: string;
};

function decodeQuotedPrintable(input: string): string {
  const cleaned = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "=" && i + 2 < cleaned.length) {
      const hex = cleaned.slice(i + 1, i + 3);
      if (/^[0-9A-F]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(cleaned.charCodeAt(i));
  }

  return Buffer.from(bytes).toString("utf-8");
}

function decodeBody(body: string, encoding: string): string {
  const normalized = encoding.toLowerCase().trim();

  if (normalized === "base64") {
    return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf-8");
  }

  if (normalized === "quoted-printable") {
    return decodeQuotedPrintable(body);
  }

  return body;
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let currentKey = "";
  let currentValue = "";

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      currentValue += ` ${line.trim()}`;
      continue;
    }

    if (currentKey) {
      headers[currentKey.toLowerCase()] = currentValue.trim();
    }

    const colon = line.indexOf(":");
    if (colon === -1) {
      currentKey = "";
      currentValue = "";
      continue;
    }

    currentKey = line.slice(0, colon).trim();
    currentValue = line.slice(colon + 1).trim();
  }

  if (currentKey) {
    headers[currentKey.toLowerCase()] = currentValue.trim();
  }

  return headers;
}

function splitMime(raw: string): { headers: Record<string, string>; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const splitAt = normalized.indexOf("\n\n");

  if (splitAt === -1) {
    return { headers: parseHeaders(normalized), body: "" };
  }

  return {
    headers: parseHeaders(normalized.slice(0, splitAt)),
    body: normalized.slice(splitAt + 2),
  };
}

function getBoundary(contentType: string): string | null {
  const match = /boundary="?([^";\s]+)"?/i.exec(contentType);
  return match?.[1] ?? null;
}

function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`;
  return body
    .split(marker)
    .map((part) => part.trim())
    .filter((part) => part && part !== "--");
}

function parseMimePart(raw: string): MimePart {
  const { headers, body } = splitMime(raw);
  return { headers, body };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function collectFromPart(
  part: MimePart,
  acc: { plainText: string[]; htmlText: string[]; images: ParsedEml["images"] },
): void {
  const contentType = part.headers["content-type"] ?? "text/plain";
  const encoding = part.headers["content-transfer-encoding"] ?? "8bit";
  const mainType = contentType.split(";")[0]!.trim().toLowerCase();
  const decodedBody = decodeBody(part.body, encoding);

  if (mainType.startsWith("multipart/")) {
    const boundary = getBoundary(contentType);
    if (!boundary) return;

    for (const childRaw of splitMultipart(part.body, boundary)) {
      collectFromPart(parseMimePart(childRaw), acc);
    }
    return;
  }

  if (mainType === "text/plain") {
    acc.plainText.push(decodedBody.trim());
    return;
  }

  if (mainType === "text/html") {
    acc.htmlText.push(decodedBody.trim());
    return;
  }

  if (mainType.startsWith("image/")) {
    const imageBody =
      encoding.toLowerCase() === "base64"
        ? part.body.replace(/\s/g, "")
        : Buffer.from(decodedBody, "binary").toString("base64");

    acc.images.push({ mimeType: mainType, base64: imageBody });
  }
}

export function parseEml(rawEml: string): ParsedEml {
  const { headers, body } = splitMime(rawEml);
  const acc = {
    plainText: [] as string[],
    htmlText: [] as string[],
    images: [] as ParsedEml["images"],
  };

  const contentType = headers["content-type"] ?? "text/plain";

  if (contentType.toLowerCase().startsWith("multipart/")) {
    const boundary = getBoundary(contentType);
    if (boundary) {
      for (const partRaw of splitMultipart(body, boundary)) {
        collectFromPart(parseMimePart(partRaw), acc);
      }
    }
  } else {
    collectFromPart(
      {
        headers,
        body,
      },
      acc,
    );
  }

  return {
    subject: headers.subject ?? "",
    from: headers.from ?? "",
    to: headers.to ?? "",
    plainText: acc.plainText.join("\n\n").trim(),
    htmlText: acc.htmlText.join("\n\n").trim(),
    images: acc.images,
  };
}

export function emlToPromptText(parsed: ParsedEml): string {
  const sections: string[] = [];

  if (parsed.subject) sections.push(`Subject: ${parsed.subject}`);
  if (parsed.from) sections.push(`From: ${parsed.from}`);
  if (parsed.to) sections.push(`To: ${parsed.to}`);

  const body =
    parsed.plainText ||
    (parsed.htmlText ? stripHtml(parsed.htmlText) : "");

  if (body) {
    sections.push("", "Email body:", body);
  } else if (parsed.htmlText) {
    sections.push("", "Email body (HTML):", parsed.htmlText);
  }

  if (parsed.images.length > 0) {
    sections.push(
      "",
      `Note: ${parsed.images.length} image attachment(s) are included separately for visual analysis.`,
    );
  }

  return sections.join("\n").trim();
}
