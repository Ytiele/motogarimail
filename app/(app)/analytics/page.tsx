import Link from "next/link";
import { cx, EmptyState, MetricCard, PageHeader, SectionTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";

export const metadata = { title: "Analytics" };

type Summary = {
  received_today: number;
  received_week: number;
  resolved_today: number;
  resolved_week: number;
  unresolved: number;
  overdue: number;
  avg_first_response_minutes: number | null;
  avg_resolution_minutes: number | null;
  by_category: { name: string; color: string; count: number }[];
  by_staff: { id: string; name: string; department: string | null; open_assigned: number; resolved: number; replies: number; avg_response_minutes: number | null }[];
  daily: { day: string; received: number; resolved: number }[];
};

const RANGES = [7, 30, 90];
const RECEIVED = "#3b6fd4";
const RESOLVED = "#f26b1d";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { supabase } = await requireAdmin();
  const days = RANGES.includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7;
  const { data, error } = await supabase.rpc("analytics_summary", { p_days: days });
  const s = data as Summary | null;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Operational visibility for the team. Times are measured from when a customer wrote in."
        actions={
          <div className="flex rounded-lg border border-line bg-white p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={`/analytics?days=${r}`} className={cx("rounded-md px-3 py-1.5 text-sm", r === days ? "bg-ink text-canvas" : "text-muted hover:text-ink")}>
                {r} days
              </Link>
            ))}
          </div>
        }
      />
      {error || !s ? (
        <EmptyState title="Analytics are unavailable" body="The analytics query failed. Check that the database migration has been applied." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Received today" value={s.received_today} hint={`${s.received_week} this week`} />
            <MetricCard label="Resolved today" value={s.resolved_today} hint={`${s.resolved_week} this week`} tone="good" />
            <MetricCard label="Unresolved" value={s.unresolved} href="/inbox" />
            <MetricCard label="Overdue" value={s.overdue} href="/inbox?view=overdue" tone="alert" />
            <MetricCard label="Avg first response" value={formatMinutes(s.avg_first_response_minutes)} hint={`Last ${days} days`} />
            <MetricCard label="Avg resolution" value={formatMinutes(s.avg_resolution_minutes)} hint={`Last ${days} days`} />
          </div>

          <section className="card mt-6 p-4">
            <SectionTitle
              right={
                <div className="flex gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RECEIVED }} /> Received</span>
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RESOLVED }} /> Resolved</span>
                </div>
              }
            >
              Received vs resolved per day
            </SectionTitle>
            <DailyChart daily={s.daily} />
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs text-muted">Show as table</summary>
              <table className="tabular mt-2 w-full max-w-md text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="py-1">Day</th><th>Received</th><th>Resolved</th></tr></thead>
                <tbody>
                  {s.daily.map((d) => <tr key={d.day} className="border-t border-line"><td className="py-1">{d.day}</td><td>{d.received}</td><td>{d.resolved}</td></tr>)}
                </tbody>
              </table>
            </details>
          </section>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <SectionTitle>By category ({days} days)</SectionTitle>
              {s.by_category.length === 0 ? (
                <p className="text-sm text-muted">No conversations in this period.</p>
              ) : (
                <ul className="space-y-2.5">
                  {s.by_category.map((c) => {
                    const max = Math.max(...s.by_category.map((x) => x.count), 1);
                    return (
                      <li key={c.name} title={`${c.name}: ${c.count}`}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: c.color }} />{c.name}</span>
                          <span className="tabular text-muted">{c.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-stone-100">
                          <div className="h-2 rounded-full bg-ink" style={{ width: `${(c.count / max) * 100}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card overflow-hidden">
              <div className="p-4 pb-0"><SectionTitle>By staff member ({days} days)</SectionTitle></div>
              <div className="overflow-x-auto">
                <table className="tabular w-full text-left text-sm">
                  <thead className="border-y border-line bg-stone-50 text-xs text-muted uppercase">
                    <tr>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-2 py-2 text-right">Open</th>
                      <th className="px-2 py-2 text-right">Replies</th>
                      <th className="px-2 py-2 text-right">Resolved</th>
                      <th className="px-4 py-2 text-right">Avg 1st response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {s.by_staff.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-2"><Link href={`/inbox?staff=${u.id}`} className="hover:underline">{u.name}</Link></td>
                        <td className="px-2 py-2 text-right">{u.open_assigned}</td>
                        <td className="px-2 py-2 text-right">{u.replies}</td>
                        <td className="px-2 py-2 text-right">{u.resolved}</td>
                        <td className="px-4 py-2 text-right">{formatMinutes(u.avg_response_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p-4 text-xs text-muted">Workload differs by role and email type — use these numbers for balancing work, not ranking people.</p>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function DailyChart({ daily }: { daily: Summary["daily"] }) {
  const max = Math.max(1, ...daily.flatMap((d) => [d.received, d.resolved]));
  const labelEvery = daily.length > 31 ? 14 : daily.length > 10 ? 5 : 1;
  return (
    <div className="mt-8 mb-6 flex h-48 items-end gap-[2px] border-b border-line" role="img" aria-label="Daily received and resolved emails">
      {daily.map((d, i) => {
        const date = new Date(d.day + "T00:00:00");
        const label = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        return (
          <div key={d.day} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label}: ${d.received} received, ${d.resolved} resolved`}>
            <div className="flex h-full items-end justify-center gap-[2px] rounded-t group-hover:bg-stone-100">
              <div className="w-full max-w-4 rounded-t-[4px]" style={{ height: `${(d.received / max) * 100}%`, background: RECEIVED, minHeight: d.received ? 2 : 0 }} />
              <div className="w-full max-w-4 rounded-t-[4px]" style={{ height: `${(d.resolved / max) * 100}%`, background: RESOLVED, minHeight: d.resolved ? 2 : 0 }} />
            </div>
            <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap text-muted">
              {i % labelEvery === 0 ? label : ""}
            </div>
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs whitespace-nowrap text-canvas group-hover:block">
              {label}: {d.received} in · {d.resolved} resolved
            </div>
          </div>
        );
      })}
    </div>
  );
}
