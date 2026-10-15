"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";

export type FormResult = { ok?: boolean; error?: string; message?: string; secret?: string; nonce?: number } | undefined;

export function ActionForm({
  action,
  children,
  submit,
  className,
  resetOnSuccess = false,
  submitClass = "btn-primary",
  confirm,
}: {
  action: (prev: FormResult, form: FormData) => Promise<FormResult>;
  children?: ReactNode;
  submit: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitClass?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state?.nonce, state?.ok, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={submitClass} disabled={pending}>{pending ? "Working…" : submit}</button>
        {state?.error && <span role="alert" className="text-sm text-red-700">{state.error}</span>}
        {state?.message && <span role="status" className="text-sm text-emerald-700">{state.message}</span>}
      </div>
      {state?.secret && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-900">Temporary password — shown once</div>
          <code className="mt-1 block font-mono text-base select-all">{state.secret}</code>
          <p className="mt-1 text-xs text-amber-900">Share it privately. They should change it under “My account” after signing in.</p>
        </div>
      )}
    </form>
  );
}
