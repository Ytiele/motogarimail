"use client";

import { useEffect, useRef, useState } from "react";
import { searchContacts } from "@/app/(app)/inbox/[id]/actions";
import { Avatar, cx } from "@/components/ui";
import { formatAddress, isValidEmail, parseAddressList } from "@/lib/mail/address";
import type { Address } from "@/lib/mail/types";

/**
 * Gmail-style recipients: addresses become chips; typing a name or address suggests people we have
 * emailed with or staff. The form receives a comma-separated list in a hidden input named `name`.
 */
export function RecipientInput({
  name,
  label,
  initial = "",
  placeholder,
  autoFocus,
  action,
}: {
  name: string;
  label: string;
  initial?: string;
  placeholder?: string;
  autoFocus?: boolean;
  action?: React.ReactNode;
}) {
  const [chips, setChips] = useState<Address[]>(() => parseAddressList(initial));
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<{ name: string | null; email: string }[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      searchContacts(q)
        .then((list) => {
          if (cancelled) return;
          const taken = new Set(chips.map((c) => c.email));
          setSuggestions(list.filter((s) => !taken.has(s.email)));
          setHighlight(0);
        })
        .catch(() => {});
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, chips]);

  const add = (list: Address[]) => {
    if (!list.length) return;
    setChips((prev) => {
      const seen = new Set(prev.map((c) => c.email));
      return [...prev, ...list.filter((a) => a.email && !seen.has(a.email) && seen.add(a.email))];
    });
    setText("");
    setSuggestions([]);
  };
  const commitText = () => {
    const list = parseAddressList(text.replace(/;/g, ","));
    if (list.length) add(list);
  };

  const open = focused && suggestions.length > 0;
  // Anything typed but not yet turned into a chip still counts when the form is sent.
  const value = [...chips.map(formatAddress), ...(text.trim() ? [text.trim()] : [])].join(", ");

  return (
    <div className="relative">
      <div className="flex items-end justify-between">
        <label className="label" htmlFor={`${name}-input`}>{label}</label>
        {action}
      </div>
      <input type="hidden" name={name} value={value} />
      <div
        className="flex min-h-10 flex-wrap items-center gap-1 rounded-lg border border-line bg-white px-1.5 py-1 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100"
        onClick={() => input.current?.focus()}
      >
        {chips.map((c) => {
          const valid = isValidEmail(c.email);
          return (
            <span
              key={c.email}
              title={formatAddress(c)}
              className={cx(
                "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pr-1 pl-0.5 text-sm",
                valid ? "bg-stone-100 text-ink" : "bg-red-50 text-red-800 ring-1 ring-red-200",
              )}
            >
              <Avatar name={c.name ?? c.email} size={20} />
              <span className="truncate">{c.name ?? c.email}</span>
              <button
                type="button"
                className="rounded-full px-1 text-muted hover:bg-stone-200 hover:text-ink"
                onClick={(e) => {
                  e.stopPropagation();
                  setChips((prev) => prev.filter((x) => x.email !== c.email));
                }}
                aria-label={`Remove ${c.email}`}
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          id={`${name}-input`}
          className="min-w-32 flex-1 bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-stone-400 focus:outline-none"
          value={text}
          autoFocus={autoFocus}
          autoComplete="off"
          placeholder={chips.length ? "" : placeholder}
          onChange={(e) => {
            const v = e.target.value;
            // Typing a comma or semicolon finishes the address, as in Gmail.
            if (/[,;]\s*$/.test(v)) {
              const list = parseAddressList(v.replace(/;/g, ","));
              if (list.length) return add(list);
            }
            setText(v);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setTimeout(() => setFocused(false), 150);
            commitText();
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[,;\n]/.test(pasted)) {
              e.preventDefault();
              add(parseAddressList(pasted.replace(/[;\n]/g, ",")));
            }
          }}
          onKeyDown={(e) => {
            if (open && e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (open && e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" || e.key === "Tab") {
              if (open) {
                e.preventDefault();
                add([suggestions[highlight]]);
              } else if (text.trim()) {
                e.preventDefault();
                commitText();
              }
            } else if (e.key === "Backspace" && !text && chips.length) {
              setChips((prev) => prev.slice(0, -1));
            } else if (e.key === "Escape") {
              setSuggestions([]);
            }
          }}
          aria-autocomplete="list"
          aria-expanded={open}
        />
      </div>
      {open && (
        <ul role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-xl bg-white py-1 shadow-[0_4px_16px_rgba(60,64,67,.3)] ring-1 ring-line">
          {suggestions.map((s, i) => (
            <li key={s.email} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add([s])}
                onMouseEnter={() => setHighlight(i)}
                className={cx("flex w-full items-center gap-3 px-3 py-2 text-left", i === highlight && "bg-hover")}
              >
                <Avatar name={s.name ?? s.email} size={28} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{s.name ?? s.email}</span>
                  {s.name && <span className="block truncate text-xs text-muted">{s.email}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
