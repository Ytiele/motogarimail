import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cx, EmptyState, PageHeader } from "@/components/ui";
import { currentUser, requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { adminDb } from "@/lib/supabase/admin";
import type { NotificationRow } from "@/lib/types";

export const metadata = { title: "Notifications" };

async function markAllRead() {
  "use server";
  const me = await currentUser();
  if (!me) return;
  await adminDb().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me.id).is("read_at", null);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const { user, supabase } = await requireUser();
  const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
  const rows = (data as NotificationRow[]) ?? [];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Assignments, customer replies and SLA alerts that concern you."
        actions={unread > 0 ? <form action={markAllRead}><button className="btn-secondary">Mark all as read</button></form> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState title="You're all caught up" body="You'll be notified when an email is assigned to you, a customer replies, or an SLA is close." />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((n) => (
            <li key={n.id} className={cx(!n.read_at && "bg-brand-50/50")}>
              <Link href={n.conversation_id ? `/inbox/${n.conversation_id}` : "#"} className="flex items-start gap-3 px-4 py-3 hover:bg-stone-50">
                <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : n.type === "sla_overdue" ? "bg-red-600" : "bg-brand-500")} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  {n.body && <div className="truncate text-sm text-muted">{n.body}</div>}
                </div>
                <span className="tabular shrink-0 text-xs text-muted">{formatDateTime(n.created_at)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
