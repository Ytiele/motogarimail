import "server-only";
import { adminDb } from "./supabase/admin";

export type NotificationType =
  | "assigned"
  | "reassigned_away"
  | "customer_replied"
  | "reopened"
  | "sla_warning"
  | "sla_overdue";

// dedupeKey guarantees a given alert is only ever delivered once (prevents notification spam).
export async function notify(
  userIds: (string | null | undefined)[],
  n: { type: NotificationType; title: string; body?: string | null; conversationId?: string | null; dedupeKey?: string },
  opts: { exclude?: string | null } = {},
) {
  const targets = [...new Set(userIds.filter((u): u is string => !!u && u !== opts.exclude))];
  if (!targets.length) return;
  const rows = targets.map((user_id) => ({
    user_id,
    type: n.type,
    title: n.title,
    body: n.body ?? null,
    conversation_id: n.conversationId ?? null,
    dedupe_key: n.dedupeKey ? `${n.dedupeKey}:${user_id}` : null,
  }));
  const { error } = await adminDb().from("notifications").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) console.error("[notify] failed", error.message);
}

export async function adminIds(): Promise<string[]> {
  const { data } = await adminDb().from("users").select("id").eq("role", "admin").eq("is_active", true);
  return (data ?? []).map((r) => r.id as string);
}
