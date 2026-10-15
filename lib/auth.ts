import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import type { AppUser } from "./types";

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("*").eq("id", user.id).maybeSingle();
  if (!data || !data.is_active) return null;
  return { user: data as AppUser, supabase };
});

export async function requireUser() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdmin() {
  const s = await requireUser();
  if (s.user.role !== "admin") redirect("/dashboard");
  return s;
}

/** For server actions / route handlers: returns null instead of redirecting. */
export async function currentUser(): Promise<AppUser | null> {
  return (await getSession())?.user ?? null;
}
