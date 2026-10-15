"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addNote, sendReply } from "@/app/(app)/inbox/[id]/actions";
import { cx } from "@/components/ui";

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
  const template = `Dear ${greetingName},\n\n\n\nRegards,\n${signature}\nMotogari`;
  const [replyState, replyAction, replyPending] = useActionState(sendReply, undefined);
  const [noteState, noteAction, notePending] = useActionState(addNote, undefined);
  const replyForm = useRef<HTMLFormElement>(null);
  const noteForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (replyState?.ok) replyForm.current?.reset();
  }, [replyState?.nonce, replyState?.ok]);
  useEffect(() => {
    if (noteState?.ok) noteForm.current?.reset();
  }, [noteState?.nonce, noteState?.ok]);

  return (
    <div className={cx("card overflow-hidden", mode === "note" && "border-amber-300")}>
      <div className="flex border-b border-line text-sm">
        <button
          type="button"
          onClick={() => setMode("reply")}
          className={cx("flex-1 px-4 py-2.5 font-medium", mode === "reply" ? "bg-white text-ink" : "bg-stone-50 text-muted hover:text-ink")}
        >
          Reply to customer
        </button>
        <button
          type="button"
          onClick={() => setMode("note")}
          className={cx("flex-1 px-4 py-2.5 font-medium", mode === "note" ? "bg-amber-50 text-amber-900" : "bg-stone-50 text-muted hover:text-ink")}
        >
          Internal note
        </button>
      </div>

      {mode === "reply" ? (
        canReply ? (
          <form ref={replyForm} action={replyAction} className="space-y-3 p-4">
            <input type="hidden" name="id" value={id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="to">To</label>
                <input className="input" id="to" name="to" defaultValue={defaultTo} required />
              </div>
              <div>
                <label className="label" htmlFor="cc">Cc</label>
                <input className="input" id="cc" name="cc" defaultValue={defaultCc} placeholder="Optional" />
              </div>
            </div>
            <textarea className="input min-h-56 font-sans leading-relaxed" name="body" defaultValue={template} required aria-label="Reply" />
            {replyState?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{replyState.error}</p>}
            {replyState?.message && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{replyState.message}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted">Sent through Gmail from the Motogari address, in the same thread. Notes are never included.</p>
              <div className="flex gap-2">
                <select name="after" className="input w-auto" defaultValue="" aria-label="After sending">
                  <option value="">Keep status</option>
                  <option value="waiting">Then: waiting on customer</option>
                  <option value="resolved">Then: resolved</option>
                </select>
                <button className="btn-brand shrink-0" disabled={replyPending}>{replyPending ? "Sending…" : "Send reply"}</button>
              </div>
            </div>
          </form>
        ) : (
          <p className="p-4 text-sm text-muted">{blockedReason}</p>
        )
      ) : (
        <form ref={noteForm} action={noteAction} className="space-y-3 bg-amber-50/40 p-4">
          <input type="hidden" name="id" value={id} />
          <textarea
            className="input min-h-28 border-amber-200"
            name="note"
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
