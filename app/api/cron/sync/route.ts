import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runSync } from "@/lib/mail/sync";
import { runSlaScan } from "@/lib/sla";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Scheduled fallback sync + SLA alerts. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: NextRequest) {
  const secret = env.cronSecret();
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sync = await runSync({ timeBudgetMs: 45_000 });
  const sla = await runSlaScan();
  return NextResponse.json({ sync, sla });
}
