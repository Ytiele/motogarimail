import Link from "next/link";
import { Avatar, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";

export const metadata = { title: "Sent" };

const PAGE_SIZE = 50;

type SentRow = {
  id: string;
  conversation_id: string;
  recipient_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  sent_by: string | null;
};

export default async function SentPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const page = Math.max(1, Number(sp.page) || 1);
  // Commas and parentheses would break the PostgREST or() filter; they are never needed to find an address or subject.
  const q = sp.q?.trim().slice(0, 100).replace(/[,()*%\\]/g, " ").trim() || undefined;

  // RLS limits staff to their own and unassigned conversations; admins see every reply.
  let query = supabase
    .from("emails")
    .select("id, conversation_id, recipient_email, subject, snippet, received_at, sent_by", { count: "exact" })
    .eq("direction", "outbound")
    .order("received_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.or(`recipient_email.ilike.*${q}*,subject.ilike.*${q}*`);

  const [{ data, count, error }, { data: users }] = await Promise.all([query, supabase.from("users").select("id, name")]);
  const rows = (data as SentRow[]) ?? [];
  const names = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));
  const total = count ?? 0;
  const href = (p: number) => `/sent?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Sent"
        subtitle="Every reply sent from the Motogari mailbox, newest first — from the dashboard or directly from Gmail."
      />
      <form method="get" className="card mb-4 flex gap-2 p-3">
        <input className="input flex-1" type="search" name="q" defaultValue={q} placeholder="Search recipient or subject…" aria-label="Search sent mail" />
        <button className="btn-primary">Search</button>
        {q && <Link href="/sent" className="btn-ghost">Clear</Link>}
      </form>

      {error ? (
        <EmptyState title="Could not load sent mail" body="Please refresh. If this keeps happening, contact your administrator." />
      ) : rows.length === 0 ? (
        <EmptyState title={q ? "No sent emails match" : "Nothing sent yet"} body={q ? "Try a different search." : "Replies appear here as soon as they are sent."} />
      ) : (
        <>
          <ul className="card divide-y divide-line">
            {rows.map((r) => {
              const by = r.sent_by ? (names.get(r.sent_by) ?? "A former user") : null;
              return (
                <li key={r.id}>
                  <Link href={`/inbox/${r.conversation_id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-stone-50">
                    <Avatar name={by ?? "Motogari"} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold">To {r.recipient_email ?? "—"}</span>
                        <span className="tabular shrink-0 text-xs text-muted" title={formatDateTime(r.received_at)}>{formatRelative(r.received_at)}</span>
                      </div>
                      <div className="truncate text-sm">{r.subject ?? "(no subject)"}</div>
                      <div className="truncate text-xs text-muted">
                        {by ? `Sent by ${by}` : "Sent directly from Gmail"}
                        {r.snippet && ` · ${r.snippet}`}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span className="tabular">{(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + rows.length} of {total}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className="btn-secondary" href={href(page - 1)}>Previous</Link>}
              {page * PAGE_SIZE < total && <Link className="btn-secondary" href={href(page + 1)}>Next</Link>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
