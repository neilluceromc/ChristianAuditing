"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { postNoteFormAction, setNoteResolved } from "@/server/modules/assets/notes";
import { NOTE_MAX_CHARS } from "@/lib/asset-notes";
import type { ActionResult } from "@/server/action-result";

type PostState = ActionResult<{ id: string }> | null;

/** The error words of a failed post (rate limits show their own countdown). */
function errorOf(state: PostState): string | null {
  if (!state || state.ok || state.kind === "rate_limited") return null;
  return state.fieldErrors?.body ?? state.message;
}

/**
 * Phase 47 (spec §4.3): the compose box ("Add a note") or, with `parentId`, a thread's Reply box — the Task 6
 * `postNoteFormAction` through `useActionState`. Post is disabled while the box is empty; at most 2,000 characters.
 * The box clears once the note is saved (the action revalidates the page, so the new note appears).
 */
export function NoteForm({ assetId, parentId, replyTo }: { assetId: string; parentId?: string; replyTo?: string }) {
  const [state, action, pending] = useActionState<PostState, FormData>(postNoteFormAction, null);
  const [, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const lastHandled = useRef<PostState>(null);
  const id = useId();
  const errorId = `${id}-error`;
  const reply = parentId !== undefined;

  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) setBody("");
    else if (state.kind === "rate_limited") setRetryAfter(state.retryAfterSec ?? 60);
  }, [state]);

  const error = errorOf(state);
  const label = reply ? `Reply${replyTo ? ` to ${replyTo}` : ""}` : "Add a note";
  return (
    <form
      className="flex flex-col gap-2"
      // submitted by hand rather than through `action=`, so a refused note stays in the box (React resets a form
      // whose `action` prop ran)
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || body.trim() === "") return;
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="assetId" value={assetId} />
      {reply && <input type="hidden" name="parentId" value={parentId} />}
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <label htmlFor={`${id}-body`} className={reply ? "sr-only" : "text-[13px] font-medium text-fg"}>{label}</label>
      <Textarea
        id={`${id}-body`}
        name="body"
        rows={reply ? 1 : 3}
        maxLength={NOTE_MAX_CHARS}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={reply ? "Write a reply…" : "Write a note for everyone who works on this asset…"}
        invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        readOnly={pending}
      />
      <div className="flex items-center gap-3">
        {error && <p id={errorId} role="alert" className="text-xs text-(--st-fault-text)">{error}</p>}
        {!reply && (
          <span className="ml-auto font-mono text-[10.5px] tabular-nums text-fg-faint">
            {body.length.toLocaleString("en-US")} / {NOTE_MAX_CHARS.toLocaleString("en-US")}
          </span>
        )}
        <Button
          type="submit"
          size="sm"
          variant={reply ? "secondary" : "primary"}
          disabled={body.trim() === ""}
          loading={pending}
          className={reply ? "ml-auto" : undefined}
        >
          {reply ? "Reply" : "Post"}
        </Button>
      </div>
    </form>
  );
}

/** Mark resolved / Reopen on a thread (Task 6 `setNoteResolved`). */
export function ResolveButton({ noteId, resolved }: { noteId: string; resolved: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        loading={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await setNoteResolved({ noteId, resolved: !resolved });
            if (res.ok) router.refresh();
            else setError(res.message);
          });
        }}
      >
        {resolved ? "Reopen" : "Mark resolved"}
      </Button>
      {error && <span role="alert" className="text-xs text-(--st-fault-text)">{error}</span>}
    </span>
  );
}
