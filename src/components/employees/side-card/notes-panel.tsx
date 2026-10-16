"use client";

import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { canDeleteNote, canEditNote, notesCountLine } from "@/lib/employee-notes";
import { monthGroups } from "@/lib/long-lists";
import { listEmployeeNotes, type NoteListPage, type NoteListRow } from "@/server/modules/employees/note-actions";
import type { ActionResult } from "@/server/action-result";
import { DeleteNoteDialog, NoteByline, NoteEditor } from "./note-parts";

type Author = { id: string; name: string };
/** `filtering` is the filter state these rows were loaded under, so the count line never mixes old and new. */
type Loaded = { rows: NoteListRow[]; hasMore: boolean; total: number; matching: number; filtering: boolean };

/** The search box waits this long after the last keystroke before asking the server. */
const DEBOUNCE_MS = 300;

function failure(res: Extract<ActionResult<NoteListPage>, { ok: false }>): string {
  if (res.kind === "rate_limited") return `Too many lookups this minute — try again in ${res.retryAfterSec ?? 60} s.`;
  return res.fieldErrors?._form ?? res.fieldErrors?.q ?? res.message;
}

const cursorOf = (row: NoteListRow) => ({ at: row.createdAt, id: row.id });

const COUNT_ID = "notes-panel-count";
const rowId = (id: string) => `notes-panel-${id}`;
const editId = (id: string) => `notes-panel-edit-${id}`;

/**
 * Phase 39 (spec §2.2): the notes side panel — the Drawer (focus trap, Esc, backdrop, focus return). Mounted only
 * while open. It reads through `listEmployeeNotes`, 20 at a time, newest first: a debounced search, "Written by",
 * the count line, Manila month headings and "Load 20 older". Edit and Delete use the existing actions; the runner
 * refreshes the card, and the panel reloads as many rows as it was showing.
 */
