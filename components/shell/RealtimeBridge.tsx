"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { browserDb } from "@/lib/supabase/browser";

type Toast = { id: number; title: string; body?: string; href?: string };

// Keeps every open dashboard in sync: any change to a conversation re-renders server data,
// and new emails / personal notifications surface as toasts.
export function RealtimeBridge({ userId }: { userId: string }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const db = browserDb();
    const push = (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((x) => [...x.slice(-3), { ...t, id }]);
      setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 7000);
    };
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };

    const channel = db
      .channel("motogari-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, (payload) => {
        refresh();
        if (payload.eventType === "INSERT") {
          const row = payload.new as { id: string; subject: string; customer_name: string | null; customer_email: string | null; is_historical: boolean; status: string };
          if (!row.is_historical && row.status !== "no_action" && row.status !== "junk") {
            push({ title: "New email received", body: `${row.customer_name ?? row.customer_email ?? "Unknown sender"} — ${row.subject}`, href: `/inbox/${row.id}` });
          }
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        const n = payload.new as { title: string; body: string | null; conversation_id: string | null };
        push({ title: n.title, body: n.body ?? undefined, href: n.conversation_id ? `/inbox/${n.conversation_id}` : "/notifications" });
        refresh();
      })
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      db.removeChannel(channel);
    };
  }, [router, userId]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto card border-l-4 border-l-brand-500 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 truncate text-sm text-muted">{t.body}</div>}
              {t.href && <Link href={t.href} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Open</Link>}
            </div>
            <button className="text-muted hover:text-ink" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>×</button>
          </div>
        </div>
      ))}
    </div>
  );
}
