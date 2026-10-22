"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormResult } from "@/components/ActionForm";
import { currentUser } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/events";
import { createInviteLink } from "@/lib/invites";
import { getActiveConnection } from "@/lib/mail/connection";
import { revokeToken } from "@/lib/mail/gmail";
import { addJunkRule } from "@/lib/mail/junk";
import { canBlockDomain, describeRule, parseJunkPattern, senderDomain } from "@/lib/mail/junk-rules";
import { injectMockInbound, MOCK_MAILBOX_ADDRESS } from "@/lib/mail/mock";
import { runSync } from "@/lib/mail/sync";
import { normalizePhone, phoneLoginEmail, whatsappLink } from "@/lib/phone";
import { adminDb } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/types";
import { PRIORITIES } from "@/lib/workflow";

async function admin(): Promise<AppUser> {
  const me = await currentUser();
  if (!me || me.role !== "admin") throw new Error("Only admins can do this.");
  return me;
}

function fail(e: unknown): FormResult {
  return { error: (e as Error).message || "Something went wrong." };
}

function tempPassword() {
  return randomBytes(12).toString("base64url");
}

// --- Staff -----------------------------------------------------------------

const staffSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  role: z.enum(["admin", "staff"]),
  department: z.string().trim().max(100).optional(),
});

function inviteMessage(name: string, url: string) {
  return `Hi ${name.split(/\s+/)[0]}, you have been added to the Motogari team inbox. Open this link to choose your password (valid for 7 days): ${url}`;
}

