import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { logEvent } from "@/lib/events";
import { exchangeCode, GMAIL_SCOPES } from "@/lib/mail/gmail";
import { getActiveConnection } from "@/lib/mail/connection";
import { runSync } from "@/lib/mail/sync";
import { adminDb } from "@/lib/supabase/admin";

export const maxDuration = 60;

function back(request: NextRequest, query: string) {
  const res = NextResponse.redirect(new URL(`/settings/gmail?${query}`, request.url));
  res.cookies.delete({ name: "gmail_oauth", path: "/api/gmail/callback" });
  return res;
}

export async function GET(request: NextRequest) {
  const me = await currentUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  if (sp.get("error")) return back(request, "error=denied");

  let saved: { state: string; window: number } | null = null;
  try {
    saved = JSON.parse(request.cookies.get("gmail_oauth")?.value ?? "null");
  } catch {}
  const state = sp.get("state") ?? "";
  if (!saved || saved.state.length !== state.length || !timingSafeEqual(Buffer.from(saved.state), Buffer.from(state))) {
    return back(request, "error=state");
  }
  const code = sp.get("code");
  if (!code) return back(request, "error=denied");

  try {
    const tokens = await exchangeCode(code);
    const granted = (tokens.scope ?? "").split(" ");
    if (!GMAIL_SCOPES.every((s) => granted.includes(s))) return back(request, "error=scopes");

    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      cache: "no-store",
    });
    if (!profileRes.ok) return back(request, "error=profile");
    const profile = (await profileRes.json()) as { emailAddress: string };

    const db = adminDb();
    const existing = await getActiveConnection();
    const tokenFields = {
      encrypted_access_token: encrypt(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ?? null,
      status: "connected",
      last_error: null,
      connected_by: me.id,
      ...(tokens.refresh_token ? { encrypted_refresh_token: encrypt(tokens.refresh_token) } : {}),
    };

    if (existing && existing.provider === "gmail" && existing.email_address.toLowerCase() === profile.emailAddress.toLowerCase()) {
      if (!tokens.refresh_token && !existing.encrypted_refresh_token) return back(request, "error=refresh");
      await db.from("mail_connections").update(tokenFields).eq("id", existing.id);
    } else {
      if (!tokens.refresh_token) return back(request, "error=refresh");
      if (existing) await db.from("mail_connections").update({ is_active: false, status: "disconnected" }).eq("id", existing.id);
      const { error } = await db.from("mail_connections").insert({
        provider: "gmail",
        email_address: profile.emailAddress.toLowerCase(),
        import_window_days: saved.window,
        ...tokenFields,
      });
      if (error) throw error;
    }
    await logEvent({ type: "gmail_connected", userId: me.id, metadata: { mailbox: profile.emailAddress } });
    after(() => runSync({ timeBudgetMs: 50_000 }).catch(() => {}));
    return back(request, "connected=1");
  } catch (e) {
    await adminDb().from("sync_logs").insert({ level: "error", message: "Gmail OAuth callback failed", details: { error: (e as Error).message } });
    return back(request, "error=exchange");
  }
}
