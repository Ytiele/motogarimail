// Phone sign-in for staff without a company email. Pure helpers, shared by server actions and tests.

/**
 * Normalises a phone number to E.164 (+2547…). Kenyan local formats are assumed when there is no
 * country code: 07XXXXXXXX / 01XXXXXXXX / 7XXXXXXXX. Returns null if it is not a plausible number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!/^[+\d][\d\s().-]*$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (/^0[17]\d{8}$/.test(digits)) {
    digits = `254${digits.slice(1)}`;
  } else if (/^[17]\d{8}$/.test(digits)) {
    digits = `254${digits}`;
  }
  if (digits.startsWith("254") && !/^254[17]\d{8}$/.test(digits)) return null;
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

// Supabase Auth needs an email per account. Phone-only staff get a private placeholder on the reserved
// ".invalid" domain (RFC 2606), which can never receive mail, so no reset link can ever leak anywhere.
export const PHONE_LOGIN_DOMAIN = "phone.motogari.invalid";

export function phoneLoginEmail(e164: string) {
  return `p${e164.replace(/\D/g, "")}@${PHONE_LOGIN_DOMAIN}`;
}

export function isPhoneLoginEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(`@${PHONE_LOGIN_DOMAIN}`);
}

/** What to show for a staff member's sign-in: their phone, or their real email. */
export function staffContact(u: { email: string; phone?: string | null }) {
  return u.phone || (isPhoneLoginEmail(u.email) ? "—" : u.email);
}

/** wa.me link that opens WhatsApp with the set-up message ready to send. */
export function whatsappLink(e164: string, text: string) {
  return `https://wa.me/${e164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}
