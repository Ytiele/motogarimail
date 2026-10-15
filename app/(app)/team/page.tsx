import Link from "next/link";
import { Avatar, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatShort } from "@/lib/format";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const { user: me, supabase } = await requireAdmin();
  const [{ data: users }, { data: open }] = await Promise.all([
    supabase.from("users").select("id, name, email, role, department, last_login_at").eq("is_active", true).order("name"),
    supabase.from("conversations").select("assigned_to, status, priority, sla_due_at").in("status", ["assigned", "in_progress", "waiting", "new"]).not("assigned_to", "is", null),
  ]);

  const now = Date.now();
  const load = new Map<string, { total: number; inProgress: number; waiting: number; urgent: number; overdue: number }>();
  for (const c of open ?? []) {
    const l = load.get(c.assigned_to) ?? { total: 0, inProgress: 0, waiting: 0, urgent: 0, overdue: 0 };
    l.total++;
    if (c.status === "in_progress") l.inProgress++;
    if (c.status === "waiting") l.waiting++;
    if (c.priority === "urgent") l.urgent++;
    if (c.sla_due_at && new Date(c.sla_due_at).getTime() < now && c.status !== "waiting") l.overdue++;
    load.set(c.assigned_to, l);
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Who owns what right now. This is for visibility and handover, not scoring."
        actions={me.role === "admin" ? <Link href="/settings/staff" className="btn-secondary">Manage staff</Link> : undefined}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(users ?? []).map((u) => {
          const l = load.get(u.id) ?? { total: 0, inProgress: 0, waiting: 0, urgent: 0, overdue: 0 };
          return (
            <Link key={u.id} href={`/inbox?staff=${u.id}`} className="card block p-4 hover:border-stone-400">
              <div className="flex items-center gap-3">
                <Avatar name={u.name} size={40} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{u.name}{u.id === me.id && <span className="font-normal text-muted"> (you)</span>}</div>
                  <div className="truncate text-xs text-muted">
                    {u.role === "admin" ? "Admin" : "Staff"}{u.department ? ` · ${u.department}` : ""} · last seen {formatShort(u.last_login_at)}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-center">
                <Cell label="Open" value={l.total} />
                <Cell label="Working" value={l.inProgress} />
                <Cell label="Waiting" value={l.waiting} />
                <Cell label="Overdue" value={l.overdue} alert />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function Cell({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`rounded-lg py-2 ${alert && value > 0 ? "bg-red-50 text-red-800" : "bg-stone-50"}`}>
      <div className="tabular text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}
