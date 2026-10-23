"use client";

import { useState } from "react";
import { cx } from "@/components/ui";

/** Name/role/department plus a choice of how the person signs in: company email, or phone number. */
export function AddStaffFields() {
  const [method, setMethod] = useState<"email" | "phone">("phone");
  const tab = (value: typeof method, label: string) => (
    <button
      type="button"
      onClick={() => setMethod(value)}
      className={cx("rounded-full px-4 py-1.5 text-sm font-medium", method === value ? "bg-brand-100 text-ink" : "text-muted hover:bg-hover")}
      aria-pressed={method === value}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-4">
      <input type="hidden" name="method" value={method} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Signs in with</span>
        {tab("phone", "Phone number")}
        {tab("email", "Company email")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><label className="label" htmlFor="n">Name</label><input id="n" className="input" name="name" required /></div>
        {method === "phone" ? (
          <div>
            <label className="label" htmlFor="ph">Phone number</label>
            <input id="ph" className="input" name="phone" type="tel" inputMode="tel" placeholder="0712 345 678" required />
          </div>
        ) : (
          <div><label className="label" htmlFor="e">Email</label><input id="e" className="input" name="email" type="email" required /></div>
        )}
        <div>
          <label className="label" htmlFor="r">Role</label>
          <select id="r" className="input" name="role" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="admin">Admin / CEO</option>
            <option value="chat">Chat only (no email access)</option>
          </select>
        </div>
        <div><label className="label" htmlFor="d">Department</label><input id="d" className="input" name="department" placeholder="e.g. Bookings" /></div>
      </div>
      <p className="text-xs text-muted">
        {method === "phone"
          ? "You'll get a one-time link to send them (copy or WhatsApp). They open it and choose their own password, then sign in with their phone number."
          : "A temporary password is shown once. They sign in with their email and change it under “My account”."}
      </p>
    </div>
  );
}
