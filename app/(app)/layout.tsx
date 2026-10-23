import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { RealtimeBridge } from "@/components/shell/RealtimeBridge";
import { Sidebar } from "@/components/shell/Sidebar";
import { requireUser } from "@/lib/auth";
import { getPublicConnection } from "@/lib/mail/connection";
import { SIDEBAR_COOKIE } from "@/lib/theme";
import type { InboxCounts } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, supabase } = await requireUser();
  if (user.role === "chat") redirect("/chat");
  const [{ data: counts }, { count: unread }, conn] = await Promise.all([
    supabase.rpc("inbox_counts"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    user.role === "admin" ? getPublicConnection() : Promise.resolve(null),
  ]);

  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  const syncHealth =
    user.role !== "admin" ? null : !conn ? "missing" : conn.status === "connected" ? "ok" : "attention";

  return (
    <div id="app-shell" data-sidebar={collapsed ? "collapsed" : "open"}>
      <Suspense>
        <Sidebar
          user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
          counts={(counts as InboxCounts) ?? null}
          unread={unread ?? 0}
          syncHealth={syncHealth}
          mockMode={conn?.provider === "mock"}
          initialCollapsed={collapsed}
        />
      </Suspense>
      <RealtimeBridge userId={user.id} />
      {/* Gmail-style white content panel floating on the tinted canvas. */}
      <main className="min-h-[calc(100vh-4rem)] bg-white px-4 py-5 sm:px-6 lg:mr-4 lg:mb-4 lg:min-h-[calc(100vh-5rem)] lg:rounded-2xl lg:px-8">
        <div className="mx-auto max-w-[96rem]">{children}</div>
      </main>
    </div>
  );
}
