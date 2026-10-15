"use client";

import { useEffect, useState } from "react";
import { THEME_KEY as KEY } from "@/lib/theme";
import { cx } from "./ui";

type Pref = "light" | "dark" | "system";

function apply(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function ThemeToggle({ tone = "light" }: { tone?: "light" | "dark" }) {
  const [pref, setPref] = useState<Pref>("system");

  useEffect(() => {
    try {
      setPref((localStorage.getItem(KEY) as Pref) || "system");
    } catch {}
  }, []);

  useEffect(() => {
    apply(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  const choose = (p: Pref) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {}
  };

  const options: { value: Pref; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cx("grid grid-cols-3 gap-0.5 rounded-lg p-0.5 text-xs", tone === "dark" ? "bg-white/10" : "bg-stone-100")}
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => choose(o.value)}
          className={cx(
            "rounded-md px-2 py-1 font-medium transition-colors",
            pref === o.value
              ? tone === "dark" ? "bg-white/20 text-white" : "bg-white text-ink shadow-sm"
              : tone === "dark" ? "text-stone-400 hover:text-white" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
