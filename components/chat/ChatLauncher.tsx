"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markChatRead, prepareChatUpload, sendChatMessage, type ChatMessage } from "@/app/(app)/chat/actions";
import { Avatar, cx } from "@/components/ui";
import { formatBytes, formatShort } from "@/lib/format";
import { browserDb } from "@/lib/supabase/browser";

type Peer = { id: string; name: string; role: "admin" | "staff"; department: string | null };
type Pending = { name: string; size: number; type: string; status: "uploading" | "ready" | "error"; path?: string; preview?: string; error?: string };

const IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;
const fileUrl = (id: string) => `/api/chat-files/${id}`;
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(new Date(iso));

const Svg = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const CHAT = "M4 4h12a1 1 0 011 1v8a1 1 0 01-1 1H9l-4 3v-3H4a1 1 0 01-1-1V5a1 1 0 011-1z";
const CLOSE = "M5 5l10 10M15 5L5 15";
const BACK = "M16 10H4M9 5l-5 5 5 5";
const CLIP = "M15 9l-5.6 5.6a3.4 3.4 0 01-4.8-4.8l6-6a2.2 2.2 0 013.2 3.2L7.9 13a1.1 1.1 0 01-1.6-1.6L11.6 6";
const SEND = "M3 10l14-6-5 14-2.5-5.5L3 10z";

