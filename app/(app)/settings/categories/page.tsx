import { ActionForm } from "@/components/ActionForm";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import type { Category } from "@/lib/types";
import { saveCategory } from "../actions";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const { supabase } = await requireAdmin();
  const { data } = await supabase.from("categories").select("*").order("sort_order").order("name");
  const categories = (data as Category[]) ?? [];

  return (
    <>
      <PageHeader title="Categories" subtitle="Used to group conversations and in analytics. Hidden categories stay on existing emails." />
      <section className="card mb-6 p-5">
        <h2 className="mb-3 font-semibold">Add category</h2>
        <ActionForm action={saveCategory} submit="Add" resetOnSuccess className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><label className="label" htmlFor="cn">Name</label><input id="cn" className="input" name="name" required /></div>
          <div><label className="label" htmlFor="cc">Colour</label><input id="cc" className="h-10 w-16 rounded-lg border border-line" type="color" name="color" defaultValue="#64748b" /></div>
        </ActionForm>
      </section>
      <ul className="card divide-y divide-line">
        {categories.map((c) => (
          <li key={c.id} className="p-3">
            <ActionForm action={saveCategory} submit="Save" submitClass="btn-secondary" className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input type="hidden" name="id" value={c.id} />
              <input className="h-9 w-12 shrink-0 rounded border border-line" type="color" name="color" defaultValue={c.color} aria-label="Colour" />
              <input className="input flex-1" name="name" defaultValue={c.name} required aria-label="Name" />
              <select className="input sm:w-36" name="is_active" defaultValue={String(c.is_active)} aria-label="Visibility">
                <option value="true">Active</option>
                <option value="false">Hidden</option>
              </select>
            </ActionForm>
          </li>
        ))}
      </ul>
    </>
  );
}
