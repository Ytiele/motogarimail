import "server-only";
import { mutateConversation } from "../conversations";
import { logEvent } from "../events";
import { notify } from "../notifications";
import { adminDb } from "../supabase/admin";
import type { Conversation } from "../types";
import { statusOnInbound } from "../workflow";
import { automatedReason } from "./classify";
import { junkSenderReason } from "./junk";
import { getActiveConnection, providerFor, type MailConnection } from "./connection";
import { MailAuthError, type MailProvider, type ParsedMessage } from "./types";

const SKIP_LABELS = new Set(["TRASH", "DRAFT", "CHAT"]);
const BASE_QUERY = "-in:spam -in:trash -in:drafts -in:chats";
// Gmail's Spam folder is pulled into the Junk section so staff can rescue real customers caught by the filter.
const SPAM_QUERY = "in:spam";
const MAX_BODY = 2_000_000;

export type IngestContext = {
  mailbox: string;
  /** Historical/backfill: store the message but do not change workflow state or notify anyone. */
  quiet: boolean;
  sentBy?: string | null;
  allowBackfill?: boolean;
  provider?: MailProvider;
};

export type IngestResult = { inserted: boolean; conversationId: string | null; emailId: string | null; reopened?: boolean };

async function findConversation(threadId: string): Promise<Conversation | null> {
  const { data } = await adminDb().from("conversations").select("*").eq("gmail_thread_id", threadId).maybeSingle();
  return (data as Conversation) ?? null;
}

