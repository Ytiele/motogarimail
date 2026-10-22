import type { Priority, Role, Status } from "./workflow";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  /** Set for staff who sign in with their phone number instead of an email. */
  phone: string | null;
  role: Role;
  department: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
};

export type Category = { id: string; name: string; color: string; sort_order: number; is_active: boolean };

export type Conversation = {
  id: string;
  gmail_thread_id: string;
  subject: string;
  customer_name: string | null;
  customer_email: string | null;
  status: Status;
  priority: Priority;
  assigned_to: string | null;
  category_id: string | null;
  snippet: string | null;
  message_count: number;
  has_attachments: boolean;
  is_historical: boolean;
  filed_reason: string | null;
  reopened_count: number;
  first_inbound_at: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_activity_at: string;
  first_response_at: string | null;
  first_response_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  sla_started_at: string | null;
  sla_due_at: string | null;
  version: number;
  created_at: string;
};

export type EmailRow = {
  id: string;
  conversation_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  message_id: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  direction: "inbound" | "outbound";
  sender_name: string | null;
  sender_email: string | null;
  reply_to: string | null;
  recipient_email: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  received_at: string;
  has_attachments: boolean;
  sent_by: string | null;
};

export type Attachment = {
  id: string;
  email_id: string;
  filename: string;
  mime_type: string;
  size: number;
};

export type NoteRow = { id: string; conversation_id: string; user_id: string; note: string; created_at: string };

export type EventRow = {
  id: number;
  conversation_id: string | null;
  email_id: string | null;
  user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type InboxRow = {
  id: string;
  subject: string;
  customer_name: string | null;
  customer_email: string | null;
  status: Status;
  priority: Priority;
  assigned_to: string | null;
  assignee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  snippet: string | null;
  message_count: number;
  has_attachments: boolean;
  reopened_count: number;
  last_message_at: string | null;
  last_activity_at: string;
  sla_due_at: string | null;
  is_overdue: boolean;
  total_count: number;
};

export type InboxCounts = Record<
  "new" | "unassigned" | "assigned" | "in_progress" | "waiting" | "overdue" | "urgent" | "mine" | "updates" | "junk" | "resolved_today",
  number
>;

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  conversation_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
