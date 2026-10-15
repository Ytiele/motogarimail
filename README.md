# Motogari Inbox

A shared-inbox workflow layer on top of the Motogari company Gmail account.

Gmail can tell you whether someone **opened** an email. This dashboard tells you whether someone **took responsibility for it, what they did, and whether it's actually resolved**. Opening an email never changes its status.

Stack: Next.js 15 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres, Auth, Realtime) · Gmail API (REST, server-side only) · Vercel.

---

## How it works

```
Gmail ──(Pub/Sub push or 5-min cron)──► /api/gmail/push | /api/cron/sync
                                             │
                                   lib/mail/sync.ts  (idempotent, locked)
                                             │
                    Postgres: conversations (1 per Gmail thread, holds workflow state)
                              emails (messages) · attachments (metadata only)
                              assignments · notes · events (append-only audit)
                                             │
                     Supabase Realtime ──► every open dashboard refreshes
```

- **One record per conversation.** Everyone sees the same row; the owner field is the source of responsibility. Workflow state lives on `conversations` (one per Gmail thread) so replies thread naturally. `emails` holds the individual messages with the fields from the spec.
- **Status rules** (`lib/workflow.ts`, unit-tested):
  - Opening: no change (only an `email_opened` event is recorded and shown as “Seen by”).
  - Assign/claim: `new → assigned`. Start working: `assigned → in_progress`.
  - Reply sent: `new/assigned → in_progress`; never auto-resolves. Replying to an unowned conversation assigns it to you.
  - Customer replies: `resolved/archived → new` (marked *Reopened*, owner kept and notified); `waiting → in_progress`.
  - Gmail read/unread labels are stored but never used for workflow.
