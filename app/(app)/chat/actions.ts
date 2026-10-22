"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import { adminDb } from "@/lib/supabase/admin";

const CHAT_BUCKET = "chat";
const MAX_FILE = 25 * 1024 * 1024;
const uuid = z.string().uuid();
const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[._]+/, "").slice(-120) || "file";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function me() {
  const user = await currentUser();
  if (!user) throw new Error("Your session has expired. Please sign in again.");
  return user;
}

/** One-time upload URL for a chat file; the uploader's id in the path proves who uploaded it. */
export async function prepareChatUpload(name: string, size: number): Promise<Result<{ path: string; token: string }>> {
  try {
    const user = await me();
    if (typeof name !== "string" || typeof size !== "number" || size <= 0) return { ok: false, error: "Invalid file." };
    if (size > MAX_FILE) return { ok: false, error: "Files can be at most 25 MB." };
    if (!(await allow(`chat-upload:${user.id}`, 60, 600))) return { ok: false, error: "Too many uploads. Wait a moment." };
    const path = `${user.id}/${randomUUID()}.${safeName(name)}`;
    const { data, error } = await adminDb().storage.from(CHAT_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: "Could not prepare the upload." };
    return { ok: true, path, token: data.token };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const sendSchema = z.object({
  to: uuid.optional(),
  room: uuid.optional(),
  body: z.string().trim().max(4000, "Messages can be at most 4000 characters.").optional().default(""),
  attachment: z
    .object({ path: z.string().max(300), name: z.string().trim().min(1).max(200), type: z.string().max(150), size: z.number().int().positive().max(MAX_FILE) })
    .nullable()
    .optional(),
});

export type ChatMessage = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  room_id: string | null;
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  created_at: string;
  read_at: string | null;
};

export async function sendChatMessage(input: unknown): Promise<Result<{ message: ChatMessage }>> {
  try {
    const user = await me();
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { to, room, body, attachment } = parsed.data;
    if (!to === !room) return { ok: false, error: "Invalid request." };
    if (to === user.id) return { ok: false, error: "Pick someone else to chat with." };
    if (!body && !attachment) return { ok: false, error: "Write a message first." };
    if (attachment && !attachment.path.startsWith(`${user.id}/`)) return { ok: false, error: "That file could not be verified. Attach it again." };
    if (!(await allow(`chat:${user.id}`, 60, 60))) return { ok: false, error: "You are sending too quickly. Wait a moment." };

    const db = adminDb();
    if (to) {
      const { data: peer } = await db.from("users").select("is_active").eq("id", to).maybeSingle();
      if (!peer?.is_active) return { ok: false, error: "That person is not an active staff member." };
    } else if (!(await isMember(room!, user.id))) {
      return { ok: false, error: "You are not in this group." };
    }
    const { data, error } = await db
      .from("chat_messages")
      .insert({
        sender_id: user.id,
        recipient_id: to ?? null,
        room_id: room ?? null,
        body: body || null,
        attachment_path: attachment?.path ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_type: attachment && /^[\w.+-]+\/[\w.+-]+$/.test(attachment.type) ? attachment.type : attachment ? "application/octet-stream" : null,
        attachment_size: attachment?.size ?? null,
      })
      .select("*")
      .single();
    if (error || !data) return { ok: false, error: "Could not send the message." };
    return { ok: true, message: data as ChatMessage };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Marks everything this peer sent me as read. */
export async function markChatRead(peerId: string): Promise<void> {
  if (!uuid.safeParse(peerId).success) return;
  const user = await currentUser();
  if (!user) return;
  await adminDb().from("chat_messages").update({ read_at: new Date().toISOString() }).eq("recipient_id", user.id).eq("sender_id", peerId).is("read_at", null);
}

// --- Group chats -------------------------------------------------------------

async function isMember(roomId: string, userId: string) {
  const { data } = await adminDb().from("chat_room_members").select("user_id").eq("room_id", roomId).eq("user_id", userId).maybeSingle();
  return !!data;
}

const groupName = z.string().trim().min(1, "Give the group a name.").max(80, "Keep the name under 80 characters.");
const memberIds = z.array(uuid).min(1, "Pick at least one person.").max(100);

async function activeIds(ids: string[]) {
  const { data } = await adminDb().from("users").select("id").in("id", ids).eq("is_active", true);
  return (data ?? []).map((u) => u.id as string);
}

export type ChatRoom = { id: string; name: string; created_by: string | null; created_at: string };

/** Anyone can start a group; the creator is always a member. */
export async function createChatGroup(name: string, members: string[]): Promise<Result<{ room: ChatRoom }>> {
  try {
    const user = await me();
    const n = groupName.safeParse(name);
    if (!n.success) return { ok: false, error: n.error.issues[0].message };
    const m = memberIds.safeParse(members);
    if (!m.success) return { ok: false, error: m.error.issues[0].message };
    if (!(await allow(`chat-group:${user.id}`, 20, 600))) return { ok: false, error: "Too many groups created. Wait a moment." };
    const ids = [...new Set([user.id, ...(await activeIds(m.data.filter((id) => id !== user.id)))])];
    if (ids.length < 2) return { ok: false, error: "Pick at least one active staff member." };
    const db = adminDb();
    const { data: room, error } = await db.from("chat_rooms").insert({ name: n.data, created_by: user.id }).select("*").single();
    if (error || !room) return { ok: false, error: "Could not create the group." };
    const { error: mErr } = await db.from("chat_room_members").insert(ids.map((id) => ({ room_id: room.id, user_id: id })));
    if (mErr) {
      await db.from("chat_rooms").delete().eq("id", room.id);
      return { ok: false, error: "Could not add the members." };
    }
    return { ok: true, room: room as ChatRoom };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Any member can add colleagues. New members see the whole history, like in most team chats. */
export async function addChatMembers(roomId: string, members: string[]): Promise<Result> {
  try {
    const user = await me();
    if (!uuid.safeParse(roomId).success) return { ok: false, error: "Invalid request." };
    const m = memberIds.safeParse(members);
    if (!m.success) return { ok: false, error: m.error.issues[0].message };
    if (!(await isMember(roomId, user.id))) return { ok: false, error: "You are not in this group." };
    const ids = await activeIds(m.data);
    if (!ids.length) return { ok: false, error: "Pick at least one active staff member." };
    const { error } = await adminDb().from("chat_room_members").upsert(ids.map((id) => ({ room_id: roomId, user_id: id })), { onConflict: "room_id,user_id", ignoreDuplicates: true });
    return error ? { ok: false, error: "Could not add them." } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function renameChatGroup(roomId: string, name: string): Promise<Result> {
  try {
    const user = await me();
    const n = groupName.safeParse(name);
    if (!uuid.safeParse(roomId).success || !n.success) return { ok: false, error: n.success ? "Invalid request." : n.error.issues[0].message };
    if (!(await isMember(roomId, user.id))) return { ok: false, error: "You are not in this group." };
    const { error } = await adminDb().from("chat_rooms").update({ name: n.data }).eq("id", roomId);
    return error ? { ok: false, error: "Could not rename the group." } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Leaving removes access to the group. The last person out deletes it. */
export async function leaveChatGroup(roomId: string): Promise<Result> {
  try {
    const user = await me();
    if (!uuid.safeParse(roomId).success) return { ok: false, error: "Invalid request." };
    const db = adminDb();
    await db.from("chat_room_members").delete().eq("room_id", roomId).eq("user_id", user.id);
    const { count } = await db.from("chat_room_members").select("user_id", { count: "exact", head: true }).eq("room_id", roomId);
    if (!count) await db.from("chat_rooms").delete().eq("id", roomId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function markRoomRead(roomId: string): Promise<void> {
  if (!uuid.safeParse(roomId).success) return;
  const user = await currentUser();
  if (!user) return;
  await adminDb().from("chat_room_members").update({ last_read_at: new Date().toISOString() }).eq("room_id", roomId).eq("user_id", user.id);
}
