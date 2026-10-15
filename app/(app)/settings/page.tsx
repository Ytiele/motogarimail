import Link from "next/link";
import { cx, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getPublicConnection } from "@/lib/mail/connection";
import { completeOnboarding } from "./actions";

export const metadata = { title: "Setup" };

export default async function SettingsOverview() {
  const { supabase } = await requireAdmin();
  const [conn, { count: staffCount }, { data: done }] = await Promise.all([
    getPublicConnection(),
    supabase.from("users").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("app_settings").select("value").eq("key", "onboarding_complete").maybeSingle(),
  ]);
  const steps = [
    { title: "Create the Motogari admin account", done: true, href: "/account", body: "Your own login — separate from the Gmail password." },
    {
      title: "Connect the company Gmail",
      done: !!conn,
      href: "/settings/gmail",
      body: conn ? `Connected: ${conn.email_address}` : "Sign in with Google and choose how much history to import.",
    },
    { title: "Add staff", done: (staffCount ?? 0) > 1, href: "/settings/staff", body: `${staffCount ?? 0} active account(s). Each person gets their own login.` },
    { title: "Configure inbox", done: done?.value === true, href: "/settings/sla", body: "Review categories and SLA deadlines." },
  ];

  return (
    <>
      <PageHeader title="Welcome to Motogari Inbox" subtitle="Four steps to make sure no email gets lost because someone else opened it." />
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link href={s.href} className="card flex items-start gap-4 p-4 hover:border-stone-400">
              <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", s.done ? "bg-emerald-600 text-white" : "bg-stone-100 text-ink")}>
                {s.done ? "✓" : i + 1}
              </span>
              <div>
                <div className="font-semibold">Step {i + 1} · {s.title}</div>
                <div className="text-sm text-muted">{s.body}</div>
              </div>
            </Link>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/settings/categories" className="btn-secondary">Categories</Link>
        <Link href="/settings/sla" className="btn-secondary">SLA & notifications</Link>
        {done?.value !== true && (
          <form action={completeOnboarding}>
            <button className="btn-brand" disabled={!conn}>Finish setup</button>
          </form>
        )}
      </div>
    </>
  );
}
