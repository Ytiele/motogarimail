import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { ChatShell } from "@/components/chat/ChatShell";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Team chat" };
export const dynamic = "force-dynamic";

// Full-screen team chat. Chat-only accounts land here and cannot leave it; email users can open it too.
export default async function ChatPage() {
  const { user } = await requireUser();
  return (
    <ChatShell user={user}>
      <ChatLauncher me={{ id: user.id, name: user.name, role: user.role }} variant="page" />
    </ChatShell>
  );
}
