import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { JoinForm } from "@/components/auth/forms";
import { findValidInvite } from "@/lib/invites";

export const metadata = { title: "Set up your account" };
export const dynamic = "force-dynamic";

// One-time set-up link sent by an admin (copy or WhatsApp). Viewing it does not use it up; saving the password does.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findValidInvite(token);
  if (!invite) {
    return (
      <AuthCard title="Link expired" subtitle="This set-up link has expired or was already used. Ask your administrator for a new one.">
        <Link href="/login" className="btn-brand h-11 w-full">Go to sign in</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={`Welcome, ${invite.name.split(/\s+/)[0]}`} subtitle={invite.phone ? `You will sign in with ${invite.phone}` : undefined}>
      <JoinForm token={token} />
    </AuthCard>
  );
}
