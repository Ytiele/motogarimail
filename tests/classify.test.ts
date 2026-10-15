import { describe, expect, it } from "vitest";
import { automatedReason } from "@/lib/mail/classify";
import { parseGmailMessage } from "@/lib/mail/parse";

const person = { name: "John Kamau", email: "john.kamau@example.com" };
const noBulk = { listId: null, listUnsubscribe: null, precedence: null, autoSubmitted: null };

describe("automatedReason", () => {
  it("leaves a real customer email in the inbox", () => {
    expect(automatedReason({ labelIds: ["INBOX", "CATEGORY_PERSONAL"], from: person, bulk: noBulk })).toBeNull();
  });
  it("files newsletters with an unsubscribe header", () => {
    expect(automatedReason({ labelIds: ["INBOX"], from: person, bulk: { ...noBulk, listUnsubscribe: "<mailto:u@x.com>" } })).toBe("Newsletter or mailing list");
  });
  it("files automatic notifications and bulk mail", () => {
    expect(automatedReason({ labelIds: [], from: person, bulk: { ...noBulk, autoSubmitted: "auto-generated" } })).toBe("Automatic notification");
    expect(automatedReason({ labelIds: [], from: person, bulk: { ...noBulk, autoSubmitted: "no" } })).toBeNull();
    expect(automatedReason({ labelIds: [], from: person, bulk: { ...noBulk, precedence: "bulk" } })).toBe("Bulk email");
  });
  it("files no-reply senders", () => {
    for (const email of ["no-reply@bank.co.ke", "noreply@safaricom.co.ke", "notifications@github.com", "do-not-reply@kra.go.ke"]) {
      expect(automatedReason({ labelIds: [], from: { name: null, email }, bulk: noBulk })).toBe("Sent from a no-reply address");
    }
  });
  it("respects Gmail's Promotions / Updates / Social categories", () => {
    expect(automatedReason({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"], from: person, bulk: noBulk })).toBe("Gmail filed it under Promotions");
  });
  it("reads the headers from a real Gmail payload", () => {
    const msg = parseGmailMessage({
      id: "m",
      threadId: "t",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "Auto Weekly <hello@autoweekly.example.com>" },
          { name: "List-Unsubscribe", value: "<https://autoweekly.example.com/u>" },
        ],
        body: { data: Buffer.from("This week in cars").toString("base64url") },
      },
    });
    expect(automatedReason(msg)).toBe("Newsletter or mailing list");
  });
});
