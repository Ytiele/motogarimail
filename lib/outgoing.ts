import "server-only";
import { randomUUID } from "node:crypto";
import { adminDb } from "./supabase/admin";

// Files attached to replies are staged in a private bucket: the browser uploads with one-time signed
// URLs, the server reads them when sending, then deletes them. Gmail's own limit is 25 MB per message.
export const OUTGOING_BUCKET = "outgoing";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, "");
const safeName = (name: string) => name.replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, ".").replace(/^[._]+/, "").slice(-120) || "file";

/** <yyyymmdd>/<userId>.<uuid>.<name> — the user id in the path proves who uploaded it. */
export function stagingPath(userId: string, filename: string) {
  return `${dayKey()}/${userId}.${randomUUID()}.${safeName(filename)}`;
}

export function ownsStagingPath(userId: string, path: string) {
  const prefix = `${userId}.`;
  const [day, file, ...rest] = path.split("/");
  return rest.length === 0 && /^\d{8}$/.test(day ?? "") && !!file?.startsWith(prefix) && /^[0-9a-f-]{36}\.[\w.-]+$/.test(file.slice(prefix.length));
}

export async function createUploadUrls(userId: string, names: string[]) {
  const bucket = adminDb().storage.from(OUTGOING_BUCKET);
  return Promise.all(
    names.map(async (name) => {
      const path = stagingPath(userId, name);
      const { data, error } = await bucket.createSignedUploadUrl(path);
      if (error || !data) throw new Error("Could not prepare the upload. Please try again.");
      return { path, token: data.token };
    }),
  );
}

export async function downloadStaged(path: string): Promise<Buffer> {
  const { data, error } = await adminDb().storage.from(OUTGOING_BUCKET).download(path);
  if (error || !data) throw new Error("An attachment is missing. Remove it and attach it again.");
  return Buffer.from(await data.arrayBuffer());
}

export async function removeStaged(paths: string[]) {
  if (paths.length) await adminDb().storage.from(OUTGOING_BUCKET).remove(paths);
}

/** Deletes uploads from replies that were never sent (anything staged before yesterday). */
export async function cleanupStaged() {
  const bucket = adminDb().storage.from(OUTGOING_BUCKET);
  const cutoff = dayKey(new Date(Date.now() - 86400_000));
  const { data: days } = await bucket.list("", { limit: 100 });
  let removed = 0;
  for (const d of days ?? []) {
    if (!/^\d{8}$/.test(d.name) || d.name >= cutoff) continue;
    const { data: files } = await bucket.list(d.name, { limit: 1000 });
    const paths = (files ?? []).map((f) => `${d.name}/${f.name}`);
    await removeStaged(paths);
    removed += paths.length;
  }
  return removed;
}
