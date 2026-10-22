"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addChatMembers,
  createChatGroup,
  leaveChatGroup,
  markChatRead,
  markRoomRead,
  prepareChatUpload,
  renameChatGroup,
  sendChatMessage,
  type ChatMessage,
  type ChatRoom,
} from "@/app/(app)/chat/actions";
import { Avatar, cx } from "@/components/ui";
import { formatBytes, formatShort } from "@/lib/format";
import { browserDb } from "@/lib/supabase/browser";

type Peer = { id: string; name: string; role: "admin" | "staff"; department: string | null };
type Member = { room_id: string; user_id: string; last_read_at: string };
type Sel = { kind: "dm" | "room"; id: string };
type View = "list" | "thread" | "newGroup" | "groupInfo";
type Pending = { name: string; size: number; type: string; status: "uploading" | "ready" | "error"; path?: string; preview?: string; error?: string };

const IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;
const fileUrl = (id: string) => `/api/chat-files/${id}`;
const timeOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" }).format(new Date(iso));
const firstName = (n: string) => n.split(/\s+/)[0];

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
const GROUP = "M7 9a3 3 0 100-6 3 3 0 000 6zM1.5 16.5a5.5 5.5 0 0111 0M13.5 9a2.5 2.5 0 100-5M14.5 11.5a4.5 4.5 0 014 5";
const INFO = "M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10 9v5M10 6.5h.01";