/** Staff without a company email: name + phone. They choose their own password through a one-time link. */
async function createPhoneStaff(me: AppUser, form: FormData): Promise<FormResult> {
  const parsed = staffSchema.omit({ email: true }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  if (!phone) return { error: "Enter a valid phone number, e.g. 0712 345 678 or +254 712 345 678." };
  const { name, role, department } = parsed.data;
  const db = adminDb();
  const { data: taken } = await db.from("users").select("id").eq("phone", phone).maybeSingle();
  if (taken) return { error: "A staff member with that phone number already exists." };

  const email = phoneLoginEmail(phone);
  // Random password nobody knows; the staff member replaces it through the set-up link.
  const { data, error } = await db.auth.admin.createUser({ email, password: randomBytes(32).toString("base64url"), email_confirm: true, user_metadata: { name, phone } });
  if (error || !data.user) return { error: error?.message.includes("already") ? "A staff member with that phone number already exists." : (error?.message ?? "Could not create the account.") };
  const { error: pErr } = await db.from("users").insert({ id: data.user.id, name, email, phone, role, department: department || null });
  if (pErr) {
    await db.auth.admin.deleteUser(data.user.id);
    return { error: "Could not create the staff profile." };
  }
  const invite = await createInviteLink(data.user.id, me.id);
  await logEvent({ type: "staff_created", userId: me.id, metadata: { staff_id: data.user.id, name, role, sign_in: "phone" } });
  revalidatePath("/settings/staff");
  return {
    ok: true,
    message: `${name} was added. Send them this link so they can choose their password.`,
    link: invite.url,
    whatsapp: whatsappLink(phone, inviteMessage(name, invite.url)),
    nonce: Date.now(),
  };
}

export async function createStaff(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    if (form.get("method") === "phone") return await createPhoneStaff(me, form);
    const parsed = staffSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { name, email, role, department } = parsed.data;
    const db = adminDb();
    const password = tempPassword();
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (error || !data.user) return { error: error?.message.includes("already") ? "An account with that email already exists." : (error?.message ?? "Could not create the account.") };
    const { error: pErr } = await db.from("users").insert({ id: data.user.id, name, email, role, department: department || null });
    if (pErr) {
      await db.auth.admin.deleteUser(data.user.id);
      return { error: "Could not create the staff profile." };
    }
    await logEvent({ type: "staff_created", userId: me.id, metadata: { staff_id: data.user.id, name, role } });
    revalidatePath("/settings/staff");
    return { ok: true, message: `${name} can now sign in.`, secret: password, nonce: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function updateStaff(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const id = z.string().uuid().parse(form.get("id"));
    const parsed = staffSchema.omit({ email: true }).safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (id === me.id && parsed.data.role !== "admin") return { error: "You cannot remove your own admin role." };
    await adminDb().from("users").update({ name: parsed.data.name, role: parsed.data.role, department: parsed.data.department || null }).eq("id", id);
    await logEvent({ type: "staff_updated", userId: me.id, metadata: { staff_id: id, role: parsed.data.role } });
    revalidatePath("/settings/staff");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

export async function setStaffActive(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const id = z.string().uuid().parse(form.get("id"));
    const active = form.get("active") === "true";
    if (id === me.id) return { error: "You cannot deactivate your own account." };
    const db = adminDb();
    const { error } = await db.auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" });
    if (error) return { error: error.message };
    await db.from("users").update({ is_active: active }).eq("id", id);

    let released = 0;
    if (!active) {
      // Nothing may silently stall with an inactive owner: hand their open work back to the shared queue.
      const { data: open } = await db
        .from("conversations")
        .update({ assigned_to: null, status: "new" })
        .eq("assigned_to", id)
        .in("status", ["new", "assigned", "in_progress", "waiting"])
        .select("id");
      released = open?.length ?? 0;
      for (const c of open ?? []) {
        await db.from("email_assignments").update({ unassigned_at: new Date().toISOString() }).eq("conversation_id", c.id).is("unassigned_at", null);
        await logEvent({ type: "email_unassigned", conversationId: c.id, userId: me.id, metadata: { from: id, reason: "staff_deactivated" } });
      }
    }
    await logEvent({ type: active ? "staff_reactivated" : "staff_deactivated", userId: me.id, metadata: { staff_id: id, released } });
    revalidatePath("/settings/staff");
    return { ok: true, message: active ? "Reactivated." : `Deactivated. ${released} open conversation(s) returned to Unassigned.` };
  } catch (e) {
    return fail(e);
  }
}

export async function resetStaffPassword(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const id = z.string().uuid().parse(form.get("id"));
    const { data: staff } = await adminDb().from("users").select("name, phone").eq("id", id).maybeSingle();
    if (staff?.phone) {
      // Phone staff have no inbox for a temporary password; give them a fresh link to choose a new one.
      const invite = await createInviteLink(id, me.id);
      await logEvent({ type: "staff_updated", userId: me.id, metadata: { staff_id: id, action: "setup_link" } });
      return {
        ok: true,
        message: "New set-up link created. Any earlier link no longer works.",
        link: invite.url,
        whatsapp: whatsappLink(staff.phone, inviteMessage(staff.name, invite.url)),
        nonce: Date.now(),
      };
    }
    const password = tempPassword();
    const { error } = await adminDb().auth.admin.updateUserById(id, { password });
    if (error) return { error: error.message };
    await logEvent({ type: "staff_updated", userId: me.id, metadata: { staff_id: id, action: "password_reset" } });
    return { ok: true, secret: password, nonce: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

// --- Categories ------------------------------------------------------------

const categorySchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Enter a name").max(50),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Pick a colour"),
  is_active: z.enum(["true", "false"]).optional(),
});

export async function saveCategory(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const parsed = categorySchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { id, name, color, is_active } = parsed.data;
    const db = adminDb();
    const row = { name, color, is_active: is_active !== "false" };
    const { error } = id
      ? await db.from("categories").update(row).eq("id", id)
      : await db.from("categories").insert({ ...row, sort_order: 100 });
    if (error) return { error: error.code === "23505" ? "A category with that name already exists." : "Could not save." };
    await logEvent({ type: "settings_changed", userId: me.id, metadata: { area: "categories", name } });
    revalidatePath("/settings/categories");
    return { ok: true, message: "Saved.", nonce: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

// --- SLA & general -----------------------------------------------------------

export async function saveSla(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const db = adminDb();
    const rows = PRIORITIES.map((p) => ({
      priority: p,
      resolution_minutes: Math.round(Number(form.get(`${p}_hours`)) * 60),
      warn_before_minutes: Math.round(Number(form.get(`${p}_warn`))),
    }));
    for (const r of rows) {
      if (!Number.isFinite(r.resolution_minutes) || r.resolution_minutes < 5 || r.resolution_minutes > 60 * 24 * 60) {
        return { error: `Enter a valid number of hours for ${r.priority}.` };
      }
      if (!Number.isFinite(r.warn_before_minutes) || r.warn_before_minutes < 0 || r.warn_before_minutes >= r.resolution_minutes) {
        return { error: `The warning for ${r.priority} must be shorter than its SLA.` };
      }
    }
    const { error } = await db.from("sla_rules").upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })));
    if (error) return { error: "Could not save SLA rules." };
    await db.rpc("recompute_sla");
    await db.from("app_settings").upsert({ key: "import_as_active", value: form.get("import_as_active") === "on" });
    await logEvent({ type: "settings_changed", userId: me.id, metadata: { area: "sla", rows } });
    revalidatePath("/settings/sla");
    return { ok: true, message: "Saved. Due dates on open conversations were recalculated." };
  } catch (e) {
    return fail(e);
  }
}

export async function completeOnboarding(): Promise<void> {
  await admin();
  await adminDb().from("app_settings").upsert({ key: "onboarding_complete", value: true });
  revalidatePath("/settings");
}

// --- Gmail -----------------------------------------------------------------

