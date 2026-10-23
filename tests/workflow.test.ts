import { describe, expect, it } from "vitest";
import { canEditConversation, canSetStatus, isOverdue, startsWork, statusOnAssign, statusOnInbound, statusOnOpen, statusOnReply, STATUSES } from "@/lib/workflow";

describe("core rule: opening is not handling", () => {
  it("never changes status when a conversation is opened", () => {
    for (const s of STATUSES) expect(statusOnOpen(s)).toBe(s);
  });
});

describe("acceptance scenario", () => {
  it("walks new → assigned → in_progress → resolved → reopened as new", () => {
    let s = statusOnOpen("new");
    expect(s).toBe("new");
    s = statusOnAssign(s, "staff-a");
    expect(s).toBe("assigned");
    expect(canSetStatus({ from: s, to: "in_progress", role: "staff", hasAssignee: true }).ok).toBe(true);
    s = "in_progress";
    s = statusOnReply(s);
    expect(s).toBe("in_progress"); // replying never resolves
    expect(canSetStatus({ from: s, to: "resolved", role: "staff", hasAssignee: true }).ok).toBe(true);
    s = "resolved";
    const after = statusOnInbound(s, true);
    expect(after).toEqual({ status: "new", reopened: true });
  });
});

describe("statusOnInbound", () => {
  it("keeps active work unchanged", () => {
    expect(statusOnInbound("new", false).status).toBe("new");
    expect(statusOnInbound("assigned", true).status).toBe("assigned");
    expect(statusOnInbound("in_progress", true).status).toBe("in_progress");
  });
  it("moves waiting back to in_progress for the owner", () => {
    expect(statusOnInbound("waiting", true)).toEqual({ status: "in_progress", reopened: false });
    expect(statusOnInbound("waiting", false)).toEqual({ status: "new", reopened: false });
  });
  it("reopens archived conversations too", () => {
    expect(statusOnInbound("archived", false)).toEqual({ status: "new", reopened: true });
  });
});

describe("statusOnReply", () => {
  it("moves early states to in_progress and never resolves", () => {
    expect(statusOnReply("new")).toBe("in_progress");
    expect(statusOnReply("assigned")).toBe("in_progress");
    expect(statusOnReply("waiting")).toBe("waiting");
    for (const s of STATUSES.filter((x) => x !== "resolved")) expect(statusOnReply(s)).not.toBe("resolved");
  });
});

describe("statusOnAssign", () => {
  it("unassigning open work returns it to new", () => {
    expect(statusOnAssign("in_progress", null)).toBe("new");
    expect(statusOnAssign("waiting", null)).toBe("new");
    expect(statusOnAssign("resolved", null)).toBe("resolved");
  });
});

describe("canSetStatus", () => {
  it("only admins archive", () => {
    expect(canSetStatus({ from: "resolved", to: "archived", role: "staff", hasAssignee: true }).ok).toBe(false);
    expect(canSetStatus({ from: "resolved", to: "archived", role: "admin", hasAssignee: true }).ok).toBe(true);
  });
  it("requires an owner for in-flight statuses", () => {
    expect(canSetStatus({ from: "new", to: "in_progress", role: "admin", hasAssignee: false }).ok).toBe(false);
  });
});

describe("no action needed (newsletters / notifications)", () => {
  it("further mail on a filed thread stays filed and never reopens", () => {
    expect(statusOnInbound("no_action", false)).toEqual({ status: "no_action", reopened: false });
  });
  it("is not open work and never overdue", () => {
    expect(isOverdue({ status: "no_action", sla_due_at: new Date(Date.now() - 1e6).toISOString() })).toBe(false);
  });
  it("anyone can file it without an owner, and move it back to the inbox", () => {
    expect(canSetStatus({ from: "new", to: "no_action", role: "staff", hasAssignee: false }).ok).toBe(true);
    expect(canSetStatus({ from: "no_action", to: "new", role: "staff", hasAssignee: false }).ok).toBe(true);
    expect(canSetStatus({ from: "no_action", to: "new", role: "staff", hasAssignee: true }).ok).toBe(true);
  });
  it("assigning or replying turns it into real work and restarts the clock", () => {
    expect(statusOnAssign("no_action", "jane")).toBe("assigned");
    expect(statusOnReply("no_action")).toBe("in_progress");
    expect(startsWork("no_action", "assigned")).toBe(true);
    expect(startsWork("in_progress", "waiting")).toBe(false);
  });
});

describe("canEditConversation", () => {
  const staff = { id: "jane", role: "staff" as const };
  it("staff act on their own and unassigned conversations, not other people's", () => {
    expect(canEditConversation(staff, "jane")).toBe(true);
    expect(canEditConversation(staff, null)).toBe(true);
    expect(canEditConversation(staff, "brian")).toBe(false);
  });
  it("staff can assign unassigned or their own conversations, not take over a colleague's", () => {
    expect(canEditConversation(staff, null)).toBe(true);
    expect(canEditConversation(staff, "jane")).toBe(true);
    expect(canEditConversation(staff, "peter")).toBe(false);
  });
  it("admins can act on everything", () => {
    expect(canEditConversation({ id: "ceo", role: "admin" }, "brian")).toBe(true);
  });
});

describe("isOverdue", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  it("flags active work past its deadline", () => {
    expect(isOverdue({ status: "in_progress", sla_due_at: past })).toBe(true);
  });
  it("pauses while waiting and ignores resolved", () => {
    expect(isOverdue({ status: "waiting", sla_due_at: past })).toBe(false);
    expect(isOverdue({ status: "resolved", sla_due_at: past })).toBe(false);
  });
});
