import { randomBytes } from "node:crypto";
import type { Address, OutgoingAttachment, OutgoingMessage } from "./types";

// Strip CR/LF so user-controlled values can never inject extra headers.
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function encodeHeaderWord(value: string): string {
  const clean = headerSafe(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function encodeAddress(a: Address): string {
  const email = headerSafe(a.email);
  if (!a.name) return email;
  const name = headerSafe(a.name);
  // eslint-disable-next-line no-control-regex
  const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}"` : encodeHeaderWord(name);
  return `${display} <${email}>`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: (no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function buildReferences(references: string | null, inReplyTo: string | null): string | null {
  const ids = (references ?? "").split(/\s+/).filter(Boolean);
  if (inReplyTo && !ids.includes(inReplyTo)) ids.push(inReplyTo);
  return ids.length ? ids.join(" ") : null;
}

type Part = { headers: string[]; body: string };

const newBoundary = () => `mg_${randomBytes(12).toString("hex")}`;

function multipart(subtype: "alternative" | "related" | "mixed", parts: Part[]): Part {
  const b = newBoundary();
  const body = [...parts.flatMap((p) => [`--${b}`, ...p.headers, "", p.body]), `--${b}--`, ""].join("\r\n");
  return { headers: [`Content-Type: multipart/${subtype}; boundary="${b}"`], body };
}

const textPart = (type: "plain" | "html", content: string): Part => ({
  headers: [`Content-Type: text/${type}; charset="UTF-8"`, "Content-Transfer-Encoding: base64"],
  body: wrap76(Buffer.from(content, "utf8").toString("base64")),
});

/** Quoted filename plus the RFC 2231 form so non-ASCII names survive every mail client. */
function fileParams(name: string) {
  const clean = headerSafe(name).replace(/["\\]/g, "_") || "attachment";
  // eslint-disable-next-line no-control-regex
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return { ascii, star: `UTF-8''${encodeURIComponent(clean)}` };
}

function filePart(a: OutgoingAttachment): Part {
  const { ascii, star } = fileParams(a.filename);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType) ? a.mimeType : "application/octet-stream";
  return {
    headers: [
      `Content-Type: ${type}; name="${ascii}"`,
      `Content-Disposition: ${a.contentId ? "inline" : "attachment"}; filename="${ascii}"; filename*=${star}`,
      "Content-Transfer-Encoding: base64",
      ...(a.contentId ? [`Content-ID: <${headerSafe(a.contentId).replace(/[<>]/g, "")}>`, `X-Attachment-Id: ${headerSafe(a.contentId).replace(/[<>]/g, "")}`] : []),
    ],
    body: wrap76(a.data.toString("base64")),
  };
}

/**
 * Builds the RFC 5322 message, structured the way Gmail does it:
 * mixed( alternative( text, related( html, inline photos ) ), attachments ).
 */
export function buildMime(msg: OutgoingMessage): string {
  const inline = (msg.attachments ?? []).filter((a) => a.contentId);
  const files = (msg.attachments ?? []).filter((a) => !a.contentId);
  const html = textPart("html", msg.html);
  const alternative = multipart("alternative", [textPart("plain", msg.text), inline.length ? multipart("related", [html, ...inline.map(filePart)]) : html]);
  const root = files.length ? multipart("mixed", [alternative, ...files.map(filePart)]) : alternative;
  const lines = [
    `From: ${encodeAddress(msg.from)}`,
    `To: ${msg.to.map(encodeAddress).join(", ")}`,
    ...(msg.cc.length ? [`Cc: ${msg.cc.map(encodeAddress).join(", ")}`] : []),
    ...(msg.bcc?.length ? [`Bcc: ${msg.bcc.map(encodeAddress).join(", ")}`] : []),
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${headerSafe(msg.inReplyTo)}`] : []),
    ...(msg.references ? [`References: ${headerSafe(msg.references)}`] : []),
    "MIME-Version: 1.0",
    ...root.headers,
    "",
    root.body,
  ];
  return lines.join("\r\n");
}

export function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function textToHtml(text: string): string {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${paragraphs}</div>`;
}
