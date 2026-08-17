"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { fmtDateTime } from "@/lib/format";
import { NOTE_CHIP, type ThreadNote } from "@/lib/purchase-thread";
import { addComment } from "@/server/modules/purchases/actions";

/**
 * The notes field is an append-only conversation across three parties — actor,
 * action chip, timestamp — never a textarea that overwrites (brief §6.1). The
 * composer only appends; nothing here can edit or delete a line, because the
 * database won't allow it either (NoteEntry has an append-only trigger).
 */
export function NoteThread({
  requestId,
  notes,
  canComment,
}: {
  requestId: string;
  notes: ThreadNote[];
  canComment: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

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
        <ol id="thread" className="flex flex-col gap-3">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <Avatar name={n.author} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-medium text-fg">{n.author}</span>
                  <Pill tone={n.kind === "COMMENT" ? "neutral" : "accent"}>{NOTE_CHIP[n.kind]}</Pill>
                  <span className="font-mono text-[10px] text-fg-muted">{fmtDateTime(n.at)}</span>
                </div>
                <p className="text-[12.5px] text-fg-secondary">{n.text}</p>
              </div>
            </li>
          ))}
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
    </Card>
  );
}
