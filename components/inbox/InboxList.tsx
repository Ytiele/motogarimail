import Link from "next/link";
import { Avatar, cx, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui";
import { formatDateTime, formatShort } from "@/lib/format";
import type { InboxRow } from "@/lib/types";

// Gmail-style label pill for the category.
function CategoryLabel({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-stone-100 px-1.5 py-px text-[11px] font-medium text-ink-2">
      <span className="h-2 w-2 rounded-sm" style={{ background: color ?? "#94a3b8" }} />
      {name}
    </span>
  );
}

function Owner({ r }: { r: InboxRow }) {
  if ((r.status === "no_action" || r.status === "junk") && !r.assignee_name) return <span className="text-xs text-muted">No owner needed</span>;
  if (!r.assignee_name) return <span className="text-xs font-medium text-brand-600">Unassigned</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
      <Avatar name={r.assignee_name} size={20} />
      <span className="truncate">{r.assignee_name}</span>
    </span>
  );
}

const Clip = () => (
  <svg className="shrink-0 text-muted" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="Has attachments">
    <path d="M13 7.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5l5.6-5.6a2.1 2.1 0 013 3L6.2 11.3a1 1 0 01-1.5-1.5L10 4.5" />
  </svg>
);

export function InboxList({ rows }: { rows: InboxRow[] }) {
  // "New" plays the role of Gmail's unread: bold on white. It still means "nobody has handled this", not "nobody opened it".
  const isNew = (r: InboxRow) => r.status === "new";
  const urgentOpen = (r: InboxRow) => r.priority === "urgent" && !["resolved", "archived", "no_action", "junk"].includes(r.status);

  return (
    <>
      {/* Desktop / tablet: one dense line per conversation */}
      <ul className="hidden border-t border-line md:block">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cx(
              "group relative flex h-11 items-center gap-3 border-b border-line pr-4 pl-3 text-sm transition-shadow hover:z-10 hover:shadow-[inset_1px_0_0_var(--color-line),inset_-1px_0_0_var(--color-line),0_1px_3px_rgba(60,64,67,.25)]",
              isNew(r) ? "bg-white" : "bg-canvas",
            )}
          >
            {urgentOpen(r) && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand-500" aria-hidden />}
            <Link href={`/inbox/${r.id}`} className="absolute inset-0" aria-label={`Open ${r.subject}`} />
            <span className="w-32 shrink-0"><StatusBadge status={r.status} /></span>
            <span className={cx("w-48 shrink-0 truncate", isNew(r) ? "font-bold text-ink" : "text-ink-2")} title={r.customer_email ?? undefined}>
              {r.customer_name || r.customer_email}
              {r.message_count > 1 && <span className="tabular ml-1 text-xs font-normal text-muted">{r.message_count}</span>}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <PriorityBadge priority={r.priority} hideNormal />
              {r.is_overdue && <OverdueBadge />}
              {r.reopened_count > 0 && r.status === "new" && (
                <span className="shrink-0 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800 uppercase">Reopened</span>
              )}
              <CategoryLabel name={r.category_name} color={r.category_color} />
              <span className="min-w-0 truncate">
                <span className={isNew(r) ? "font-bold text-ink" : "text-ink-2"}>{r.subject}</span>
                {r.snippet && <span className="text-muted"> - {r.snippet}</span>}
              </span>
            </span>
            {r.has_attachments && <Clip />}
            <span className="hidden w-36 shrink-0 lg:flex"><Owner r={r} /></span>
            <span
              className={cx("tabular w-16 shrink-0 text-right text-xs whitespace-nowrap", isNew(r) ? "font-bold text-ink" : "text-muted")}
              title={`Received ${formatDateTime(r.last_message_at)} · Last activity ${formatDateTime(r.last_activity_at)}`}
            >
              {formatShort(r.last_message_at)}
            </span>
          </li>
        ))}
      </ul>

      {/* Mobile: Gmail app style */}
      <ul className="-mx-4 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/inbox/${r.id}`} className={cx("relative flex gap-3 px-4 py-3 active:bg-hover")}>
              {urgentOpen(r) && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand-500" aria-hidden />}
              <Avatar name={r.customer_name || r.customer_email} size={40} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cx("truncate", isNew(r) ? "font-bold text-ink" : "text-ink-2")}>{r.customer_name || r.customer_email}</span>
                  <span className={cx("tabular shrink-0 text-xs", isNew(r) ? "font-bold text-ink" : "text-muted")}>{formatShort(r.last_message_at)}</span>
                </div>
                <div className={cx("flex items-center gap-1.5 text-sm", isNew(r) ? "font-bold text-ink" : "text-ink-2")}>
                  <span className="truncate">{r.subject}</span>
                  {r.has_attachments && <Clip />}
                </div>
                <div className="truncate text-sm text-muted">{r.snippet}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge status={r.status} />
                  <PriorityBadge priority={r.priority} hideNormal />
                  {r.is_overdue && <OverdueBadge />}
                  <Owner r={r} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
