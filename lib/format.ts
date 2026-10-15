export const TIMEZONE = "Africa/Nairobi";

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(new Date(iso));
}

export function formatShort(iso: string | null | undefined, now = new Date()) {
  if (!iso) return "—";
  const d = new Date(iso);
  const dayKey = (x: Date) => x.toLocaleDateString("en-GB", { timeZone: TIMEZONE });
  if (dayKey(d) === dayKey(now)) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
  }
  const yesterday = new Date(now.getTime() - 86400_000);
  if (dayKey(d) === dayKey(yesterday)) return "Yesterday";
  const sameYear = d.toLocaleDateString("en-GB", { year: "numeric", timeZone: TIMEZONE }) ===
    now.toLocaleDateString("en-GB", { year: "numeric", timeZone: TIMEZONE });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: TIMEZONE });
}

export function formatRelative(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const text = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

export function formatMinutes(mins: number | null | undefined) {
  if (mins == null) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  if (mins < 1440) return `${(mins / 60).toFixed(1)} h`;
  return `${(mins / 1440).toFixed(1)} d`;
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function initials(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
