import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { ForgotForm } from "@/components/auth/forms";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset password" subtitle="We'll email you a secure link." footer={<Link href="/login" className="underline">Back to sign in</Link>}>
      <ForgotForm />
    </AuthCard>
  );
}
