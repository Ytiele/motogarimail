import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { SetupForm } from "@/components/auth/forms";
import { hasAnyUser } from "@/lib/bootstrap";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasAnyUser()) redirect("/login");
  return (
    <AuthCard title="Welcome to Motogari Inbox" subtitle="Step 1 of 4 — create the first administrator (CEO) account.">
      <SetupForm />
    </AuthCard>
  );
}
