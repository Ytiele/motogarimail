"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createFirstAdmin, login, requestPasswordReset, updatePassword } from "@/app/(auth)/actions";
import { FormMessage } from "./AuthCard";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="password">Password</label>
          <Link href="/forgot-password" className="mb-1 text-xs text-brand-700 hover:underline">Forgot password?</Link>
        </div>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormMessage state={state} />
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <FormMessage state={state} />
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

export function NewPasswordForm({ doneHref = "/dashboard" }: { doneHref?: string }) {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <div>
        <label className="label" htmlFor="confirm">Confirm password</label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <FormMessage state={state} />
      {state?.message ? (
        <Link href={doneHref} className="btn-primary w-full">Continue</Link>
      ) : (
        <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
      )}
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(createFirstAdmin, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="name">Your name</label>
        <input className="input" id="name" name="name" required autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="email">Work email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <p className="mt-1 text-xs text-muted">At least 10 characters. This is your own login — not the Gmail password.</p>
      </div>
      <FormMessage state={state} />
      <button className="btn-brand w-full" disabled={pending}>{pending ? "Creating…" : "Create admin account"}</button>
    </form>
  );
}
