"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { deleteEmployeeNote, editEmployeeNote } from "@/server/modules/employees/note-actions";
import { fmtDateTime } from "@/lib/format";
import { useEmployeeRunner } from "../use-employee-runner";

/**
 * Phase 39 (spec §2.2): what the Notes tab and the notes side panel share — the note's shape, its byline, the
 * inline editor and the delete confirmation. Both mutations go through the existing actions; the runner's
 * `router.refresh()` refreshes the card, and `onDone` lets the panel reload its own list.
 */
export interface NoteRow {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Date | string;
  editedAt: Date | string | null;
}

/** "{author} · {date and time}[ · edited]". */
export function NoteByline({ note }: { note: NoteRow }) {
  return (
    <p className="text-[11px] text-fg-muted">
      <span className="font-medium text-fg-secondary">{note.authorName}</span>
      {" · "}
      {fmtDateTime(note.createdAt)}
      {note.editedAt && " · edited"}
    </p>
  );
}

/** The inline editor: the text, Save and Cancel. Focus lands in the text as it opens. */
export function NoteEditor({
  note, onClose, onSaved,
}: {
  note: NoteRow;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [text, setText] = useState(note.text);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useEmployeeRunner(["text"]);

  function save() {
    run(() => editEmployeeNote({ id: note.id, text }), "Note saved", {
      onOk: () => {
        onClose();
        onSaved?.();
      },
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <Textarea
        aria-label="Edited text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        invalid={!!fieldErrors.text}
        autoFocus
      />
      <FormError>{fieldErrors.text ?? error ?? ""}</FormError>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" loading={pending} onClick={save}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

/** "Delete this note?" with the note's text. Open while `note` is set. */
export function DeleteNoteDialog({
  note, onClose, onDeleted,
}: {
  note: NoteRow | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { pending, error, retryAfter, setRetryAfter, run } = useEmployeeRunner();
  function confirm() {
    if (!note) return;
    run(() => deleteEmployeeNote({ id: note.id }), "Note deleted", {
      onOk: () => {
        onClose();
        onDeleted?.();
      },
    });
  }
  return (
    <Dialog
      open={note !== null}
      onClose={onClose}
      title="Delete this note?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={confirm}>Delete</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        <p className="line-clamp-6 whitespace-pre-wrap break-words text-[12.5px] text-fg-secondary">{note?.text}</p>
        <FormError>{error ?? ""}</FormError>
      </div>
    </Dialog>
  );
}

/**
 * Puts focus back on `target` when `editing` turns false — the editor that held focus is gone by then, so a
 * keyboard user lands on the control that opened it instead of the page's top.
 */
export function useFocusAfterEdit(editing: boolean, target: React.RefObject<HTMLElement | null>) {
  const was = useRef(editing);
  useEffect(() => {
    if (was.current && !editing) target.current?.focus();
    was.current = editing;
  }, [editing, target]);
}
