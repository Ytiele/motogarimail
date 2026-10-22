import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { isPhoneLoginEmail } from "@/lib/phone";
import { NewPasswordForm } from "@/components/auth/forms";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <AuthCard title="Link expired" subtitle="This password reset link is invalid or has expired.">
        <Link href="/forgot-password" className="btn-primary w-full">Request a new link</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle={isPhoneLoginEmail(user.email) ? undefined : user.email}>
      <NewPasswordForm />
    </AuthCard>
  );
}
