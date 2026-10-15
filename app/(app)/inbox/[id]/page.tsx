import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityList } from "@/components/activity";
import { Composer } from "@/components/email/Composer";
import { JunkControl, MarkOpened, OwnershipControl, WorkflowControls } from "@/components/email/Controls";
import { EmailFrame } from "@/components/email/EmailFrame";
import { Assignee, Avatar, cx, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { formatAddress, parseAddressList } from "@/lib/mail/address";
import { sanitizeEmailHtml } from "@/lib/sanitize";
import type { Attachment, Category, Conversation, EmailRow, EventRow, NoteRow } from "@/lib/types";
import { isOverdue } from "@/lib/workflow";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { user: me, supabase } = await requireUser();

  const { data: convRow } = await supabase.from("conversations").select("*").eq("id", id).maybeSingle();
  if (!convRow) notFound();
  const c = convRow as Conversation;

  const [{ data: emails }, { data: notes }, { data: events }, { data: users }, { data: categories }] = await Promise.all([
    supabase.from("emails").select("*").eq("conversation_id", id).order("received_at"),
    supabase.from("email_notes").select("*").eq("conversation_id", id).order("created_at"),
    supabase.from("email_events").select("*").eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.from("users").select("id, name, is_active").order("name"),
    supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
  ]);
  const messages = (emails as EmailRow[]) ?? [];
  const emailIds = messages.map((m) => m.id);
  const { data: atts } = emailIds.length
    ? await supabase.from("email_attachments").select("id, email_id, filename, mime_type, size, content_id").in("email_id", emailIds)
    : { data: [] };
  const attachments = (atts as (Attachment & { content_id: string | null })[]) ?? [];

  const names = new Map((users ?? []).map((u) => [u.id as string, u.name as string]));
  const activeStaff = (users ?? []).filter((u) => u.is_active).map((u) => ({ id: u.id as string, name: u.name as string }));
  const evts = (events as EventRow[]) ?? [];

  const isAdmin = me.role === "admin";
  const isOwner = c.assigned_to === me.id;
  const canEdit = isAdmin || isOwner || !c.assigned_to;
  const isJunk = c.status === "junk";
  const canReply = (isAdmin || isOwner || !c.assigned_to) && !isJunk;
  const closed = c.status === "resolved" || c.status === "archived" || c.status === "no_action" || isJunk;
  const overdue = isOverdue(c);

  const viewers = [...new Set(evts.filter((e) => e.event_type === "email_opened" && e.user_id).map((e) => e.user_id!))];
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const firstInbound = messages.find((m) => m.direction === "inbound");
  const replyTarget = lastInbound?.reply_to || (lastInbound ? formatAddress({ name: lastInbound.sender_name, email: lastInbound.sender_email ?? "" }) : c.customer_email ?? "");

  type Item = { kind: "email"; at: string; email: EmailRow } | { kind: "note"; at: string; note: NoteRow };
  const items: Item[] = [
    ...messages.map((e) => ({ kind: "email" as const, at: e.received_at, email: e })),
    ...((notes as NoteRow[]) ?? []).map((n) => ({ kind: "note" as const, at: n.created_at, note: n })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <MarkOpened id={c.id} />
      <div className="mb-4">
        <Link href="/inbox" className="text-sm text-muted hover:text-ink">← Inbox</Link>
      </div>

      {/* Header */}
      <div className="card mb-4 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} size="lg" />
              <PriorityBadge priority={c.priority} />
              {overdue && <OverdueBadge />}
              {c.reopened_count > 0 && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-800 uppercase">Reopened ×{c.reopened_count}</span>
              )}
            </div>
            <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{c.subject}</h1>
            <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted">From</dt>
              <dd className="break-all">{c.customer_name ? `${c.customer_name} <${c.customer_email}>` : c.customer_email}</dd>
              <dt className="text-muted">To</dt>
              <dd className="break-all">{firstInbound?.recipient_email ?? "—"}</dd>
              <dt className="text-muted">Received</dt>
              <dd className="tabular">{formatDateTime(c.first_inbound_at ?? c.created_at)}</dd>
              {c.sla_due_at && !closed && c.status !== "waiting" && (
                <>
                  <dt className="text-muted">Due</dt>
                  <dd className={cx("tabular", overdue && "font-semibold text-red-700")}>
                    {formatDateTime(c.sla_due_at)} ({overdue ? `overdue by ${formatRelative(c.sla_due_at).replace(" ago", "")}` : formatRelative(c.sla_due_at)})
                  </dd>
                </>
              )}
            </dl>
          </div>
          <div className="shrink-0 rounded-lg bg-stone-50 p-3 lg:w-64">
            <div className="label">Owner</div>
            <div className="mb-2">
              {(c.status === "no_action" || isJunk) && !c.assigned_to ? (
                <span className="text-sm text-muted">No owner needed</span>
              ) : (
                <Assignee name={c.assigned_to ? names.get(c.assigned_to) : null} />
              )}
            </div>
            <div className="label mt-3">Seen by</div>
            {viewers.length ? (
              <div className="flex flex-wrap gap-1">
                {viewers.map((v) => (
                  <span key={v} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs ring-1 ring-line">
                    <Avatar name={names.get(v)} size={16} /> {names.get(v)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted">Nobody yet</div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-muted">Being seen does not mean handled. Only the status above says that.</p>
          </div>
        </div>
        {c.status === "no_action" && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
            <strong>Filed as no action needed</strong>
            {c.filed_reason ? ` — ${c.filed_reason}.` : "."} It does not need an owner, is not counted as work and never goes overdue.
            If it does need a reply, use “This needs action” on the right.
          </div>
        )}
        {isJunk && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            <strong>In Junk</strong>
            {c.filed_reason ? ` — ${c.filed_reason}.` : "."} It is not counted as work and never goes overdue.
            Do not click links or open attachments unless you trust the sender. If this is a real customer, use “Not junk” on the right.
          </div>
        )}
        {c.status === "new" && !c.assigned_to && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <strong>Nobody owns this yet.</strong> Opening it does not change anything — it stays <strong>New</strong> until someone takes ownership.
          </div>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Conversation */}
        <div className="min-w-0 space-y-3">
          {items.map((it) =>
            it.kind === "email" ? (
              <Message
                key={it.email.id}
                email={it.email}
                attachments={attachments.filter((a) => a.email_id === it.email.id)}
                senderName={it.email.sent_by ? names.get(it.email.sent_by) : undefined}
              />
            ) : (
              <div key={it.note.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4 sm:ml-10">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold tracking-wide text-amber-900 uppercase">Internal note · {names.get(it.note.user_id)}</span>
                  <span className="tabular text-amber-800">{formatDateTime(it.note.created_at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap text-amber-950">{it.note.note}</p>
              </div>
            ),
          )}
          <Composer
            id={c.id}
            defaultTo={replyTarget}
            defaultCc=""
            greetingName={(lastInbound?.sender_name ?? c.customer_name ?? "Customer").split(/\s+/)[0]}
            signature={me.name}
            canReply={canReply}
            blockedReason={isJunk ? "This conversation is in Junk. If it is a real customer, choose “Not junk” first." : `This conversation is owned by ${c.assigned_to ? names.get(c.assigned_to) : "someone else"}. Add an internal note, or ask an admin to reassign it.`}
          />
        </div>

        {/* Side panel */}
        <aside className="grid gap-4 self-start md:grid-cols-2 xl:sticky xl:top-6 xl:grid-cols-1">
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold">Ownership</div>
            <OwnershipControl id={c.id} assignedTo={c.assigned_to} meId={me.id} isAdmin={isAdmin} closed={closed} staff={activeStaff} />
          </div>
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold">Workflow</div>
            <WorkflowControls
              id={c.id}
              status={c.status}
              priority={c.priority}
              categoryId={c.category_id}
              categories={((categories as Category[]) ?? []).map((x) => ({ id: x.id, name: x.name }))}
              canEdit={canEdit}
              isAdmin={isAdmin}
              hasAssignee={!!c.assigned_to}
            />
          </div>
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold">Junk</div>
            <JunkControl id={c.id} status={c.status} senderEmail={c.customer_email} canEdit={canEdit} />
          </div>
          <div className="card p-4">
            <div className="mb-3 text-sm font-semibold">Activity</div>
            {evts.length ? <ActivityList events={evts} names={names} /> : <p className="text-sm text-muted">No activity yet.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}

function Message({
  email,
  attachments,
  senderName,
}: {
  email: EmailRow;
  attachments: (Attachment & { content_id: string | null })[];
  senderName?: string;
}) {
  const outbound = email.direction === "outbound";
  const cidMap = Object.fromEntries(attachments.filter((a) => a.content_id).map((a) => [a.content_id!, `/api/attachments/${a.id}?inline=1`]));
  const visible = attachments.filter((a) => !a.content_id || !email.body_html?.includes(`cid:${a.content_id}`));
  const cc = parseAddressList(email.cc);

  return (
    <article className={cx("card overflow-hidden", outbound && "border-brand-100 sm:ml-10")}>
      <header className={cx("flex items-start justify-between gap-3 border-b px-4 py-3", outbound ? "border-brand-100 bg-brand-50" : "border-line bg-stone-50/60")}>
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={outbound ? (senderName ?? "Motogari") : (email.sender_name ?? email.sender_email)} size={32} />
          <div className="min-w-0 text-sm">
            <div className="font-semibold">
              {outbound ? (
                <>
                  Motogari{senderName ? <span className="font-normal text-muted"> · sent by {senderName}</span> : <span className="font-normal text-muted"> · sent from Gmail</span>}
                </>
              ) : (
                email.sender_name ?? email.sender_email
              )}
            </div>
            <div className="truncate text-xs text-muted">
              {outbound ? `To ${email.recipient_email}` : email.sender_email}
              {cc.length > 0 && ` · Cc ${cc.map((a) => a.email).join(", ")}`}
            </div>
          </div>
        </div>
        <div className="tabular shrink-0 text-xs text-muted">{formatDateTime(email.received_at)}</div>
      </header>
      <div className="px-4 py-3">
        {email.body_html ? (
          <EmailFrame html={sanitizeEmailHtml(email.body_html, cidMap)} />
        ) : (
          <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">{email.body_text || <span className="text-muted">(empty message)</span>}</div>
        )}
      </div>
      {visible.length > 0 && (
        <footer className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          {visible.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-stone-50 px-2.5 py-1.5 text-sm">
              <span className="max-w-48 truncate font-medium" title={a.filename}>{a.filename}</span>
              <span className="text-xs text-muted">{formatBytes(a.size)}</span>
              <a className="text-xs font-medium text-brand-700 hover:underline" href={`/api/attachments/${a.id}?inline=1`} target="_blank" rel="noopener">View</a>
              <a className="text-xs font-medium text-brand-700 hover:underline" href={`/api/attachments/${a.id}`}>Download</a>
            </div>
          ))}
        </footer>
      )}
    </article>
  );
}