export async function ingestMessage(msg: ParsedMessage, ctx: IngestContext): Promise<IngestResult> {
  const db = adminDb();
  if (msg.labelIds.some((l) => SKIP_LABELS.has(l))) return { inserted: false, conversationId: null, emailId: null };
  const gmailSpam = msg.labelIds.includes("SPAM");
  // Old spam is not worth importing; only spam that arrives while connected goes to Junk.
  if (gmailSpam && ctx.quiet) return { inserted: false, conversationId: null, emailId: null };

  const outbound = msg.labelIds.includes("SENT") || msg.from?.email === ctx.mailbox;
  let conv = await findConversation(msg.threadId);
  let created = false;

  if (!conv) {
    // Threads started by Motogari itself are not customer conversations until the customer writes back.
    if (outbound) return { inserted: false, conversationId: null, emailId: null };
    const junkReason = ctx.quiet ? null : gmailSpam ? "Gmail marked it as spam" : await junkSenderReason(msg.from?.email);
    const filedReason = ctx.quiet ? null : (junkReason ?? automatedReason(msg));
    const { data: inserted, error } = await db
      .from("conversations")
      .upsert(
        {
          gmail_thread_id: msg.threadId,
          subject: msg.subject?.trim() || "(no subject)",
          customer_name: msg.from?.name ?? null,
          customer_email: msg.from?.email ?? null,
          status: ctx.quiet ? "archived" : junkReason ? "junk" : filedReason ? "no_action" : "new",
          filed_reason: filedReason,
          is_historical: ctx.quiet,
          sla_started_at: ctx.quiet || filedReason ? null : msg.internalDate,
          last_message_at: msg.internalDate,
          last_activity_at: new Date().toISOString(),
        },
        { onConflict: "gmail_thread_id", ignoreDuplicates: true },
      )
      .select("*");
    if (error) throw new Error(`Failed to create conversation: ${error.message}`);
    created = !!inserted?.length;
    conv = created ? (inserted![0] as Conversation) : await findConversation(msg.threadId);
    if (!conv) throw new Error("Conversation vanished during sync");
  }

  const { data: emailRows, error: emailErr } = await db
    .from("emails")
    .upsert(
      {
        conversation_id: conv.id,
        gmail_message_id: msg.id,
        gmail_thread_id: msg.threadId,
        message_id: msg.messageIdHeader,
        in_reply_to: msg.inReplyTo,
        references_header: msg.references,
        direction: outbound ? "outbound" : "inbound",
        sender_name: msg.from?.name ?? null,
        sender_email: msg.from?.email ?? null,
        reply_to: msg.replyTo,
        recipient_email: msg.to,
        cc: msg.cc,
        bcc: msg.bcc,
        subject: msg.subject,
        body_text: msg.text?.slice(0, MAX_BODY) ?? null,
        body_html: msg.html?.slice(0, MAX_BODY) ?? null,
        snippet: msg.snippet ?? msg.text?.slice(0, 200) ?? null,
        received_at: msg.internalDate,
        has_attachments: msg.attachments.length > 0,
        labels: msg.labelIds,
        sent_by: ctx.sentBy ?? null,
      },
      { onConflict: "gmail_message_id", ignoreDuplicates: true },
    )
    .select("id");
  if (emailErr) throw new Error(`Failed to store email: ${emailErr.message}`);
  // Already synced: idempotent no-op, no duplicate side effects.
  if (!emailRows?.length) return { inserted: false, conversationId: conv.id, emailId: null };
  const emailId = emailRows[0].id as string;

  if (msg.attachments.length) {
    const { error } = await db.from("email_attachments").upsert(
      msg.attachments.map((a) => ({
        email_id: emailId,
        gmail_attachment_id: a.attachmentId,
        part_id: a.partId,
        filename: a.filename.slice(0, 255),
        mime_type: a.mimeType,
        size: a.size,
        content_id: a.contentId,
      })),
      { onConflict: "email_id,part_id", ignoreDuplicates: true },
    );
    if (error) console.error("[sync] attachment metadata failed", error.message);
  }

  let reopened = false;
  const at = msg.internalDate;
  const result = await mutateConversation(conv.id, (c) => {
    reopened = false;
    const patch: Partial<Conversation> = {
      message_count: c.message_count + 1,
      has_attachments: c.has_attachments || msg.attachments.length > 0,
    };
    const isLatest = !c.last_message_at || at >= c.last_message_at;
    if (isLatest) {
      patch.last_message_at = at;
      patch.snippet = msg.snippet ?? msg.text?.slice(0, 200) ?? c.snippet;
    }
    if (!outbound) {
      if (!c.first_inbound_at || at < c.first_inbound_at) patch.first_inbound_at = at;
      if (!c.last_inbound_at || at > c.last_inbound_at) patch.last_inbound_at = at;
      if (!ctx.quiet && isLatest) {
        const t = statusOnInbound(c.status, !!c.assigned_to);
        if (t.status !== c.status) patch.status = t.status;
        if (t.reopened) {
          reopened = true;
          patch.reopened_count = c.reopened_count + 1;
          patch.resolved_at = null;
          patch.resolved_by = null;
          patch.sla_started_at = at;
          patch.is_historical = false;
        }
        patch.last_activity_at = new Date().toISOString();
      }
    } else if (!c.first_response_at && c.first_inbound_at && at > c.first_inbound_at) {
      patch.first_response_at = at;
      patch.first_response_by = ctx.sentBy ?? null;
    }
    return patch;
  });
  if (!result.ok) throw new Error(`Failed to update conversation: ${result.error}`);
  const after = result.after;

  if (!outbound) {
    if (created) {
      await logEvent({
        type: "email_received",
        conversationId: conv.id,
        emailId,
        metadata: ctx.quiet ? { historical: true } : { from: msg.from?.email, auto_filed: conv.filed_reason ?? undefined },
      });
    } else if (!ctx.quiet && (after.status === "no_action" || after.status === "junk")) {
      await logEvent({ type: "email_received", conversationId: conv.id, emailId, metadata: { from: msg.from?.email, auto_filed: after.filed_reason ?? "Filed as no action needed" } });
    } else if (!ctx.quiet) {
      await logEvent({ type: "customer_replied", conversationId: conv.id, emailId, metadata: { from: msg.from?.email } });
      if (reopened) {
        await logEvent({ type: "conversation_reopened", conversationId: conv.id, emailId, metadata: { previous_status: result.before.status } });
      }
      await notify([after.assigned_to], {
        type: reopened ? "reopened" : "customer_replied",
        title: reopened ? "Resolved conversation reopened — customer replied" : "Customer replied",
        body: `${msg.from?.name ?? msg.from?.email ?? "Customer"}: ${after.subject}`,
        conversationId: conv.id,
        dedupeKey: `inbound:${emailId}`,
      });
    }
  } else if (!ctx.quiet && !ctx.sentBy) {
    await logEvent({ type: "reply_sent", conversationId: conv.id, emailId, metadata: { via: "gmail", note: "Sent directly from Gmail, outside the dashboard" } });
  }

  if (created && !ctx.quiet && ctx.allowBackfill && ctx.provider) {
    // Pull in earlier messages on this thread so the conversation view is complete.
    const ids = await ctx.provider.listThreadMessageIds(msg.threadId);
    for (const id of await filterNew(ids.filter((i) => i !== msg.id))) {
      await ingestMessage(await ctx.provider.getMessage(id), { mailbox: ctx.mailbox, quiet: true });
    }
  }

  return { inserted: true, conversationId: conv.id, emailId, reopened };
}

async function filterNew(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await adminDb().from("emails").select("gmail_message_id").in("gmail_message_id", ids.slice(i, i + 300));
    data?.forEach((r) => existing.add(r.gmail_message_id as string));
  }
  return ids.filter((id) => !existing.has(id));
}

async function listAll(provider: MailProvider, query: string, cap = 5000): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await provider.listMessageIds({ query, pageToken });
    ids.push(...r.ids);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids;
}

async function ingestMany(
  provider: MailProvider,
  ids: string[],
  ctx: Omit<IngestContext, "provider">,
  deadline: number,
): Promise<{ count: number; complete: boolean; failed: number }> {
  let count = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += 5) {
    if (Date.now() > deadline) return { count, complete: false, failed };
    const batch = ids.slice(i, i + 5);
    const messages = await Promise.all(
      batch.map((id) =>
        provider.getMessage(id).catch((e) => {
          if (e instanceof MailAuthError) throw e;
          return { error: e as Error, id };
        }),
      ),
    );
    for (const m of messages) {
      if ("error" in m) {
        failed++;
        await syncLog("error", `Failed to fetch message ${m.id}`, { error: String(m.error?.message ?? m.error) });
        continue;
      }
      try {
        const r = await ingestMessage(m, { ...ctx, provider, allowBackfill: !ctx.quiet });
        if (r.inserted) count++;
      } catch (e) {
        failed++;
        await syncLog("error", `Failed to ingest message ${m.id}`, { error: (e as Error).message });
      }
    }
  }
  return { count, complete: true, failed };
}

