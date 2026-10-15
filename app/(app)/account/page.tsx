import { NewPasswordForm } from "@/components/auth/forms";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const { user } = await requireUser();
  return (
    <>
      <PageHeader title="My account" />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted">Name</dt><dd>{user.name}</dd>
            <dt className="text-muted">Email</dt><dd>{user.email}</dd>
            <dt className="text-muted">Role</dt><dd>{user.role === "admin" ? "Admin / CEO" : "Staff"}</dd>
            <dt className="text-muted">Department</dt><dd>{user.department ?? "—"}</dd>
          </dl>
        </section>
        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Change password</h2>
          <NewPasswordForm doneHref="/account" />
        </section>
      </div>
    </>
  );
}
