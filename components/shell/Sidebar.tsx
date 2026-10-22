"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/(auth)/actions";
import { Logo } from "@/components/auth/AuthCard";
import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar, cx } from "@/components/ui";
import { isPhoneLoginEmail } from "@/lib/phone";
import { SIDEBAR_COOKIE } from "@/lib/theme";
import type { InboxCounts } from "@/lib/types";

// Outline icons on a 20px grid, Gmail-style.
const ICONS = {
  menu: "M3 5h14M3 10h14M3 15h14",
  search: "M8.5 14a5.5 5.5 0 100-11 5.5 5.5 0 000 11zM12.5 12.5L17 17",
  dashboard: "M3 3h6v8H3zM11 3h6v5h-6zM11 10h6v7h-6zM3 13h6v4H3z",
  bell: "M5 8a5 5 0 0110 0c0 5 2 6 2 6H3s2-1 2-6M8.5 17a1.7 1.7 0 003 0",
  inbox: "M3 11l2-7h10l2 7v5H3v-5zm0 0h4l1 2h4l1-2h4",
  sent: "M3 10l14-6-5 14-2.5-5.5L3 10z",
  star: "M10 2.5l2.3 4.7 5.2.8-3.8 3.7.9 5.2L10 14.4l-4.6 2.5.9-5.2L2.5 8l5.2-.8z",
  addPerson: "M8 9a3 3 0 100-6 3 3 0 000 6zM2.5 16.5a5.5 5.5 0 0111 0M15.5 6v6M12.5 9h6",
  person: "M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3.5 17a6.5 6.5 0 0113 0",
  clock: "M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10 6v4l2.5 2.5",
  hourglass: "M5.5 2.5h9M5.5 17.5h9M6.5 2.5c0 4 7 4 7 7.5s-7 3.5-7 7.5M13.5 2.5c0 4-7 4-7 7.5s7 3.5 7 7.5",
  alert: "M10 3l7.5 13h-15zM10 8v4M10 14.5v.5",
  check: "M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM6.8 10.2l2.2 2.2 4.3-4.6",
  tag: "M3 3h7l7 7-7 7-7-7zM6.5 6.5h.01",
  ban: "M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM4.7 4.7l10.6 10.6",
  team: "M7 9a3 3 0 100-6 3 3 0 000 6zM1.5 16.5a5.5 5.5 0 0111 0M13.5 9a2.5 2.5 0 100-5M14.5 11.5a4.5 4.5 0 014 5",
  chart: "M3 17h14M5.5 14V9M10 14V5M14.5 14v-3",
  pulse: "M2.5 10h3l2-5 3.5 10 2-5h4.5",
  gear: "M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8",
  mail: "M2.5 5h15v10h-15zM2.5 5l7.5 6 7.5-6",
} as const;
type IconName = keyof typeof ICONS;

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

