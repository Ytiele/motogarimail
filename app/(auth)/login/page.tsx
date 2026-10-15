import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/forms";
import { getSession } from "@/lib/auth";
import { hasAnyUser } from "@/lib/bootstrap";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  if (!(await hasAnyUser())) redirect("/setup");
  const { next } = await searchParams;
  return (
    <AuthCard
      title="Sign in"
      subtitle="Use your own Motogari staff account."
      footer={<>Need an account? Ask your administrator.</>}
    >
      <LoginForm next={next} />
      <p className="mt-4 text-xs text-muted">
        You never need the company Gmail password here. <Link href="/forgot-password" className="underline">Reset your password</Link>.
      </p>
    </AuthCard>
  );
}
