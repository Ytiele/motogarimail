import Link from "next/link";
import { ActivityList } from "@/components/activity";
import { cx, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import type { EventRow } from "@/lib/types";

export const metadata = { title: "Activity" };

const TYPES: { key: string; label: string; types?: string[] }[] = [
  { key: "all", label: "All" },
  { key: "replies", label: "Replies", types: ["reply_sent"] },
  { key: "assignments", label: "Assignments", types: ["email_assigned", "email_unassigned"] },
  { key: "status", label: "Status", types: ["status_changed", "email_resolved", "conversation_reopened"] },
  { key: "incoming", label: "Incoming", types: ["email_received", "customer_replied"] },
  { key: "opened", label: "Opened", types: ["email_opened"] },
];

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; user?: string; page?: string }> }) {
  const sp = await searchParams;
  const { user: me, supabase } = await requireUser();
  const isAdmin = me.role === "admin";
  const type = TYPES.find((t) => t.key === sp.type) ?? TYPES[0];
  const page = Math.max(1, Number(sp.page) || 1);
  const userFilter = isAdmin ? (sp.user && /^[0-9a-f-]{36}$/i.test(sp.user) ? sp.user : null) : me.id;

  let q = supabase.from("email_events").select("*").order("created_at", { ascending: false }).range((page - 1) * 100, page * 100 - 1);
  if (type.types) q = q.in("event_type", type.types);
  if (userFilter) q = q.eq("user_id", userFilter);
  const [{ data: events }, { data: users }] = await Promise.all([q, supabase.from("users").select("id, name").order("name")]);
  const evts = (events as EventRow[]) ?? [];

  const convIds = [...new Set(evts.map((e) => e.conversation_id).filter(Boolean))] as string[];
  const { data: convs } = convIds.length ? await supabase.from("conversations").select("id, subject").in("id", convIds) : { data: [] };
  const names = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));
  const subjects = new Map((convs ?? []).map((c) => [c.id as string, c.subject as string]));
  const emailIds = [...new Set(evts.filter((e) => e.email_id && ["email_received", "customer_replied"].includes(e.event_type)).map((e) => e.email_id!))];
  const { data: mails } = emailIds.length ? await supabase.from("emails").select("id, sender_name, sender_email").in("id", emailIds) : { data: [] };
  const senders = new Map((mails ?? []).map((m) => [m.id as string, { name: m.sender_name as string | null, email: m.sender_email as string | null }]));

  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    Object.entries({ type: sp.type, user: sp.user, ...o }).forEach(([k, v]) => v && v !== "all" && p.set(k, v));
    return `/activity${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle={isAdmin ? "Complete, append-only audit trail of every action on every email." : "Your own activity. The full audit trail is visible to admins."}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <Link key={t.key} href={href({ type: t.key, page: undefined })} className={cx("rounded-full px-3 py-1 text-sm", t.key === type.key ? "bg-ink text-canvas" : "bg-white text-muted ring-1 ring-line hover:text-ink")}>
            {t.label}
          </Link>
        ))}
        {isAdmin && (
          <form method="get" className="ml-auto flex gap-2">
            {sp.type && <input type="hidden" name="type" value={sp.type} />}
            <select name="user" defaultValue={sp.user ?? ""} className="input w-auto" aria-label="Staff member">
              <option value="">Everyone</option>
              {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <button className="btn-secondary">Filter</button>
          </form>
        )}
      </div>
      {evts.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <div className="card p-5">
          <ActivityList events={evts} names={names} subjects={subjects} senders={senders} />
          <div className="mt-6 flex gap-2">
            {page > 1 && <Link className="btn-secondary" href={href({ page: String(page - 1) })}>Newer</Link>}
            {evts.length === 100 && <Link className="btn-secondary" href={href({ page: String(page + 1) })}>Older</Link>}
          </div>
        </div>
      )}
    </>
  );
}
