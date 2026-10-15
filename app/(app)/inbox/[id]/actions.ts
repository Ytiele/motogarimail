"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { mutateConversation } from "@/lib/conversations";
import { logEvent } from "@/lib/events";
import { isValidEmail, parseAddressList } from "@/lib/mail/address";
import { getActiveConnection, providerFor } from "@/lib/mail/connection";
import { addJunkRule, findSweepable, matchingRules } from "@/lib/mail/junk";
import { canBlockDomain, describeRule, senderDomain, type JunkRule } from "@/lib/mail/junk-rules";
import { buildReferences, replySubject, textToHtml, escapeHtml } from "@/lib/mail/mime";
import { ingestMessage } from "@/lib/mail/sync";
import type { Address, ParsedMessage } from "@/lib/mail/types";
import { notify } from "@/lib/notifications";
import { allow } from "@/lib/rate-limit";
import { adminDb } from "@/lib/supabase/admin";
import type { ActionResult, AppUser, Conversation, EmailRow } from "@/lib/types";
import {
  canSetStatus,
  canViewConversation,
  PRIORITIES,
  startsWork,
  STATUS_LABEL,
  STATUSES,
  statusOnAssign,
  statusOnReply,
  type Status,
} from "@/lib/workflow";

const workClock = (c: Conversation, next: Status): Partial<Conversation> =>
  startsWork(c.status, next) ? { sla_started_at: new Date().toISOString(), is_historical: false } : {};

const uuid = z.string().uuid();

async function actor(): Promise<AppUser> {
  const me = await currentUser();
  if (!me) throw new Error("Your session has expired. Please sign in again.");
  return me;
}

function done(id: string, message?: string): ActionResult {
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true, message };
}

async function userName(id: string | null) {
  if (!id) return null;
  const { data } = await adminDb().from("users").select("name").eq("id", id).maybeSingle();
  return (data?.name as string) ?? null;
}

async function viewError(me: AppUser, id: string): Promise<string | null> {
  const { data } = await adminDb().from("conversations").select("assigned_to").eq("id", id).maybeSingle();
  if (!data) return "Conversation not found.";
  return canViewConversation(me, data.assigned_to as string | null) ? null : "This conversation is assigned to someone else.";
}

async function recordAssignment(conversationId: string, from: string | null, to: string | null, by: string) {
  const db = adminDb();
  if (from) {
    await db.from("email_assignments").update({ unassigned_at: new Date().toISOString() }).eq("conversation_id", conversationId).is("unassigned_at", null);
  }
  if (to) await db.from("email_assignments").insert({ conversation_id: conversationId, user_id: to, assigned_by: by });
}

// ---------------------------------------------------------------------------

/** Records that a user viewed the conversation. Deliberately does NOT change status. */
export async function markOpened(id: string): Promise<void> {
  if (!uuid.safeParse(id).success) return;
  const me = await currentUser();
  if (!me || (await viewError(me, id))) return;
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data } = await adminDb()
    .from("email_events")
    .select("id")
    .eq("conversation_id", id)
    .eq("user_id", me.id)
    .eq("event_type", "email_opened")
    .gte("created_at", since)
    .limit(1);
  await adminDb().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me.id).eq("conversation_id", id).is("read_at", null);
  if (data?.length) return;
  await logEvent({ type: "email_opened", conversationId: id, userId: me.id });
}

