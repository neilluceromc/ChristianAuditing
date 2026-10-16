"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { addEmployeeNote, deleteEmployeeNote, editEmployeeNote } from "@/server/modules/employees/note-actions";
import { fmtDateTime } from "@/lib/format";
import { canDeleteNote, canEditNote } from "@/lib/employee-notes";
import { useEmployeeRunner } from "./use-employee-runner";

export interface NoteRow {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
}

const FIRST = 5;

/**
 * Phase 37 (spec §4.5): the note log on a profile. Admin and it_staff add; the author edits their own; the
 * author or any admin deletes. The server re-checks every one of those — this only decides what to show.
 */
export function NotesCard({
  employeeId, employeeName, notes, viewer, canAdd,
}: {
  employeeId: string;
  employeeName: string;
  notes: NoteRow[];
  viewer: { id: string; role: string };
  canAdd: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useEmployeeRunner(["text"]);
  const [deleting, setDeleting] = useState<NoteRow | null>(null);
  const shown = showAll ? notes : notes.slice(0, FIRST);

  function add() {
    run(() => addEmployeeNote({ employeeId, text: draft }), "Note added", { onOk: () => setDraft("") });
  }

  return (
    <Card>
      <CardHeader title={`Notes (${notes.length})`} />
      <CardBody className="flex flex-col gap-3">
        {canAdd && (
          <div className="flex flex-col gap-2">
            {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
            <label htmlFor={`note-new-${employeeId}`} className="sr-only">New note</label>
            <Textarea
              id={`note-new-${employeeId}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`Add a note about ${employeeName}…`}
              invalid={!!fieldErrors.text}
              aria-describedby={fieldErrors.text ? `note-new-${employeeId}-error` : undefined}
            />
            <FormError id={`note-new-${employeeId}-error`}>{fieldErrors.text ?? error ?? ""}</FormError>
            <div>
              <Button variant="primary" size="sm" loading={pending} onClick={add}>Add note</Button>
            </div>
          </div>
        )}

        {notes.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">No notes yet</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-faint">
            {shown.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                mayEdit={canEditNote(n, viewer)}
                mayDelete={canDeleteNote(n, viewer)}
                onDelete={() => setDeleting(n)}
              />
            ))}
          </ul>
        )}

        {notes.length > FIRST && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${notes.length}`}
            </Button>
          </div>
        )}
      </CardBody>
      <DeleteNoteDialog key={deleting?.id ?? "none"} note={deleting} onClose={() => setDeleting(null)} />
    </Card>
  );
}

function NoteItem({
  note, mayEdit, mayDelete, onDelete,
}: {
  note: NoteRow; mayEdit: boolean; mayDelete: boolean; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useEmployeeRunner(["text"]);

  function startEdit() {
    reset();
    setText(note.text);
    setEditing(true);
  }
  function save() {
    run(() => editEmployeeNote({ id: note.id, text }), "Note saved", { onOk: () => setEditing(false) });
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
      <p className="text-[11px] text-fg-muted">
        <span className="font-medium text-fg-secondary">{note.authorName}</span>
        {" · "}
        {fmtDateTime(note.createdAt)}
        {note.editedAt && " · edited"}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          <Textarea
            aria-label="Edited text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            invalid={!!fieldErrors.text}
          />
          <FormError>{fieldErrors.text ?? error ?? ""}</FormError>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={pending} onClick={save}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words text-[13px] text-fg">{note.text}</p>
          {(mayEdit || mayDelete) && (
            <div className="flex gap-2">
              {mayEdit && <Button variant="ghost" size="sm" onClick={startEdit}>Edit</Button>}
              {mayDelete && <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>}
            </div>
          )}
        </>
      )}
    </li>
  );
}

function DeleteNoteDialog({ note, onClose }: { note: NoteRow | null; onClose: () => void }) {
  const { pending, error, retryAfter, setRetryAfter, run } = useEmployeeRunner();
  function confirm() {
    if (!note) return;
    run(() => deleteEmployeeNote({ id: note.id }), "Note deleted", { onOk: onClose });
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
        <p className="whitespace-pre-wrap break-words text-[12.5px] text-fg-secondary">{note?.text}</p>
        <FormError>{error ?? ""}</FormError>
      </div>
    </Dialog>
  );
}
