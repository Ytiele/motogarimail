import Link from "next/link";
import { NewPasswordForm } from "@/components/auth/forms";
import { ChatShell } from "@/components/chat/ChatShell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "My account" };
export const dynamic = "force-dynamic";

// Account page inside the chat shell, so chat-only people can change their password and theme.
export default async function ChatAccountPage() {
  const { user } = await requireUser();
  return (
    <ChatShell user={user}>
      <div className="mx-auto max-w-md overflow-y-auto p-6">
        <Link href="/chat" className="text-sm text-muted hover:text-ink">← Back to chat</Link>
        <h1 className="mt-3 text-[22px] text-ink">My account</h1>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">Name</dt><dd>{user.name}</dd>
          {user.phone ? (<><dt className="text-muted">Phone</dt><dd>{user.phone}</dd></>) : (<><dt className="text-muted">Email</dt><dd>{user.email}</dd></>)}
        </dl>
        <h2 className="mt-8 mb-3 font-medium">Change password</h2>
        <NewPasswordForm doneHref="/chat" />
        <h2 className="mt-8 mb-3 font-medium">Theme</h2>
        <div className="w-56"><ThemeToggle /></div>
      </div>
    </ChatShell>
  );
}
