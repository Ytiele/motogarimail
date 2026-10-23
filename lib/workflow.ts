export const STATUSES = ["new", "assigned", "in_progress", "waiting", "resolved", "no_action", "junk", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** "chat" accounts only use team chat and can never reach email. */
export type Role = "admin" | "staff" | "chat";

export const OPEN_STATUSES: readonly Status[] = ["new", "assigned", "in_progress", "waiting"];
export const SLA_ACTIVE_STATUSES: readonly Status[] = ["new", "assigned", "in_progress"];

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  waiting: "Waiting on customer",
  resolved: "Resolved",
  no_action: "No action needed",
  junk: "Junk",
  archived: "Archived",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function isOpen(status: Status) {
  return OPEN_STATUSES.includes(status);
}

// Opening/viewing a conversation never changes its workflow state. This is the core product rule.
export function statusOnOpen(current: Status): Status {
  return current;
}

export function statusOnInbound(current: Status, hasAssignee: boolean): { status: Status; reopened: boolean } {
  // Another newsletter, notification or junk message on the same thread stays filed away.
  if (current === "no_action" || current === "junk") return { status: current, reopened: false };
  if (current === "resolved" || current === "archived") return { status: "new", reopened: true };
  if (current === "waiting") return { status: hasAssignee ? "in_progress" : "new", reopened: false };
  return { status: current, reopened: false };
}

export function statusOnAssign(current: Status, assignee: string | null): Status {
  // Assigning a filed email means someone decided it does need handling.
  if (assignee && (current === "new" || current === "no_action" || current === "junk")) return "assigned";
  if (!assignee && (current === "assigned" || current === "in_progress" || current === "waiting")) return "new";
  return current;
}

// Sending a reply moves early-stage work to in-progress but never resolves it.
export function statusOnReply(current: Status): Status {
  return current === "new" || current === "assigned" || current === "no_action" || current === "junk" ? "in_progress" : current;
}

/** Statuses that are filed away: no owner needed, not counted as work, never overdue. */
export const FILED_STATUSES: readonly Status[] = ["no_action", "junk"];

/** Leaving a filed or closed state for active work restarts the SLA clock. */
export function startsWork(from: Status, to: Status) {
  return (FILED_STATUSES.includes(from) || from === "resolved" || from === "archived") && OPEN_STATUSES.includes(to);
}

export type ManualStatusCheck = { ok: true } | { ok: false; reason: string };

export function canSetStatus(opts: {
  from: Status;
  to: Status;
  role: Role;
  hasAssignee: boolean;
}): ManualStatusCheck {
  const { from, to, role, hasAssignee } = opts;
  if (from === to) return { ok: false, reason: "Status is unchanged." };
  if (to === "archived" && role !== "admin") return { ok: false, reason: "Only admins can archive conversations." };
  if ((to === "assigned" || to === "in_progress" || to === "waiting") && !hasAssignee) {
    return { ok: false, reason: "Assign the conversation to someone before changing it to this status." };
  }
  if (to === "new" && hasAssignee && !["resolved", "archived", "no_action", "junk"].includes(from)) {
    return { ok: false, reason: "Unassign the conversation to move it back to New." };
  }
  return { ok: true };
}

// Every active staff member can SEE every conversation (mirrors the RLS policy). Acting on one is
// narrower: the owner, an admin, or anyone while it is still unassigned.
export function canEditConversation(viewer: { id: string; role: Role }, assignedTo: string | null) {
  return viewer.role === "admin" || assignedTo === null || assignedTo === viewer.id;
}

export function isOverdue(c: { status: Status; sla_due_at: string | null }, now = Date.now()) {
  return !!c.sla_due_at && SLA_ACTIVE_STATUSES.includes(c.status) && new Date(c.sla_due_at).getTime() < now;
}
