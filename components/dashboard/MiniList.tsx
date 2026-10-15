import Link from "next/link";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui";
import { formatShort } from "@/lib/format";
import type { InboxRow } from "@/lib/types";

export function MiniList({ title, rows, href, empty }: { title: string; rows: InboxRow[]; href: string; empty: string }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link href={href} className="text-xs font-medium text-brand-700 hover:underline">View all</Link>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/inbox/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{r.customer_name || r.customer_email}</span>
                    <PriorityBadge priority={r.priority} hideNormal />
                    {r.is_overdue && <OverdueBadge />}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {r.subject} · {r.assignee_name ?? <span className="font-medium text-red-700">Unassigned</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={r.status} />
                  <span className="tabular text-xs text-muted">{formatShort(r.last_message_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