function GroupAvatar({ size = 40 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink text-[#fff]" style={{ width: size, height: size }} aria-hidden>
      <Svg d={GROUP} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Top-bar chat button + right-hand team chat panel: direct messages and group chats between staff. */
export function ChatLauncher({ me }: { me: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<{ sel: Sel; title: string; body: string } | null>(null);
  // New group / add people form
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [groupNameInput, setGroupNameInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const openRef = useRef(open);
  const selRef = useRef(sel);
  const viewRef = useRef(view);
  openRef.current = open;
  selRef.current = sel;
  viewRef.current = view;

  const merge = useCallback((rows: ChatMessage[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      rows.forEach((r) => map.set(r.id, { ...map.get(r.id), ...r }));
      return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
  }, []);

  const loadRooms = useCallback(async () => {
    const db = browserDb();
    const [{ data: r }, { data: m }] = await Promise.all([
      db.from("chat_rooms").select("*").order("created_at"),
      db.from("chat_room_members").select("room_id, user_id, last_read_at"),
    ]);
    setRooms((r as ChatRoom[]) ?? []);
    setMembers((m as Member[]) ?? []);
  }, []);

  // Everything is read with the person's own session, so RLS limits it to their chats and groups.
  useEffect(() => {
    const db = browserDb();
    db.from("users").select("id, name, role, department").eq("is_active", true).neq("id", me.id).order("name")
      .then(({ data }) => setPeers((data as Peer[]) ?? []));
    db.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => merge((data as ChatMessage[]) ?? []));
    loadRooms();
    const channel = db
      .channel("motogari-chat")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        if (!m?.id) return;
        merge([m]);
        if (payload.eventType !== "INSERT" || m.sender_id === me.id) return;
        const target: Sel | null = m.room_id ? { kind: "room", id: m.room_id } : m.recipient_id === me.id ? { kind: "dm", id: m.sender_id } : null;
        if (!target) return;
        const viewing = openRef.current && viewRef.current === "thread" && selRef.current?.kind === target.kind && selRef.current.id === target.id;
        if (viewing) {
          if (target.kind === "dm") markChatRead(target.id).catch(() => {});
          else {
            markRoomRead(target.id).catch(() => {});
            const now = new Date().toISOString();
            setMembers((prev) => prev.map((x) => (x.room_id === target.id && x.user_id === me.id ? { ...x, last_read_at: now } : x)));
          }
        } else {
          setToast({ sel: target, title: "", body: m.body ?? (m.attachment_name ? `📎 ${m.attachment_name}` : "New message") });
          setTimeout(() => setToast(null), 6000);
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_rooms" }, () => loadRooms())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_room_members" }, () => loadRooms())
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [me.id, merge, loadRooms]);

  const peerName = (id: string) => (id === me.id ? "You" : (peers.find((p) => p.id === id)?.name ?? "A former colleague"));
  const room = (id: string) => rooms.find((r) => r.id === id);
  const roomMembers = (id: string) => members.filter((m) => m.room_id === id);
  const myRead = (roomId: string) => members.find((m) => m.room_id === roomId && m.user_id === me.id)?.last_read_at ?? "";

  const inThread = useCallback(
    (m: ChatMessage, s: Sel) =>
      s.kind === "room" ? m.room_id === s.id : !m.room_id && ((m.sender_id === s.id && m.recipient_id === me.id) || (m.sender_id === me.id && m.recipient_id === s.id)),
    [me.id],
  );
  const unreadOf = (s: Sel) =>
    s.kind === "dm"
      ? messages.filter((m) => !m.room_id && m.sender_id === s.id && m.recipient_id === me.id && !m.read_at).length
      : messages.filter((m) => m.room_id === s.id && m.sender_id !== me.id && m.created_at > myRead(s.id)).length;
  const myRooms = rooms.filter((r) => members.some((m) => m.room_id === r.id && m.user_id === me.id));
  const unreadTotal =
    messages.filter((m) => !m.room_id && m.recipient_id === me.id && !m.read_at).length +
    myRooms.reduce((n, r) => n + unreadOf({ kind: "room", id: r.id }), 0);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const lastOf = (s: Sel) => [...messages].reverse().find((m) => inThread(m, s));
    const groupEntries = myRooms
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .map((r) => ({ sel: { kind: "room" as const, id: r.id }, name: r.name, sub: `${roomMembers(r.id).length} members`, last: lastOf({ kind: "room", id: r.id }) }));
    const peopleEntries = peers
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q))
      .map((p) => ({ sel: { kind: "dm" as const, id: p.id }, name: p.name, sub: p.department ?? (p.role === "admin" ? "Admin" : "Staff"), last: lastOf({ kind: "dm", id: p.id }) }));
    return [...groupEntries, ...peopleEntries].sort((a, b) => (b.last?.created_at ?? "").localeCompare(a.last?.created_at ?? "") || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, rooms, members, messages, query]);

  const thread = sel ? messages.filter((m) => inThread(m, sel)) : [];
  const title = sel ? (sel.kind === "room" ? (room(sel.id)?.name ?? "Group") : peerName(sel.id)) : "";

  // Opening a conversation: load its history and mark it read.
  useEffect(() => {
    if (!open || !sel || view !== "thread") return;
    const db = browserDb().from("chat_messages").select("*").order("created_at", { ascending: false }).limit(200);
    const q =
      sel.kind === "room"
        ? db.eq("room_id", sel.id)
        : db.or(`and(sender_id.eq.${me.id},recipient_id.eq.${sel.id}),and(sender_id.eq.${sel.id},recipient_id.eq.${me.id})`);
    q.then(({ data }) => merge((data as ChatMessage[]) ?? []));
    const now = new Date().toISOString();
    if (sel.kind === "dm") {
      setMessages((prev) => prev.map((m) => (!m.room_id && m.sender_id === sel.id && m.recipient_id === me.id && !m.read_at ? { ...m, read_at: now } : m)));
      markChatRead(sel.id).catch(() => {});
    } else {
      setMembers((prev) => prev.map((x) => (x.room_id === sel.id && x.user_id === me.id ? { ...x, last_read_at: now } : x)));
      markRoomRead(sel.id).catch(() => {});
    }
  }, [open, sel, view, me.id, merge]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread.length, sel, open, view]);

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
    if (!prep.ok) return setPending({ ...p, status: "error", error: prep.error });
    const { error: upErr } = await browserDb().storage.from("chat").uploadToSignedUrl(prep.path, prep.token, file, { contentType: type });
    setPending(upErr ? { ...p, status: "error", error: "Upload failed" } : { ...p, status: "ready", path: prep.path });
  }

  async function send() {
    if (!sel || sending) return;
    const body = text.trim();
    if (!body && pending?.status !== "ready") return;
    setSending(true);
    setError(null);
    const r = await sendChatMessage({
      ...(sel.kind === "room" ? { room: sel.id } : { to: sel.id }),
      body,
      attachment: pending?.status === "ready" && pending.path ? { path: pending.path, name: pending.name, type: pending.type, size: pending.size } : null,
    });
    setSending(false);
    if (!r.ok) return setError(r.error);
    merge([r.message]);
    resetComposer();
  }

  const openThread = (s: Sel) => {
    setSel(s);
    setView("thread");
    setOpen(true);
    setToast(null);
    setError(null);
  };
  const startPicking = (next: View) => {
    setPicked(new Set());
    setQuery("");
    setError(null);
    setGroupNameInput(next === "groupInfo" && sel ? (room(sel.id)?.name ?? "") : "");
    setView(next);
  };
  const toggle = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function createGroup() {
    setBusy(true);
    setError(null);
    const r = await createChatGroup(groupNameInput, [...picked]);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await loadRooms();
    openThread({ kind: "room", id: r.room.id });
  }
  async function addPeople() {
    if (!sel || !picked.size) return;
    setBusy(true);
    const r = await addChatMembers(sel.id, [...picked]);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPicked(new Set());
    await loadRooms();
  }
  async function rename() {
    if (!sel) return;
    setBusy(true);
    const r = await renameChatGroup(sel.id, groupNameInput);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    await loadRooms();
  }
  async function leave() {
    if (!sel || !window.confirm(`Leave “${title}”? You will no longer see its messages.`)) return;
    setBusy(true);
    const r = await leaveChatGroup(sel.id);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSel(null);
    setView("list");
    await loadRooms();
  }

  const header = (label: string, onBack?: () => void, extra?: React.ReactNode) => (
    <div className="flex items-center gap-2 border-b border-line px-2 py-2">
      {onBack ? (
        <button type="button" className="icon-btn h-9 w-9" onClick={onBack} aria-label="Back">
          <Svg d={BACK} size={18} />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <div className="min-w-0 flex-1 truncate text-base text-ink">{label}</div>
      {extra}
      <button type="button" className="icon-btn h-9 w-9" onClick={() => setOpen(false)} aria-label="Close chat">
        <Svg d={CLOSE} size={18} />
      </button>
    </div>
  );

  const searchBox = (placeholder: string) => (
    <div className="px-4 py-2">
      <input
        className="h-10 w-full rounded-full bg-search px-4 text-sm text-ink placeholder:text-muted focus:bg-white focus:shadow-md focus:outline-none"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );

  const pickList = (candidates: Peer[]) => {
    const q = query.trim().toLowerCase();
    const shown = candidates.filter((p) => !q || p.name.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q));
    return (
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-2 hover:bg-hover">
              <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <Avatar name={p.name} size={32} />
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{p.name}</span>
                <span className="block truncate text-xs text-muted">{p.department ?? (p.role === "admin" ? "Admin" : "Staff")}</span>
              </span>
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-4 py-6 text-center text-sm text-muted">Nobody to add.</li>}
      </ul>
    );
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

      {toast && !(open && view === "thread" && sel?.kind === toast.sel.kind && sel.id === toast.sel.id) && (
        <button
          type="button"
          onClick={() => openThread(toast.sel)}
          className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-2xl bg-white p-3 text-left shadow-[0_4px_16px_rgba(60,64,67,.3)] ring-1 ring-line"
        >
          {toast.sel.kind === "room" ? <GroupAvatar size={32} /> : <Avatar name={peerName(toast.sel.id)} size={32} />}
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{toast.sel.kind === "room" ? (room(toast.sel.id)?.name ?? "Group") : peerName(toast.sel.id)}</span>
            <span className="block truncate text-sm text-muted">{toast.body}</span>
          </span>
        </button>
      )}

      {open && (
        <aside
          className="fixed top-16 right-0 bottom-0 z-30 flex w-full flex-col bg-white shadow-[0_0_24px_rgba(60,64,67,.25)] sm:w-[380px] lg:bottom-4 lg:rounded-l-2xl"
          aria-label="Team chat"
        >
          {view === "list" && (
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <h2 className="text-lg text-ink">Team chat</h2>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => startPicking("newGroup")} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-brand-600 hover:bg-hover">
                    <Svg d={GROUP} size={16} /> New group
                  </button>
                  <button type="button" className="icon-btn h-9 w-9" onClick={() => setOpen(false)} aria-label="Close chat">
                    <Svg d={CLOSE} size={18} />
                  </button>
                </div>
              </div>
              {searchBox("Search people and groups")}
              <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
                {entries.map((e) => {
                  const unread = unreadOf(e.sel);
                  const last = e.last;
                  const who = last && e.sel.kind === "room" ? (last.sender_id === me.id ? "You: " : `${firstName(peerName(last.sender_id))}: `) : last?.sender_id === me.id ? "You: " : "";
                  return (
                    <li key={`${e.sel.kind}:${e.sel.id}`}>
                      <button type="button" onClick={() => openThread(e.sel)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-hover">
                        {e.sel.kind === "room" ? <GroupAvatar /> : <Avatar name={e.name} size={40} />}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cx("truncate text-sm text-ink", unread > 0 && "font-bold")}>{e.name}</span>
                            {last && <span className="tabular shrink-0 text-xs text-muted">{formatShort(last.created_at)}</span>}
                          </span>
                          <span className="flex items-center justify-between gap-2">
                            <span className={cx("truncate text-xs", unread ? "font-semibold text-ink" : "text-muted")}>
                              {last ? `${who}${last.body ?? (last.attachment_name ? `📎 ${last.attachment_name}` : "")}` : e.sub}
                            </span>
                            {unread > 0 && <span className="tabular shrink-0 rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-[#fff]">{unread}</span>}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!entries.length && (
                  <li className="px-4 py-8 text-center text-sm text-muted">{peers.length ? "Nothing matches that search." : "No other staff yet. Add them under Settings → Staff."}</li>
                )}
              </ul>
            </>
          )}

          {view === "newGroup" && (
            <>
              {header("New group", () => setView("list"))}
              <div className="px-4 pt-3">
                <label className="label" htmlFor="gname">Group name</label>
                <input id="gname" className="input" value={groupNameInput} onChange={(e) => setGroupNameInput(e.target.value)} placeholder="e.g. Bookings team" maxLength={80} autoFocus />
              </div>
              {searchBox("Search people")}
              {pickList(peers)}
              <div className="border-t border-line p-3">
                {error && <p role="alert" className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
                <button type="button" className="btn-brand w-full" disabled={busy || !groupNameInput.trim() || !picked.size} onClick={createGroup}>
                  {busy ? "Creating…" : `Create group${picked.size ? ` with ${picked.size} ${picked.size === 1 ? "person" : "people"}` : ""}`}
                </button>
              </div>
            </>
          )}

          {view === "groupInfo" && sel?.kind === "room" && (
            <>
              {header("Group info", () => setView("thread"))}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex gap-2 px-4 pt-3">
                  <input className="input" value={groupNameInput} onChange={(e) => setGroupNameInput(e.target.value)} maxLength={80} aria-label="Group name" />
                  <button type="button" className="btn-secondary shrink-0" disabled={busy || !groupNameInput.trim() || groupNameInput.trim() === title} onClick={rename}>
                    Rename
                  </button>
                </div>
                <div className="px-4 pt-4 pb-1 text-xs font-medium text-muted">{roomMembers(sel.id).length} members</div>
                <ul>
                  {roomMembers(sel.id).map((m) => (
                    <li key={m.user_id} className="flex items-center gap-3 px-4 py-1.5">
                      <Avatar name={peerName(m.user_id) === "You" ? me.name : peerName(m.user_id)} size={28} />
                      <span className="text-sm text-ink">{peerName(m.user_id)}</span>
                    </li>
                  ))}
                </ul>
                <div className="px-4 pt-4 pb-1 text-xs font-medium text-muted">Add people</div>
                {searchBox("Search people")}
                {pickList(peers.filter((p) => !roomMembers(sel.id).some((m) => m.user_id === p.id)))}
              </div>
              <div className="space-y-2 border-t border-line p-3">
                {error && <p role="alert" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800">{error}</p>}
                <button type="button" className="btn-brand w-full" disabled={busy || !picked.size} onClick={addPeople}>
                  {picked.size ? `Add ${picked.size} ${picked.size === 1 ? "person" : "people"}` : "Add people"}
                </button>
                <button type="button" className="btn-danger w-full" disabled={busy} onClick={leave}>Leave group</button>
              </div>
            </>
          )}

          {view === "thread" && sel && (
            <>
              <div className="flex items-center gap-2 border-b border-line px-2 py-2">
                <button type="button" className="icon-btn h-9 w-9" onClick={() => setView("list")} aria-label="Back to chats">
                  <Svg d={BACK} size={18} />
                </button>
                {sel.kind === "room" ? <GroupAvatar size={32} /> : <Avatar name={title} size={32} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{title}</div>
                  {sel.kind === "room" && (
                    <div className="truncate text-xs text-muted">
                      {roomMembers(sel.id).map((m) => firstName(peerName(m.user_id))).join(", ")}
                    </div>
                  )}
                </div>
                {sel.kind === "room" && (
                  <button type="button" className="icon-btn h-9 w-9" onClick={() => startPicking("groupInfo")} aria-label="Group info" title="Group info">
                    <Svg d={INFO} size={18} />
                  </button>
                )}
                <button type="button" className="icon-btn h-9 w-9" onClick={() => setOpen(false)} aria-label="Close chat">
                  <Svg d={CLOSE} size={18} />
                </button>
              </div>

              <div ref={scroller} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
                {!thread.length && (
                  <p className="py-10 text-center text-sm text-muted">{sel.kind === "room" ? `Say hello to ${title} 👋` : `Say hello to ${firstName(title)} 👋`}</p>
                )}
                {thread.map((m, i) => {
                  const mine = m.sender_id === me.id;
                  const isImage = m.attachment_path && IMAGE.test(m.attachment_type ?? "");
                  const lastMine = mine && !thread.slice(i + 1).some((x) => x.sender_id === me.id);
                  const showName = sel.kind === "room" && !mine && thread[i - 1]?.sender_id !== m.sender_id;
                  return (
                    <div key={m.id} className={cx("flex flex-col", mine ? "items-end" : "items-start")}>
                      {showName && <span className="mt-1 px-1 text-[11px] font-medium text-muted">{peerName(m.sender_id)}</span>}
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
                        {sel.kind === "dm" && lastMine && m.read_at ? " · Seen" : ""}
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
                    placeholder={sel.kind === "room" ? `Message ${title}` : `Message ${firstName(title)}`}
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
