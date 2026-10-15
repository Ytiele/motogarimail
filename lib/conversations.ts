import "server-only";
import { adminDb } from "./supabase/admin";
import type { Conversation } from "./types";

type MutateResult =
  | { ok: true; before: Conversation; after: Conversation; changed: boolean }
  | { ok: false; error: string; current?: Conversation };

/**
 * Optimistic-concurrency update. `decide` sees the latest row and returns a patch, null (no change),
 * or an error. The write only lands if nobody else changed the row in between; otherwise it retries
 * against the fresh row. This is what makes "Assign to me" safe when two people click at once.
 */
export async function mutateConversation(
  id: string,
  decide: (c: Conversation) => Partial<Conversation> | null | { error: string },
  attempts = 5,
): Promise<MutateResult> {
  const db = adminDb();
  for (let i = 0; i < attempts; i++) {
    const { data: current, error } = await db.from("conversations").select("*").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: "Could not load conversation." };
    if (!current) return { ok: false, error: "Conversation not found." };
    const c = current as Conversation;
    const patch = decide(c);
    if (patch && "error" in patch) return { ok: false, error: patch.error as string, current: c };
    if (!patch) return { ok: true, before: c, after: c, changed: false };

    const { data: updated, error: upErr } = await db
      .from("conversations")
      .update(patch)
      .eq("id", id)
      .eq("version", c.version)
      .select("*")
      .maybeSingle();
    if (upErr) return { ok: false, error: "Could not update conversation." };
    if (updated) return { ok: true, before: c, after: updated as Conversation, changed: true };
  }
  return { ok: false, error: "The conversation is being updated by someone else. Please try again." };
}
