import Link from "next/link";
import { cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { PublicConnection } from "@/lib/mail/connection";

export function SyncStatus({ conn, compact = false }: { conn: PublicConnection | null; compact?: boolean }) {
  if (!conn) {
    return (
      <Link href="/settings/gmail" className="card flex items-center gap-3 border-amber-300 bg-amber-50 p-4">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
        <div className="text-sm">
          <div className="font-semibold text-amber-900">Gmail not connected</div>
          <div className="text-amber-800">Connect the company mailbox to start receiving emails.</div>
        </div>
      </Link>
    );
  }
  const ok = conn.status === "connected";
  return (
    <div className={cx("card flex items-start gap-3 p-4", !ok && "border-amber-300 bg-amber-50")}>
      <span className={cx("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500")} />
      <div className="min-w-0 text-sm">
        <div className="font-semibold">
          {conn.provider === "mock" ? "Development mailbox" : "Gmail sync"} · {ok ? "Connected" : "Attention required"}
        </div>
        <div className="truncate text-muted">{conn.email_address}</div>
        <div className="tabular text-xs text-muted">
          {ok ? `Last sync: ${formatDateTime(conn.last_sync_at)}` : `Last successful sync: ${formatDateTime(conn.last_success_at)}`}
        </div>
        {!ok && conn.last_error && <div className="mt-1 text-xs text-amber-900">{conn.last_error}</div>}
        {!compact && !conn.initial_import_done && <div className="mt-1 text-xs text-muted">Initial import in progress…</div>}
        {!ok && <Link href="/settings/gmail" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">Open Gmail settings</Link>}
      </div>
    </div>
  );
}
