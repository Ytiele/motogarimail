"use client";

import { useState, type ReactNode } from "react";
import { Avatar, cx } from "@/components/ui";

export type ThreadEntry = {
  key: string;
  kind: "email" | "note";
  /** The full, server-rendered message or note. */
  node: ReactNode;
  /** One-line summary shown while an email is collapsed. */
  summary?: { name: string; avatarName: string; snippet: string; date: string; dateTitle: string; hasAttachments: boolean };
};

const Clip = () => (
  <svg className="shrink-0 text-muted" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-label="Has attachments">
    <path d="M13 7.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5l5.6-5.6a2.1 2.1 0 013 3L6.2 11.3a1 1 0 01-1.5-1.5L10 4.5" />
  </svg>
);

/**
 * Gmail-style thread: older emails fold into one-line rows and the newest stays open. Long threads
 * also hide the middle behind an "N older messages" divider. Internal notes are always shown.
 */
export function ThreadView({ entries }: { entries: ThreadEntry[] }) {
  const emailIdx = entries.flatMap((e, i) => (e.kind === "email" ? [i] : []));
  const latestKey = emailIdx.length ? entries[emailIdx[emailIdx.length - 1]].key : null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(latestKey ? [latestKey] : []));
  const [showAll, setShowAll] = useState(false);

  // Like Gmail: first message, a divider for the hidden middle, then the last three.
  const fold = !showAll && emailIdx.length >= 5;
  const hideFrom = fold ? emailIdx[0] + 1 : -1;
  const hideTo = fold ? emailIdx[emailIdx.length - 3] - 1 : -2;
  const hiddenEmails = fold ? emailIdx.length - 4 : 0;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allEmails = entries.filter((e) => e.kind === "email").map((e) => e.key);
  const everyOpen = allEmails.length > 0 && allEmails.every((k) => open.has(k));

  return (
    <div className="min-w-0">
      {allEmails.length > 1 && (
        <div className="mb-2 flex items-center justify-end gap-1 text-xs">
          <span className="mr-auto text-muted">{allEmails.length} messages</span>
          <button
            type="button"
            className="rounded-full px-3 py-1.5 font-medium text-brand-600 hover:bg-hover"
            onClick={() => {
              if (everyOpen) {
                setOpen(new Set());
              } else {
                setOpen(new Set(allEmails));
                setShowAll(true);
              }
            }}
          >
            {everyOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {entries.map((e, i) => {
          if (i >= hideFrom && i <= hideTo) {
            if (i !== hideFrom) return null;
            return (
              <div key="older" className="relative py-1">
                <div className="absolute inset-x-0 top-1/2 border-t border-line" aria-hidden />
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="relative mx-auto flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 text-sm font-medium text-ink-2 shadow-sm hover:bg-hover"
                >
                  <span className="tabular flex h-6 min-w-6 items-center justify-center rounded-full bg-stone-100 px-1.5 text-xs">{hiddenEmails}</span>
                  older messages
                </button>
              </div>
            );
          }
          if (e.kind === "note") return <div key={e.key}>{e.node}</div>;

          if (open.has(e.key) || !e.summary) {
            return (
              <div
                key={e.key}
                // Clicking an open message's header folds it back, as in Gmail (links and buttons still work).
                onClick={(ev) => {
                  const t = ev.target as HTMLElement;
                  if (t.closest("header") && !t.closest("a,button")) toggle(e.key);
                }}
                className="[&_header]:cursor-pointer"
              >
                {e.node}
              </div>
            );
          }
          const s = e.summary;
          return (
            <button
              key={e.key}
              type="button"
              onClick={() => toggle(e.key)}
              className={cx("flex w-full items-center gap-3 border-b border-line py-2.5 text-left hover:bg-hover sm:px-1")}
              aria-label={`Show message from ${s.name}, ${s.dateTitle}`}
            >
              <Avatar name={s.avatarName} size={32} />
              <span className="w-36 shrink-0 truncate text-sm font-bold text-ink sm:w-44">{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted">{s.snippet}</span>
              {s.hasAttachments && <Clip />}
              <span className="tabular shrink-0 text-xs text-muted" title={s.dateTitle}>{s.date}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