export async function claim(id: string): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid conversation." };
    const me = await actor();
    let ownerName: string | null = null;
    const r = await mutateConversation(id, (c) => {
      if (c.assigned_to === me.id) return null;
      if (c.assigned_to) return { error: "already_assigned" };
      if (c.status === "resolved" || c.status === "archived") return { error: "This conversation is closed. Reopen it first." };
      const next = statusOnAssign(c.status, me.id);
      return { assigned_to: me.id, status: next, last_activity_at: new Date().toISOString(), ...workClock(c, next) };
    });
    if (!r.ok) {
      if (r.error === "already_assigned") {
        ownerName = await userName(r.current?.assigned_to ?? null);
        return { ok: false, error: `${ownerName ?? "Someone else"} has already taken this conversation.` };
      }
      return { ok: false, error: r.error };
    }
    if (r.changed) {
      await recordAssignment(id, null, me.id, me.id);
      await logEvent({ type: "email_assigned", conversationId: id, userId: me.id, metadata: { to: me.id, to_name: me.name, self: true } });
      if (r.before.status !== r.after.status) {
        await logEvent({ type: "status_changed", conversationId: id, userId: me.id, metadata: { from: r.before.status, to: r.after.status } });
      }
    }
    return done(id, "Assigned to you.");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function assign(id: string, assigneeId: string | null): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success || (assigneeId !== null && !uuid.safeParse(assigneeId).success)) {
      return { ok: false, error: "Invalid request." };
    }
    const me = await actor();
    let target: { id: string; name: string } | null = null;
    if (assigneeId) {
      const { data } = await adminDb().from("users").select("id, name, is_active").eq("id", assigneeId).maybeSingle();
      if (!data?.is_active) return { ok: false, error: "That staff member is not active." };
      target = { id: data.id, name: data.name };
    }

    const r = await mutateConversation(id, (c) => {
      const isOwner = c.assigned_to === me.id;
      // Staff may only release their own assignment; assigning others is an admin action.
      if (me.role !== "admin" && !(isOwner && assigneeId === null)) {
        return { error: "Only an admin can assign conversations to other people. Use “Assign to me” instead." };
      }
      if (c.assigned_to === assigneeId) return null;
      const next = statusOnAssign(c.status, assigneeId);
      return { assigned_to: assigneeId, status: next, last_activity_at: new Date().toISOString(), ...workClock(c, next) };
    });
    if (!r.ok) return { ok: false, error: r.error };
    if (!r.changed) return done(id);

    const prev = r.before.assigned_to;
    await recordAssignment(id, prev, assigneeId, me.id);
    await logEvent({
      type: assigneeId ? "email_assigned" : "email_unassigned",
      conversationId: id,
      userId: me.id,
      metadata: { from: prev, from_name: await userName(prev), to: assigneeId, to_name: target?.name ?? null },
    });
    if (r.before.status !== r.after.status) {
      await logEvent({ type: "status_changed", conversationId: id, userId: me.id, metadata: { from: r.before.status, to: r.after.status } });
    }
    if (assigneeId) {
      await notify([assigneeId], {
        type: "assigned",
        title: prev ? "Email reassigned to you" : "New email assigned to you",
        body: `${r.after.subject} — by ${me.name}`,
        conversationId: id,
      }, { exclude: me.id });
    }
    if (prev && prev !== assigneeId) {
      await notify([prev], {
        type: "reassigned_away",
        title: assigneeId ? `Reassigned to ${target?.name}` : "You were unassigned",
        body: r.after.subject,
        conversationId: id,
      }, { exclude: me.id });
    }
    return done(id, assigneeId ? `Assigned to ${target?.name}.` : "Unassigned.");
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function statusPatch(c: Conversation, to: Status, me: AppUser): Partial<Conversation> {
  const now = new Date().toISOString();
  const patch: Partial<Conversation> = { status: to, last_activity_at: now };
  if (to === "resolved") {
    patch.resolved_at = now;
    patch.resolved_by = me.id;
  } else if (startsWork(c.status, to)) {
    patch.resolved_at = null;
    patch.resolved_by = null;
    patch.is_historical = false;
    patch.sla_started_at = now;
  }
  return patch;
}

async function applyStatus(id: string, to: Status, me: AppUser): Promise<ActionResult> {
  const r = await mutateConversation(id, (c) => {
    if (me.role !== "admin" && c.assigned_to && c.assigned_to !== me.id) {
      return { error: "Only the assigned owner or an admin can change the status." };
    }
    const check = canSetStatus({ from: c.status, to, role: me.role, hasAssignee: !!c.assigned_to });
    if (!check.ok) return { error: check.reason };
    return statusPatch(c, to, me);
  });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.changed) return { ok: true };
  await logEvent({ type: "status_changed", conversationId: id, userId: me.id, metadata: { from: r.before.status, to } });
  if (to === "resolved") await logEvent({ type: "email_resolved", conversationId: id, userId: me.id });
  return { ok: true, message: `Status changed to ${STATUS_LABEL[to]}.` };
}

