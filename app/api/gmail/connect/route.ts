import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { buildGoogleAuthUrl } from "@/lib/mail/gmail";

const WINDOWS = new Set(["7", "30", "90", "365"]);

export async function GET(request: NextRequest) {
  const me = await currentUser();
  if (!me || me.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!env.googleConfigured()) {
    return NextResponse.redirect(new URL("/settings/gmail?error=not_configured", request.url));
  }
  const windowDays = request.nextUrl.searchParams.get("window") ?? "30";
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(buildGoogleAuthUrl(state));
  response.cookies.set("gmail_oauth", JSON.stringify({ state, window: WINDOWS.has(windowDays) ? Number(windowDays) : 30 }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/api/gmail/callback",
  });
  return response;
}
