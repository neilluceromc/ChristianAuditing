"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { FileDrop } from "@/components/patterns/file-drop";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { uploadAttachmentFormAction } from "@/server/modules/assets/attachments";
import { ATTACHMENT_KINDS, ATTACHMENT_KIND_LABELS, type AttachmentKind } from "@/lib/asset-notes";
import { checkUploadMeta } from "@/lib/upload-meta";
import type { ActionResult } from "@/server/action-result";
import { settleUploadResult, stageUploadFile } from "./form-focus";

type UploadState = ActionResult<{ id: string }> | null;

/**
 * Phase 47 (spec §4.4): the Attachments upload area — pick the kind, then choose or drop a file (PDF, PNG or JPG,
 * 4 MB; the server validates with the same rules and storage driver as every upload), then Upload. Runs the Task 6
 * `uploadAttachmentFormAction` through `useActionState`; nothing is stored until Upload.
 *
 * The browser checks a chosen file with the server's own `checkUploadMeta` first and refuses it inline, in the
 * server's words: a file over the server-action body limit never reaches the server (the framework would reject it
 * before `validateUpload` runs, and the rejection would throw into the error boundary).
 */
export function AttachmentUpload({ assetId }: { assetId: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadAttachmentFormAction, null);
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [kind, setKind] = useState<AttachmentKind>("proof-of-payment");
  const [file, setFile] = useState<File | null>(null);
  // The browser's own refusal of a chosen file, and the server result that a new pick made stale.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [staleState, setStaleState] = useState<UploadState>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const lastHandled = useRef<UploadState>(null);
  const sentName = useRef<string | null>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const uploadRef = useRef<HTMLButtonElement>(null);
  const kindId = useId();

  useEffect(() => {
    if (!state || state === lastHandled.current) return;
    lastHandled.current = state;
    if (state.ok) toast("Attachment uploaded — audit entry written", "settled");
    // Upload disabled while it worked (focus fell to <body>); saved, its row goes away: focus "Choose file" and
    // announce it; refused, the row stays: focus Upload again
    settleUploadResult(state, sentName.current, {
      clear: () => setFile(null),
      announce: setStatus,
      rateLimited: setRetryAfter,
      choose: chooseRef.current,
      upload: uploadRef.current,
    });
  }, [state, toast]);

  const serverError = state && state !== staleState && !state.ok && state.kind !== "rate_limited"
    ? state.fieldErrors?.file ?? state.fieldErrors?.kind ?? state.message
    : null;
  const error = refusal ?? serverError;

  function pick(chosen: File) {
    setStaleState(state);
    stageUploadFile<File>(chosen, { stage: setFile, refuse: setRefusal });
  }

  function upload() {
    if (!file || pending) return;
    // never send a file the server would refuse (or the framework would reject for its size)
    const refused = checkUploadMeta(file);
    if (refused) {
      setRefusal(refused);
      setFile(null);
      return;
    }
    const data = new FormData();
    data.set("assetId", assetId);
    data.set("kind", kind);
    data.set("file", file);
    sentName.current = file.name;
    setStatus("");
    startTransition(() => action(data));
  }

  return (
    <section aria-label="Upload an attachment" className="flex flex-col gap-2">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={kindId} className="text-[12.5px] font-medium text-fg">Kind</label>
        <Select
          id={kindId}
          value={kind}
          disabled={pending}
          onChange={(e) => setKind(e.target.value as AttachmentKind)}
          className="w-auto py-1.5 text-xs"
        >
          {ATTACHMENT_KINDS.map((k) => <option key={k} value={k}>{ATTACHMENT_KIND_LABELS[k]}</option>)}
        </Select>
      </div>
      <FileDrop label="Attachment file" onFile={pick} disabled={pending} buttonRef={chooseRef} />
      <p role="status" aria-live="polite" className="sr-only">{status}</p>
      {file && (
        <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-border bg-surface px-3 py-2.5 shadow-card">
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{file.name}</span>
          <span className="text-[11.5px] text-fg-muted">{ATTACHMENT_KIND_LABELS[kind]}</span>
          <Button ref={uploadRef} size="sm" variant="primary" loading={pending} onClick={upload}>Upload</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setFile(null)}>Cancel</Button>
        </div>
      )}
    </section>
  );
}
