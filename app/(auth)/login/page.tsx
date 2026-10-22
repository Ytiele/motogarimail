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
      subtitle="Use your own Motogari staff account to continue to the team inbox."
      highlights={[
        "Every customer email has one clear owner.",
        "Opening an email never marks it as handled.",
        "Your own login — nobody needs the company Gmail password.",
      ]}
      footer={<>Need an account? Ask your administrator.</>}
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}
