import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getActiveConnection, providerFor } from "@/lib/mail/connection";

const INLINE_SAFE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);

function contentDisposition(type: "inline" | "attachment", filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// Attachments are fetched from Gmail on demand (never stored publicly) and only for signed-in active staff.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: att } = await session.supabase
    .from("email_attachments")
    .select("id, filename, mime_type, part_id, emails!inner(gmail_message_id)")
    .eq("id", id)
    .maybeSingle();
  if (!att || !att.part_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const conn = await getActiveConnection();
  if (!conn) return NextResponse.json({ error: "Mailbox not connected" }, { status: 503 });

  const email = att.emails as unknown as { gmail_message_id: string };
  try {
    const file = await providerFor(conn).getAttachment(email.gmail_message_id, att.part_id);
    const mime = (att.mime_type || file.mimeType).toLowerCase();
    const wantsInline = request.nextUrl.searchParams.get("inline") === "1" && INLINE_SAFE.has(mime);
    const headers: Record<string, string> = {
      "Content-Type": wantsInline ? (mime === "text/plain" ? "text/plain; charset=utf-8" : mime) : "application/octet-stream",
      "Content-Disposition": contentDisposition(wantsInline ? "inline" : "attachment", att.filename),
      "Content-Length": String(file.data.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    };
    // Browsers refuse to render PDFs inside a CSP sandbox; everything else gets one.
    if (mime !== "application/pdf") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:";
    return new NextResponse(new Uint8Array(file.data), { headers });
  } catch {
    return NextResponse.json({ error: "Could not fetch attachment from Gmail" }, { status: 502 });
  }
}
