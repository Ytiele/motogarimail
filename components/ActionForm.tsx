"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

export type FormResult = { ok?: boolean; error?: string; message?: string; secret?: string; link?: string; whatsapp?: string; nonce?: number } | undefined;

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
      {state?.link && <SetupLink link={state.link} whatsapp={state.whatsapp} />}
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

function SetupLink({ link, whatsapp }: { link: string; whatsapp?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <div className="font-semibold text-emerald-900">One-time set-up link — valid for 7 days</div>
      <code className="mt-1 block font-mono text-xs break-all select-all">{link}</code>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary h-8 text-xs"
          onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => {})}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        {whatsapp && (
          <a className="btn h-8 bg-[#25d366] text-xs text-[#fff] hover:bg-[#1ebe5b]" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Send on WhatsApp
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-emerald-900">Anyone with this link can set the password, so send it only to this person.</p>
    </div>
  );
}
