import Link from "next/link";
import { MiniList } from "@/components/dashboard/MiniList";
import { SyncStatus } from "@/components/dashboard/SyncStatus";
import { Avatar, MetricCard, PageHeader, SectionTitle } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";
import { getPublicConnection } from "@/lib/mail/connection";
import type { InboxCounts, InboxRow } from "@/lib/types";

export const metadata = { title: "Dashboard" };

type Summary = {
  received_today: number;
  new_today: number;
  resolved_today: number;
  unresolved: number;
  overdue: number;
  avg_first_response_minutes: number | null;
  avg_resolution_minutes: number | null;
  by_staff: { id: string; name: string; open_assigned: number; resolved: number; replies: number; avg_response_minutes: number | null }[];
};

export default async function DashboardPage() {
  const { user: me, supabase } = await requireUser();
  const isAdmin = me.role === "admin";

  const list = (view: string, limit: number) =>
    supabase.rpc("list_conversations", { p: { view, limit } }).then((r) => (r.data as InboxRow[]) ?? []);

  const [{ data: countsRaw }, mine, unassigned, overdue, conn, summary] = await Promise.all([
    supabase.rpc("inbox_counts"),
    list("mine", 8),
    list("unassigned", 6),
    list("overdue", 6),
    isAdmin ? getPublicConnection() : Promise.resolve(null),
    isAdmin ? supabase.rpc("analytics_summary", { p_days: 7 }).then((r) => r.data as Summary | null) : Promise.resolve(null),
  ]);
  const c = (countsRaw as InboxCounts) ?? ({} as InboxCounts);

  const hour = Number(new Date().toLocaleString("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}, ${me.name.split(" ")[0]}`}
        subtitle={isAdmin ? "Here is what needs attention across the team." : "Here is what needs attention, and what you own."}
        actions={<Link href="/inbox?view=unassigned" className="btn-primary">Open unassigned</Link>}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="New" value={c.new ?? 0} href="/inbox?view=new" tone="brand" />
        <MetricCard label="Unassigned" value={c.unassigned ?? 0} href="/inbox?view=unassigned" tone="alert" />
        <MetricCard label="In progress" value={c.in_progress ?? 0} href="/inbox?view=in_progress" />
        <MetricCard label="Waiting" value={c.waiting ?? 0} href="/inbox?view=waiting" hint="On the customer" />
        <MetricCard label="Overdue" value={c.overdue ?? 0} href="/inbox?view=overdue" tone="alert" />
        <MetricCard label="Resolved today" value={c.resolved_today ?? 0} href="/inbox?view=resolved_today" tone="good" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {isAdmin ? (
            <>
              <MiniList title="Overdue" rows={overdue} href="/inbox?view=overdue" empty="Nothing is overdue." />
              <MiniList title="Needs an owner" rows={unassigned} href="/inbox?view=unassigned" empty="Every open email has an owner." />
            </>
          ) : (
            <>
              <MiniList title={`My emails (${c.mine ?? 0})`} rows={mine} href="/inbox?view=mine" empty="Nothing assigned to you right now." />
              <MiniList title="Needs an owner" rows={unassigned} href="/inbox?view=unassigned" empty="Every open email has an owner." />
            </>
          )}
        </div>

        <div className="space-y-4">
          {isAdmin && <SyncStatus conn={conn} />}
          {isAdmin && summary && (
            <section className="card p-4">
              <SectionTitle right={<Link href="/analytics" className="text-xs font-medium text-brand-700 hover:underline">Analytics</Link>}>
                Today
              </SectionTitle>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Emails received" value={summary.received_today} />
                <Stat label="New conversations" value={summary.new_today} />
                <Stat label="Unresolved" value={summary.unresolved} />
                <Stat label="Overdue" value={summary.overdue} />
                <Stat label="Avg first response (7d)" value={formatMinutes(summary.avg_first_response_minutes)} />
                <Stat label="Avg resolution (7d)" value={formatMinutes(summary.avg_resolution_minutes)} />
              </dl>
            </section>
          )}
          {isAdmin && summary && (
            <section className="card p-4">
              <SectionTitle right={<Link href="/team" className="text-xs font-medium text-brand-700 hover:underline">Team</Link>}>
                Team workload
              </SectionTitle>
              <ul className="space-y-2.5">
                {summary.by_staff.map((s) => (
                  <li key={s.id} className="flex items-center gap-3">
                    <Avatar name={s.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      <div className="text-xs text-muted">
                        {s.resolved} resolved · avg response {formatMinutes(s.avg_response_minutes)} (7d)
                      </div>
                    </div>
                    <Link href={`/inbox?staff=${s.id}`} className="tabular rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold" title="Open conversations">
                      {s.open_assigned} open
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!isAdmin && <MiniList title="Overdue" rows={overdue} href="/inbox?view=overdue" empty="Nothing is overdue." />}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  );
}
