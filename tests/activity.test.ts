import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ adminDb: () => ({}) }));

const { describeEvent } = await import("@/components/activity");
const names = new Map<string, string>();
const ev = (event_type: string, metadata: Record<string, unknown>, email_id: string | null = null) => ({
  id: 1, conversation_id: "c", email_id, user_id: null, event_type, metadata, created_at: new Date().toISOString(),
});

describe("activity: who wrote in", () => {
  it("names the person who replied, with their address", () => {
    expect(describeEvent(ev("customer_replied", { from: "mary@example.com", from_name: "Mary Wanjiku" }), names)).toBe("Mary Wanjiku (mary@example.com) replied");
  });
  it("uses the address when the email had no name", () => {
    expect(describeEvent(ev("customer_replied", { from: "accounts@acme.co.ke" }), names)).toBe("accounts@acme.co.ke replied");
  });
  it("fills in the name for older events from the stored email", () => {
    const senders = new Map([["e1", { name: "Ali Hassan", email: "ali@example.com" }]]);
    expect(describeEvent(ev("customer_replied", { from: "ali@example.com" }, "e1"), names, senders)).toBe("Ali Hassan (ali@example.com) replied");
  });
  it("says who a new email came from", () => {
    expect(describeEvent(ev("email_received", { from: "mary@example.com", from_name: "Mary Wanjiku" }), names)).toBe("Email received from Mary Wanjiku (mary@example.com)");
  });
  it("falls back to the old wording when the sender is unknown", () => {
    expect(describeEvent(ev("customer_replied", {}), names)).toBe("Customer replied");
  });
});
