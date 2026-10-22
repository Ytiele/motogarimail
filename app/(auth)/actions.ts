"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { hasAnyUser } from "@/lib/bootstrap";
import { env } from "@/lib/env";
import { consumeInvite, findValidInvite } from "@/lib/invites";
import { isPhoneLoginEmail, normalizePhone, phoneLoginEmail } from "@/lib/phone";
import { allow, clientIp } from "@/lib/rate-limit";
import { adminDb } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; message?: string } | undefined;

function safeNext(next: unknown) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/dashboard";
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or phone number").max(254),
  password: z.string().min(1, "Enter your password").max(200),
});

/** Staff sign in with their email, or — if they have no company email — their phone number. */
function loginEmail(identifier: string): string | null {
  if (identifier.includes("@")) {
    const e = z.string().toLowerCase().email().safeParse(identifier);
    return e.success ? e.data : null;
  }
  const phone = normalizePhone(identifier);
  return phone ? phoneLoginEmail(phone) : null;
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ identifier: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const email = loginEmail(parsed.data.identifier);
  if (!email) return { error: "Enter a valid email address or phone number." };
  const { password } = parsed.data;

  const ip = await clientIp();
  if (!(await allow(`login:ip:${ip}`, 20, 900)) || !(await allow(`login:email:${email}`, 8, 900))) {
    return { error: "Too many sign-in attempts. Please wait 15 minutes and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Incorrect sign-in details or password." };

  const { data: profile } = await adminDb().from("users").select("is_active").eq("id", data.user.id).maybeSingle();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "This account is not active. Contact your administrator." };
  }
  await adminDb().from("users").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id);
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const raw = String(form.get("email") ?? "").trim();
  if (raw && !raw.includes("@") && normalizePhone(raw)) {
    return { error: "Phone sign-in accounts are reset by your administrator: ask them for a new set-up link (Settings → Staff)." };
  }
  const parsed = z.string().trim().toLowerCase().email().max(254).safeParse(raw);
  if (!parsed.success || isPhoneLoginEmail(parsed.data)) return { error: "Enter a valid email address." };
  const ip = await clientIp();
  if (!(await allow(`reset:ip:${ip}`, 5, 3600)) || !(await allow(`reset:email:${parsed.data}`, 3, 3600))) {
    return { error: "Too many reset requests. Please try again later." };
  }
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${env.appUrl()}/auth/callback?next=/auth/reset-password`,
  });
  // Same response whether or not the account exists, to avoid leaking which emails are registered.
  return { message: "If that email belongs to a Motogari account, a reset link is on its way." };
}

const passwordSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export async function updatePassword(_: FormState, form: FormData): Promise<FormState> {
  const parsed = passwordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };
  return { message: "Password updated." };
}

const setupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export async function createFirstAdmin(_: FormState, form: FormData): Promise<FormState> {
  const parsed = setupSchema.safeParse({ name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await allow(`setup:${await clientIp()}`, 5, 3600))) return { error: "Too many attempts." };
  if (await hasAnyUser()) return { error: "Setup has already been completed. Sign in instead." };

  const db = adminDb();
  // Unique key insert acts as a one-time lock so two simultaneous setups cannot both succeed.
  const { error: lockErr } = await db.from("app_settings").insert({ key: "bootstrap_lock", value: true });
  if (lockErr) return { error: "Setup has already been completed. Sign in instead." };

  const { name, email, password } = parsed.data;
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error || !data.user) {
    await db.from("app_settings").delete().eq("key", "bootstrap_lock");
    return { error: error?.message ?? "Could not create account." };
  }
  const { error: profileErr } = await db.from("users").insert({ id: data.user.id, name, email, role: "admin", department: "Management" });
  if (profileErr) return { error: profileErr.message };

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email, password });
  redirect("/settings");
}

/** Completes a one-time set-up link: the staff member chooses their own password and is signed in. */
export async function completeInvite(_: FormState, form: FormData): Promise<FormState> {
  const parsed = passwordSchema.safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await allow(`invite:${await clientIp()}`, 10, 3600))) return { error: "Too many attempts. Please try again later." };

  const invite = await findValidInvite(String(form.get("token") ?? ""));
  if (!invite) return { error: "This link has expired or was already used. Ask your administrator for a new one." };
  if (!(await consumeInvite(invite.inviteId))) return { error: "This link was already used. Ask your administrator for a new one." };

  const db = adminDb();
  const { error } = await db.auth.admin.updateUserById(invite.userId, { password: parsed.data.password });
  if (error) {
    // Give the link back so they can try again.
    await db.from("staff_invites").update({ used_at: null }).eq("id", invite.inviteId);
    return { error: "Could not save your password. Please try again." };
  }
  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: invite.email, password: parsed.data.password });
  await db.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", invite.userId);
  redirect("/dashboard");
}
