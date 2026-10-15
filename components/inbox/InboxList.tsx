import Link from "next/link";
import { Assignee, cx, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui";
import { formatShort } from "@/lib/format";
import type { InboxRow } from "@/lib/types";

function CategoryChip({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-sm text-stone-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="h-2 w-2 rounded-sm" style={{ background: color ?? "#94a3b8" }} />
      {name}
    </span>
  );
}

export function InboxList({ rows }: { rows: InboxRow[] }) {
  return (
    <>
      {/* Desktop / tablet */}
      <div className="card hidden overflow-hidden md:block">
        <table className="w-full table-fixed text-left">
          <thead className="border-b border-line bg-stone-50 text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th className="w-36 px-4 py-2.5">Status</th>
              <th className="w-48 px-3 py-2.5">Sender</th>
              <th className="px-3 py-2.5">Subject</th>
              <th className="w-40 px-3 py-2.5">Assigned to</th>
              <th className="hidden w-36 px-3 py-2.5 xl:table-cell">Category</th>
              <th className="w-24 px-3 py-2.5 text-right">Received</th>
              <th className="hidden w-28 px-4 py-2.5 text-right lg:table-cell">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                className={cx(
                  "group relative hover:bg-stone-50",
                  r.priority === "urgent" && r.status !== "resolved" && r.status !== "archived" && "bg-red-50/40",
                )}
              >
                <td className="px-4 py-3 align-top">
                  <Link href={`/inbox/${r.id}`} className="absolute inset-0" aria-label={`Open ${r.subject}`} />
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={r.status} />
                    <div className="flex gap-1">
                      <PriorityBadge priority={r.priority} hideNormal />
                      {r.is_overdue && <OverdueBadge />}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="truncate text-sm font-medium">{r.customer_name || r.customer_email}</div>
                  {r.customer_name && <div className="truncate text-xs text-muted">{r.customer_email}</div>}
                </td>
                <td className="px-3 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.subject}</span>
                    {r.message_count > 1 && <span className="tabular shrink-0 text-xs text-muted">({r.message_count})</span>}
                    {r.has_attachments && (
                      <svg className="shrink-0 text-muted" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="Has attachments">
                        <path d="M13 7.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5l5.6-5.6a2.1 2.1 0 013 3L6.2 11.3a1 1 0 01-1.5-1.5L10 4.5" />
                      </svg>
                    )}
                    {r.reopened_count > 0 && r.status === "new" && (
                      <span className="shrink-0 rounded bg-blue-100 px-1 text-[10px] font-bold text-blue-800 uppercase">Reopened</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">{r.snippet}</div>
                </td>
                <td className="px-3 py-3 align-top">
                  {(r.status === "no_action" || r.status === "junk") && !r.assignee_name ? <span className="text-sm text-muted">No owner needed</span> : <Assignee name={r.assignee_name} />}
                </td>
                <td className="hidden px-3 py-3 align-top xl:table-cell">
                  <CategoryChip name={r.category_name} color={r.category_color} />
                </td>
                <td className="tabular px-3 py-3 text-right align-top text-sm whitespace-nowrap">{formatShort(r.last_message_at)}</td>
                <td className="tabular hidden px-4 py-3 text-right align-top text-sm whitespace-nowrap text-muted lg:table-cell">
                  {formatShort(r.last_activity_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              href={`/inbox/${r.id}`}
              className={cx("card block p-3.5", r.priority === "urgent" && r.status !== "resolved" && "border-red-300")}
            >
              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={r.status} />
                <span className="tabular text-xs text-muted">{formatShort(r.last_message_at)}</span>
              </div>
              <div className="mt-2 truncate text-sm font-semibold">{r.customer_name || r.customer_email}</div>
              <div className="truncate text-sm">{r.subject}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(r.status === "no_action" || r.status === "junk") && !r.assignee_name ? <span className="text-sm text-muted">No owner needed</span> : <Assignee name={r.assignee_name} />}
                <PriorityBadge priority={r.priority} hideNormal />
                {r.is_overdue && <OverdueBadge />}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
