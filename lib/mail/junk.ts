import "server-only";
import { adminDb } from "../supabase/admin";
import { describeRule, ruleMatches, senderDomain, type JunkRule } from "./junk-rules";

export type JunkSenderRow = JunkRule & {
  id: string;
  created_by: string | null;
  source_conversation_id: string | null;
  match_count: number;
  last_matched_at: string | null;
  created_at: string;
};

/** Rules that match this sender: the exact address, its domain, or a parent domain. */
export async function matchingRules(email: string | null | undefined): Promise<JunkSenderRow[]> {
  const domain = senderDomain(email);
  // Quotes would break the PostgREST filter below; such an address cannot be on the list anyway.
  if (!email || !domain || /["\\]/.test(email)) return [];
  const parts = domain.split(".");
  const domains = parts.slice(0, -1).map((_, i) => parts.slice(i).join("."));
  const { data } = await adminDb()
    .from("junk_senders")
    .select("*")
    .or(`and(kind.eq.address,value.eq."${email.toLowerCase()}"),and(kind.eq.domain,value.in.(${domains.map((d) => `"${d}"`).join(",")}))`);
  return ((data as JunkSenderRow[]) ?? []).filter((r) => ruleMatches(r, email));
}

/** Why this sender's mail belongs in Junk, or null. Records the hit so admins can see which rules are used. */
export async function junkSenderReason(email: string | null | undefined): Promise<string | null> {
  const [rule] = await matchingRules(email);
  if (!rule) return null;
  await adminDb()
    .from("junk_senders")
    .update({ match_count: rule.match_count + 1, last_matched_at: new Date().toISOString() })
    .eq("id", rule.id);
  return `Sender is on the junk list (${describeRule(rule)})`;
}

export async function addJunkRule(rule: JunkRule, by: string, sourceConversationId?: string | null) {
  const { error } = await adminDb()
    .from("junk_senders")
    .upsert(
      { ...rule, created_by: by, source_conversation_id: sourceConversationId ?? null },
      { onConflict: "kind,value", ignoreDuplicates: true },
    );
  if (error) throw new Error("Could not save the junk sender.");
}

/** Escapes LIKE wildcards so a domain is matched literally. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Other unowned conversations from this sender that are still waiting in New or Updates.
 * Anything someone has already taken ownership of is left alone.
 */
export async function findSweepable(rule: JunkRule, exceptId: string): Promise<{ id: string; status: string }[]> {
  let q = adminDb()
    .from("conversations")
    .select("id, status")
    .is("assigned_to", null)
    .in("status", ["new", "no_action"])
    .neq("id", exceptId)
    .limit(500);
  q = rule.kind === "address" ? q.eq("customer_email", rule.value) : q.like("customer_email", `%@${likeLiteral(rule.value)}`);
  const { data } = await q;
  return (data as { id: string; status: string }[]) ?? [];
}
