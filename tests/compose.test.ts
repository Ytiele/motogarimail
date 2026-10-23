import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ adminDb: () => ({}) }));

const { htmlToText, sanitizeOutgoingHtml } = await import("@/lib/mail/compose");
const { buildMime, forwardSubject } = await import("@/lib/mail/mime");
const { ownsStagingPath, stagingPath } = await import("@/lib/outgoing");

const base = {
  from: { name: "Motogari", email: "info@motogari.com" },
  to: [{ name: null, email: "john@example.com" }],
  cc: [],
  subject: "Re: Booking",
  text: "Hello",
  html: "<p>Hello</p>",
  inReplyTo: null,
  references: null,
};

describe("buildMime with attachments", () => {
  it("keeps the simple alternative structure when there are no files", () => {
    const mime = buildMime(base);
    expect(mime).toMatch(/^Content-Type: multipart\/alternative/m);
    expect(mime).not.toContain("multipart/mixed");
  });
  it("nests text, html + inline photos and files the way Gmail does", () => {
    const mime = buildMime({
      ...base,
      html: '<p>See <img src="cid:img1@motogari"></p>',
      attachments: [
        { filename: "photo.jpg", mimeType: "image/jpeg", data: Buffer.from("jpg"), contentId: "img1@motogari" },
        { filename: "Invoice Ö.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF") },
      ],
    });
    const mixed = mime.indexOf("multipart/mixed");
    const alt = mime.indexOf("multipart/alternative");
    const related = mime.indexOf("multipart/related");
    expect(mixed).toBeGreaterThan(-1);
    expect(alt).toBeGreaterThan(mixed);
    expect(related).toBeGreaterThan(alt);
    expect(mime).toContain("Content-ID: <img1@motogari>");
    expect(mime).toContain('Content-Disposition: inline; filename="photo.jpg"');
    expect(mime).toContain("filename*=UTF-8''Invoice%20%C3%96.pdf");
    expect(mime).toContain(Buffer.from("%PDF").toString("base64"));
  });
  it("cannot be tricked into extra headers through a filename", () => {
    const mime = buildMime({ ...base, attachments: [{ filename: 'a.txt"\r\nBcc: evil@x.com', mimeType: "text/plain", data: Buffer.from("x") }] });
    expect(mime).not.toMatch(/^Bcc:/m);
  });
});

describe("forwardSubject", () => {
  it("prefixes Fwd: once, replacing Re:/Fwd:", () => {
    expect(forwardSubject("Booking")).toBe("Fwd: Booking");
    expect(forwardSubject("Re: Booking")).toBe("Fwd: Booking");
    expect(forwardSubject("Fwd: Booking")).toBe("Fwd: Booking");
    expect(forwardSubject("")).toBe("Fwd: (no subject)");
  });
});

describe("Bcc", () => {
  it("adds a Bcc header for Gmail to deliver (Gmail strips it before anyone receives the mail)", () => {
    const mime = buildMime({ ...base, bcc: [{ name: "Boss", email: "ceo@motogari.co.ke" }] });
    expect(mime).toMatch(/^Bcc: "Boss" <ceo@motogari.co.ke>$/m);
  });
  it("omits the header when there is no Bcc", () => {
    expect(buildMime(base)).not.toMatch(/^Bcc:/m);
  });
  it("cannot be used to inject headers", () => {
    const mime = buildMime({ ...base, bcc: [{ name: "x\r\nX-Evil: 1", email: "a@b.com\r\nX-Evil: 2" }] });
    expect(mime).not.toMatch(/^X-Evil:/m);
  });
});

describe("sanitizeOutgoingHtml", () => {
  it("keeps formatting, lists and safe links", () => {
    const out = sanitizeOutgoingHtml('<p><b>Hi</b> <i>there</i> <u>u</u></p><ul><li>one</li></ul><a href="https://motogari.co.ke">site</a>', {});
    expect(out).toContain("<b>Hi</b>");
    expect(out).toContain("<ul><li>one</li></ul>");
    expect(out).toContain('href="https://motogari.co.ke"');
  });
  it("removes scripts, handlers, javascript: links and remote or pasted images", () => {
    const out = sanitizeOutgoingHtml(
      '<p onclick="x()">a<script>alert(1)</script></p><a href="javascript:alert(1)">bad</a><img src="https://tracker.example/p.gif"><img src="data:image/png;base64,AAA">',
      {},
    );
    expect(out).not.toMatch(/script|onclick|javascript:|tracker|data:image/);
  });
  it("turns our uploaded photos into cid: references", () => {
    const out = sanitizeOutgoingHtml('<img src="blob:https://x/abc" data-upload="20261023/u.p.jpg" alt="car">', { "20261023/u.p.jpg": "img1@motogari" });
    expect(out).toContain('src="cid:img1@motogari"');
    expect(out).not.toContain("blob:");
  });
});

describe("htmlToText", () => {
  it("produces a readable plain-text version", () => {
    const text = htmlToText('<p>Dear John,</p><p>Your car is <b>ready</b> &amp; waiting.</p><ul><li>Prado</li><li>Fuel full</li></ul><p>See <a href="https://motogari.co.ke">our site</a></p>');
    expect(text).toBe("Dear John,\nYour car is ready & waiting.\n\n• Prado\n• Fuel full\n\nSee our site (https://motogari.co.ke)");
  });
});

describe("staged attachment paths", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  it("only the uploader can send a staged file", () => {
    const path = stagingPath(me, "../../etc/passwd");
    expect(ownsStagingPath(me, path)).toBe(true);
    expect(ownsStagingPath("22222222-2222-2222-2222-222222222222", path)).toBe(false);
    expect(path).not.toContain("..");
    expect(ownsStagingPath(me, `20261023/${me}.x/../other`)).toBe(false);
  });
});
