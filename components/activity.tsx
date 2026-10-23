import Link from "next/link";
import { EVENT_LABEL } from "@/lib/events";
import { formatDateTime } from "@/lib/format";
import type { EventRow } from "@/lib/types";
import { STATUS_LABEL, type Status, PRIORITY_LABEL, type Priority } from "@/lib/workflow";

export type Senders = Map<string, { name: string | null; email: string | null }>;

export function describeEvent(e: EventRow, names: Map<string, string>, senders?: Senders): string {
  const who = e.user_id ? (names.get(e.user_id) ?? "A former user") : null;
  const m = e.metadata as Record<string, string | boolean | null | undefined>;
  // Who actually wrote in: the name on the email, else its address. Older events only stored the
  // address, so the stored email (if loaded) fills in the name.
  const stored = e.email_id ? senders?.get(e.email_id) : undefined;
  const fromName = (m.from_name as string | undefined) || stored?.name || null;
  const fromEmail = (m.from as string | undefined) || stored?.email || null;
  const sender = fromName && fromEmail && fromName !== fromEmail ? `${fromName} (${fromEmail})` : (fromName ?? fromEmail);
  switch (e.event_type) {
    case "email_received":
      if (m.historical) return sender ? `Email from ${sender} imported from Gmail history` : "Email imported from Gmail history";
      if (m.auto_filed) return `Email received${sender ? ` from ${sender}` : ""} — filed as no action needed (${m.auto_filed})`;
      return sender ? `Email received from ${sender}` : "Email received";
    case "customer_replied":
      return sender ? `${sender} replied` : "Customer replied";
    case "conversation_reopened":
      return `Reopened automatically — customer replied after it was ${STATUS_LABEL[m.previous_status as Status] ?? m.previous_status}`;
    case "email_opened":
      return `Opened by ${who} (status unchanged)`;
    case "email_assigned":
      if (m.self) return m.reason === "replied" ? `${who} took ownership by replying` : `${who} assigned it to themselves`;
      return `Assigned to ${m.to_name ?? "someone"} by ${who}`;
    case "email_unassigned":
      return `${who} unassigned ${m.from_name ?? "the owner"}`;
    case "status_changed":
      if (m.to === "junk") return m.rule ? `${who ?? "System"} moved it to Junk (sender ${m.rule} is on the junk list)` : `${who ?? "System"} moved it to Junk`;
      if (m.from === "junk") return `${who ?? "System"} marked it as not junk and moved it to the inbox`;
      if (m.to === "no_action") return `${who ?? "System"} filed it as no action needed`;
      if (m.from === "no_action") return `${who ?? "System"} moved it to the inbox as needing action`;
      return `${who ?? "System"} changed status: ${STATUS_LABEL[m.from as Status] ?? m.from} → ${STATUS_LABEL[m.to as Status] ?? m.to}`;
    case "junk_sender_added":
      return `${who} added ${m.kind === "domain" ? `everyone @${m.value}` : m.value} to the junk list`;
    case "junk_sender_removed":
      return `${who} removed ${m.kind === "domain" ? `everyone @${m.value}` : m.value} from the junk list`;
    case "reply_sent":
      return m.via === "gmail" ? "Reply sent directly from Gmail (outside the dashboard)" : `${who} sent a reply`;
    case "note_added":
      return `${who} added an internal note`;
    case "email_resolved":
      return `${who} resolved the conversation`;
    case "priority_changed":
      return `${who} changed priority: ${PRIORITY_LABEL[m.from as Priority] ?? m.from} → ${PRIORITY_LABEL[m.to as Priority] ?? m.to}`;
    case "category_changed":
      return `${who} set category to ${m.to_name ?? "none"}`;
    default:
      return `${EVENT_LABEL[e.event_type] ?? e.event_type}${who ? ` — ${who}` : ""}`;
  }
}

const DOT: Record<string, string> = {
  email_received: "bg-blue-500",
  customer_replied: "bg-blue-500",
  conversation_reopened: "bg-blue-600",
  email_opened: "bg-stone-300",
  email_assigned: "bg-violet-500",
  email_unassigned: "bg-violet-300",
  reply_sent: "bg-brand-500",
  email_resolved: "bg-emerald-500",
  note_added: "bg-amber-400",
};

export function ActivityList({
  events,
  names,
  subjects,
  senders,
}: {
  events: EventRow[];
  names: Map<string, string>;
  subjects?: Map<string, string>;
  senders?: Senders;
}) {
  return (
    <ol className="relative space-y-3 border-l border-line pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className={`absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${DOT[e.event_type] ?? "bg-stone-400"}`} />
          <div className="text-sm">{describeEvent(e, names, senders)}</div>
          {subjects && e.conversation_id && (
            <Link href={`/inbox/${e.conversation_id}`} className="block truncate text-xs text-brand-700 hover:underline">
              {subjects.get(e.conversation_id) ?? "Conversation"}
            </Link>
          )}
          <div className="tabular text-xs text-muted">{formatDateTime(e.created_at)}</div>
        </li>
      ))}
    </ol>
  );
}
