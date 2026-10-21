import { ActionForm } from "@/components/ActionForm";
import { SyncStatus } from "@/components/dashboard/SyncStatus";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { getPublicConnection } from "@/lib/mail/connection";
import { connectMockMailbox, disconnectMailbox, simulateInbound, syncNow } from "../actions";

export const metadata = { title: "Gmail connection" };

const ERRORS: Record<string, string> = {
  not_configured: "Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
  denied: "Google sign-in was cancelled or denied.",
  state: "The sign-in request expired or could not be verified. Please try again.",
  scopes: "Both permissions (read and send) are required. Please try again and allow both.",
  refresh: "Google did not return a long-lived token. Remove the app's access at myaccount.google.com/permissions and try again.",
  profile: "Could not read the mailbox profile from Gmail.",
  exchange: "Could not complete the Google connection. Details were logged.",
};

const WINDOWS = [
  { v: 7, label: "Last 7 days" },
  { v: 30, label: "Last 30 days" },
  { v: 90, label: "Last 90 days" },
  { v: 365, label: "Last 1 year" },
];

export default async function GmailSettings({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const conn = await getPublicConnection();
  const mock = env.mailProvider() === "mock";
  // Names only, never values: tells the admin exactly which Vercel variable the server cannot see.
  const missingGoogle = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"].filter((n) => !process.env[n]?.trim());
  // A stale ?error=not_configured from an earlier attempt is not shown once the server is configured.
  const error = sp.error === "not_configured" && !missingGoogle.length ? undefined : sp.error;
  const [{ data: logs }, { data: threads }] = await Promise.all([
    supabase.from("sync_logs").select("*").order("created_at", { ascending: false }).limit(15),
    mock ? supabase.from("conversations").select("gmail_thread_id, subject").order("last_message_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
  ]);

  return (
    <>
      <PageHeader title="Gmail connection" subtitle="The company mailbox is connected once, server-side, with Google OAuth. Staff never see the Gmail password or tokens." />
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{ERRORS[error] ?? "Connection failed."}</p>}
      {sp.connected && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Gmail connected. The initial import has started in the background.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SyncStatus conn={conn} />
          {conn && (
            <section className="card space-y-3 p-5 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                <dt className="text-muted">Mailbox</dt><dd>{conn.email_address}</dd>
                <dt className="text-muted">Import window</dt><dd>Last {conn.import_window_days} days</dd>
                <dt className="text-muted">Initial import</dt><dd>{conn.initial_import_done ? "Complete" : "In progress"}</dd>
                <dt className="text-muted">Push notifications</dt>
                <dd>{conn.watch_expiration ? `Active until ${formatDateTime(conn.watch_expiration)}` : "Not configured — using scheduled polling"}</dd>
                <dt className="text-muted">Connected</dt><dd>{formatDateTime(conn.created_at)}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                <ActionForm action={syncNow} submit="Sync now" />
                <ActionForm action={disconnectMailbox} submit="Disconnect" submitClass="btn-danger" confirm="Disconnect the mailbox? New emails will stop arriving until it is reconnected." />
              </div>
            </section>
          )}

          {!mock && (
            <section className="card p-5">
              <h2 className="font-semibold">{conn ? "Reconnect Gmail" : "Connect company Gmail"}</h2>
              <p className="mt-1 text-sm text-muted">
                Requests only two permissions: read email and send email. The app cannot delete mail or change labels.
                Gmail’s read/unread state is ignored — the dashboard status is what counts.
              </p>
              {missingGoogle.length > 0 ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  The server cannot see: <strong>{missingGoogle.join(", ")}</strong>. Add {missingGoogle.length > 1 ? "them" : "it"} in Vercel → Settings → Environment Variables (Production), then redeploy.
                </p>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  Redirect URI in use: <code className="break-all">{env.googleRedirectUri()}</code> — it must match the Google Cloud OAuth client exactly.
                </p>
              )}
              <form action="/api/gmail/connect" method="get" className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div>
                  <label className="label" htmlFor="window">Import history</label>
                  <select id="window" name="window" className="input" defaultValue="30">
                    {WINDOWS.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
                  </select>
                </div>
                <button className="btn-brand">{conn ? "Reconnect with Google" : "Connect Gmail"}</button>
              </form>
              <p className="mt-3 text-xs text-muted">
                Imported history is filed as Archived so it does not flood the queue. Change this under SLA & notifications.
                {!env.googleConfigured() && <strong className="mt-1 block text-red-700">Google OAuth credentials are not set on the server yet.</strong>}
              </p>
            </section>
          )}

          {mock && (
            <section className="card border-amber-300 bg-amber-50/60 p-5">
              <h2 className="font-semibold text-amber-950">Development mailbox (MAIL_PROVIDER=mock)</h2>
              <p className="mt-1 text-sm text-amber-900">
                For local testing without Google credentials. Messages go through the same sync pipeline, but nothing is sent to or received from real Gmail.
              </p>
              {!conn ? (
                <ActionForm action={connectMockMailbox} submit="Connect development mailbox" className="mt-4 space-y-3">
                  <select name="window" className="input" defaultValue="30">
                    {WINDOWS.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
                  </select>
                </ActionForm>
              ) : (
                <ActionForm action={simulateInbound} submit="Simulate customer email" resetOnSuccess className="mt-4 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input className="input" name="fromName" defaultValue="John Kamau" required aria-label="Sender name" />
                    <input className="input" name="fromEmail" defaultValue="john.kamau@example.com" type="email" required aria-label="Sender email" />
                  </div>
                  <input className="input" name="subject" defaultValue="Booking enquiry" required aria-label="Subject" />
                  <textarea className="input min-h-24" name="body" defaultValue="Hello, I would like to book a vehicle for next weekend. Is it available?" required aria-label="Body" />
                  <select className="input" name="threadId" defaultValue="" aria-label="Thread">
                    <option value="">New conversation</option>
                    {(threads ?? []).map((t) => <option key={t.gmail_thread_id} value={t.gmail_thread_id}>Reply on: {t.subject}</option>)}
                  </select>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="attachment" /> Include a sample attachment</label>
                </ActionForm>
              )}
            </section>
          )}
        </div>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Sync log</h2>
          {(logs ?? []).length === 0 ? (
            <p className="text-sm text-muted">No sync events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(logs ?? []).map((l) => (
                <li key={l.id} className="flex gap-2">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${l.level === "error" ? "bg-red-500" : l.level === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <div>
                    <div>{l.message}</div>
                    <div className="tabular text-xs text-muted">{formatDateTime(l.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted">Technical details are kept server-side. Tokens are encrypted (AES-256-GCM) and never sent to the browser.</p>
        </section>
      </div>
    </>
  );
}
