import "server-only";
import { decrypt, encrypt } from "../crypto";
import { env } from "../env";
import { adminDb } from "../supabase/admin";
import { buildMime, toBase64Url } from "./mime";
import { base64UrlToBuffer, parseGmailMessage, type GmailMessage, type GmailPart } from "./parse";
import { MailAuthError, type MailProvider, type OutgoingMessage, type ParsedMessage } from "./types";

// Minimum scopes: read mail + send replies. No modify/delete access is requested.
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function buildGoogleAuthUrl(state: string) {
  const params = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: env.googleRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
      ...body,
    }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new MailAuthError("Google authorization was revoked or expired. Reconnect Gmail.");
    throw new Error(`Google token request failed (${res.status}: ${json.error ?? "unknown"})`);
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: env.googleRedirectUri() });
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => {});
}

export type GmailConnectionRow = {
  id: string;
  email_address: string;
  encrypted_refresh_token: string | null;
  encrypted_access_token: string | null;
  access_token_expires_at: string | null;
};

export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  private accessToken: string | null = null;
  private expiresAt = 0;

  constructor(private conn: GmailConnectionRow) {
    if (conn.encrypted_access_token && conn.access_token_expires_at) {
      try {
        this.accessToken = decrypt(conn.encrypted_access_token);
        this.expiresAt = new Date(conn.access_token_expires_at).getTime();
      } catch {
        this.accessToken = null;
      }
    }
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    if (!this.conn.encrypted_refresh_token) throw new MailAuthError("No Gmail refresh token stored. Reconnect Gmail.");
    const t = await tokenRequest({ refresh_token: decrypt(this.conn.encrypted_refresh_token), grant_type: "refresh_token" });
    this.accessToken = t.access_token;
    this.expiresAt = Date.now() + t.expires_in * 1000;
    await adminDb()
      .from("mail_connections")
      .update({ encrypted_access_token: encrypt(t.access_token), access_token_expires_at: new Date(this.expiresAt).toISOString() })
      .eq("id", this.conn.id);
    return t.access_token;
  }

  private async call<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });
    if (res.status === 401 && attempt === 0) {
      this.accessToken = null;
      return this.call(path, init, 1);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      return this.call(path, init, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(`Gmail API ${res.status}: ${body?.error?.message ?? res.statusText}`) as Error & { status: number };
      err.status = res.status;
      if (res.status === 401 || res.status === 403) throw Object.assign(new MailAuthError(err.message), { status: res.status });
      throw err;
    }
    return (await res.json()) as T;
  }

  async getProfile() {
    return this.call<{ emailAddress: string; historyId: string }>("/profile");
  }

  async listMessageIds({ query, pageToken }: { query: string; pageToken?: string }) {
    const params = new URLSearchParams({ q: query, maxResults: "500" });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await this.call<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${params}`);
    return { ids: (r.messages ?? []).map((m) => m.id), nextPageToken: r.nextPageToken };
  }

  async listHistory(startHistoryId: string) {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    try {
      do {
        const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
        if (pageToken) params.set("pageToken", pageToken);
        const r = await this.call<{
          history?: { messagesAdded?: { message: { id: string } }[] }[];
          historyId: string;
          nextPageToken?: string;
        }>(`/history?${params}`);
        r.history?.forEach((h) => h.messagesAdded?.forEach((m) => ids.add(m.message.id)));
        historyId = r.historyId ?? historyId;
        pageToken = r.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return { messageIds: [...ids], historyId };
  }

  async listThreadMessageIds(threadId: string) {
    const r = await this.call<{ messages?: { id: string }[] }>(`/threads/${encodeURIComponent(threadId)}?format=minimal`);
    return (r.messages ?? []).map((m) => m.id);
  }

  private getRaw(id: string) {
    return this.call<GmailMessage>(`/messages/${encodeURIComponent(id)}?format=full`);
  }

  async getMessage(id: string): Promise<ParsedMessage> {
    return parseGmailMessage(await this.getRaw(id));
  }

  async send(message: OutgoingMessage, threadId: string) {
    return this.call<{ id: string; threadId: string }>("/messages/send", {
      method: "POST",
      body: JSON.stringify({ raw: toBase64Url(buildMime(message)), threadId }),
    });
  }

  async getAttachment(messageId: string, partId: string) {
    // Gmail attachment ids are not stable across fetches, so resolve the part fresh each time.
    const raw = await this.getRaw(messageId);
    const find = (p: GmailPart | undefined): GmailPart | null => {
      if (!p) return null;
      if (p.partId === partId) return p;
      for (const c of p.parts ?? []) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    const part = find(raw.payload);
    if (!part) throw new Error("Attachment not found in message");
    let data: Buffer;
    if (part.body?.attachmentId) {
      const r = await this.call<{ data: string }>(
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
      );
      data = base64UrlToBuffer(r.data);
    } else {
      data = base64UrlToBuffer(part.body?.data ?? "");
    }
    return { data, mimeType: part.mimeType ?? "application/octet-stream", filename: part.filename || "attachment" };
  }

  async watch() {
    const topicName = env.pubsubTopic();
    if (!topicName) return null;
    return this.call<{ historyId: string; expiration: string }>("/watch", {
      method: "POST",
      body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }),
    });
  }
}
