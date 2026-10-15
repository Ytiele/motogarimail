import { Suspense } from "react";
import { RealtimeBridge } from "@/components/shell/RealtimeBridge";
import { Sidebar } from "@/components/shell/Sidebar";
import { requireUser } from "@/lib/auth";
import { getPublicConnection } from "@/lib/mail/connection";
import type { InboxCounts } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, supabase } = await requireUser();
  const [{ data: counts }, { count: unread }, conn] = await Promise.all([
    supabase.rpc("inbox_counts"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
    user.role === "admin" ? getPublicConnection() : Promise.resolve(null),
  ]);

  const syncHealth =
    user.role !== "admin" ? null : !conn ? "missing" : conn.status === "connected" ? "ok" : "attention";

  return (
    <div className="lg:pl-64">
      <Suspense>
        <Sidebar
          user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
          counts={(counts as InboxCounts) ?? null}
          unread={unread ?? 0}
          syncHealth={syncHealth}
          mockMode={conn?.provider === "mock"}
        />
      </Suspense>
      <RealtimeBridge userId={user.id} />
      <main className="mx-auto max-w-7xl px-4 pt-20 pb-16 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
    </div>
  );
}
