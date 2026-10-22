"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createFirstAdmin, login, requestPasswordReset, updatePassword } from "@/app/(auth)/actions";
import { FormMessage } from "./AuthCard";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label className="auth-label" htmlFor="email">Email</label>
        <input className="auth-input" id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div>
        <label className="auth-label" htmlFor="password">Password</label>
        <input className="auth-input" id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required />
        <div className="mt-2 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Show password
          </label>
          <Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">Forgot password?</Link>
        </div>
      </div>
      <FormMessage state={state} />
      <button className="btn-brand h-11 w-full text-[15px]" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="auth-label" htmlFor="email">Email</label>
        <input className="auth-input" id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <FormMessage state={state} />
      <button className="btn-brand h-11 w-full text-[15px]" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

export function NewPasswordForm({ doneHref = "/dashboard" }: { doneHref?: string }) {
  const [state, action, pending] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="auth-label" htmlFor="password">New password</label>
        <input className="auth-input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <div>
        <label className="auth-label" htmlFor="confirm">Confirm password</label>
        <input className="auth-input" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      <FormMessage state={state} />
      {state?.message ? (
        <Link href={doneHref} className="btn-brand h-11 w-full text-[15px]">Continue</Link>
      ) : (
        <button className="btn-brand h-11 w-full text-[15px]" disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
      )}
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(createFirstAdmin, undefined);
  return (
    <form action={action} className="space-y-5">
      <div>
        <label className="auth-label" htmlFor="name">Your name</label>
        <input className="auth-input" id="name" name="name" required autoFocus />
      </div>
      <div>
        <label className="auth-label" htmlFor="email">Work email</label>
        <input className="auth-input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="auth-label" htmlFor="password">Password</label>
        <input className="auth-input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <p className="mt-1 text-xs text-muted">At least 10 characters. This is your own login — not the Gmail password.</p>
      </div>
      <FormMessage state={state} />
      <button className="btn-brand h-11 w-full text-[15px]" disabled={pending}>{pending ? "Creating…" : "Create admin account"}</button>
    </form>
  );
}
