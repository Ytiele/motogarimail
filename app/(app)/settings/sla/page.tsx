import { ActionForm } from "@/components/ActionForm";
import { PageHeader, PriorityBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { PRIORITIES, type Priority } from "@/lib/workflow";
import { saveSla } from "../actions";

export const metadata = { title: "SLA & notifications" };

export default async function SlaPage() {
  const { supabase } = await requireAdmin();
  const [{ data: rules }, { data: importSetting }] = await Promise.all([
    supabase.from("sla_rules").select("*"),
    supabase.from("app_settings").select("value").eq("key", "import_as_active").maybeSingle(),
  ]);
  const byPriority = new Map((rules ?? []).map((r) => [r.priority as Priority, r]));

  return (
    <>
      <PageHeader
        title="SLA & notifications"
        subtitle="An email becomes overdue when it is still New, Assigned or In progress past its deadline. The clock pauses while waiting on the customer."
      />
      <ActionForm action={saveSla} submit="Save settings" className="space-y-6">
        <section className="card overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-stone-50 text-xs text-muted uppercase">
              <tr>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Resolve within (hours)</th>
                <th className="px-4 py-2">Warn owner before (minutes)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PRIORITIES.map((p) => {
                const r = byPriority.get(p);
                return (
                  <tr key={p}>
                    <td className="px-4 py-3"><PriorityBadge priority={p} /></td>
                    <td className="px-4 py-3">
                      <input className="input w-28" type="number" step="0.25" min="0.25" name={`${p}_hours`} defaultValue={r ? r.resolution_minutes / 60 : 24} required aria-label={`${p} hours`} />
                    </td>
                    <td className="px-4 py-3">
                      <input className="input w-28" type="number" min="0" name={`${p}_warn`} defaultValue={r?.warn_before_minutes ?? 60} required aria-label={`${p} warning minutes`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <section className="card space-y-2 p-5 text-sm">
          <h2 className="font-semibold">Imported history</h2>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="import_as_active" defaultChecked={importSetting?.value === true} className="mt-1" />
            <span>Treat emails imported when Gmail is first connected as active work (status New) instead of Archived.</span>
          </label>
        </section>
        <section className="card p-5 text-sm text-muted">
          <h2 className="mb-1 font-semibold text-ink">Notifications</h2>
          In-app notifications are sent only for: an email assigned or reassigned to you, a customer reply on your conversation,
          an SLA warning on your conversation, and overdue emails (owner plus admins). Each alert is delivered once.
        </section>
      </ActionForm>
    </>
  );
}
