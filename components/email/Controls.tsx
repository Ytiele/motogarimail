"use client";

import { useEffect, useState, useTransition } from "react";
import { assign, claim, markJunk, markOpened, notJunk, setCategory, setPriority, setStatus } from "@/app/(app)/inbox/[id]/actions";
import { cx } from "@/components/ui";
import { canBlockDomain, senderDomain } from "@/lib/mail/junk-rules";
import type { ActionResult } from "@/lib/types";
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, STATUSES, type Priority, type Status } from "@/lib/workflow";

function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      try {
        setResult(await fn());
      } catch {
        setResult({ ok: false, error: "Something went wrong. Please try again." });
      }
    });
  return { pending, result, run };
}

function Feedback({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  if (!result.ok) return <p role="alert" className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800">{result.error}</p>;
  if (result.message) return <p role="status" className="mt-2 text-xs text-emerald-700">{result.message}</p>;
  return null;
}

export function MarkOpened({ id }: { id: string }) {
  useEffect(() => {
    markOpened(id).catch(() => {});
  }, [id]);
  return null;
}

export function OwnershipControl({
  id,
  assignedTo,
  meId,
  isAdmin,
  closed,
  staff,
}: {
  id: string;
  assignedTo: string | null;
  meId: string;
  isAdmin: boolean;
  closed: boolean;
  staff: { id: string; name: string }[];
}) {
  const { pending, result, run } = useAction();
  return (
    <div>
      {!assignedTo && !closed && (
        <button className="btn-brand w-full" disabled={pending} onClick={() => run(() => claim(id))}>
          {pending ? "Assigning…" : "Assign to me"}
        </button>
      )}
      {isAdmin && (
        <div className={cx(!assignedTo && !closed && "mt-2")}>
          <label className="label" htmlFor="assignee">{assignedTo ? "Reassign" : "Assign to staff"}</label>
          <select
            id="assignee"
            className="input"
            disabled={pending}
            value={assignedTo ?? ""}
            onChange={(e) => run(() => assign(id, e.target.value || null))}
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.id === meId ? " (me)" : ""}</option>
            ))}
          </select>
        </div>
      )}
      {!isAdmin && assignedTo === meId && (
        <button className="btn-ghost mt-1 w-full text-xs" disabled={pending} onClick={() => run(() => assign(id, null))}>
          Release (unassign me)
        </button>
      )}
      <Feedback result={result} />
    </div>
  );
}

export function WorkflowControls({
  id,
  status,
  priority,
  categoryId,
  categories,
  canEdit,
  isAdmin,
  hasAssignee,
}: {
  id: string;
  status: Status;
  priority: Priority;
  categoryId: string | null;
  categories: { id: string; name: string }[];
  canEdit: boolean;
  isAdmin: boolean;
  hasAssignee: boolean;
}) {
  const { pending, result, run } = useAction();
  const open = status !== "resolved" && status !== "archived" && status !== "no_action" && status !== "junk";
  return (
    <div className="space-y-3">
      {canEdit && status === "no_action" && (
        <button className="btn-brand w-full" disabled={pending} onClick={() => run(() => setStatus(id, hasAssignee ? "assigned" : "new"))}>
          This needs action — move to inbox
        </button>
      )}
      {canEdit && (status === "new" || status === "assigned") && (
        <button className="btn-secondary w-full" disabled={pending} onClick={() => run(() => setStatus(id, "no_action"))}>
          No action needed (newsletter / notification)
        </button>
      )}
      {canEdit && hasAssignee && open && (
        <div className="grid grid-cols-2 gap-2">
          {status === "assigned" && (
            <button className="btn-secondary col-span-2" disabled={pending} onClick={() => run(() => setStatus(id, "in_progress"))}>
              Start working
            </button>
          )}
          {status !== "waiting" && (
            <button className="btn-secondary" disabled={pending} onClick={() => run(() => setStatus(id, "waiting"))}>
              Waiting on customer
            </button>
          )}
          <button
            className={cx("btn bg-emerald-600 text-white hover:bg-emerald-700", status === "waiting" && "col-span-2")}
            disabled={pending}
            onClick={() => run(() => setStatus(id, "resolved"))}
          >
            Mark resolved
          </button>
        </div>
      )}
      {canEdit && (status === "resolved" || status === "archived") && (
        <button className="btn-secondary w-full" disabled={pending} onClick={() => run(() => setStatus(id, hasAssignee ? "in_progress" : "new"))}>
          Reopen conversation
        </button>
      )}

      <div>
        <label className="label" htmlFor="status">Status</label>
        <select
          id="status"
          className="input"
          value={status}
          disabled={pending || !canEdit}
          onChange={(e) => run(() => setStatus(id, e.target.value))}
        >
          {STATUSES.filter((s) => s !== "archived" || isAdmin || status === "archived").map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="priority">Priority</label>
          <select
            id="priority"
            className="input"
            value={priority}
            disabled={pending || !canEdit}
            onChange={(e) => run(() => setPriority(id, e.target.value))}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select
            id="category"
            className="input"
            value={categoryId ?? ""}
            disabled={pending}
            onChange={(e) => run(() => setCategory(id, e.target.value || null))}
          >
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {!canEdit && <p className="text-xs text-muted">Only the owner or an admin can change status and priority.</p>}
      <Feedback result={result} />
    </div>
  );
}

export function JunkControl({ id, status, senderEmail, canEdit }: { id: string; status: Status; senderEmail: string | null; canEdit: boolean }) {
  const { pending, result, run } = useAction();
  const [choosing, setChoosing] = useState(false);
  const [scope, setScope] = useState<"conversation" | "sender" | "domain">(senderEmail ? "sender" : "conversation");
  const domain = senderDomain(senderEmail);

  if (!canEdit) return <p className="text-xs text-muted">Only the owner or an admin can change this.</p>;
  if (status === "junk") {
    return (
      <div>
        <button className="btn-brand w-full" disabled={pending} onClick={() => run(() => notJunk(id))}>
          {pending ? "Moving…" : "Not junk — move to inbox"}
        </button>
        <p className="mt-1.5 text-xs text-muted">Also stops sending this sender’s future mail to Junk.</p>
        <Feedback result={result} />
      </div>
    );
  }
  if (status === "archived") return null;
  if (!choosing) {
    return (
      <div>
        <button className="btn-secondary w-full" onClick={() => setChoosing(true)}>Mark as junk…</button>
        <Feedback result={result} />
      </div>
    );
  }
  const option = (value: typeof scope, label: string, hint?: string) => (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="radio" name="junk-scope" className="mt-1" checked={scope === value} onChange={() => setScope(value)} />
      <span className="min-w-0 break-words">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
  return (
    <div className="space-y-2">
      {senderEmail && option("sender", `Always junk mail from ${senderEmail}`, "Future emails from this address go straight to Junk.")}
      {domain && canBlockDomain(domain) && option("domain", `Always junk mail from anyone @${domain}`)}
      {option("conversation", "Only this conversation")}
      <div className="flex gap-2 pt-1">
        <button className="btn-brand flex-1" disabled={pending} onClick={() => run(() => markJunk(id, scope))}>
          {pending ? "Moving…" : "Move to Junk"}
        </button>
        <button className="btn-ghost" disabled={pending} onClick={() => setChoosing(false)}>Cancel</button>
      </div>
      <Feedback result={result} />
    </div>
  );
}
