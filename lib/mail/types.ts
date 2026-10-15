export type Address = { name: string | null; email: string };

export type ParsedAttachment = {
  partId: string;
  attachmentId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  /** base64 (standard) content when the provider returns it inline */
  inlineData?: string | null;
};

export type ParsedMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDate: string;
  messageIdHeader: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: Address | null;
  replyTo: string | null;
  to: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  snippet: string | null;
  attachments: ParsedAttachment[];
  /** Headers that mark bulk / automated mail. */
  bulk?: { listId: string | null; listUnsubscribe: string | null; precedence: string | null; autoSubmitted: string | null } | null;
};

export type OutgoingMessage = {
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  text: string;
  html: string;
  inReplyTo: string | null;
  references: string | null;
};

export interface MailProvider {
  readonly kind: "gmail" | "mock";
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
  listMessageIds(opts: { query: string; pageToken?: string }): Promise<{ ids: string[]; nextPageToken?: string }>;
  /** Returns null when the start history id is too old and a full resync is needed. */
  listHistory(startHistoryId: string): Promise<{ messageIds: string[]; historyId: string } | null>;
  listThreadMessageIds(threadId: string): Promise<string[]>;
  getMessage(id: string): Promise<ParsedMessage>;
  send(message: OutgoingMessage, threadId: string): Promise<{ id: string; threadId: string }>;
  getAttachment(messageId: string, partId: string): Promise<{ data: Buffer; mimeType: string; filename: string }>;
  watch?(): Promise<{ historyId: string; expiration: string } | null>;
}

export class MailAuthError extends Error {}
