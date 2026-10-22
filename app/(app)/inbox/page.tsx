import Link from "next/link";
import { InboxList } from "@/components/inbox/InboxList";
import { cx, EmptyState } from "@/components/ui";
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

  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = (page - 1) * PAGE_SIZE + list.length;
  const viewLabel = VIEWS.find((v) => v.key === view)?.label ?? "All";
  const chip = "h-8 w-auto rounded-full border border-line bg-white px-3 text-sm text-ink-2 hover:bg-hover focus:border-brand-500 focus:outline-none";
  const pager = (
    <div className="flex items-center gap-1 text-xs text-muted">
      <span className="tabular px-2">{total ? `${from}–${to} of ${total}` : "0"}</span>
      {page > 1 ? (
        <Link className="icon-btn h-9 w-9" href={qs({ page: String(page - 1) })} aria-label="Newer">‹</Link>
      ) : (
        <span className="icon-btn h-9 w-9 opacity-30">‹</span>
      )}
      {page * PAGE_SIZE < total ? (
        <Link className="icon-btn h-9 w-9" href={qs({ page: String(page + 1) })} aria-label="Older">›</Link>
      ) : (
        <span className="icon-btn h-9 w-9 opacity-30">›</span>
      )}
    </div>
  );

  return (
    <>
      <h1 className="sr-only">Inbox — {viewLabel}</h1>
      <p className="mb-3 text-xs text-muted">
        Every conversation, one shared record each — the whole team sees the same inbox. Status shows whether it is handled, not whether someone opened it.
      </p>

      {/* Gmail-style category tabs */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex border-b border-line">
          {VIEWS.map((v) => {
            const n = v.countKey ? c?.[v.countKey] : undefined;
            const active = v.key === view;
            return (
              <Link
                key={v.key}
                href={qs({ view: v.key, page: undefined })}
                className={cx(
                  "-mb-px flex h-12 items-center gap-2 border-b-[3px] px-4 text-sm whitespace-nowrap hover:bg-hover",
                  active ? "border-brand-500 font-medium text-brand-600" : "border-transparent text-muted",
                )}
              >
                {v.label}
                {!!n && (
                  <span
                    className={cx(
                      "tabular rounded-full px-1.5 text-[11px] font-medium",
                      v.key === "overdue" || v.key === "unassigned" ? "bg-brand-500 text-white" : "bg-stone-200 text-stone-700",
                    )}
                  >
                    {n}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Toolbar: filter chips (like Gmail's search chips) + pager */}
      <div className="flex flex-col gap-2 py-2 lg:flex-row lg:items-center lg:justify-between">
        <form method="get" className="flex flex-wrap items-center gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          {filter.q && <input type="hidden" name="q" value={filter.q} />}
          <select className={chip} name="staff" defaultValue={filter.staff ?? ""} aria-label="Assigned staff">
            <option value="">Any staff</option>
            {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className={chip} name="category" defaultValue={filter.category ?? ""} aria-label="Category">
            <option value="">Any category</option>
            {((categories as Category[]) ?? []).map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          <select className={chip} name="priority" defaultValue={filter.priority ?? ""} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
          <input className={chip} type="date" name="from" defaultValue={filter.from} aria-label="From date" />
          <input className={chip} type="date" name="to" defaultValue={filter.to} aria-label="To date" />
          <button className="h-8 rounded-full bg-ink px-4 text-sm font-medium text-canvas hover:bg-ink-2">Apply</button>
          {hasFilters && (
            <Link href={qs({ q: undefined, staff: undefined, category: undefined, priority: undefined, from: undefined, to: undefined, page: undefined })} className="h-8 rounded-full px-3 text-sm leading-8 text-brand-600 hover:bg-hover">
              Clear filters
            </Link>
          )}
          {filter.q && <span className="text-sm text-muted">Results for “{filter.q}”</span>}
        </form>
        <div className="self-end lg:self-auto">{pager}</div>
      </div>

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
          <div className="mt-2 flex justify-end">{pager}</div>
        </>
      )}
    </>
  );
}
