import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/auth/AuthCard";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { isPhoneLoginEmail } from "@/lib/phone";
import type { AppUser } from "@/lib/types";

const ROLE_LABEL = { admin: "Admin / CEO", staff: "Staff", chat: "Chat only" } as const;

/** Full-screen chat shell: brand, account menu, and (for email users) a way back to the inbox. */
export function ChatShell({ user, children }: { user: AppUser; children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <header className="flex h-16 shrink-0 items-center gap-3 px-4">
        <Link href="/chat" className="flex items-center gap-2">
          <Logo size={30} />
          <span className="text-[22px] leading-none text-ink-2">Motogari</span>
        </Link>
        <span className="hidden text-sm text-muted sm:inline">Team chat</span>
        <div className="ml-auto flex items-center gap-2">
          {user.role !== "chat" && (
            <Link href="/inbox" className="btn-secondary h-9 text-sm">← Back to inbox</Link>
          )}
          <AccountMenu
            name={user.name}
            contact={isPhoneLoginEmail(user.email) ? "Signs in with phone number" : user.email}
            roleLabel={ROLE_LABEL[user.role]}
            accountHref={user.role === "chat" ? "/chat/account" : "/account"}
          />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-hidden bg-white lg:mx-4 lg:mb-4 lg:rounded-2xl">{children}</main>
    </div>
  );
}
