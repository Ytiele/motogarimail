import { parseAddress } from "./address";
import type { ParsedAttachment, ParsedMessage } from "./types";

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export function base64UrlToBuffer(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function charsetOf(part: GmailPart): string {
  const ct = header(part.headers, "Content-Type") ?? "";
  const m = ct.match(/charset="?([^";\s]+)"?/i);
  return m ? m[1].toLowerCase() : "utf-8";
}

function decodeText(part: GmailPart): string {
  const buf = base64UrlToBuffer(part.body?.data ?? "");
  try {
    return new TextDecoder(charsetOf(part)).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseGmailMessage(msg: GmailMessage): ParsedMessage {
  const root = msg.payload ?? {};
  let text: string | null = null;
  let html: string | null = null;
  const attachments: ParsedAttachment[] = [];

  const walk = (part: GmailPart) => {
    const mime = (part.mimeType ?? "").toLowerCase();
    const disposition = (header(part.headers, "Content-Disposition") ?? "").toLowerCase();
    const contentId = header(part.headers, "Content-ID")?.replace(/^<|>$/g, "") ?? null;
    const isFile =
      !!part.filename || disposition.startsWith("attachment") || (!!contentId && !mime.startsWith("text/") && !mime.startsWith("multipart/"));

    if (part.parts?.length) {
      part.parts.forEach(walk);
      return;
    }
    if (isFile && (part.body?.attachmentId || part.body?.data)) {
      attachments.push({
        partId: part.partId ?? String(attachments.length),
        attachmentId: part.body?.attachmentId ?? null,
        filename: part.filename || (contentId ? `inline-${contentId}` : "attachment"),
        mimeType: mime || "application/octet-stream",
        size: part.body?.size ?? 0,
        contentId,
        inlineData: part.body?.data ? base64UrlToBuffer(part.body.data).toString("base64") : null,
      });
      return;
    }
    if (mime === "text/plain" && text === null && part.body?.data) text = decodeText(part);
    else if (mime === "text/html" && html === null && part.body?.data) html = decodeText(part);
  };
  walk(root);

  const headers = root.headers;
  const fromRaw = header(headers, "From");
  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds ?? [],
    internalDate: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
    messageIdHeader: header(headers, "Message-ID") ?? header(headers, "Message-Id"),
    inReplyTo: header(headers, "In-Reply-To"),
    references: header(headers, "References"),
    from: fromRaw ? parseAddress(fromRaw) : null,
    replyTo: header(headers, "Reply-To"),
    to: header(headers, "To"),
    cc: header(headers, "Cc"),
    bcc: header(headers, "Bcc"),
    subject: header(headers, "Subject"),
    text: text ?? (html ? htmlToText(html) : null),
    html,
    snippet: msg.snippet ? decodeEntities(msg.snippet) : null,
    attachments,
    bulk: {
      listId: header(headers, "List-Id"),
      listUnsubscribe: header(headers, "List-Unsubscribe"),
      precedence: header(headers, "Precedence"),
      autoSubmitted: header(headers, "Auto-Submitted"),
    },
  };
}
