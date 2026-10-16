"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { THREAD_PREVIEW, type ThreadNote } from "@/lib/purchase-thread";
import { addComment } from "@/server/modules/purchases/actions";
import { ThreadMessage } from "./thread-message";
import { ThreadPanel } from "./thread-panel";

/** Phase 39 (spec §3): `?thread=1` keeps the conversation side panel open across a refresh. */
function setThreadParam(open: boolean) {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set("thread", "1");
  else url.searchParams.delete("thread");
  // `null` state: Next's patched replaceState then keeps its own history entry and syncs the router's URL.
  window.history.replaceState(null, "", url);
}

/**
 * The notes field is an append-only conversation across three parties — actor,
 * action chip, timestamp — never a textarea that overwrites (brief §6.1). The
 * composer only appends; nothing here can edit or delete a line, because the
 * database won't allow it either (NoteEntry has an append-only trigger).
 *
 * Phase 39 (spec §3): the page shows the 5 newest messages in time order, with
 * "Earlier messages ({n}) →" above them when there are more; that opens the
 * whole conversation in a side panel. `notes` is every message, oldest first.
 */
export function NoteThread({
  requestId,
  refNo,
  notes,
  canComment,
}: {
  requestId: string;
  refNo: string;
  notes: ThreadNote[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const earlierButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const earlier = Math.max(0, notes.length - THREAD_PREVIEW);
  const recent = notes.slice(earlier);

  function openPanel() {
    returnFocus.current = true;
    setPanelOpen(true);
    setThreadParam(true);
  }
  function closePanel() {
    setPanelOpen(false);
    setThreadParam(false);
  }

  // A refresh with `?thread=1` reopens the panel, when there is anything earlier to show.
  useEffect(() => {
    if (earlier > 0 && new URLSearchParams(window.location.search).get("thread") === "1") {
      returnFocus.current = true;
      setPanelOpen(true);
    }
    // Mount only: a later comment must not reopen a panel the reader closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The drawer's trap hands focus back as it unmounts; this runs after that and lands on "Earlier messages" —
  // also when the panel was opened from `?thread=1` and nothing on the page had focus before it.
  useEffect(() => {
    if (panelOpen || !returnFocus.current) return;
    returnFocus.current = false;
    earlierButton.current?.focus();
  }, [panelOpen]);

  function post() {
    setError(null);
    startTransition(async () => {
      const res = await addComment({ id: requestId, text });
      if (res.ok) {
        setText("");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.text ?? res.message);
    });
  }

  return (
    <Card>
      <CardHeader title="Thread" actions={<Pill>APPEND-ONLY</Pill>} />
      <CardBody className="flex flex-col gap-3">
        {earlier > 0 && (
          <div>
            <button
              ref={earlierButton}
              type="button"
              onClick={openPanel}
              className="rounded-(--radius-ctl) text-xs font-medium text-accent hover:underline"
            >
              Earlier messages ({earlier}) →
            </button>
          </div>
        )}
        <ol id="thread" className="flex flex-col gap-3">
          {recent.map((n) => <ThreadMessage key={n.id} note={n} />)}
          {notes.length === 0 && <li className="text-xs text-fg-muted">Nothing said yet.</li>}
        </ol>

        {canComment && (
          <div className="flex flex-col gap-2 border-t border-border-faint pt-3">
            {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
            {error && <Banner tone="fault" title={error} />}
            <Textarea
              aria-label="Add a comment"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Reply to the thread…"
            />
            <Button size="sm" loading={pending} onClick={post} className="self-start">Post comment</Button>
          </div>
        )}
      </CardBody>
      {panelOpen && <ThreadPanel refNo={refNo} notes={notes} onClose={closePanel} />}
    </Card>
  );
}
