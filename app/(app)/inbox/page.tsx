import Link from "next/link";
import { InboxList } from "@/components/inbox/InboxList";
import { cx, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import type { Category, InboxCounts, InboxRow } from "@/lib/types";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/workflow";

export const metadata = { title: "Inbox" };

const VIEWS: { key: string; label: string; countKey?: keyof InboxCounts }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New", countKey: "new" },
  { key: "unassigned", label: "Unassigned", countKey: "unassigned" },
  { key: "mine", label: "Assigned to me", countKey: "mine" },
  { key: "in_progress", label: "In progress", countKey: "in_progress" },
  { key: "waiting", label: "Waiting", countKey: "waiting" },
  { key: "urgent", label: "Urgent", countKey: "urgent" },
  { key: "overdue", label: "Overdue", countKey: "overdue" },
  { key: "resolved", label: "Resolved" },
  { key: "resolved_today", label: "Resolved today" },
  { key: "updates", label: "Updates & newsletters", countKey: "updates" },
  { key: "junk", label: "Junk", countKey: "junk" },
  { key: "archived", label: "Archived" },
];
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type SP = Record<string, string | undefined>;

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { user: me, supabase } = await requireUser();
  const isAdmin = me.role === "admin";

  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const filter = {
    view,
    q: sp.q?.slice(0, 200) || undefined,
    staff: sp.staff && UUID.test(sp.staff) ? sp.staff : undefined,
    category: sp.category && UUID.test(sp.category) ? sp.category : undefined,
    priority: sp.priority && (PRIORITIES as readonly string[]).includes(sp.priority) ? sp.priority : undefined,
    from: sp.from && DATE.test(sp.from) ? sp.from : undefined,
    to: sp.to && DATE.test(sp.to) ? sp.to : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [{ data: rows, error }, { data: counts }, { data: staff }, { data: categories }] = await Promise.all([
    supabase.rpc("list_conversations", { p: filter }),
    supabase.rpc("inbox_counts"),
    supabase.from("users").select("id, name").eq("is_active", true).order("name"),
    supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
  ]);
  const list = (rows as InboxRow[]) ?? [];
  const total = list[0]?.total_count ?? 0;
  const c = counts as InboxCounts | null;
  const hasFilters = !!(filter.q || filter.staff || filter.category || filter.priority || filter.from || filter.to);

  const qs = (over: SP) => {
    const p = new URLSearchParams();
    const merged = { ...sp, ...over };
    Object.entries(merged).forEach(([k, v]) => v && !(k === "view" && v === "all") && p.set(k, v));
    const s = p.toString();
    return s ? `/inbox?${s}` : "/inbox";
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={`${isAdmin ? "Every conversation, one shared record each." : "Your emails, plus unassigned emails waiting for an owner."} Status shows whether it is handled, not whether someone opened it.`}
      />

      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 border-b border-line">
          {VIEWS.map((v) => {
            const n = v.countKey ? c?.[v.countKey] : undefined;
            const active = v.key === view;
            return (
              <Link
                key={v.key}
                href={qs({ view: v.key, page: undefined })}
                className={cx(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                  active ? "border-brand-500 font-semibold text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {v.label}
                {!!n && (
                  <span className={cx("tabular rounded-full px-1.5 text-xs", (v.key === "overdue" || v.key === "unassigned") ? "bg-red-100 text-red-800" : "bg-stone-200 text-stone-700")}>
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <form method="get" className="card mb-4 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[2fr_1fr_1fr_1fr_auto_auto_auto]">
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <input className="input sm:col-span-2 lg:col-span-3 2xl:col-span-1" type="search" name="q" defaultValue={filter.q} placeholder="Search sender, subject, message…" aria-label="Search" />
        {isAdmin ? (
          <select className="input" name="staff" defaultValue={filter.staff ?? ""} aria-label="Assigned staff">
            <option value="">Any staff</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : null}
        <select className="input" name="category" defaultValue={filter.category ?? ""} aria-label="Category">
          <option value="">Any category</option>
          {((categories as Category[]) ?? []).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
        </select>
        <select className="input" name="priority" defaultValue={filter.priority ?? ""} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <input className="input" type="date" name="from" defaultValue={filter.from} aria-label="From date" />
        <input className="input" type="date" name="to" defaultValue={filter.to} aria-label="To date" />
        <div className="flex gap-2">
          <button className="btn-primary flex-1">Apply</button>
          {hasFilters && <Link href={qs({ q: undefined, staff: undefined, category: undefined, priority: undefined, from: undefined, to: undefined, page: undefined })} className="btn-ghost">Clear</Link>}
        </div>
      </form>

      {error ? (
        <EmptyState title="Could not load the inbox" body="Please refresh. If this keeps happening, contact your administrator." />
      ) : list.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No conversations match these filters" : view === "unassigned" ? "Everything has an owner" : "Nothing here right now"}
          body={hasFilters ? "Try a different search term or clear the filters." : "New emails appear here automatically as they arrive."}
        />
      ) : (
        <>
          <InboxList rows={list} />
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span className="tabular">
              {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + list.length} of {total}
            </span>
            <div className="flex gap-2">
              {page > 1 && <Link className="btn-secondary" href={qs({ page: String(page - 1) })}>Previous</Link>}
              {page * PAGE_SIZE < total && <Link className="btn-secondary" href={qs({ page: String(page + 1) })}>Next</Link>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
