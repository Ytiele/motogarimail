import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { env } from "./env";
import { adminDb } from "./supabase/admin";

const INVITE_DAYS = 7;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a fresh one-time set-up link for a staff member, cancelling any earlier unused ones. */
export async function createInviteLink(userId: string, createdBy: string): Promise<{ url: string; expiresAt: string }> {
  const db = adminDb();
  await db.from("staff_invites").delete().eq("user_id", userId).is("used_at", null);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86400_000).toISOString();
  const { error } = await db.from("staff_invites").insert({ user_id: userId, token_hash: hashInviteToken(token), created_by: createdBy, expires_at: expiresAt });
  if (error) throw new Error("Could not create the set-up link.");
  return { url: `${env.appUrl()}/join/${token}`, expiresAt };
}

export type InviteLookup = { inviteId: string; userId: string; name: string; phone: string | null; email: string };

/** Valid = exists, unused, not expired, and the account is still active. */
export async function findValidInvite(token: string): Promise<InviteLookup | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const { data } = await adminDb()
    .from("staff_invites")
    .select("id, user_id, expires_at, used_at, users!staff_invites_user_id_fkey(name, phone, email, is_active)")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  const u = data?.users as unknown as { name: string; phone: string | null; email: string; is_active: boolean } | undefined;
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now() || !u?.is_active) return null;
  return { inviteId: data.id, userId: data.user_id, name: u.name, phone: u.phone, email: u.email };
}

/** Marks the invite used. Returns false if someone else used it first (link opened twice). */
export async function consumeInvite(inviteId: string): Promise<boolean> {
  const { data } = await adminDb()
    .from("staff_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  return !!data?.length;
}
