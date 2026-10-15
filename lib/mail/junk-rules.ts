// Pure helpers for the junk-sender list. Shared by the sync engine, server actions and the UI.

export type JunkRuleKind = "address" | "domain";
export type JunkRule = { kind: JunkRuleKind; value: string };

// Blocking one of these domains would send every customer using that provider to Junk.
const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com", "zoho.com", "yandex.com",
]);

export function senderDomain(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** Whole-domain blocking is offered only for company domains, never shared providers or our own domain. */
export function canBlockDomain(domain: string | null, ownDomain?: string | null) {
  return !!domain && !SHARED_DOMAINS.has(domain) && domain !== ownDomain?.toLowerCase();
}

/** Accepts "someone@example.com" or "@example.com" / "example.com" (whole domain). */
export function parseJunkPattern(input: string): JunkRule | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@") && !s.startsWith("@")) {
    return /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/.test(s) ? { kind: "address", value: s } : null;
  }
  const domain = senderDomain(`x@${s.replace(/^@/, "")}`);
  return domain ? { kind: "domain", value: domain } : null;
}

export function ruleMatches(rule: JunkRule, email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (rule.kind === "address") return e === rule.value;
  const domain = senderDomain(e);
  return !!domain && (domain === rule.value || domain.endsWith(`.${rule.value}`));
}

export function describeRule(rule: JunkRule) {
  return rule.kind === "address" ? rule.value : `anyone @${rule.value}`;
}
