import { ActionForm } from "@/components/ActionForm";
import { Avatar, cx, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { AppUser } from "@/lib/types";
import { createStaff, resetStaffPassword, setStaffActive, updateStaff } from "../actions";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const { user: me, supabase } = await requireAdmin();
  const { data } = await supabase.from("users").select("*").order("is_active", { ascending: false }).order("name");
  const users = (data as AppUser[]) ?? [];

  return (
    <>
      <PageHeader title="Staff" subtitle="Every person signs in with their own account. Nobody needs the Gmail password." />

      <section className="card mb-6 p-5">
        <h2 className="mb-4 font-semibold">Add staff member</h2>
        <ActionForm action={createStaff} submit="Add staff" resetOnSuccess className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label" htmlFor="n">Name</label><input id="n" className="input" name="name" required /></div>
            <div><label className="label" htmlFor="e">Email</label><input id="e" className="input" name="email" type="email" required /></div>
            <div>
              <label className="label" htmlFor="r">Role</label>
              <select id="r" className="input" name="role" defaultValue="staff">
                <option value="staff">Staff</option>
                <option value="admin">Admin / CEO</option>
              </select>
            </div>
            <div><label className="label" htmlFor="d">Department</label><input id="d" className="input" name="department" placeholder="e.g. Bookings" /></div>
          </div>
        </ActionForm>
      </section>

      <ul className="space-y-3">
        {users.map((u) => (
          <li key={u.id} className={cx("card p-4", !u.is_active && "opacity-70")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex min-w-0 items-center gap-3 lg:w-64">
                <Avatar name={u.name} size={36} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{u.name}{u.id === me.id && <span className="text-muted"> (you)</span>}</div>
                  <div className="truncate text-xs text-muted">{u.email}</div>
                  <div className="text-xs text-muted">
                    {u.is_active ? `Last login ${formatDateTime(u.last_login_at)}` : <span className="font-semibold text-red-700">Deactivated</span>}
                  </div>
                </div>
              </div>
              <ActionForm action={updateStaff} submit="Save" submitClass="btn-secondary" className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
                <input type="hidden" name="id" value={u.id} />
                <div className="flex-1"><label className="label">Name</label><input className="input" name="name" defaultValue={u.name} required /></div>
                <div>
                  <label className="label">Role</label>
                  <select className="input" name="role" defaultValue={u.role}>
                    <option value="staff">Staff</option>
                    <option value="admin">Admin / CEO</option>
                  </select>
                </div>
                <div className="flex-1"><label className="label">Department</label><input className="input" name="department" defaultValue={u.department ?? ""} /></div>
              </ActionForm>
              {u.id !== me.id && (
                <div className="flex flex-wrap gap-2 lg:flex-col">
                  <ActionForm action={resetStaffPassword} submit="Reset password" submitClass="btn-ghost text-xs" confirm={`Generate a new temporary password for ${u.name}?`}>
                    <input type="hidden" name="id" value={u.id} />
                  </ActionForm>
                  <ActionForm
                    action={setStaffActive}
                    submit={u.is_active ? "Deactivate" : "Reactivate"}
                    submitClass={u.is_active ? "btn-danger text-xs" : "btn-secondary text-xs"}
                    confirm={u.is_active ? `Deactivate ${u.name}? They will be signed out and their open emails return to Unassigned.` : undefined}
                  >
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="active" value={u.is_active ? "false" : "true"} />
                  </ActionForm>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">Accounts are deactivated, never deleted, so the audit history always stays intact.</p>
    </>
  );
}
