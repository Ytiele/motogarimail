import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let client: SupabaseClient | null = null;

// Service-role client: bypasses RLS. Only call after an explicit authorization check.
export function adminDb(): SupabaseClient {
  client ??= createClient(env.supabaseUrl(), env.serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