export async function setStatus(id: string, to: string): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success || !(STATUSES as readonly string[]).includes(to)) return { ok: false, error: "Invalid request." };
    const me = await actor();
    const r = await applyStatus(id, to as Status, me);
    return r.ok ? done(id, r.message) : r;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Files a conversation as junk. With scope "sender" or "domain" future mail from that sender is
 * filed there automatically, and their other unowned conversations still in New/Updates move too.
 */
export async function markJunk(id: string, scope: string): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success || !["conversation", "sender", "domain"].includes(scope)) return { ok: false, error: "Invalid request." };
    const me = await actor();
    const conn = await getActiveConnection();
    let rule = null as JunkRule | null;
    const r = await mutateConversation(id, (c) => {
      if (me.role !== "admin" && c.assigned_to && c.assigned_to !== me.id) {
        return { error: "Only the assigned owner or an admin can mark this as junk." };
      }
      if (scope !== "conversation") {
        const email = c.customer_email?.toLowerCase() ?? null;
        const domain = senderDomain(email);
        if (!email || !domain) return { error: "This email has no sender address to block." };
        if (scope === "domain" && !canBlockDomain(domain, senderDomain(conn?.email_address))) {
          return { error: `@${domain} is shared by many people, so only this sender can be blocked.` };
        }
        rule = scope === "domain" ? { kind: "domain", value: domain } : { kind: "address", value: email };
      }
      if (c.status === "junk") return null;
      return { status: "junk", assigned_to: null, filed_reason: `Marked as junk by ${me.name}`, last_activity_at: new Date().toISOString() };
    });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.changed) {
      if (r.before.assigned_to) await recordAssignment(id, r.before.assigned_to, null, me.id);
      await logEvent({ type: "status_changed", conversationId: id, userId: me.id, metadata: { from: r.before.status, to: "junk" } });
    }
    if (!rule) return done(id, "Moved to Junk.");

    const blocked: JunkRule = rule;
    await addJunkRule(blocked, me.id, id);
    await logEvent({ type: "junk_sender_added", conversationId: id, userId: me.id, metadata: { kind: blocked.kind, value: blocked.value } });
    let moved = 0;
    for (const other of await findSweepable(blocked, id)) {
      const m = await mutateConversation(other.id, (c) =>
        c.assigned_to || !["new", "no_action"].includes(c.status)
          ? null
          : { status: "junk", filed_reason: `Sender is on the junk list (${describeRule(blocked)})`, last_activity_at: new Date().toISOString() },
      );
      if (m.ok && m.changed) {
        moved++;
        await logEvent({ type: "status_changed", conversationId: other.id, userId: me.id, metadata: { from: m.before.status, to: "junk", rule: blocked.value } });
      }
    }
    revalidatePath("/settings/junk");
    return done(id, `Moved to Junk. Future mail from ${describeRule(blocked)} will go to Junk automatically${moved ? ` (${moved} other conversation(s) moved too)` : ""}.`);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Moves a junk conversation back to the inbox and stops filing this sender's mail as junk. */
