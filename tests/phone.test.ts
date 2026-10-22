import { describe, expect, it } from "vitest";
import { isPhoneLoginEmail, normalizePhone, phoneLoginEmail, staffContact, whatsappLink } from "@/lib/phone";

describe("normalizePhone", () => {
  it("accepts Kenyan local and international formats", () => {
    for (const input of ["0712345678", "0712 345 678", "712345678", "254712345678", "+254 712 345 678", "+254-712-345-678", "00254712345678"]) {
      expect(normalizePhone(input)).toBe("+254712345678");
    }
    expect(normalizePhone("0110 123 456")).toBe("+254110123456");
  });
  it("accepts other countries in international format", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
  });
  it("rejects things that are not phone numbers", () => {
    for (const input of ["", "abc", "12345", "jane@motogari.com", "+254 12345", "0812345678"]) {
      expect(normalizePhone(input)).toBeNull();
    }
  });
});

describe("phone sign-in placeholder", () => {
  it("maps a phone to a private address that is recognised and never shown", () => {
    const email = phoneLoginEmail("+254712345678");
    expect(email).toBe("p254712345678@phone.motogari.invalid");
    expect(isPhoneLoginEmail(email)).toBe(true);
    expect(isPhoneLoginEmail("jane@motogari.com")).toBe(false);
    expect(staffContact({ email, phone: "+254712345678" })).toBe("+254712345678");
    expect(staffContact({ email: "jane@motogari.com", phone: null })).toBe("jane@motogari.com");
  });
  it("builds a WhatsApp share link", () => {
    expect(whatsappLink("+254712345678", "Hi & welcome")).toBe("https://wa.me/254712345678?text=Hi%20%26%20welcome");
  });
});
