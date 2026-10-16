"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { addEmployeeNote } from "@/server/modules/employees/note-actions";
import { canDeleteNote, canEditNote } from "@/lib/employee-notes";
import { useEmployeeRunner } from "../use-employee-runner";
import { DeleteNoteDialog, NoteByline, NoteEditor, useFocusAfterEdit, type NoteRow } from "./note-parts";
import { NotesPanel } from "./notes-panel";

/** The composer grows with its text up to this many rows, then scrolls. */
const MAX_ROWS = 4;

/** Phase 39 (spec §2.2): `?notes=1` keeps the notes side panel open across a refresh. */
function setNotesParam(open: boolean) {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set("notes", "1");
  else url.searchParams.delete("notes");
  // `null` state: Next's patched replaceState then keeps its own history entry and syncs the router's URL.
  window.history.replaceState(null, "", url);
}

/**
 * Phase 39 (spec §2.2): the side card's Notes tab. A composer (admin and it_staff), the 3 newest notes — each cut
 * to 3 lines with a ⋯ menu for Edit (inline) and Delete (confirm) — and, past 3, "View all {n} →", which opens
 * the notes side panel (search, author, 20 at a time). The page loads only these 3 and the total, so the column
 * never grows with the log. The server re-checks every right; this only decides what to show.
 */
export function NotesTab({
  employeeId, employeeName, notes, total, viewer, canAdd,
}: {
  employeeId: string;
  employeeName: string;
  /** The 3 newest, newest first. */
  notes: NoteRow[];
  /** Every note on this person. */
  total: number;
  viewer: { id: string; role: string };
  canAdd: boolean;
}) {
  const [deleting, setDeleting] = useState<NoteRow | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const viewAll = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  function openPanel() {
    returnFocus.current = true;
    setPanelOpen(true);
    setNotesParam(true);
  }
  function closePanel() {
    setPanelOpen(false);
    setNotesParam(false);
  }

  // A refresh with `?notes=1` reopens the panel.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("notes") === "1") {
      returnFocus.current = true;
      setPanelOpen(true);
    }
  }, []);

  // The drawer's trap hands focus back as it unmounts; this runs after that and lands on "View all" — also when
  // the panel was opened from `?notes=1` and nothing on the page had focus before it. Deletes in the panel can
  // take the total to 3 or fewer, and "View all" goes with them: then the Notes tab panel (side-card.tsx's
  // `side-panel-notes`, tabIndex 0) takes focus.
  useEffect(() => {
    if (panelOpen || !returnFocus.current) return;
    returnFocus.current = false;
    (viewAll.current ?? document.getElementById("side-panel-notes"))?.focus();
  }, [panelOpen]);

  return (
    <>
      <div className="flex flex-col gap-3">
        {canAdd && <Composer employeeId={employeeId} />}

        {notes.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">No notes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-faint">
            {notes.map((n) => (
              <NoteItem key={n.id} note={n} viewer={viewer} onDelete={() => setDeleting(n)} />
            ))}
          </ul>
        )}

        {total > 3 && (
          <div className="flex items-center justify-between gap-2 border-t border-border-faint pt-2.5">
            <span className="text-[11.5px] text-fg-muted">{notes.length} newest of {total}</span>
            <button
              ref={viewAll}
              type="button"
              onClick={openPanel}
              className="rounded-(--radius-ctl) text-xs font-medium text-accent hover:underline"
            >
              View all {total} →
            </button>
          </div>
        )}
      </div>
      <DeleteNoteDialog key={deleting?.id ?? "none"} note={deleting} onClose={() => setDeleting(null)} />
      {panelOpen && (
        <NotesPanel employeeId={employeeId} employeeName={employeeName} viewer={viewer} onClose={closePanel} />
      )}
    </>
  );
}

/** "Add a note…": one row that grows to 4 as the text does, with Add beside it. */
function Composer({ employeeId }: { employeeId: string }) {
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useEmployeeRunner(["text"]);
  const id = `note-new-${employeeId}`;

  // Height follows the text: reset, measure, then cap at MAX_ROWS lines (past that the box scrolls).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = "auto";
    const want = el.scrollHeight + borders;
    const max = line * MAX_ROWS + padding + borders;
    el.style.height = `${Math.min(want, max)}px`;
    el.style.overflowY = want > max ? "auto" : "hidden";
  }, [draft]);

  function add() {
    run(() => addEmployeeNote({ employeeId, text: draft }), "Note added", { onOk: () => setDraft("") });
  }

  return (
    <div className="flex flex-col gap-1.5">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <label htmlFor={id} className="sr-only">New note</label>
      <div className="flex items-end gap-2">
        <Textarea
          ref={box}
          id={id}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          invalid={!!fieldErrors.text}
          aria-describedby={fieldErrors.text || error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 resize-none leading-5"
        />
        <Button variant="primary" size="sm" loading={pending} onClick={add} className="shrink-0">Add</Button>
      </div>
      <FormError id={`${id}-error`}>{fieldErrors.text ?? error ?? ""}</FormError>
    </div>
  );
}

/** One of the 3 newest: byline, ⋯ "Note actions" (only when the viewer may edit or delete), text cut to 3 lines. */
function NoteItem({
  note, viewer, onDelete,
}: {
  note: NoteRow;
  viewer: { id: string; role: string };
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useFocusAfterEdit(editing, trigger);
  const items: MenuItem[] = [
    ...(canEditNote(note, viewer) ? [{ label: "Edit", onSelect: () => setEditing(true) }] : []),
    ...(canDeleteNote(note, viewer) ? [{ label: "Delete", danger: true, onSelect: onDelete }] : []),
  ];

  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      {/* min-h-5: the same height with or without the ⋯ button, so the card is one size whoever wrote the notes */}
      <div className="flex min-h-5 items-start justify-between gap-2">
        <NoteByline note={note} />
        {items.length > 0 && !editing && (
          <Menu
            align="end"
            items={items}
            trigger={(props) => (
              <button
                ref={trigger}
                type="button"
                {...props}
                aria-label="Note actions"
                className="-my-0.5 rounded-(--radius-ctl) px-1.5 leading-5 text-fg-muted hover:bg-surface-subtle"
              >
                ⋯
              </button>
            )}
          />
        )}
      </div>
      {editing ? (
        <NoteEditor note={note} onClose={() => setEditing(false)} />
      ) : (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-fg">{note.text}</p>
      )}
    </li>
  );
}