async function syncLog(level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>) {
  await adminDb().from("sync_logs").insert({ level, message, details: details ?? null });
}

function userFacingError(e: unknown): string {
  if (e instanceof MailAuthError) return "Gmail authorization failed. An admin needs to reconnect Gmail.";
  return "Sync failed. Details have been logged for the administrator.";
}

export type SyncResult = {
  status: "ok" | "partial" | "skipped" | "error" | "no_connection";
  imported: number;
  message?: string;
};

export async function runSync(opts: { timeBudgetMs?: number } = {}): Promise<SyncResult> {
  const conn = await getActiveConnection();
  if (!conn || conn.status === "disconnected") return { status: "no_connection", imported: 0 };
  const db = adminDb();
  const { data: locked, error: lockErr } = await db.rpc("acquire_sync_lock", { p_connection: conn.id, p_seconds: 120 });
  if (lockErr) throw lockErr;
  if (!locked) return { status: "skipped", imported: 0, message: "A sync is already running." };

  const deadline = Date.now() + (opts.timeBudgetMs ?? 45_000);
  const provider = providerFor(conn);
  const mailbox = conn.email_address.toLowerCase();
  let imported = 0;
  let complete = true;

  try {
    let historyId = conn.history_id;
    let initialDone = conn.initial_import_done;

    if (!initialDone) {
      if (!historyId) {
        // Record the starting point first so mail arriving during the import is picked up afterwards.
        historyId = (await provider.getProfile()).historyId;
        await db.from("mail_connections").update({ history_id: historyId }).eq("id", conn.id);
      }
      const { data: setting } = await db.from("app_settings").select("value").eq("key", "import_as_active").maybeSingle();
      const asActive = setting?.value === true;
      const ids = (await filterNew(await listAll(provider, `newer_than:${conn.import_window_days}d ${BASE_QUERY}`))).reverse();
      const r = await ingestMany(provider, ids, { mailbox, quiet: !asActive }, deadline);
      imported += r.count;
      if (r.complete) {
        initialDone = true;
        await db.from("mail_connections").update({ initial_import_done: true }).eq("id", conn.id);
        await syncLog("info", `Initial import finished (${conn.import_window_days} days)`, { imported: imported, failed: r.failed });
      } else complete = false;
    }

    if (initialDone && Date.now() < deadline && historyId) {
      const h = await provider.listHistory(historyId);
      let ids: string[];
      let nextHistory: string;
      if (h === null) {
        await syncLog("warn", "Gmail history expired; running catch-up scan of the last 7 days");
        const profile = await provider.getProfile();
        ids = [
          ...(await listAll(provider, `newer_than:7d ${BASE_QUERY}`)),
          ...(await listAll(provider, `newer_than:7d ${SPAM_QUERY}`)),
        ].reverse();
        nextHistory = profile.historyId;
      } else {
        ids = h.messageIds;
        nextHistory = h.historyId;
      }
      const r = await ingestMany(provider, await filterNew(ids), { mailbox, quiet: false }, deadline);
      imported += r.count;
      if (r.complete) await db.from("mail_connections").update({ history_id: nextHistory }).eq("id", conn.id);
      else complete = false;
    }

    await maybeRenewWatch(conn, provider);

    await db
      .from("mail_connections")
      .update({ status: "connected", last_sync_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null })
      .eq("id", conn.id);
    return { status: complete ? "ok" : "partial", imported };
  } catch (e) {
    const message = userFacingError(e);
    await syncLog("error", "Sync run failed", { error: (e as Error)?.message ?? String(e) });
    await db
      .from("mail_connections")
      .update({ status: "error", last_sync_at: new Date().toISOString(), last_error: message, last_error_at: new Date().toISOString() })
      .eq("id", conn.id);
    return { status: "error", imported, message };
  } finally {
    await db.from("mail_connections").update({ sync_lock_until: null }).eq("id", conn.id);
  }
}

async function maybeRenewWatch(conn: MailConnection, provider: MailProvider) {
  if (!provider.watch) return;
  const exp = conn.watch_expiration ? new Date(conn.watch_expiration).getTime() : 0;
  if (exp - Date.now() > 24 * 3600_000) return;
  try {
    const w = await provider.watch();
    if (w) {
      await adminDb()
        .from("mail_connections")
        .update({ watch_expiration: new Date(Number(w.expiration)).toISOString() })
        .eq("id", conn.id);
    }
  } catch (e) {
    await syncLog("warn", "Could not register Gmail push notifications; polling will continue", { error: (e as Error).message });
  }
}
