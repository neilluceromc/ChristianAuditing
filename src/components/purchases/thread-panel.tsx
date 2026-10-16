"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { filterThread, monthGroups, type ThreadKind } from "@/lib/long-lists";
import { THREAD_PAGE, threadCountLine, type ThreadNote } from "@/lib/purchase-thread";
import { ThreadMessage } from "./thread-message";

const COUNT_ID = "thread-panel-count";
const rowId = (id: string) => `thread-panel-${id}`;

/**
 * Phase 39 (spec §3): the whole conversation in a side panel — the Drawer (focus trap, Esc, backdrop, focus
 * return). Mounted only while open. The page already loads every message (the stepper and the bounce-back read
 * them), so this filters that data in the browser: a search, "Kind" (All, Comments, Status changes), Manila
 * month headings, oldest first, 30 at a time with "Load 30 more".
 */
export function ThreadPanel({
  refNo, notes, onClose,
}: {
  refNo: string;
  /** Every message, oldest first. */
  notes: ThreadNote[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ThreadKind>("all");
  const [shown, setShown] = useState(THREAD_PAGE);
  /** The element id focus should land on after the next commit — the first message "Load 30 more" revealed. */
  const [focusReq, setFocusReq] = useState<string | null>(null);

  const filtering = q.trim() !== "" || kind !== "all";
  const matches = useMemo(() => filterThread(notes, q, kind), [notes, q, kind]);
  const visible = matches.slice(0, shown);
  const groups = monthGroups(visible, (n) => n.at);

  // "Load 30 more" is a button that goes away on the last page: focus moves to the first new message, so it
  // never falls to the page behind the open drawer.
  useEffect(() => {
    if (!focusReq) return;
    document.getElementById(focusReq)?.focus();
    setFocusReq(null);
  }, [focusReq]);

  function loadMore() {
    const next = matches[shown];
    setShown((s) => s + THREAD_PAGE);
    if (next) setFocusReq(rowId(next.id));
  }

  return (
    <Drawer open onClose={onClose} title={`Conversation — ${refNo}`} width={440}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_150px] gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-medium text-fg-secondary">
            Search the conversation
            <Input
              type="search"
              value={q}
              maxLength={100}
              enterKeyHint="search"
              onChange={(e) => {
                setQ(e.target.value);
                setShown(THREAD_PAGE);
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-fg-secondary">
            Kind
            <Select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ThreadKind);
                setShown(THREAD_PAGE);
              }}
            >
              <option value="all">All</option>
              <option value="comments">Comments</option>
              <option value="status">Status changes</option>
            </Select>
          </label>
        </div>

        <p id={COUNT_ID} tabIndex={-1} className="text-[11.5px] text-fg-muted outline-none" aria-live="polite">
          {threadCountLine({ total: notes.length, matching: matches.length, shown: visible.length, filtering })}
        </p>

        {matches.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">{filtering ? "No message matches." : "Nothing said yet."}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <section key={`${g.month}-${g.items[0].id}`} className="flex flex-col gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{g.month}</h3>
                <ul className="flex flex-col gap-3">
                  {g.items.map((n) => <ThreadMessage key={n.id} note={n} id={rowId(n.id)} />)}
                </ul>
              </section>
            ))}
            {matches.length > visible.length && (
              <div>
                <Button variant="secondary" size="sm" onClick={loadMore}>Load {THREAD_PAGE} more</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
