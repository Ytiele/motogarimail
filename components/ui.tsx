import Link from "next/link";
import type { ReactNode } from "react";
import { initials } from "@/lib/format";
import { PRIORITY_LABEL, STATUS_LABEL, type Priority, type Status } from "@/lib/workflow";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const STATUS_STYLE: Record<Status, { dot: string; chip: string }> = {
  new: { dot: "bg-blue-500", chip: "bg-blue-50 text-blue-800 ring-blue-200" },
  assigned: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-800 ring-violet-200" },
  in_progress: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-900 ring-amber-200" },
  waiting: { dot: "bg-cyan-600", chip: "bg-cyan-50 text-cyan-900 ring-cyan-200" },
  resolved: { dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  no_action: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-700 ring-slate-200" },
  junk: { dot: "bg-rose-400", chip: "bg-rose-50 text-rose-800 ring-rose-200" },
  archived: { dot: "bg-stone-400", chip: "bg-stone-100 text-stone-600 ring-stone-200" },
};

export function StatusBadge({ status, size = "sm" }: { status: Status; size?: "sm" | "lg" }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ring-1 ring-inset",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
        s.chip,
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority, hideNormal = false }: { priority: Priority; hideNormal?: boolean }) {
  if (hideNormal && priority === "normal") return null;
  const cls: Record<Priority, string> = {
    low: "text-stone-500 bg-stone-100",
    normal: "text-stone-700 bg-stone-100",
    high: "text-orange-800 bg-orange-100",
    urgent: "text-[#fff] bg-red-600",
  };
  return (
    <span className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide uppercase", cls[priority])}>
      {priority === "urgent" && <span aria-hidden className="mr-1">!</span>}
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="inline-flex items-center rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-red-700 uppercase ring-1 ring-red-200 ring-inset">
      Overdue
    </span>
  );
}

// Gmail-style: each person gets a stable colour derived from their name.
const AVATAR_COLORS = ["#d7262e", "#e8710a", "#188038", "#1a73e8", "#9334e6", "#007b83", "#b06000", "#5f6368"];
function avatarColor(name: string | null | undefined) {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white"
      style={{ width: size, height: size, fontSize: size < 30 ? 11 : size < 38 ? 13 : 16, background: avatarColor(name), color: "#fff" }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Assignee({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-sm font-medium text-red-700">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Avatar name={name} size={22} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-normal text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <svg className="mb-3 text-stone-300" width="48" height="48" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
        <path d="M3 11l2-7h10l2 7v5H3v-5zm0 0h4l1 2h4l1-2h4" />
      </svg>
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {right}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  href,
  tone = "default",
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: "default" | "alert" | "brand" | "good";
  hint?: string;
}) {
  const toneCls = {
    default: "",
    alert: Number(value) > 0 ? "border-red-300 bg-red-50/60" : "",
    brand: Number(value) > 0 ? "border-brand-100 bg-brand-50" : "",
    good: "",
  }[tone];
  const valueCls = {
    default: "text-ink",
    alert: Number(value) > 0 ? "text-red-700" : "text-ink",
    brand: Number(value) > 0 ? "text-brand-700" : "text-ink",
    good: "text-emerald-700",
  }[tone];
  const inner = (
    <>
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</div>
      <div className={cx("tabular mt-2 text-3xl font-semibold tracking-tight", valueCls)}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </>
  );
  const cls = cx("card block p-4 transition", toneCls, href && "hover:border-stone-400 hover:shadow-sm");
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
