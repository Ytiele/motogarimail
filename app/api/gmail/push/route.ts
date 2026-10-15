import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runSync } from "@/lib/mail/sync";

export const maxDuration = 60;

// Google Cloud Pub/Sub push endpoint. Configure the subscription's push URL as
// https://<app>/api/gmail/push?token=<GMAIL_PUSH_TOKEN>
export async function POST(request: NextRequest) {
  const expected = env.pushToken();
  const given = request.nextUrl.searchParams.get("token") ?? "";
  if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Payload only says "something changed"; the sync reads the actual changes from Gmail history.
  after(() => runSync({ timeBudgetMs: 50_000 }).catch(() => {}));
  return new NextResponse(null, { status: 204 });
}
