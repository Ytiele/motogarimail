import { describe, expect, it } from "vitest";
import { parseAddress, parseAddressList } from "@/lib/mail/address";
import { buildMime, buildReferences, encodeHeaderWord, headerSafe, replySubject, textToHtml } from "@/lib/mail/mime";
import { parseGmailMessage } from "@/lib/mail/parse";

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("addresses", () => {
  it("parses names, quotes and commas", () => {
    expect(parseAddress('"Kamau, John" <John@Example.com>')).toEqual({ name: "Kamau, John", email: "john@example.com" });
    expect(parseAddressList('a@x.com, "B, C" <b@y.com>, D <d@z.com>').map((a) => a.email)).toEqual(["a@x.com", "b@y.com", "d@z.com"]);
  });
});

describe("parseGmailMessage", () => {
  it("extracts headers, bodies and attachments from a multipart message", () => {
    const parsed = parseGmailMessage({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "UNREAD"],
      snippet: "I&#39;d like to book",
      internalDate: "1791460920000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "John Kamau <john@example.com>" },
          { name: "To", value: "info@motogari.com" },
          { name: "Subject", value: "Booking enquiry" },
          { name: "Message-ID", value: "<abc@example.com>" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { partId: "0.0", mimeType: "text/plain", headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }], body: { data: b64url("Hello Motogari") } },
              { partId: "0.1", mimeType: "text/html", body: { data: b64url("<p>Hello <b>Motogari</b></p>") } },
            ],
          },
          { partId: "1", mimeType: "application/pdf", filename: "Invoice.pdf", body: { attachmentId: "att-1", size: 2048 } },
        ],
      },
    });
    expect(parsed.from).toEqual({ name: "John Kamau", email: "john@example.com" });
    expect(parsed.subject).toBe("Booking enquiry");
    expect(parsed.text).toBe("Hello Motogari");
    expect(parsed.html).toContain("<b>Motogari</b>");
    expect(parsed.snippet).toBe("I'd like to book");
    expect(parsed.messageIdHeader).toBe("<abc@example.com>");
    expect(parsed.attachments).toEqual([
      expect.objectContaining({ partId: "1", attachmentId: "att-1", filename: "Invoice.pdf", mimeType: "application/pdf", size: 2048 }),
    ]);
    expect(parsed.labelIds).toContain("UNREAD"); // stored, but never used for workflow
  });

  it("falls back to text derived from HTML", () => {
    const parsed = parseGmailMessage({ id: "m", threadId: "t", payload: { mimeType: "text/html", body: { data: b64url("<p>Hi</p><p>there &amp; you</p>") } } });
    expect(parsed.text).toBe("Hi\nthere & you");
  });
});

describe("MIME reply", () => {
  it("prevents header injection", () => {
    expect(headerSafe("Hi\r\nBcc: evil@x.com")).toBe("Hi Bcc: evil@x.com");
    const mime = buildMime({
      from: { name: "Motogari", email: "info@motogari.com" },
      to: [{ name: "John", email: "john@example.com" }],
      cc: [],
      subject: "Re: Booking\r\nBcc: evil@x.com",
      text: "Hello",
      html: "<p>Hello</p>",
      inReplyTo: "<abc@example.com>",
      references: "<abc@example.com>",
    });
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toContain("In-Reply-To: <abc@example.com>");
    expect(mime).toContain('From: "Motogari" <info@motogari.com>');
  });

  it("encodes non-ASCII subjects", () => {
    expect(encodeHeaderWord("Habari — ndiyo")).toMatch(/^=\?UTF-8\?B\?/);
  });

  it("threads correctly", () => {
    expect(replySubject("Booking")).toBe("Re: Booking");
    expect(replySubject("RE: Booking")).toBe("RE: Booking");
    expect(buildReferences("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
    expect(buildReferences(null, null)).toBeNull();
  });

  it("escapes HTML in the composed body", () => {
    expect(textToHtml("<script>alert(1)</script>")).not.toContain("<script>");
  });
});
