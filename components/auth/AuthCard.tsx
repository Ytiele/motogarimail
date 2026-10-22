import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Sign-in style layout (login, first-run setup, password reset), modelled on Google's account pages:
 * a large rounded card on the tinted canvas, heading on the left, form on the right.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  highlights,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  highlights?: string[];
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas sm:items-center sm:justify-center sm:px-6 sm:py-10">
      <main className="w-full flex-1 bg-white px-6 py-10 sm:max-w-[1040px] sm:flex-none sm:rounded-[28px] sm:px-10 sm:py-12 sm:shadow-[0_1px_3px_rgba(60,64,67,.15)]">
        <div className="grid gap-10 md:grid-cols-2 md:gap-14">
          <div>
            <div className="flex items-center gap-3">
              <Logo size={44} />
              <div className="leading-tight">
                <div className="text-lg font-medium text-ink">Motogari</div>
                <div className="text-xs tracking-wide text-muted uppercase">Team inbox</div>
              </div>
            </div>
            <h1 className="mt-8 text-[32px] leading-tight font-normal text-ink sm:text-[36px]">{title}</h1>
            {subtitle && <p className="mt-3 text-base text-ink-2">{subtitle}</p>}
            {highlights && highlights.length > 0 && (
              <ul className="mt-8 hidden space-y-4 md:block">
                {highlights.map((h) => (
                  <li key={h} className="flex items-start gap-3 text-sm text-ink-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M2.5 6.2l2.2 2.2 4.8-5" />
                      </svg>
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="md:pt-[4.75rem]">
            {children}
            {footer && <div className="mt-8 text-sm text-muted">{footer}</div>}
          </div>
        </div>
      </main>
      <footer className="flex w-full items-center justify-between gap-4 px-6 py-4 text-xs text-muted sm:max-w-[1040px] sm:px-2">
        <div className="w-44"><ThemeToggle /></div>
        <span className="hidden sm:inline">Motogari · Private staff workspace</span>
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