- **Junk:** mail Gmail puts in Spam, and new mail from senders on the junk list (`junk_senders`, managed under Settings → Junk senders), is filed in the **Junk** section. Staff use *Mark as junk…* on a conversation to add the sender (or a company domain; shared providers like gmail.com can't be blocked) and *Not junk* to move it back and remove the rule. Junk has no owner, never goes overdue and is excluded from analytics. Gmail itself is not changed (the app only has read/send scopes).
- **Concurrency:** every conversation update is optimistic (`version` column). If two people click *Assign to me* at once, exactly one wins; the other sees “Jane has already taken this conversation.”
- **Idempotent sync:** `gmail_message_id` is unique; side effects (events, notifications, reopen) only happen when a message is inserted for the first time. A DB lock prevents overlapping sync runs.
- **SLA:** per-priority deadlines (admin-configurable). Overdue = still New/Assigned/In progress past the deadline; the clock pauses while *Waiting on customer*. Reopening restarts the clock.
- **Notifications** (in-app, deduplicated): assigned/reassigned to you, customer replied, SLA warning, overdue (owner + admins). New unowned email shows as a live toast to everyone, not a stored notification.

## Security

- Each person has their own Supabase Auth account (bcrypt-hashed passwords). Nobody needs the Gmail password.
- Gmail OAuth runs server-side. Scopes are only `gmail.readonly` and `gmail.send`. Refresh/access tokens are AES-256-GCM encrypted in a table with no RLS policies (service role only) and never sent to the browser.
- RLS: browsers can only **read**, and only as an active user. All writes go through server actions that check role/ownership, then use the service role. Admin-only analytics are enforced in SQL.
- `email_events` is append-only at the database level (a trigger blocks UPDATE/DELETE for every role).
- Email HTML is sanitized (`sanitize-html`) and rendered in a sandboxed iframe with scripts disabled and a restrictive CSP.
- Attachments are fetched from Gmail on demand for signed-in staff only; non-PDF responses carry a CSP sandbox, risky types are forced to download.
- Login, password reset, setup and reply sending are rate-limited (Postgres-backed, works across serverless instances).
- Server actions get Next.js’ built-in Origin check (CSRF); OAuth uses a random `state` in an httpOnly cookie; cron and Pub/Sub endpoints use constant-time secret checks.
- Staff are deactivated, never deleted; their open conversations automatically return to **Unassigned**.

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. Run the migration: either `supabase db push` with the Supabase CLI, or paste `supabase/migrations/20261008000000_init.sql` into the SQL editor and run it.
3. Authentication → URL configuration: set **Site URL** to your app URL and add `https://<your-app>/auth/callback` to **Redirect URLs** (used by password reset).
4. Authentication → Providers → Email: you can disable public sign-ups — accounts are created by the admin.
5. Copy the project URL, anon key and service-role key into `.env.local`.

### 2. Google Cloud (requires the Motogari Google account — manual)

1. Create a Google Cloud project and enable the **Gmail API**.
2. OAuth consent screen: if Motogari uses Google Workspace, choose **Internal** (no verification needed). For a consumer @gmail.com account choose External; `gmail.readonly` is a *restricted* scope, so the app must either stay in Testing mode with the mailbox added as a test user (refresh tokens then expire every 7 days) or go through Google verification.
3. Credentials → Create OAuth client ID → *Web application*. Authorized redirect URI: `https://<your-app>/api/gmail/callback` (and `http://localhost:3000/api/gmail/callback` for development).
4. Put the client ID/secret and redirect URI in the environment.

**Optional – real-time push (recommended for production):**

1. Enable the Pub/Sub API, create a topic (e.g. `gmail-motogari`).
2. Grant `gmail-api-push@system.gserviceaccount.com` the **Pub/Sub Publisher** role on that topic.
3. Create a **push** subscription to `https://<your-app>/api/gmail/push?token=<GMAIL_PUSH_TOKEN>`.
4. Set `GMAIL_PUBSUB_TOPIC=projects/<project>/topics/gmail-motogari`. The app registers and renews the Gmail watch automatically.

Without Pub/Sub the 5-minute cron still keeps the inbox current.

### 3. Environment

```bash
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # GMAIL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET, GMAIL_PUSH_TOKEN
```

### 4. Run

```bash
npm install
npm run dev          # http://localhost:3000 → first visit opens the one-time admin setup
npm test             # workflow + Gmail parsing/MIME unit tests
npm run build
```

### 5. Deploy (Vercel)

Import the repo, add every variable from `.env.example`, deploy. `vercel.json` schedules `/api/cron/sync` every 5 minutes (Vercel Pro; on Hobby, crons run once a day — use Pub/Sub push, or call the endpoint from an external scheduler or Supabase `pg_cron` with `Authorization: Bearer $CRON_SECRET`).

## First-run onboarding

1. Visit the app → create the CEO/admin account (only possible while no users exist).
2. Settings → Gmail connection → choose import window (7/30/90/365 days, default 30) → *Connect Gmail*. History is imported as **Archived** so it doesn’t flood the queue (toggle under SLA & notifications).
3. Settings → Staff → add people. A temporary password is shown once; they change it under *My account*.
4. Review Categories and SLA → *Finish setup*.

## Local development without Google credentials

Set `MAIL_PROVIDER=mock`. Settings → Gmail connection then offers a clearly labelled **development mailbox** stored in the `mock_mailbox` table. You can simulate customer emails and replies; they go through the real sync pipeline, and dashboard replies are “sent” into that table. The sidebar shows a permanent “not connected to Gmail” banner. Nothing pretends to be Gmail.

## Project layout

```
app/(auth)          login, forgot password, first-admin setup, auth actions
app/auth            password-reset callback + new-password page
app/(app)           authenticated shell: dashboard, inbox, inbox/[id], team,
                    analytics, activity, notifications, account, settings/*
app/api             attachments, gmail/connect|callback|push, cron/sync
components          UI primitives, shell (sidebar, realtime), inbox, email, dashboard
lib/workflow.ts     status rules (pure, tested)
lib/mail            provider interface, Gmail REST client, mock provider, parser, MIME, sync engine
lib/conversations.ts optimistic-concurrency updates
supabase/migrations schema, RLS, functions, seed data
tests               vitest unit tests
```

## Extending later

`conversations.channel` defaults to `email`, and the sync engine talks to a `MailProvider` interface, so WhatsApp/SMS/web enquiries can be added as new providers feeding the same conversations, assignments and audit trail. None of these are implemented.
