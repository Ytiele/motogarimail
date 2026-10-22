"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/auth/AuthCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, cx } from "@/components/ui";
import { SIDEBAR_COOKIE } from "@/lib/theme";
import type { InboxCounts } from "@/lib/types";

type NavItem = { href: string; label: string; count?: number; alert?: boolean };

const ChevronIcon = ({ flip }: { flip?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" style={flip ? { transform: "scaleX(-1)" } : undefined}>
    <path d="M12.5 4.5L7 10l5.5 5.5" />
  </svg>
);
const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 8a5 5 0 0110 0c0 5 2 6 2 6H3s2-1 2-6M8.5 17a1.7 1.7 0 003 0" /></svg>
);
const InboxIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11l2-7h10l2 7v5H3v-5zm0 0h4l1 2h4l1-2h4" /></svg>
);
const SendIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 10l14-6-5 14-2.5-5.5L3 10z" /></svg>
);

export function Sidebar({
  user,
  counts,
  unread,
  syncHealth,
  mockMode,
  initialCollapsed = false,
}: {
  user: { id: string; name: string; email: string; role: "admin" | "staff" };
  counts: InboxCounts | null;
  unread: number;
  syncHealth: "ok" | "attention" | "missing" | null;
  mockMode: boolean;
  initialCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname, params]);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // Desktop only: shrink the sidebar to a slim rail so the page gets the width. Remembered per browser.
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
    const shell = document.getElementById("app-shell");
    if (shell) shell.dataset.sidebar = next ? "collapsed" : "open";
  };

  const isAdmin = user.role === "admin";
  const view = pathname === "/inbox" ? (params.get("view") ?? "all") : null;

  const inbox: NavItem[] = [
    { href: "/inbox", label: "All" },
    { href: "/sent", label: "Sent" },
    { href: "/inbox?view=new", label: "New", count: counts?.new },
    { href: "/inbox?view=unassigned", label: "Unassigned", count: counts?.unassigned, alert: true },
    { href: "/inbox?view=mine", label: "My emails", count: counts?.mine },
    { href: "/inbox?view=in_progress", label: "In progress", count: counts?.in_progress },
    { href: "/inbox?view=waiting", label: "Waiting", count: counts?.waiting },
    { href: "/inbox?view=overdue", label: "Overdue", count: counts?.overdue, alert: true },
    { href: "/inbox?view=resolved", label: "Resolved" },
    { href: "/inbox?view=updates", label: "Updates & newsletters", count: counts?.updates },
    { href: "/inbox?view=junk", label: "Junk", count: counts?.junk },
  ];
  const main: NavItem[] = [
    ...(isAdmin ? [{ href: "/team", label: "Team" }, { href: "/analytics", label: "Analytics" }] : []),
    { href: "/activity", label: "Activity" },
  ];
  const admin: NavItem[] = [
    { href: "/settings", label: "Setup overview" },
    { href: "/settings/staff", label: "Staff" },
    { href: "/settings/gmail", label: "Gmail connection" },
    { href: "/settings/categories", label: "Categories" },
    { href: "/settings/junk", label: "Junk senders" },
    { href: "/settings/sla", label: "SLA & notifications" },
  ];

  const isActive = (href: string) => {
    if (href.startsWith("/inbox")) {
      const v = new URL(href, "http://x").searchParams.get("view") ?? "all";
      return view === v;
    }
    return href === "/settings" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  };

  const link = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className={cx(
        "flex items-center justify-between rounded-md px-3 py-1.5 text-sm transition-colors",
        isActive(item.href) ? "bg-stone-100 font-semibold text-ink" : "text-muted hover:bg-stone-50 hover:text-ink",
      )}
    >
      <span>{item.label}</span>
      {!!item.count && (
        <span
          className={cx(
            "tabular min-w-6 rounded-full px-1.5 text-center text-xs font-semibold",
            item.alert ? "bg-brand-500 text-white" : "bg-stone-200 text-stone-700",
          )}
        >
          {item.count}
        </span>
      )}
    </Link>
  );

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-5">
        <Logo size={30} />
        <div className="flex-1 leading-tight">
          <div className="font-semibold text-ink">Motogari</div>
          <div className="text-xs text-muted">Team inbox</div>
        </div>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="hidden rounded-md p-1.5 text-muted hover:bg-stone-100 hover:text-ink lg:block"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <ChevronIcon />
        </button>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        <div className="space-y-0.5">
          {link({ href: "/dashboard", label: "Dashboard" })}
          {link({ href: "/notifications", label: "Notifications", count: unread, alert: true })}
        </div>
        <div>
          <div className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Inbox</div>
          <div className="space-y-0.5">{inbox.map(link)}</div>
        </div>
        <div className="space-y-0.5">{main.map(link)}</div>
        {isAdmin && (
          <div>
            <div className="mb-1 flex items-center justify-between px-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <span>Settings</span>
              {syncHealth && syncHealth !== "ok" && (
                <span className="rounded bg-amber-50 px-1.5 text-amber-900 normal-case ring-1 ring-amber-200">
                  {syncHealth === "missing" ? "Gmail not connected" : "Sync attention"}
                </span>
              )}
            </div>
            <div className="space-y-0.5">{admin.map(link)}</div>
          </div>
        )}
      </div>
      {mockMode && (
        <div className="mx-3 mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Development mailbox active — not connected to Gmail.
        </div>
      )}
      <div className="space-y-3 border-t border-line p-3">
        <ThemeToggle />
        <div className="flex items-center gap-2.5 px-1">
          <Avatar name={user.name} size={32} />
          <div className="min-w-0 flex-1 leading-tight">
            <Link href="/account" className="block truncate text-sm font-medium text-ink hover:underline">{user.name}</Link>
            <div className="truncate text-xs text-muted">{isAdmin ? "Admin / CEO" : "Staff"}</div>
          </div>
          <form action={logout}>
            <button className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:bg-stone-100 hover:text-ink">Sign out</button>
          </form>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      {collapsed ? (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-14 flex-col items-center gap-1 border-r border-line bg-side py-4 lg:flex">
          <button type="button" onClick={toggleCollapsed} className="mb-3 rounded-md p-1" aria-label="Expand sidebar" title="Expand sidebar">
            <Logo size={28} />
          </button>
          {[
            { href: "/inbox", label: "Inbox", icon: <InboxIcon />, dot: !!counts?.unassigned },
            { href: "/sent", label: "Sent", icon: <SendIcon />, dot: false },
            { href: "/notifications", label: "Notifications", icon: <BellIcon />, dot: unread > 0 },
          ].map((i) => (
            <Link
              key={i.href}
              href={i.href}
              title={i.label}
              aria-label={i.label}
              className={cx("relative rounded-md p-2", pathname === i.href ? "bg-stone-100 text-ink" : "text-muted hover:bg-stone-50 hover:text-ink")}
            >
              {i.icon}
              {i.dot && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand-500" />}
            </Link>
          ))}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="mt-auto rounded-md p-2 text-muted hover:bg-stone-100 hover:text-ink"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronIcon flip />
          </button>
        </aside>
      ) : (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-side lg:block">{nav}</aside>
      )}

      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} className="btn-ghost -ml-2 px-2" aria-label="Open navigation">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <Logo size={24} /> Motogari
        </Link>
        <Link href="/notifications" className="relative btn-ghost -mr-2 px-2" aria-label={`${unread} unread notifications`}>
          <BellIcon />
          {unread > 0 && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-brand-500" />}
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85%] overflow-y-auto bg-side shadow-xl">{nav}</aside>
        </div>
      )}
    </>
  );
}