export async function syncNow(_: FormResult): Promise<FormResult> {
  try {
    await admin();
    const r = await runSync({ timeBudgetMs: 50_000 });
    revalidatePath("/", "layout");
    switch (r.status) {
      case "ok":
        return { ok: true, message: `Sync complete. ${r.imported} new message(s).` };
      case "partial":
        return { ok: true, message: `Imported ${r.imported} message(s); more remaining — it will continue automatically.` };
      case "skipped":
        return { ok: true, message: r.message };
      case "no_connection":
        return { error: "No mailbox is connected." };
      default:
        return { error: r.message ?? "Sync failed." };
    }
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectMailbox(_: FormResult): Promise<FormResult> {
  try {
    const me = await admin();
    const conn = await getActiveConnection();
    if (!conn) return { error: "Nothing is connected." };
    if (conn.encrypted_refresh_token) {
      try {
        await revokeToken(decrypt(conn.encrypted_refresh_token));
      } catch {}
    }
    await adminDb()
      .from("mail_connections")
      .update({ is_active: false, status: "disconnected", encrypted_access_token: null, encrypted_refresh_token: null })
      .eq("id", conn.id);
    await logEvent({ type: "gmail_disconnected", userId: me.id, metadata: { mailbox: conn.email_address } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Disconnected. Existing conversations are kept." };
  } catch (e) {
    return fail(e);
  }
}

export async function connectMockMailbox(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    if (env.mailProvider() !== "mock") return { error: "The development mailbox is only available when MAIL_PROVIDER=mock." };
    if (await getActiveConnection()) return { error: "A mailbox is already connected." };
    const window = Number(form.get("window"));
    await adminDb().from("mail_connections").insert({
      provider: "mock",
      email_address: MOCK_MAILBOX_ADDRESS,
      import_window_days: [7, 30, 90, 365].includes(window) ? window : 30,
      connected_by: me.id,
    });
    await logEvent({ type: "gmail_connected", userId: me.id, metadata: { mailbox: MOCK_MAILBOX_ADDRESS, provider: "mock" } });
    await runSync();
    revalidatePath("/", "layout");
    return { ok: true, message: "Development mailbox connected." };
  } catch (e) {
    return fail(e);
  }
}

const simulateSchema = z.object({
  fromName: z.string().trim().min(1).max(100),
  fromEmail: z.string().trim().email(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  threadId: z.string().trim().max(100).optional(),
});

export async function simulateInbound(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    await admin();
    if (env.mailProvider() !== "mock") return { error: "Only available with MAIL_PROVIDER=mock." };
    const conn = await getActiveConnection();
    if (conn?.provider !== "mock") return { error: "Connect the development mailbox first." };
    const parsed = simulateSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "Fill in every field with valid values." };
    let inReplyTo: string | null = null;
    if (parsed.data.threadId) {
      const { data } = await adminDb()
        .from("emails")
        .select("message_id")
        .eq("gmail_thread_id", parsed.data.threadId)
        .order("received_at", { ascending: false })
        .limit(1);
      inReplyTo = (data?.[0]?.message_id as string) ?? null;
    }
    await injectMockInbound({ ...parsed.data, threadId: parsed.data.threadId || null, inReplyTo, withAttachment: form.get("attachment") === "on" });
    const r = await runSync();
    revalidatePath("/", "layout");
    return { ok: true, message: `Delivered to the development mailbox and synced (${r.imported} new).`, nonce: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

// --- Junk senders ------------------------------------------------------------

export async function addJunkSender(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const rule = parseJunkPattern(String(form.get("pattern") ?? ""));
    if (!rule) return { error: "Enter an email address (name@company.com) or a domain (@company.com)." };
    const conn = await getActiveConnection();
    if (rule.kind === "domain" && !canBlockDomain(rule.value, senderDomain(conn?.email_address))) {
      return { error: `@${rule.value} is shared by many people. Block individual addresses instead.` };
    }
    await addJunkRule(rule, me.id);
    await logEvent({ type: "junk_sender_added", userId: me.id, metadata: { kind: rule.kind, value: rule.value } });
    revalidatePath("/settings/junk");
    return { ok: true, message: `Future mail from ${describeRule(rule)} will go to Junk.`, nonce: Date.now() };
  } catch (e) {
    return fail(e);
  }
}

export async function removeJunkSender(_: FormResult, form: FormData): Promise<FormResult> {
  try {
    const me = await admin();
    const id = z.string().uuid().parse(form.get("id"));
    const { data } = await adminDb().from("junk_senders").delete().eq("id", id).select("kind, value");
    const row = data?.[0];
    if (row) await logEvent({ type: "junk_sender_removed", userId: me.id, metadata: { kind: row.kind, value: row.value } });
    revalidatePath("/settings/junk");
    return { ok: true, message: "Removed." };
  } catch (e) {
    return fail(e);
  }
}