type NavItem = { href: string; label: string; icon: IconName; count?: number; alert?: boolean };

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
  // Desktop only: shrink the menu to an icon rail so the page gets the width. Remembered per browser.
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
    const shell = document.getElementById("app-shell");
    if (shell) shell.dataset.sidebar = next ? "collapsed" : "open";
  };

  const isAdmin = user.role === "admin";
  const onInbox = pathname === "/inbox";
  const view = onInbox ? (params.get("view") ?? "all") : null;

  const inbox: NavItem[] = [
    { href: "/inbox", label: "Inbox", icon: "inbox" },
    { href: "/inbox?view=new", label: "New", icon: "star", count: counts?.new },
    { href: "/inbox?view=unassigned", label: "Unassigned", icon: "addPerson", count: counts?.unassigned, alert: true },
    { href: "/inbox?view=mine", label: "My emails", icon: "person", count: counts?.mine },
    { href: "/inbox?view=in_progress", label: "In progress", icon: "clock", count: counts?.in_progress },
    { href: "/inbox?view=waiting", label: "Waiting", icon: "hourglass", count: counts?.waiting },
    { href: "/inbox?view=overdue", label: "Overdue", icon: "alert", count: counts?.overdue, alert: true },
    { href: "/sent", label: "Sent", icon: "sent" },
    { href: "/inbox?view=resolved", label: "Resolved", icon: "check" },
    { href: "/inbox?view=updates", label: "Updates & newsletters", icon: "tag", count: counts?.updates },
    { href: "/inbox?view=junk", label: "Junk", icon: "ban", count: counts?.junk },
  ];
  const main: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/notifications", label: "Notifications", icon: "bell", count: unread, alert: true },
    ...(isAdmin ? [{ href: "/team", label: "Team", icon: "team" as const }, { href: "/analytics", label: "Analytics", icon: "chart" as const }] : []),
    { href: "/activity", label: "Activity", icon: "pulse" },
  ];
  const admin: NavItem[] = [
    { href: "/settings", label: "Setup overview", icon: "gear" },
    { href: "/settings/staff", label: "Staff", icon: "team" },
    { href: "/settings/gmail", label: "Gmail connection", icon: "mail" },
    { href: "/settings/categories", label: "Categories", icon: "tag" },
    { href: "/settings/junk", label: "Junk senders", icon: "ban" },
    { href: "/settings/sla", label: "SLA & notifications", icon: "clock" },
  ];

  const isActive = (href: string) => {
    if (href.startsWith("/inbox")) {
      const v = new URL(href, "http://x").searchParams.get("view") ?? "all";
      return view === v;
    }
    return href === "/settings" ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  };

  const link = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cx(
          "flex h-8 items-center gap-4 rounded-r-full pr-4 pl-6 text-sm transition-colors",
          active ? "bg-brand-100 font-bold text-ink" : "text-ink-2 hover:bg-hover",
        )}
      >
        <span className={active ? "text-ink" : "text-muted"}><Icon name={item.icon} /></span>
        <span className="flex-1 truncate">{item.label}</span>
        {!!item.count && <span className={cx("tabular text-xs font-bold", item.alert ? "text-brand-600" : "")}>{item.count}</span>}
      </Link>
    );
  };

  const railLink = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.count ? `${item.label} (${item.count})` : item.label}
        aria-label={item.label}
        className={cx("relative mx-auto flex h-8 w-14 items-center justify-center rounded-full", active ? "bg-brand-100 text-ink" : "text-muted hover:bg-hover hover:text-ink")}
      >
        <Icon name={item.icon} />
        {!!item.count && item.alert && <span className="absolute top-1 right-3 h-2 w-2 rounded-full bg-brand-500" />}
      </Link>
    );
  };

  const heading = (text: string, extra?: React.ReactNode) => (
    <div className="mt-4 mb-1 flex items-center justify-between pr-4 pl-6 text-xs font-medium text-muted">
      <span>{text}</span>
      {extra}
    </div>
  );

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto py-2 pr-2">
        <div className="space-y-px">{inbox.map(link)}</div>
        {heading("Workspace")}
        <div className="space-y-px">{main.map(link)}</div>
        {isAdmin && (
          <>
            {heading(
              "Settings",
              syncHealth && syncHealth !== "ok" && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 ring-1 ring-amber-200">
                  {syncHealth === "missing" ? "Gmail not connected" : "Sync attention"}
                </span>
              ),
            )}
            <div className="space-y-px">{admin.map(link)}</div>
          </>
        )}
      </div>
      {mockMode && (
        <div className="mx-3 mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Development mailbox active — not connected to Gmail.
        </div>
      )}
      <div className="space-y-3 px-4 pt-2 pb-4">
        <ThemeToggle />
        <form action={logout}>
          <button className="w-full rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-ink">Sign out</button>
        </form>
      </div>
    </nav>
  );

  const q = onInbox ? (params.get("q") ?? "") : "";

  return (
    <>
      {/* Top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-2 bg-canvas px-2 sm:px-3">
        <button type="button" onClick={() => setOpen(true)} className="icon-btn lg:hidden" aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="icon-btn hidden lg:inline-flex"
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <Icon name="menu" />
        </button>
        <Link href="/inbox" className="flex shrink-0 items-center gap-2 pr-2 lg:w-[11.5rem]">
          <Logo size={30} />
          <span className="hidden text-[22px] leading-none text-ink-2 sm:inline">Motogari</span>
        </Link>
        <form action="/inbox" method="get" className="min-w-0 flex-1 lg:max-w-3xl">
          {onInbox && view !== "all" && view && <input type="hidden" name="view" value={view} />}
          <label className="flex h-12 items-center gap-3 rounded-full bg-search px-4 text-muted focus-within:bg-white focus-within:shadow-md">
            <Icon name="search" />
            <input
              key={q}
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search mail"
              aria-label="Search mail"
              className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
        </form>
        <div className="ml-auto flex items-center gap-1">
          {isAdmin && syncHealth && syncHealth !== "ok" && (
            <Link href="/settings/gmail" className="hidden rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200 md:inline">
              {syncHealth === "missing" ? "Gmail not connected" : "Sync needs attention"}
            </Link>
          )}
          <ChatLauncher me={{ id: user.id, name: user.name, role: user.role }} />
          <Link href="/notifications" className="icon-btn relative" aria-label={`${unread} unread notifications`} title="Notifications">
            <Icon name="bell" />
            {unread > 0 && <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-brand-500" />}
          </Link>
          <AccountMenu name={user.name} contact={isPhoneLoginEmail(user.email) ? "Signs in with phone number" : user.email} roleLabel={isAdmin ? "Admin / CEO" : "Staff"} />
        </div>
      </header>

      {/* Desktop menu */}
      {collapsed ? (
        <aside className="fixed top-16 bottom-0 left-0 z-20 hidden w-[4.5rem] flex-col gap-1 overflow-y-auto py-2 lg:flex">
          {inbox.map(railLink)}
          <div className="my-2 border-t border-line" />
          {main.map(railLink)}
          {isAdmin && railLink({ href: "/settings", label: "Settings", icon: "gear" })}
        </aside>
      ) : (
        <aside className="fixed top-16 bottom-0 left-0 z-20 hidden w-64 bg-side lg:block">{nav}</aside>
      )}

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-side shadow-xl">
            <div className="flex h-16 shrink-0 items-center gap-2 px-4">
              <Logo size={28} />
              <span className="text-xl text-ink-2">Motogari</span>
            </div>
            <div className="min-h-0 flex-1">{nav}</div>
          </aside>
        </div>
      )}
    </>
  );
}
