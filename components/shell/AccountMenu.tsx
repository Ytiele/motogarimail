"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/(auth)/actions";
import { Avatar } from "@/components/ui";

/** Gmail-style account menu behind the avatar in the top bar. */
export function AccountMenu({ name, contact, roleLabel }: { name: string; contact: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative ml-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-1 hover:bg-hover"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        title={`${name} · ${roleLabel}`}
      >
        <Avatar name={name} size={32} />
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-50 w-72 rounded-3xl bg-white p-4 shadow-[0_4px_16px_rgba(60,64,67,.3)] ring-1 ring-line">
          <div className="flex flex-col items-center text-center">
            <Avatar name={name} size={64} />
            <div className="mt-3 text-base text-ink">Hi, {name.split(/\s+/)[0]}!</div>
            <div className="max-w-full truncate text-sm text-muted">{contact}</div>
            <div className="mt-1 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-ink-2">{roleLabel}</div>
          </div>
          <div className="mt-4 space-y-2">
            <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className="btn-secondary w-full">
              My account &amp; password
            </Link>
            <form action={logout}>
              <button role="menuitem" className="btn-brand w-full">Sign out</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
