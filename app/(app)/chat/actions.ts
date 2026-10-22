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
  to: uuid,
  body: z.string().trim().max(4000, "Messages can be at most 4000 characters.").optional().default(""),
  attachment: z
    .object({ path: z.string().max(300), name: z.string().trim().min(1).max(200), type: z.string().max(150), size: z.number().int().positive().max(MAX_FILE) })
    .nullable()
    .optional(),
});

export type ChatMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
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
    const { to, body, attachment } = parsed.data;
    if (to === user.id) return { ok: false, error: "Pick someone else to chat with." };
    if (!body && !attachment) return { ok: false, error: "Write a message first." };
    if (attachment && !attachment.path.startsWith(`${user.id}/`)) return { ok: false, error: "That file could not be verified. Attach it again." };
    if (!(await allow(`chat:${user.id}`, 60, 60))) return { ok: false, error: "You are sending too quickly. Wait a moment." };

    const db = adminDb();
    const { data: peer } = await db.from("users").select("is_active").eq("id", to).maybeSingle();
    if (!peer?.is_active) return { ok: false, error: "That person is not an active staff member." };
    const { data, error } = await db
      .from("chat_messages")
      .insert({
        sender_id: user.id,
        recipient_id: to,
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