export async function notJunk(id: string): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
    const me = await actor();
    const r = await mutateConversation(id, (c) => {
      if (me.role !== "admin" && c.assigned_to && c.assigned_to !== me.id) {
        return { error: "Only the assigned owner or an admin can change this." };
      }
      if (c.status !== "junk") return null;
      const next: Status = c.assigned_to ? "assigned" : "new";
      return { ...statusPatch(c, next, me), filed_reason: null };
    });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.changed) await logEvent({ type: "status_changed", conversationId: id, userId: me.id, metadata: { from: "junk", to: r.after.status } });

    const rules = await matchingRules(r.after.customer_email);
    if (rules.length) {
      await adminDb().from("junk_senders").delete().in("id", rules.map((x) => x.id));
      for (const rule of rules) {
        await logEvent({ type: "junk_sender_removed", conversationId: id, userId: me.id, metadata: { kind: rule.kind, value: rule.value } });
      }
      revalidatePath("/settings/junk");
    }
    const unblocked = rules.length ? ` ${rules.map(describeRule).join(" and ")} removed from the junk list.` : "";
    return done(id, `Moved to the inbox.${unblocked}`);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setPriority(id: string, priority: string): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success || !(PRIORITIES as readonly string[]).includes(priority)) return { ok: false, error: "Invalid request." };
    const me = await actor();
    const r = await mutateConversation(id, (c) => {
      if (me.role !== "admin" && c.assigned_to && c.assigned_to !== me.id) return { error: "Only the owner or an admin can change priority." };
      if (c.priority === priority) return null;
      return { priority: priority as Conversation["priority"], last_activity_at: new Date().toISOString() };
    });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.changed) await logEvent({ type: "priority_changed", conversationId: id, userId: me.id, metadata: { from: r.before.priority, to: priority } });
    return done(id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setCategory(id: string, categoryId: string | null): Promise<ActionResult> {
  try {
    if (!uuid.safeParse(id).success || (categoryId && !uuid.safeParse(categoryId).success)) return { ok: false, error: "Invalid request." };
    const me = await actor();
    let name: string | null = null;
    if (categoryId) {
      const { data } = await adminDb().from("categories").select("name").eq("id", categoryId).maybeSingle();
      if (!data) return { ok: false, error: "Unknown category." };
      name = data.name;
    }
    const r = await mutateConversation(id, (c) => {
      if (!canViewConversation(me, c.assigned_to)) return { error: "This conversation is assigned to someone else." };
      return c.category_id === categoryId ? null : { category_id: categoryId, last_activity_at: new Date().toISOString() };
    });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.changed) await logEvent({ type: "category_changed", conversationId: id, userId: me.id, metadata: { to: categoryId, to_name: name } });
    return done(id);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type FormResult = { ok?: boolean; error?: string; message?: string; nonce?: number } | undefined;

const noteSchema = z.object({ id: uuid, note: z.string().trim().min(1, "Write a note first.").max(10000) });

export async function addNote(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const parsed = noteSchema.safeParse({ id: form.get("id"), note: form.get("note") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const me = await actor();
    const { id, note } = parsed.data;
    const denied = await viewError(me, id);
    if (denied) return { error: denied };
    const { data, error } = await adminDb().from("email_notes").insert({ conversation_id: id, user_id: me.id, note }).select("id").single();
    if (error) return { error: "Could not save the note." };
    await adminDb().from("conversations").update({ last_activity_at: new Date().toISOString() }).eq("id", id);
    await logEvent({ type: "note_added", conversationId: id, userId: me.id, metadata: { note_id: data.id } });
    done(id);
    return { ok: true, message: "Internal note added.", nonce: Date.now() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const replySchema = z.object({
  id: uuid,
  to: z.string().trim().min(3, "Add at least one recipient.").max(2000),
  cc: z.string().trim().max(2000).optional().default(""),
  body: z.string().trim().min(1, "Write a reply first.").max(100_000),
  after: z.enum(["", "waiting", "resolved"]).optional().default(""),
});

function validAddresses(raw: string): Address[] | null {
  const list = parseAddressList(raw);
  return list.every((a) => isValidEmail(a.email)) ? list : null;
}

export async function sendReply(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const parsed = replySchema.safeParse({
      id: form.get("id"),
      to: form.get("to"),
      cc: form.get("cc") ?? "",
      body: form.get("body"),
      after: form.get("after") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const me = await actor();
    const { id, body, after } = parsed.data;
    const to = validAddresses(parsed.data.to);
    const cc = validAddresses(parsed.data.cc);
    if (!to?.length) return { error: "Check the recipient address." };
    if (cc === null) return { error: "Check the CC addresses." };
    if (!(await allow(`reply:${me.id}`, 20, 60))) return { error: "You are sending too quickly. Wait a moment and try again." };

    const db = adminDb();
    const { data: conv } = await db.from("conversations").select("*").eq("id", id).maybeSingle();
    if (!conv) return { error: "Conversation not found." };
    const c = conv as Conversation;
    if (me.role !== "admin" && c.assigned_to && c.assigned_to !== me.id) {
      return { error: `This conversation is assigned to ${(await userName(c.assigned_to)) ?? "someone else"}. Ask them or an admin to reassign it.` };
    }

    const conn = await getActiveConnection();
    if (!conn || conn.status === "disconnected") return { error: "Gmail is not connected. Ask an admin to connect it in Settings." };
    const provider = providerFor(conn);

    const { data: msgs } = await db
      .from("emails")
      .select("*")
      .eq("conversation_id", id)
      .order("received_at", { ascending: false })
      .limit(20);
    const latest = (msgs as EmailRow[] | null)?.[0];
    const lastInbound = (msgs as EmailRow[] | null)?.find((m) => m.direction === "inbound");

    const quoteSource = lastInbound ?? latest;
    const quoteHeader = quoteSource
      ? `On ${new Date(quoteSource.received_at).toUTCString()}, ${quoteSource.sender_name ?? quoteSource.sender_email} wrote:`
      : "";
    const quotedText = quoteSource?.body_text ? quoteSource.body_text.split("\n").map((l) => `> ${l}`).join("\n") : "";
    const text = quotedText ? `${body}\n\n${quoteHeader}\n${quotedText}` : body;
    const html = quotedText
      ? `${textToHtml(body)}<br><div style="color:#555">${escapeHtml(quoteHeader)}</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#555">${escapeHtml(quoteSource!.body_text!).replace(/\n/g, "<br>")}</blockquote>`
      : textToHtml(body);

    const outgoing = {
      from: { name: "Motogari", email: conn.email_address },
      to,
      cc: cc ?? [],
      subject: replySubject(c.subject),
      text,
      html,
      inReplyTo: latest?.message_id ?? null,
      references: buildReferences(latest?.references_header ?? null, latest?.message_id ?? null),
    };

    let sent: { id: string; threadId: string };
    try {
      sent = await provider.send(outgoing, c.gmail_thread_id);
    } catch (e) {
      await db.from("sync_logs").insert({ level: "error", message: "Reply send failed", details: { conversation: id, error: (e as Error).message } });
      return { error: "Gmail rejected the message, so nothing was sent. Check the Gmail connection and try again." };
    }

    let parsedSent: ParsedMessage;
    try {
      parsedSent = await provider.getMessage(sent.id);
    } catch {
      parsedSent = {
        id: sent.id,
        threadId: sent.threadId,
        labelIds: ["SENT"],
        internalDate: new Date().toISOString(),
        messageIdHeader: null,
        inReplyTo: outgoing.inReplyTo,
        references: outgoing.references,
        from: outgoing.from,
        replyTo: null,
        to: parsed.data.to,
        cc: parsed.data.cc || null,
        bcc: null,
        subject: outgoing.subject,
        text,
        html,
        snippet: body.slice(0, 200),
        attachments: [],
      };
    }
    const ingested = await ingestMessage(parsedSent, { mailbox: conn.email_address.toLowerCase(), quiet: true, sentBy: me.id });

    const now = new Date().toISOString();
    // Replying means taking responsibility: an unowned conversation is assigned to the sender.
    const r = await mutateConversation(id, (cur) => {
      const next = statusOnReply(cur.status);
      const patch: Partial<Conversation> = { status: next, last_activity_at: now, ...workClock(cur, next) };
      if (!cur.assigned_to) patch.assigned_to = me.id;
      if (!cur.first_response_at) {
        patch.first_response_at = now;
        patch.first_response_by = me.id;
      }
      return patch;
    });

    await logEvent({
      type: "reply_sent",
      conversationId: id,
      emailId: ingested.emailId,
      userId: me.id,
      metadata: { to: to.map((a) => a.email), cc: (cc ?? []).map((a) => a.email), gmail_message_id: sent.id },
    });
    if (r.ok && r.changed) {
      if (!r.before.assigned_to && r.after.assigned_to === me.id) {
        await recordAssignment(id, null, me.id, me.id);
        await logEvent({ type: "email_assigned", conversationId: id, userId: me.id, metadata: { to: me.id, to_name: me.name, self: true, reason: "replied" } });
      }
      if (r.before.status !== r.after.status) {
        await logEvent({ type: "status_changed", conversationId: id, userId: me.id, metadata: { from: r.before.status, to: r.after.status } });
      }
    }

    let message = "Reply sent from the Motogari mailbox.";
    if (after) {
      const s = await applyStatus(id, after, me);
      message = s.ok ? `${message} ${s.message ?? ""}` : `${message} (Status not changed: ${s.error})`;
    }
    done(id);
    return { ok: true, message, nonce: Date.now() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
