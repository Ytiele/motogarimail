import "server-only";
import { adminDb } from "../supabase/admin";
import { GmailProvider } from "./gmail";
import { MockMailProvider } from "./mock";
import type { MailProvider } from "./types";

export type MailConnection = {
  id: string;
  provider: "gmail" | "mock";
  email_address: string;
  encrypted_refresh_token: string | null;
  encrypted_access_token: string | null;
  access_token_expires_at: string | null;
  history_id: string | null;
  watch_expiration: string | null;
  status: "connected" | "error" | "disconnected";
  import_window_days: number;
  initial_import_done: boolean;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
};

// Fields that are safe to show admins in the UI. Never includes tokens.
export type PublicConnection = Pick<
  MailConnection,
  "id" | "provider" | "email_address" | "status" | "import_window_days" | "initial_import_done" | "last_sync_at" | "last_success_at" | "last_error" | "last_error_at" | "watch_expiration" | "created_at"
>;

export async function getActiveConnection(): Promise<MailConnection | null> {
  const { data, error } = await adminDb().from("mail_connections").select("*").eq("is_active", true).maybeSingle();
  if (error) throw error;
  return (data as MailConnection) ?? null;
}

export async function getPublicConnection(): Promise<PublicConnection | null> {
  const c = await getActiveConnection();
  if (!c) return null;
  const { encrypted_access_token: _a, encrypted_refresh_token: _r, access_token_expires_at: _e, history_id: _h, ...safe } = c;
  return safe;
}

export function providerFor(conn: MailConnection): MailProvider {
  return conn.provider === "mock" ? new MockMailProvider() : new GmailProvider(conn);
}
