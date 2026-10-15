import { describe, expect, it } from "vitest";
import { canBlockDomain, parseJunkPattern, ruleMatches, senderDomain } from "@/lib/mail/junk-rules";
import { canSetStatus, isOverdue, startsWork, statusOnAssign, statusOnInbound, statusOnReply } from "@/lib/workflow";

describe("junk sender rules", () => {
  it("parses addresses and domains", () => {
    expect(parseJunkPattern(" Offers@Spammy.com ")).toEqual({ kind: "address", value: "offers@spammy.com" });
    expect(parseJunkPattern("@spammy.com")).toEqual({ kind: "domain", value: "spammy.com" });
    expect(parseJunkPattern("spammy.co.ke")).toEqual({ kind: "domain", value: "spammy.co.ke" });
    expect(parseJunkPattern("not an email")).toBeNull();
    expect(parseJunkPattern("")).toBeNull();
  });
  it("matches the exact address only", () => {
    const rule = { kind: "address" as const, value: "offers@spammy.com" };
    expect(ruleMatches(rule, "OFFERS@spammy.com")).toBe(true);
    expect(ruleMatches(rule, "sales@spammy.com")).toBe(false);
  });
  it("matches a domain and its subdomains, not look-alikes", () => {
    const rule = { kind: "domain" as const, value: "spammy.com" };
    expect(ruleMatches(rule, "a@spammy.com")).toBe(true);
    expect(ruleMatches(rule, "a@mail.spammy.com")).toBe(true);
    expect(ruleMatches(rule, "a@notspammy.com")).toBe(false);
    expect(ruleMatches(rule, null)).toBe(false);
  });
  it("never offers to block shared providers or our own domain", () => {
    expect(canBlockDomain("gmail.com")).toBe(false);
    expect(canBlockDomain("yahoo.com")).toBe(false);
    expect(canBlockDomain("motogari.co.ke", "motogari.co.ke")).toBe(false);
    expect(canBlockDomain("spammy.com", "motogari.co.ke")).toBe(true);
    expect(senderDomain("John@Example.CO.KE")).toBe("example.co.ke");
    expect(senderDomain("broken")).toBeNull();
  });
});

describe("junk workflow", () => {
  it("keeps further junk on the same thread in Junk", () => {
    expect(statusOnInbound("junk", false)).toEqual({ status: "junk", reopened: false });
  });
  it("never goes overdue", () => {
    expect(isOverdue({ status: "junk", sla_due_at: new Date(Date.now() - 1e6).toISOString() })).toBe(false);
  });
  it("can be rescued back to the inbox, restarting the SLA clock", () => {
    expect(canSetStatus({ from: "junk", to: "new", role: "staff", hasAssignee: false }).ok).toBe(true);
    expect(startsWork("junk", "new")).toBe(true);
    expect(statusOnAssign("junk", "jane")).toBe("assigned");
    expect(statusOnReply("junk")).toBe("in_progress");
  });
});
