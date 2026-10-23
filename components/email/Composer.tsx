"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addNote, prepareAttachmentUploads, sendReply } from "@/app/(app)/inbox/[id]/actions";
import { cx } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { browserDb } from "@/lib/supabase/browser";

const MAX_TOTAL = 25 * 1024 * 1024;
const MAX_FILES = 20;

type Att = {
  key: string;
  name: string;
  size: number;
  type: string;
  inline: boolean;
  status: "uploading" | "ready" | "error";
  path?: string;
  error?: string;
  preview?: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Toolbar icons (20px grid).
const ICON: Record<string, string> = {
  bold: "M6 4h5a3 3 0 010 6H6zM6 10h6a3 3 0 010 6H6z",
  italic: "M12 4H8M12 16H8M11 4L9 16",
  underline: "M6 3v6a4 4 0 008 0V3M5 17h10",
  strike: "M4 10h12M13 6.5C13 5 11.7 4 10 4S7 5 7 6.5c0 3 6 2 6 5.5 0 1.5-1.3 2.5-3 2.5s-3-1-3-2.5",
  ul: "M8 5h9M8 10h9M8 15h9M4 5h.01M4 10h.01M4 15h.01",
  ol: "M8 5h9M8 10h9M8 15h9M3.5 4l1-.5V7M3 12.5c.3-.5 1.7-.7 1.7.3 0 .7-1.7 1.2-1.7 2.2h2",
  quote: "M5 8h3v4H5zM5 8c0-2 1-3 3-3M12 8h3v4h-3zM12 8c0-2 1-3 3-3",
  link: "M8.5 11.5a3 3 0 004.2 0l2.6-2.6a3 3 0 00-4.2-4.2L10 5.8M11.5 8.5a3 3 0 00-4.2 0l-2.6 2.6a3 3 0 004.2 4.2l1.1-1.1",
  clear: "M4 16h7M7 4h9M11 4L8 16M14 12l4 4M18 12l-4 4",
  clip: "M15 9l-5.6 5.6a3.4 3.4 0 01-4.8-4.8l6-6a2.2 2.2 0 013.2 3.2L7.9 13a1.1 1.1 0 01-1.6-1.6L11.6 6",
  photo: "M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5h.01",
};
function Glyph({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function Composer({
  id,
  defaultTo,
  defaultCc,
  greetingName,
  signature,
  canReply,
  blockedReason,
}: {
  id: string;
  defaultTo: string;
  defaultCc: string;
  greetingName: string;
  signature: string;
  canReply: boolean;
  blockedReason?: string;
}) {
  const [mode, setMode] = useState<"reply" | "note">(canReply ? "reply" : "note");
  const template = `<p>Dear ${esc(greetingName)},</p><p><br></p><p>Regards,<br>${esc(signature)}<br>Motogari</p>`;
  const [replyState, replyAction, replyPending] = useActionState(sendReply, undefined);
  const [noteState, noteAction, notePending] = useActionState(addNote, undefined);
  // Kept in state (not just the DOM) so switching to "Internal note" and back never loses a half-written reply.
  const [html, setHtml] = useState(template);
  const [note, setNote] = useState("");
  const [atts, setAtts] = useState<Att[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [showCopies, setShowCopies] = useState(!!defaultCc);
  const editor = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // Restore the editor content whenever the reply tab is shown.
  useEffect(() => {
    if (mode !== "reply" || !editor.current) return;
    if (editor.current.innerHTML !== html) editor.current.innerHTML = html;
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Remember the caret so toolbar buttons and photo inserts act where the person was typing.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (!sel?.rangeCount || !editor.current) return;
      const r = sel.getRangeAt(0);
      if (!editor.current.contains(r.commonAncestorContainer)) return;
      range.current = r.cloneRange();
      setActive({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        ul: document.queryCommandState("insertUnorderedList"),
        ol: document.queryCommandState("insertOrderedList"),
      });
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  useEffect(() => {
    if (!replyState?.ok) return;
    setHtml(template);
    if (editor.current) editor.current.innerHTML = template;
    setAtts((prev) => {
      prev.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
      return [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replyState?.nonce, replyState?.ok]);
  useEffect(() => {
    if (noteState?.ok) setNote("");
  }, [noteState?.nonce, noteState?.ok]);

  const sync = () => editor.current && setHtml(editor.current.innerHTML);

  const restoreCaret = () => {
    const el = editor.current;
    if (!el) return;
    el.focus();
    const sel = document.getSelection();
    if (sel && range.current) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    }
  };

  const exec = (cmd: string, value?: string) => {
    restoreCaret();
    document.execCommand(cmd, false, value);
    sync();
  };

  const insertLink = () => {
    const sel = document.getSelection();
    const selected = range.current && !range.current.collapsed ? range.current.toString() : "";
    const input = window.prompt("Link address (web page or email)", selected.startsWith("http") ? selected : "https://");
    if (!input || input === "https://") return;
    const url = /^(https?:|mailto:|tel:)/i.test(input.trim()) ? input.trim() : input.includes("@") && !input.includes("/") ? `mailto:${input.trim()}` : `https://${input.trim()}`;
    restoreCaret();
    if (selected && sel) document.execCommand("createLink", false, url);
    else document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(input.trim())}</a>&nbsp;`);
    sync();
  };

  const totalSize = atts.reduce((n, a) => n + a.size, 0);

  async function upload(files: File[], inline: boolean) {
    setUploadError(null);
    if (!files.length) return;
    if (atts.length + files.length > MAX_FILES) return setUploadError(`You can attach at most ${MAX_FILES} files.`);
    if (totalSize + files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) return setUploadError("Attachments can be at most 25 MB in total, like Gmail.");
    const items: Att[] = files.map((f) => ({
      key: crypto.randomUUID(),
      name: f.name || "image.png",
      size: f.size,
      type: f.type || "application/octet-stream",
      inline,
      status: "uploading",
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setAtts((prev) => [...prev, ...items]);
    const update = (key: string, patch: Partial<Att>) => setAtts((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));

    const prepared = await prepareAttachmentUploads(id, items.map((i) => ({ name: i.name, size: i.size })));
    if (!prepared.ok) {
      items.forEach((i) => update(i.key, { status: "error", error: prepared.error }));
      return setUploadError(prepared.error);
    }
    const bucket = browserDb().storage.from("outgoing");
    await Promise.all(
      items.map(async (item, n) => {
        const { path, token } = prepared.uploads[n];
        const { error } = await bucket.uploadToSignedUrl(path, token, files[n], { contentType: item.type });
        if (error) return update(item.key, { status: "error", error: "Upload failed" });
        update(item.key, { status: "ready", path });
        if (inline && item.preview) {
          restoreCaret();
          document.execCommand("insertHTML", false, `<img src="${item.preview}" data-upload="${esc(path)}" alt="${esc(item.name)}" style="max-width:100%;height:auto"><br>`);
          sync();
        }
      }),
    );
  }

  const remove = (a: Att) => {
    if (a.inline && a.path && editor.current) {
      editor.current.querySelectorAll(`img[data-upload="${CSS.escape(a.path)}"]`).forEach((img) => img.remove());
      sync();
    }
    if (a.preview) URL.revokeObjectURL(a.preview);
    setAtts((prev) => prev.filter((x) => x.key !== a.key));
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    upload(files.filter((f) => f.type.startsWith("image/")), true);
    upload(files.filter((f) => !f.type.startsWith("image/")), false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    upload(Array.from(e.dataTransfer.files), false);
  };

  const busy = atts.some((a) => a.status === "uploading");
  const ready = atts.filter((a) => a.status === "ready" && a.path).map((a) => ({ path: a.path!, name: a.name, type: a.type, inline: a.inline }));

  const tool = (key: string, label: string, onClick: () => void, pressed?: boolean) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx("inline-flex h-8 w-8 items-center justify-center rounded-md", pressed ? "bg-brand-100 text-ink" : "text-muted hover:bg-hover hover:text-ink")}
    >
      <Glyph d={ICON[key]} />
    </button>
  );
  const sep = (k: string) => <span key={k} className="mx-1 h-5 w-px bg-line" aria-hidden />;

  return (
    <div className={cx("overflow-hidden rounded-2xl border bg-white shadow-[0_1px_3px_rgba(60,64,67,.3)] sm:ml-14", mode === "note" ? "border-amber-300" : "border-line")}>
      <div className="flex border-b border-line text-sm">
        <button
          type="button"
          onClick={() => setMode("reply")}
          className={cx("flex-1 border-b-[3px] px-4 py-2.5 font-medium", mode === "reply" ? "border-brand-500 bg-white text-ink" : "border-transparent bg-canvas text-muted hover:text-ink")}
        >
          Reply to customer
        </button>
        <button
          type="button"
          onClick={() => setMode("note")}
          className={cx("flex-1 border-b-[3px] px-4 py-2.5 font-medium", mode === "note" ? "border-amber-400 bg-amber-50 text-amber-900" : "border-transparent bg-canvas text-muted hover:text-ink")}
        >
          Internal note
        </button>
      </div>

      {mode === "reply" ? (
        canReply ? (
          <form action={replyAction} className="space-y-3 p-4" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="html" value={html} />
            <input type="hidden" name="attachments" value={JSON.stringify(ready)} />
            <div>
              <div className="flex items-end justify-between">
                <label className="label" htmlFor="to">To</label>
                {!showCopies && (
                  <button type="button" onClick={() => setShowCopies(true)} className="mb-1 text-xs font-medium text-brand-600 hover:underline">
                    Cc Bcc
                  </button>
                )}
              </div>
              <input className="input" id="to" name="to" defaultValue={defaultTo} required />
            </div>
            {/* Like Gmail: Cc/Bcc stay tucked away until needed. Bcc recipients are hidden from everyone else. */}
            <div className={cx("grid gap-3 sm:grid-cols-2", !showCopies && "hidden")}>
              <div>
                <label className="label" htmlFor="cc">Cc</label>
                <input className="input" id="cc" name="cc" defaultValue={defaultCc} placeholder="Optional" />
              </div>
              <div>
                <label className="label" htmlFor="bcc">Bcc</label>
                <input className="input" id="bcc" name="bcc" placeholder="Hidden from other recipients" />
              </div>
            </div>

            <div className="rounded-xl border border-line focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
              <div
                ref={editor}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                aria-label="Reply"
                onInput={sync}
                onBlur={sync}
                onPaste={onPaste}
                className="min-h-56 px-3 py-2.5 text-sm leading-relaxed text-ink focus:outline-none [&_a]:text-brand-600 [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_img]:my-1 [&_img]:max-w-full [&_img]:rounded [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-[1.5em] [&_ul]:list-disc [&_ul]:pl-6"
              />
              {/* Gmail-style formatting bar */}
              <div className="flex flex-wrap items-center gap-0.5 border-t border-line px-2 py-1">
                {tool("bold", "Bold (Ctrl+B)", () => exec("bold"), active.bold)}
                {tool("italic", "Italic (Ctrl+I)", () => exec("italic"), active.italic)}
                {tool("underline", "Underline (Ctrl+U)", () => exec("underline"), active.underline)}
                {tool("strike", "Strikethrough", () => exec("strikeThrough"), active.strike)}
                {sep("s1")}
                {tool("ul", "Bulleted list", () => exec("insertUnorderedList"), active.ul)}
                {tool("ol", "Numbered list", () => exec("insertOrderedList"), active.ol)}
                {tool("quote", "Quote", () => exec("formatBlock", "blockquote"))}
                {sep("s2")}
                {tool("link", "Insert link", insertLink)}
                {tool("clear", "Remove formatting", () => {
                  exec("removeFormat");
                  exec("unlink");
                })}
                {sep("s3")}
                {tool("clip", "Attach files", () => fileInput.current?.click())}
                {tool("photo", "Insert photo", () => photoInput.current?.click())}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    upload(Array.from(e.target.files ?? []), false);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    upload(Array.from(e.target.files ?? []), true);
                    e.target.value = "";
                  }}
                />
                {atts.length > 0 && <span className="tabular ml-auto pr-1 text-xs text-muted">{formatBytes(totalSize)} of 25 MB</span>}
              </div>
            </div>

            {atts.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {atts.map((a) => (
                  <li
                    key={a.key}
                    className={cx("flex max-w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm", a.status === "error" ? "border-red-200 bg-red-50" : "border-line bg-canvas")}
                  >
                    {a.preview ? <img src={a.preview} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="text-muted"><Glyph d={ICON.clip} /></span>}
                    <span className="max-w-44 truncate font-medium" title={a.name}>{a.name}</span>
                    <span className="text-xs text-muted">
                      {a.status === "uploading" ? "Uploading…" : a.status === "error" ? (a.error ?? "Failed") : a.inline ? "in message" : formatBytes(a.size)}
                    </span>
                    <button type="button" onClick={() => remove(a)} className="rounded-full px-1.5 text-muted hover:bg-hover hover:text-ink" aria-label={`Remove ${a.name}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {uploadError && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{uploadError}</p>}
            {replyState?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{replyState.error}</p>}
            {replyState?.message && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{replyState.message}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted">Sent through Gmail from the Motogari address, in the same thread. Notes are never included. Drop files here to attach.</p>
              <div className="flex gap-2">
                <select name="after" className="input w-auto" defaultValue="" aria-label="After sending">
                  <option value="">Keep status</option>
                  <option value="waiting">Then: waiting on customer</option>
                  <option value="resolved">Then: resolved</option>
                </select>
                <button className="btn-brand shrink-0" disabled={replyPending || busy} title={busy ? "Waiting for uploads to finish" : undefined}>
                  {replyPending ? "Sending…" : busy ? "Uploading…" : "Send"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <p className="p-4 text-sm text-muted">{blockedReason}</p>
        )
      ) : (
        <form action={noteAction} className="space-y-3 bg-amber-50/40 p-4">
          <input type="hidden" name="id" value={id} />
          <textarea
            className="input min-h-28 border-amber-200"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            placeholder="Visible to Motogari staff only. Never sent to the customer."
            aria-label="Internal note"
          />
          {noteState?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{noteState.error}</p>}
          {noteState?.message && <p role="status" className="text-sm text-emerald-700">{noteState.message}</p>}
          <div className="flex justify-end">
            <button className="btn bg-amber-500 text-white hover:bg-amber-600" disabled={notePending}>
              {notePending ? "Saving…" : "Add internal note"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
