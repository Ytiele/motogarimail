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
  replyTo: uuid.nullable().optional(),
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
  reply_to_id: string | null;
  forwarded: boolean;
  edited_at: string | null;
  deleted_at: string | null;
};

export async function sendChatMessage(input: unknown): Promise<Result<{ message: ChatMessage }>> {
  try {
    const user = await me();
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { to, room, body, attachment, replyTo } = parsed.data;
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
    if (replyTo) {
      // A reply must point at a message in this same conversation.
      const { data: orig } = await db.from("chat_messages").select("sender_id, recipient_id, room_id").eq("id", replyTo).maybeSingle();
      const sameThread = orig && (room ? orig.room_id === room : !orig.room_id && [orig.sender_id, orig.recipient_id].sort().join() === [user.id, to].sort().join());
      if (!sameThread) return { ok: false, error: "The message you are replying to is not in this chat." };
    }
    const { data, error } = await db
      .from("chat_messages")
      .insert({
        sender_id: user.id,
        recipient_id: to ?? null,
        room_id: room ?? null,
        reply_to_id: replyTo ?? null,
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

// --- Message actions -----------------------------------------------------------

type MessageRow = ChatMessage;

async function loadMessage(id: string): Promise<MessageRow | null> {
  const { data } = await adminDb().from("chat_messages").select("*").eq("id", id).maybeSingle();
  return (data as MessageRow) ?? null;
}

async function canRead(m: MessageRow, userId: string) {
  return m.sender_id === userId || m.recipient_id === userId || (!!m.room_id && (await isMember(m.room_id, userId)));
}

/** Only the sender can edit, and only while the message still exists. */
export async function editChatMessage(id: string, body: string): Promise<Result<{ message: ChatMessage }>> {
  try {
    const user = await me();
    const text = z.string().trim().max(4000, "Messages can be at most 4000 characters.").safeParse(body);
    if (!uuid.safeParse(id).success || !text.success) return { ok: false, error: text.success ? "Invalid request." : text.error.issues[0].message };
    const m = await loadMessage(id);
    if (!m || m.sender_id !== user.id) return { ok: false, error: "You can only edit your own messages." };
    if (m.deleted_at) return { ok: false, error: "This message was deleted." };
    if (!text.data && !m.attachment_path) return { ok: false, error: "A message cannot be empty. Delete it instead." };
    const { data, error } = await adminDb()
      .from("chat_messages")
      .update({ body: text.data || null, edited_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    return error || !data ? { ok: false, error: "Could not edit the message." } : { ok: true, message: data as ChatMessage };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Deletes your own message for everyone: text and file are removed, a "deleted" marker stays. */
export async function deleteChatMessage(id: string): Promise<Result<{ message: ChatMessage }>> {
  try {
    const user = await me();
    if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
    const m = await loadMessage(id);
    if (!m || m.sender_id !== user.id) return { ok: false, error: "You can only delete your own messages." };
    const db = adminDb();
    const { data, error } = await db
      .from("chat_messages")
      .update({ body: null, attachment_path: null, attachment_name: null, attachment_type: null, attachment_size: null, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error || !data) return { ok: false, error: "Could not delete the message." };
    // Forwarded copies have their own file, so this one can go.
    if (m.attachment_path) await db.storage.from(CHAT_BUCKET).remove([m.attachment_path]).catch(() => {});
    return { ok: true, message: data as ChatMessage };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const forwardSchema = z.object({
  id: uuid,
  people: z.array(uuid).max(20).default([]),
  rooms: z.array(uuid).max(20).default([]),
});

/** Re-shares a message (with its file) into other chats. Each copy gets its own file and is marked Forwarded. */
export async function forwardChatMessage(input: unknown): Promise<Result<{ messages: ChatMessage[] }>> {
  try {
    const user = await me();
    const parsed = forwardSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid request." };
    const { id, people, rooms } = parsed.data;
    if (!people.length && !rooms.length) return { ok: false, error: "Pick at least one person or group." };
    if (!(await allow(`chat-forward:${user.id}`, 30, 60))) return { ok: false, error: "You are forwarding too quickly. Wait a moment." };
    const m = await loadMessage(id);
    if (!m || !(await canRead(m, user.id))) return { ok: false, error: "Message not found." };
    if (m.deleted_at) return { ok: false, error: "This message was deleted." };

    const db = adminDb();
    const peopleOk = new Set(await activeIds(people.filter((p) => p !== user.id)));
    const roomsOk: string[] = [];
    for (const r of rooms) if (await isMember(r, user.id)) roomsOk.push(r);
    const targets = [...[...peopleOk].map((to) => ({ recipient_id: to, room_id: null })), ...roomsOk.map((room) => ({ recipient_id: null, room_id: room }))];
    if (!targets.length) return { ok: false, error: "None of those chats are available." };

    const sent: ChatMessage[] = [];
    for (const t of targets) {
      let attachment_path: string | null = null;
      if (m.attachment_path) {
        attachment_path = `${user.id}/${randomUUID()}.${safeName(m.attachment_name ?? "file")}`;
        const { error: copyErr } = await db.storage.from(CHAT_BUCKET).copy(m.attachment_path, attachment_path);
        if (copyErr) return { ok: false, error: "Could not copy the file. Please try again." };
      }
      const { data, error } = await db
        .from("chat_messages")
        .insert({
          sender_id: user.id,
          ...t,
          body: m.body,
          attachment_path,
          attachment_name: m.attachment_path ? m.attachment_name : null,
          attachment_type: m.attachment_path ? m.attachment_type : null,
          attachment_size: m.attachment_path ? m.attachment_size : null,
          forwarded: true,
        })
        .select("*")
        .single();
      if (error || !data) return { ok: false, error: "Could not forward the message." };
      sent.push(data as ChatMessage);
    }
    return { ok: true, messages: sent };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** "Delete conversation" for a 1:1 chat: hides everything so far for you only; the other person keeps theirs. */
export async function clearChatConversation(peerId: string): Promise<Result<{ clearedAt: string }>> {
  try {
    const user = await me();
    if (!uuid.safeParse(peerId).success || peerId === user.id) return { ok: false, error: "Invalid request." };
    const clearedAt = new Date().toISOString();
    const db = adminDb();
    const { error } = await db.from("chat_clears").upsert({ user_id: user.id, peer_id: peerId, cleared_at: clearedAt });
    if (error) return { ok: false, error: "Could not delete the conversation." };
    await db.from("chat_messages").update({ read_at: clearedAt }).eq("recipient_id", user.id).eq("sender_id", peerId).is("read_at", null);
    return { ok: true, clearedAt };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Deletes a group and all its messages and files for everyone. Allowed for whoever created it, or an admin member. */
export async function deleteChatGroup(roomId: string): Promise<Result> {
  try {
    const user = await me();
    if (!uuid.safeParse(roomId).success) return { ok: false, error: "Invalid request." };
    const db = adminDb();
    const { data: room } = await db.from("chat_rooms").select("created_by").eq("id", roomId).maybeSingle();
    if (!room) return { ok: false, error: "Group not found." };
    if (!(await isMember(roomId, user.id)) || (room.created_by !== user.id && user.role !== "admin")) {
      return { ok: false, error: "Only the person who created the group, or an admin, can delete it. You can leave it instead." };
    }
    const { data: files } = await db.from("chat_messages").select("attachment_path").eq("room_id", roomId).not("attachment_path", "is", null);
    const { error } = await db.from("chat_rooms").delete().eq("id", roomId);
    if (error) return { ok: false, error: "Could not delete the group." };
    const paths = (files ?? []).map((f) => f.attachment_path as string);
    for (let i = 0; i < paths.length; i += 100) await db.storage.from(CHAT_BUCKET).remove(paths.slice(i, i + 100)).catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
