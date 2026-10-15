import "server-only";
import { randomBytes } from "node:crypto";
import { adminDb } from "../supabase/admin";
import { formatAddress } from "./address";
import { htmlToText } from "./parse";
import type { MailProvider, OutgoingMessage, ParsedMessage } from "./types";

// DEVELOPMENT ONLY. A database-backed fake mailbox so the real sync pipeline can be exercised
// without Google credentials. It is clearly labelled in the UI and never claims to be Gmail.
export const MOCK_MAILBOX_ADDRESS = "dev-mailbox@motogari.test";

const newId = () => randomBytes(8).toString("hex");

export class MockMailProvider implements MailProvider {
  readonly kind = "mock" as const;

  async getProfile() {
    const { data } = await adminDb().from("mock_mailbox").select("history_id").order("history_id", { ascending: false }).limit(1);
    return { emailAddress: MOCK_MAILBOX_ADDRESS, historyId: String(data?.[0]?.history_id ?? 0) };
  }

  async listMessageIds({ query }: { query: string }) {
    const days = Number(query.match(/newer_than:(\d+)d/)?.[1] ?? 30);
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data, error } = await adminDb().from("mock_mailbox").select("id").gte("created_at", since).order("history_id", { ascending: false });
    if (error) throw error;
    return { ids: (data ?? []).map((r) => r.id as string) };
  }

  async listHistory(startHistoryId: string) {
    const { data, error } = await adminDb()
      .from("mock_mailbox")
      .select("id, history_id")
      .gt("history_id", Number(startHistoryId))
      .order("history_id");
    if (error) throw error;
    const last = data?.at(-1)?.history_id ?? Number(startHistoryId);
    return { messageIds: (data ?? []).map((r) => r.id as string), historyId: String(last) };
  }

  async listThreadMessageIds(threadId: string) {
    const { data } = await adminDb().from("mock_mailbox").select("id").eq("thread_id", threadId).order("history_id");
    return (data ?? []).map((r) => r.id as string);
  }

  async getMessage(id: string): Promise<ParsedMessage> {
    const { data, error } = await adminDb().from("mock_mailbox").select("message").eq("id", id).single();
    if (error) throw error;
    return data.message as ParsedMessage;
  }

  async send(message: OutgoingMessage, threadId: string) {
    const id = newId();
    const parsed: ParsedMessage = {
      id,
      threadId,
      labelIds: ["SENT"],
      internalDate: new Date().toISOString(),
      messageIdHeader: `<${id}@motogari.test>`,
      inReplyTo: message.inReplyTo,
      references: message.references,
      from: message.from,
      replyTo: null,
      to: message.to.map(formatAddress).join(", "),
      cc: message.cc.map(formatAddress).join(", ") || null,
      bcc: null,
      subject: message.subject,
      text: message.text,
      html: message.html,
      snippet: message.text.slice(0, 140),
      attachments: [],
    };
    const { error } = await adminDb().from("mock_mailbox").insert({ id, thread_id: threadId, message: parsed });
    if (error) throw error;
    return { id, threadId };
  }

  async getAttachment(messageId: string, partId: string) {
    const msg = await this.getMessage(messageId);
    const att = msg.attachments.find((a) => a.partId === partId);
    if (!att) throw new Error("Attachment not found");
    return { data: Buffer.from(att.inlineData ?? "", "base64"), mimeType: att.mimeType, filename: att.filename };
  }
}

export async function injectMockInbound(input: {
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  withAttachment?: boolean;
}) {
  const id = newId();
  const threadId = input.threadId || newId();
  const msg: ParsedMessage = {
    id,
    threadId,
    labelIds: ["INBOX", "UNREAD"],
    internalDate: new Date().toISOString(),
    messageIdHeader: `<${id}@customer.test>`,
    inReplyTo: input.inReplyTo ?? null,
    references: input.inReplyTo ?? null,
    from: { name: input.fromName, email: input.fromEmail.toLowerCase() },
    replyTo: null,
    to: MOCK_MAILBOX_ADDRESS,
    cc: null,
    bcc: null,
    subject: input.subject,
    text: htmlToText(input.body),
    html: null,
    snippet: input.body.slice(0, 140),
    attachments: input.withAttachment
      ? [
          {
            partId: "1",
            attachmentId: null,
            filename: "booking-details.txt",
            mimeType: "text/plain",
            size: 64,
            contentId: null,
            inlineData: Buffer.from("Sample attachment from the development mailbox.\n").toString("base64"),
          },
        ]
      : [],
  };
  const { error } = await adminDb().from("mock_mailbox").insert({ id, thread_id: threadId, message: msg });
  if (error) throw error;
  return { id, threadId };
}