/** Top-bar chat button + right-hand team chat panel (direct messages between staff). */
export function ChatLauncher({ me }: { me: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ peerId: string; name: string; body: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  const peerRef = useRef(peerId);
  openRef.current = open;
  peerRef.current = peerId;

  const merge = useCallback((rows: ChatMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      rows.forEach((r) => map.set(r.id, { ...map.get(r.id), ...r }));
      return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  // Staff directory + my recent messages, then live updates (RLS limits both to what I may see).
  useEffect(() => {
    const db = browserDb();
    db.from("users").select("id, name, role, department").eq("is_active", true).neq("id", me.id).order("name")
      .then(({ data }) => setPeers((data as Peer[]) ?? []));
    db.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => merge((data as ChatMessage[]) ?? []));
    const channel = db
      .channel("motogari-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        if (!m?.id) return;
        merge([m]);
        if (payload.eventType === "INSERT" && m.recipient_id === me.id) {
          if (openRef.current && peerRef.current === m.sender_id) {
            markChatRead(m.sender_id).catch(() => {});
          } else {
            setToast({ peerId: m.sender_id, name: "", body: m.body ?? (m.attachment_name ? `📎 ${m.attachment_name}` : "New message") });
            setTimeout(() => setToast(null), 6000);
          }
        }
      })
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [me.id, merge]);

  const peerName = (id: string) => peers.find((p) => p.id === id)?.name ?? "A colleague";
  const unreadFrom = (id: string) => messages.filter((m) => m.sender_id === id && m.recipient_id === me.id && !m.read_at).length;
  const unreadTotal = messages.filter((m) => m.recipient_id === me.id && !m.read_at).length;
  const lastWith = (id: string) => [...messages].reverse().find((m) => m.sender_id === id || m.recipient_id === id);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return peers
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q))
      .map((p) => ({ p, last: lastWith(p.id) }))
      .sort((a, b) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? "") || a.p.name.localeCompare(b.p.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, messages, query]);

  const thread = peerId ? messages.filter((m) => (m.sender_id === peerId && m.recipient_id === me.id) || (m.sender_id === me.id && m.recipient_id === peerId)) : [];

  // Opening a conversation: load its history and mark it read.
  useEffect(() => {
    if (!open || !peerId) return;
    browserDb()
      .from("chat_messages")
      .select("*")
      .or(`and(sender_id.eq.${me.id},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${me.id})`)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => merge((data as ChatMessage[]) ?? []));
    const now = new Date().toISOString();
    setMessages((prev) => prev.map((m) => (m.sender_id === peerId && m.recipient_id === me.id && !m.read_at ? { ...m, read_at: now } : m)));
    markChatRead(peerId).catch(() => {});
  }, [open, peerId, me.id, merge]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread.length, peerId, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resetComposer = () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setPending(null);
    setText("");
  };

  async function attach(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    const type = file.type || "application/octet-stream";
    const p: Pending = { name: file.name || "image.png", size: file.size, type, status: "uploading", preview: IMAGE.test(type) ? URL.createObjectURL(file) : undefined };
    setPending(p);
    const prep = await prepareChatUpload(p.name, p.size);
    if (!prep.ok) {
      setPending({ ...p, status: "error", error: prep.error });
      return;
    }
    const { error: upErr } = await browserDb().storage.from("chat").uploadToSignedUrl(prep.path, prep.token, file, { contentType: type });
    setPending(upErr ? { ...p, status: "error", error: "Upload failed" } : { ...p, status: "ready", path: prep.path });
  }

  async function send() {
    if (!peerId || sending) return;
    const body = text.trim();
    if (!body && pending?.status !== "ready") return;
    setSending(true);
    setError(null);
    const r = await sendChatMessage({
      to: peerId,
      body,
      attachment: pending?.status === "ready" && pending.path ? { path: pending.path, name: pending.name, type: pending.type, size: pending.size } : null,
    });
    setSending(false);
    if (!r.ok) return setError(r.error);
    merge([r.message]);
    resetComposer();
  }

  const openWith = (id: string) => {
    setPeerId(id);
    setOpen(true);
    setToast(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx("icon-btn relative", open && "bg-brand-100 text-ink")}
        aria-label={unreadTotal ? `Team chat, ${unreadTotal} unread` : "Team chat"}
        aria-expanded={open}
        title="Team chat"
      >
        <Svg d={CHAT} />
        {unreadTotal > 0 && (
          <span className="tabular absolute top-1 right-1 min-w-4 rounded-full bg-brand-500 px-1 text-center text-[10px] leading-4 font-bold text-[#fff]">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {toast && !open && (
        <button
          type="button"
          onClick={() => openWith(toast.peerId)}
          className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-2xl bg-white p-3 text-left shadow-[0_4px_16px_rgba(60,64,67,.3)] ring-1 ring-line"
        >
          <Avatar name={peerName(toast.peerId)} size={32} />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{peerName(toast.peerId)}</span>
            <span className="block truncate text-sm text-muted">{toast.body}</span>
          </span>
        </button>
      )}

      {open && (
        <aside
          className="fixed top-16 right-0 bottom-0 z-30 flex w-full flex-col bg-white shadow-[0_0_24px_rgba(60,64,67,.25)] sm:w-[380px] lg:bottom-4 lg:rounded-l-2xl"
          aria-label="Team chat"
        >
          {!peerId ? (
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <h2 className="text-lg text-ink">Team chat</h2>
                <button type="button" className="icon-btn h-9 w-9" onClick={() => setOpen(false)} aria-label="Close chat">
                  <Svg d={CLOSE} size={18} />
                </button>
              </div>
              <div className="px-4 pb-2">
                <input
                  className="h-10 w-full rounded-full bg-search px-4 text-sm text-ink placeholder:text-muted focus:bg-white focus:shadow-md focus:outline-none"
                  placeholder="Search people"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search people"
                />
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
                {list.map(({ p, last }) => {
                  const unread = unreadFrom(p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => openWith(p.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                        <Avatar name={p.name} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cx("truncate text-sm", unread ? "font-bold text-ink" : "text-ink")}>{p.name}</span>
                            {last && <span className="tabular shrink-0 text-xs text-muted">{formatShort(last.created_at)}</span>}
                          </span>
                          <span className="flex items-center justify-between gap-2">
                            <span className={cx("truncate text-xs", unread ? "font-semibold text-ink" : "text-muted")}>
                              {last
                                ? `${last.sender_id === me.id ? "You: " : ""}${last.body ?? (last.attachment_name ? `📎 ${last.attachment_name}` : "")}`
                                : (p.department ?? (p.role === "admin" ? "Admin" : "Staff"))}
                            </span>
                            {unread > 0 && <span className="tabular shrink-0 rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-[#fff]">{unread}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!list.length && <li className="px-4 py-8 text-center text-sm text-muted">{peers.length ? "Nobody matches that search." : "No other staff yet. Add them under Settings → Staff."}</li>}
              </ul>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-line px-2 py-2">
                <button type="button" className="icon-btn h-9 w-9" onClick={() => setPeerId(null)} aria-label="Back to people">
                  <Svg d={BACK} size={18} />
                </button>
                <Avatar name={peerName(peerId)} size={32} />
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{peerName(peerId)}</div>
                <button type="button" className="icon-btn h-9 w-9" onClick={() => setOpen(false)} aria-label="Close chat">
                  <Svg d={CLOSE} size={18} />
                </button>
              </div>

              <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
                {!thread.length && <p className="py-10 text-center text-sm text-muted">Say hello to {peerName(peerId).split(/\s+/)[0]} 👋</p>}
                {thread.map((m, i) => {
                  const mine = m.sender_id === me.id;
                  const isImage = m.attachment_path && IMAGE.test(m.attachment_type ?? "");
                  const lastMine = mine && !thread.slice(i + 1).some((x) => x.sender_id === me.id);
                  return (
                    <div key={m.id} className={cx("flex flex-col", mine ? "items-end" : "items-start")}>
                      <div className={cx("max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap", mine ? "rounded-br-md bg-brand-100 text-ink" : "rounded-bl-md bg-stone-100 text-ink")}>
                        {isImage && (
                          <a href={fileUrl(m.id)} target="_blank" rel="noopener" className="mb-1 block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(m.id)} alt={m.attachment_name ?? ""} className="max-h-60 rounded-lg object-cover" loading="lazy" />
                          </a>
                        )}
                        {m.attachment_path && !isImage && (
                          <a href={fileUrl(m.id)} className="mb-1 flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 hover:underline">
                            <Svg d={CLIP} size={16} />
                            <span className="min-w-0 truncate font-medium">{m.attachment_name}</span>
                            {m.attachment_size ? <span className="shrink-0 text-xs text-muted">{formatBytes(m.attachment_size)}</span> : null}
                          </a>
                        )}
                        {m.body}
                      </div>
                      <span className="mt-0.5 px-1 text-[10px] text-muted">
                        {timeOf(m.created_at)}
                        {lastMine && m.read_at ? " · Seen" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-line p-3">
                {pending && (
                  <div className={cx("mb-2 flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm", pending.status === "error" ? "bg-red-50" : "bg-canvas")}>
                    {pending.preview ? <img src={pending.preview} alt="" className="h-10 w-10 rounded object-cover" /> : <Svg d={CLIP} size={16} />}
                    <span className="min-w-0 flex-1 truncate">{pending.name}</span>
                    <span className="shrink-0 text-xs text-muted">{pending.status === "uploading" ? "Uploading…" : pending.status === "error" ? pending.error : formatBytes(pending.size)}</span>
                    <button type="button" className="rounded-full px-1.5 text-muted hover:bg-hover" onClick={resetComposer} aria-label="Remove attachment">×</button>
                  </div>
                )}
                {error && <p role="alert" className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
                <div className="flex items-end gap-1 rounded-3xl bg-search px-2 py-1.5">
                  <button type="button" className="icon-btn h-9 w-9" onClick={() => fileInput.current?.click()} aria-label="Attach a file or photo" title="Attach a file or photo">
                    <Svg d={CLIP} size={18} />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    onChange={(e) => {
                      attach(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <textarea
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    onPaste={(e) => {
                      const f = e.clipboardData.files[0];
                      if (f) {
                        e.preventDefault();
                        attach(f);
                      }
                    }}
                    placeholder={`Message ${peerName(peerId).split(/\s+/)[0]}`}
                    aria-label="Message"
                    className="max-h-32 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-ink placeholder:text-muted focus:outline-none"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={sending || pending?.status === "uploading" || (!text.trim() && pending?.status !== "ready")}
                    className="icon-btn h-9 w-9 text-brand-600 disabled:opacity-40"
                    aria-label="Send"
                    title="Send (Enter)"
                  >
                    <Svg d={SEND} size={18} />
                  </button>
                </div>
                <p className="mt-1 px-2 text-[10px] text-muted">Enter to send · Shift+Enter for a new line · paste or attach photos and files (25 MB)</p>
              </div>
            </>
          )}
        </aside>
      )}
    </>
  );
}
