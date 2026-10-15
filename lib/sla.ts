import "server-only";
import { adminIds, notify } from "./notifications";
import { adminDb } from "./supabase/admin";

export async function runSlaScan() {
  const db = adminDb();
  const { data: rules } = await db.from("sla_rules").select("priority, warn_before_minutes");
  const warn = new Map((rules ?? []).map((r) => [r.priority as string, r.warn_before_minutes as number]));
  const maxWarn = Math.max(0, ...warn.values());
  const horizon = new Date(Date.now() + maxWarn * 60_000).toISOString();

  const { data: convs } = await db
    .from("conversations")
    .select("id, subject, assigned_to, priority, sla_due_at")
    .in("status", ["new", "assigned", "in_progress"])
    .not("sla_due_at", "is", null)
    .lt("sla_due_at", horizon)
    .limit(500);
  if (!convs?.length) return { warned: 0, overdue: 0 };

  const admins = await adminIds();
  let warned = 0;
  let overdue = 0;
  for (const c of convs) {
    const due = new Date(c.sla_due_at as string).getTime();
    if (due < Date.now()) {
      overdue++;
      await notify([c.assigned_to as string | null, ...admins], {
        type: "sla_overdue",
        title: "Email overdue",
        body: c.subject as string,
        conversationId: c.id as string,
        dedupeKey: `overdue:${c.id}:${c.sla_due_at}`,
      });
    } else if (c.assigned_to && due - (warn.get(c.priority as string) ?? 0) * 60_000 < Date.now()) {
      warned++;
      await notify([c.assigned_to as string], {
        type: "sla_warning",
        title: "Email approaching its SLA deadline",
        body: c.subject as string,
        conversationId: c.id as string,
        dedupeKey: `warn:${c.id}:${c.sla_due_at}`,
      });
    }
  }
  return { warned, overdue };
}