export function NotesPanel({
  employeeId, employeeName, viewer, onClose,
}: {
  employeeId: string;
  employeeName: string;
  viewer: { id: string; role: string };
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [authorId, setAuthorId] = useState("");
  const [authors, setAuthors] = useState<Author[]>([]);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NoteListRow | null>(null);
  /** The element id focus should land on after the next commit (an Edit button, a row, the count line). */
  const [focusReq, setFocusReq] = useState<string | null>(null);
  /** Bumped by every first-page load, so a slower older answer is dropped. */
  const seq = useRef(0);
  /** After an edit or delete: how many rows to load back, so the reader keeps their place. */
  const keep = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const mine = ++seq.current;
    const want = keep.current;
    keep.current = 0;
    setLoading(true);
    setError(null);
    (async () => {
      const first = await listEmployeeNotes({ employeeId, q: query, authorId });
      if (mine !== seq.current) return;
      if (!first.ok) {
        setError(failure(first));
        setLoading(false);
        return;
      }
      let rows = first.data.notes;
      let hasMore = first.data.hasMore;
      while (hasMore && rows.length < want) {
        const more = await listEmployeeNotes({ employeeId, q: query, authorId, before: cursorOf(rows[rows.length - 1]) });
        if (mine !== seq.current) return;
        if (!more.ok) break;
        rows = [...rows, ...more.data.notes];
        hasMore = more.data.hasMore;
      }
      const list = first.data.authors ?? [];
      setAuthors(list);
      // The chosen author's last note went: back to Anyone (which reloads).
      if (authorId && !list.some((a) => a.id === authorId)) setAuthorId("");
      setData({
        rows, hasMore, total: first.data.total, matching: first.data.matching,
        filtering: query.trim() !== "" || authorId !== "",
      });
      setLoading(false);
    })().catch(() => {
      if (mine !== seq.current) return;
      setError("The notes could not be loaded.");
      setLoading(false);
    });
  }, [employeeId, query, authorId, reloadKey]);

  // Focus never drops to the page behind the open drawer: a requested target (the Edit button after an edit, the
  // next row after a delete, the first loaded row when "Load 20 older" goes away) wins; failing that, when focus
  // fell to body because its element was removed, the count line takes it. Waits while a reload is in flight.
  useEffect(() => {
    if (loading) return;
    const target = focusReq ? document.getElementById(focusReq) : null;
    if (focusReq) setFocusReq(null);
    if (target) {
      target.focus();
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body) document.getElementById(COUNT_ID)?.focus();
  }, [focusReq, data, loading]);

  async function loadOlder() {
    if (!data?.hasMore || data.rows.length === 0) return;
    const mine = seq.current;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listEmployeeNotes({ employeeId, q: query, authorId, before: cursorOf(data.rows[data.rows.length - 1]) });
      if (mine !== seq.current) return;
      if (!res.ok) {
        setError(failure(res));
        return;
      }
      setData((d) => d && {
        ...d, rows: [...d.rows, ...res.data.notes], hasMore: res.data.hasMore, total: res.data.total, matching: res.data.matching,
      });
      if (!res.data.hasMore && res.data.notes[0]) setFocusReq(rowId(res.data.notes[0].id));
    } catch {
      if (mine === seq.current) setError("The notes could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  function reload() {
    keep.current = data?.rows.length ?? 0;
    setReloadKey((k) => k + 1);
  }

  /** After a delete: the row below the deleted one, else the one above, else the count line. */
  function afterDelete(id: string) {
    const rows = data?.rows ?? [];
    const i = rows.findIndex((r) => r.id === id);
    const next = rows[i + 1] ?? rows[i - 1];
    setFocusReq(i >= 0 && next ? rowId(next.id) : COUNT_ID);
    reload();
  }
  const groups = data ? monthGroups(data.rows, (r) => new Date(r.createdAt)) : [];

  return (
    <>
      <Drawer open onClose={onClose} title={`Notes — ${employeeName}`} width={440}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-fg-secondary">
              Search the notes
              <Input
                type="search"
                value={q}
                maxLength={100}
                enterKeyHint="search"
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-fg-secondary">
              Written by
              <Select value={authorId} onChange={(e) => setAuthorId(e.target.value)}>
                <option value="">Anyone</option>
                {authors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </label>
          </div>

          <p id={COUNT_ID} tabIndex={-1} className="text-[11.5px] text-fg-muted outline-none" aria-live="polite">
            {data ? notesCountLine({ total: data.total, matching: data.matching, shown: data.rows.length, filtering: data.filtering }) : " "}
          </p>

          {error && <Banner tone="fault" title={error} />}

          {loading && !data ? (
            <div className="flex flex-col gap-3" aria-busy="true">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="mt-2 h-3 w-1/3" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ) : data && data.rows.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">{data.filtering ? "No note matches." : "No notes yet."}</p>
          ) : (
            <div className="flex flex-col gap-4" aria-busy={loading || undefined}>
              {groups.map((g) => (
                <section key={`${g.month}-${g.items[0].id}`} className="flex flex-col gap-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{g.month}</h3>
                  <ul className="flex flex-col divide-y divide-border-faint">
                    {g.items.map((n) => {
                      const mayEdit = canEditNote(n, viewer);
                      const mayDelete = canDeleteNote(n, viewer);
                      return (
                        <li
                          key={n.id}
                          id={rowId(n.id)}
                          tabIndex={-1}
                          className="flex flex-col gap-1 py-2.5 outline-none"
                        >
                          <NoteByline note={n} />
                          {editingId === n.id ? (
                            <NoteEditor
                              note={n}
                              onClose={() => {
                                setEditingId(null);
                                setFocusReq(editId(n.id));
                              }}
                              onSaved={reload}
                            />
                          ) : (
                            <>
                              <p className="whitespace-pre-wrap break-words text-[13px] text-fg">{n.text}</p>
                              {(mayEdit || mayDelete) && (
                                <div className="flex gap-3">
                                  {mayEdit && (
                                    <button id={editId(n.id)} type="button" onClick={() => setEditingId(n.id)} className="text-[11.5px] text-accent hover:underline">
                                      Edit
                                    </button>
                                  )}
                                  {mayDelete && (
                                    <button type="button" onClick={() => setDeleting(n)} className="text-[11.5px] text-accent hover:underline">
                                      Delete
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {data?.hasMore && (
                <div>
                  <Button variant="secondary" size="sm" loading={loadingMore} onClick={loadOlder}>Load 20 older</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>
      <DeleteNoteDialog key={deleting?.id ?? "none"} note={deleting} onClose={() => setDeleting(null)} onDeleted={() => deleting && afterDelete(deleting.id)} />
    </>
  );
}
