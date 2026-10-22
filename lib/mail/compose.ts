import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Staff write replies in a rich-text editor. Before sending, the HTML is reduced to a small allowlist
 * (formatting, lists, links, quotes and our own inline photos), whatever the browser or a paste produced.
 * `inline` maps an uploaded photo's storage path to the Content-ID it is sent with.
 */
export function sanitizeOutgoingHtml(html: string, inline: Record<string, string>): string {
  const clean = sanitizeHtml(html, {
    allowedTags: ["p", "div", "br", "b", "strong", "i", "em", "u", "s", "strike", "ul", "ol", "li", "a", "blockquote", "img", "span"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "style"], p: ["style"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["cid"] },
    allowProtocolRelative: false,
    transformTags: {
      // No paragraph margins, so the email looks exactly like the editor (as in Gmail); pasted styles are dropped.
      p: () => ({ tagName: "p", attribs: { style: "margin:0" } }),
      a: (tagName, attribs) => ({ tagName, attribs: { href: attribs.href ?? "", target: "_blank", rel: "noopener noreferrer" } }),
      // Photos inserted in the editor carry data-upload="<path>"; anything else (pasted or remote images) is dropped.
      img: (tagName, attribs) => {
        const cid = inline[attribs["data-upload"] ?? ""];
        const kept: Record<string, string> = cid ? { src: `cid:${cid}`, alt: attribs.alt ?? "", style: "max-width:100%;height:auto" } : {};
        return { tagName, attribs: kept };
      },
    },
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
  });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${clean}</div>`;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Plain-text alternative of the editor HTML, for mail clients that do not show HTML. */
export function htmlToText(html: string): string {
  const marked = html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => (text.trim() && text.trim() !== href ? `${text} (${href})` : href))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<\/(p|div|li|blockquote|ul|ol)>/gi, "\n");
  const text = sanitizeHtml(marked, { allowedTags: [], allowedAttributes: {} }).replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
