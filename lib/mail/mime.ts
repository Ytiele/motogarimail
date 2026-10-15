import { randomBytes } from "node:crypto";
import type { Address, OutgoingMessage } from "./types";

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

export function buildMime(msg: OutgoingMessage): string {
  const boundary = `mg_${randomBytes(12).toString("hex")}`;
  const lines = [
    `From: ${encodeAddress(msg.from)}`,
    `To: ${msg.to.map(encodeAddress).join(", ")}`,
    ...(msg.cc.length ? [`Cc: ${msg.cc.map(encodeAddress).join(", ")}`] : []),
    `Subject: ${encodeHeaderWord(msg.subject)}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${headerSafe(msg.inReplyTo)}`] : []),
    ...(msg.references ? [`References: ${headerSafe(msg.references)}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(msg.text, "utf8").toString("base64")),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(msg.html, "utf8").toString("base64")),
    `--${boundary}--`,
    "",
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
