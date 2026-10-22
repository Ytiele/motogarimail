import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Sign-in style layout (login, first-run setup, password reset): one centred card on the tinted canvas. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas sm:items-center sm:justify-center sm:px-6 sm:py-10">
      <main className="w-full flex-1 bg-white px-6 py-10 sm:max-w-[448px] sm:flex-none sm:rounded-[28px] sm:px-10 sm:py-12 sm:shadow-[0_1px_3px_rgba(60,64,67,.15)]">
        <div className="flex flex-col items-center text-center">
          <Logo size={44} />
          <h1 className="mt-6 text-[28px] leading-tight font-normal text-ink">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-ink-2">{subtitle}</p>}
        </div>
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
      </main>
      <footer className="flex w-full justify-center px-6 py-4 sm:max-w-[448px]">
        <div className="w-44"><ThemeToggle /></div>
      </footer>
    </div>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#2b2c30" />
      <path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#d7262e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FormMessage({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (state?.error) return <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</p>;
  if (state?.message) return <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>;
  return null;
}
