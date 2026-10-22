import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { adminDb } from "@/lib/supabase/admin";

const IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;

// Chat files are private. The message is read with the viewer's own session, so RLS only finds it if
// they are the sender or recipient; they then get a 60-second signed link (forced download unless it's a photo).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: msg } = await session.supabase.from("chat_messages").select("attachment_path, attachment_name, attachment_type").eq("id", id).maybeSingle();
  if (!msg?.attachment_path) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const inline = IMAGE.test(msg.attachment_type ?? "");
  const { data, error } = await adminDb()
    .storage.from("chat")
    .createSignedUrl(msg.attachment_path, 60, inline ? undefined : { download: msg.attachment_name ?? "file" });
  if (error || !data) return NextResponse.json({ error: "File unavailable" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
