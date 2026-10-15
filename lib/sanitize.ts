import "server-only";
import sanitizeHtml from "sanitize-html";

/**
 * Incoming email HTML is untrusted. It is sanitized here (no scripts, handlers, forms, iframes,
 * or javascript: URLs) and then additionally rendered inside a sandboxed iframe with scripts disabled.
 */
export function sanitizeEmailHtml(html: string, cidMap: Record<string, string> = {}): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img", "font", "center", "span", "div", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "u", "s", "sup", "sub", "hr",
    ],
    disallowedTagsMode: "discard",
    allowedAttributes: {
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "color", "dir", "class", "title"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "style"],
      font: ["face", "size", "color"],
      td: ["colspan", "rowspan", "style", "align", "valign", "width", "bgcolor"],
      th: ["colspan", "rowspan", "style", "align", "valign", "width", "bgcolor"],
      table: ["border", "cellpadding", "cellspacing", "width", "style", "bgcolor", "align"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" } }),
      img: (tagName, attribs) => {
        const src = attribs.src ?? "";
        if (src.toLowerCase().startsWith("cid:")) {
          const mapped = cidMap[src.slice(4).replace(/^<|>$/g, "")];
          return { tagName, attribs: { ...attribs, src: mapped ?? "" } };
        }
        return { tagName, attribs };
      },
    },
  });
}
