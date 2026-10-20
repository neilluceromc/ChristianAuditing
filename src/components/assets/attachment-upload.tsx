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
import type { ActionResult } from "@/server/action-result";
import { settleUploadResult } from "./form-focus";

type UploadState = ActionResult<{ id: string }> | null;

/**
 * Phase 47 (spec §4.4): the Attachments upload area — pick the kind, then choose or drop a file (PDF, PNG or JPG,
 * 4 MB; the server validates with the same rules and storage driver as every upload), then Upload. Runs the Task 6
 * `uploadAttachmentFormAction` through `useActionState`; nothing is stored until Upload.
 */
export function AttachmentUpload({ assetId }: { assetId: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadAttachmentFormAction, null);
  const [, startTransition] = useTransition();
  const toast = useToast();
  const [kind, setKind] = useState<AttachmentKind>("proof-of-payment");
  const [file, setFile] = useState<File | null>(null);
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

  const error = state && !state.ok && state.kind !== "rate_limited"
    ? state.fieldErrors?.file ?? state.fieldErrors?.kind ?? state.message
    : null;

  function upload() {
    if (!file || pending) return;
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
      <FileDrop label="Attachment file" onFile={setFile} disabled={pending} buttonRef={chooseRef} />
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
