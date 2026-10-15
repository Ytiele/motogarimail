import type { Address } from "./types";

function splitOutsideQuotes(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let inAngle = false;
  for (const ch of input) {
    if (ch === '"') inQuote = !inQuote;
    else if (ch === "<" && !inQuote) inAngle = true;
    else if (ch === ">" && !inQuote) inAngle = false;
    if (ch === "," && !inQuote && !inAngle) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

export function parseAddress(raw: string): Address | null {
  const s = raw.trim();
  if (!s) return null;
  const angle = s.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
    return { name: name || null, email: angle[2].trim().toLowerCase() };
  }
  if (s.includes("@")) return { name: null, email: s.replace(/^"|"$/g, "").toLowerCase() };
  return null;
}

export function parseAddressList(raw: string | null | undefined): Address[] {
  if (!raw) return [];
  return splitOutsideQuotes(raw)
    .map(parseAddress)
    .filter((a): a is Address => !!a);
}

const EMAIL_RE = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\]+$/;

export function isValidEmail(email: string) {
  return EMAIL_RE.test(email);
}

export function formatAddress(a: Address) {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}
