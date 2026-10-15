import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import type { JunkSenderRow } from "@/lib/mail/junk";
import { describeRule } from "@/lib/mail/junk-rules";
import { addJunkSender, removeJunkSender } from "../actions";

export const metadata = { title: "Junk senders" };

export default async function JunkSendersPage() {
  const { supabase } = await requireAdmin();
  const [{ data }, { data: users }] = await Promise.all([
    supabase.from("junk_senders").select("*").order("created_at", { ascending: false }),
    supabase.from("users").select("id, name"),
  ]);
  const rules = (data as JunkSenderRow[]) ?? [];
  const names = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));

  return (
    <>
      <PageHeader
        title="Junk senders"
        subtitle="New mail from these senders goes straight to Junk. Gmail's own Spam folder is shown there too. Staff add senders with “Mark as junk” on a conversation."
      />
      <section className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Add sender</h2>
        <ActionForm action={addJunkSender} submit="Add" resetOnSuccess className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="jp">Email address or @domain</label>
            <input id="jp" className="input" name="pattern" placeholder="offers@spammy.com or @spammy.com" required />
          </div>
        </ActionForm>
      </section>
      {rules.length ? (
        <ul className="card divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="font-medium break-all">{describeRule(r)}</div>
                <div className="text-xs text-muted">
                  Added {formatRelative(r.created_at)}
                  {r.created_by && ` by ${names.get(r.created_by) ?? "a former user"}`}
                  {r.source_conversation_id && (
                    <> · <Link className="underline" href={`/inbox/${r.source_conversation_id}`}>original email</Link></>
                  )}
                  {" · "}
                  {r.match_count ? `caught ${r.match_count} email(s), last ${formatRelative(r.last_matched_at!)}` : "nothing caught yet"}
                </div>
              </div>
              <ActionForm action={removeJunkSender} submit="Remove" submitClass="btn-secondary" confirm={`Stop sending mail from ${describeRule(r)} to Junk?`}>
                <input type="hidden" name="id" value={r.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No junk senders yet" body="Open a junk email and choose “Mark as junk…” to start the list." />
      )}
    </>
  );
}
