import "server-only";
import { adminDb } from "./supabase/admin";

export async function hasAnyUser() {
  const { count, error } = await adminDb().from("users").select("id", { count: "exact", head: true });
  if (error) throw error;
  return (count ?? 0) > 0;
}
