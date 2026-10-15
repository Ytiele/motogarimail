import type { ParsedMessage } from "./types";

const GMAIL_CATEGORY: Record<string, string> = {
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
};

const NO_REPLY_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|mailer-daemon|postmaster|alerts?|newsletters?|news|updates?|marketing|bounce[s]?)$/i;

/**
 * Returns why a message looks like a newsletter or automatic notification (so it needs no owner),
 * or null when it looks like a real person writing in. Staff can always override the decision.
 */
export function automatedReason(msg: Pick<ParsedMessage, "labelIds" | "from" | "bulk">): string | null {
  const b = msg.bulk;
  if (b?.listUnsubscribe || b?.listId) return "Newsletter or mailing list";
  if (b?.precedence && /^(bulk|list|junk)$/i.test(b.precedence.trim())) return "Bulk email";
  if (b?.autoSubmitted && !/^no$/i.test(b.autoSubmitted.trim())) return "Automatic notification";
  const local = msg.from?.email.split("@")[0] ?? "";
  if (NO_REPLY_LOCAL.test(local) || /no-?reply/i.test(local)) return "Sent from a no-reply address";
  for (const label of msg.labelIds) {
    if (GMAIL_CATEGORY[label]) return `Gmail filed it under ${GMAIL_CATEGORY[label]}`;
  }
  return null;
}
