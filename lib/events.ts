import "server-only";
import { adminDb } from "./supabase/admin";

export type EventType =
  | "email_received"
  | "customer_replied"
  | "conversation_reopened"
  | "email_opened"
  | "email_assigned"
  | "email_unassigned"
  | "status_changed"
  | "reply_sent"
  | "note_added"
  | "email_resolved"
  | "priority_changed"
  | "category_changed"
  | "staff_created"
  | "staff_updated"
  | "staff_deactivated"
  | "staff_reactivated"
  | "gmail_connected"
  | "gmail_disconnected"
  | "settings_changed"
  | "junk_sender_added"
  | "junk_sender_removed";

export async function logEvent(e: {
  type: EventType;
  conversationId?: string | null;
  emailId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await adminDb()
    .from("email_events")
    .insert({
      event_type: e.type,
      conversation_id: e.conversationId ?? null,
      email_id: e.emailId ?? null,
      user_id: e.userId ?? null,
      metadata: e.metadata ?? {},
    });
  if (error) console.error("[audit] failed to log event", e.type, error.message);
}

export const EVENT_LABEL: Record<string, string> = {
  email_received: "Email received",
  customer_replied: "Customer replied",
  conversation_reopened: "Conversation reopened",
  email_opened: "Opened",
  email_assigned: "Assigned",
  email_unassigned: "Unassigned",
  status_changed: "Status changed",
  reply_sent: "Reply sent",
  note_added: "Internal note added",
  email_resolved: "Resolved",
  priority_changed: "Priority changed",
  category_changed: "Category changed",
  staff_created: "Staff account created",
  staff_updated: "Staff account updated",
  staff_deactivated: "Staff account deactivated",
  staff_reactivated: "Staff account reactivated",
  gmail_connected: "Gmail connected",
  gmail_disconnected: "Gmail disconnected",
  settings_changed: "Settings changed",
  junk_sender_added: "Sender added to junk list",
  junk_sender_removed: "Sender removed from junk list",
};
