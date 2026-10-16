"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { recordAcknowledgement } from "@/server/modules/employees/acknowledgement-actions";
import { fmtDate } from "@/lib/format";
import { latestSigningDate, type AckItem } from "@/lib/acknowledgement";
import { formStatus, tagLine } from "@/lib/side-card";
import { StatusDot } from "./status-dot";

export interface AckRow {
  id: string;
  signedAt: Date;
  items: unknown;
}

function itemCount(items: unknown): number {
  return Array.isArray(items) ? (items as AckItem[]).length : 0;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

const download = (employeeId: string, id: string) => `/employees/${employeeId}/acknowledgements/${id}/download`;

/**
 * Spec §6 (Phase 20), Phase 39 (spec §2.4): the signed paper, recorded on the person — the side card's Form tab.
 * A status line with a dot, a helper line, Print and Record side by side (Record is the primary while nothing is
 * signed), then the History `<details>` of older forms (the page caps the read at 20).
 */
export function FormTab({
  employeeId,
  latest,
  history,
  uncovered,
  canRecord,
}: {
  employeeId: string;
  latest: AckRow | null;
  history: AckRow[];
  uncovered: Array<{ tag: string }>;
  canRecord: boolean;
}) {
  const status = formStatus(latest ? { signedAt: latest.signedAt, items: itemCount(latest.items) } : null, uncovered.length);
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-fg-secondary">
        <StatusDot dot={status.dot} />
        <span className={latest ? "text-fg" : undefined}>{status.text}</span>
        {latest && (
          <>
            <span aria-hidden>·</span>
            <a href={download(employeeId, latest.id)} className="text-accent hover:underline">Download</a>
          </>
        )}
        {status.since && (
          <>
            <span aria-hidden>·</span>
            <span className="font-medium" style={{ color: "var(--st-attention-text)" }}>
              {status.since}
            </span>
          </>
        )}
      </p>
      {status.since && (
        <p className="-mt-2 pl-3.5 font-mono text-[11px] text-fg-muted">{tagLine(uncovered.map((u) => u.tag))}</p>
      )}
      <p className="text-[11.5px] text-fg-muted">Print it, have them sign, then record it here.</p>

      <div className="flex gap-2">
        <ButtonLink href={`/employees/${employeeId}/form`} size="sm" className="flex-1 justify-center">
          Print form
        </ButtonLink>
        {canRecord && <RecordAcknowledgementDialog employeeId={employeeId} primary={!latest} />}
      </div>

      {history.length > 0 && (
        <details className="rounded-(--radius-card) border border-border-faint">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-fg-secondary">
            History ({history.length})
          </summary>
          <div className="flex flex-col gap-1.5 border-t border-border-faint px-3 py-2.5">
            {history.map((row) => {
              const n = itemCount(row.items);
              return (
                <p key={row.id} className="text-[11px] text-fg-secondary">
                  {fmtDate(row.signedAt)} · {n} item{plural(n)} ·{" "}
                  <a href={download(employeeId, row.id)} className="text-accent hover:underline">Download</a>
                </p>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function RecordAcknowledgementDialog({ employeeId, primary }: { employeeId: string; primary: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [signedAt, setSignedAt] = useState(today());
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() {
    setOpen(false); setSignedAt(today()); setFile(null);
    setFieldErrors({}); setError(null); setRetryAfter(null);
  }

  function submit() {
    setError(null); setFieldErrors({});
    const fd = new FormData();
    fd.set("employeeId", employeeId);
    fd.set("signedAt", signedAt);
    if (file) fd.set("file", file);
    startTransition(async () => {
      const res = await recordAcknowledgement(fd);
      if (res.ok) {
        toast("Signed form recorded", "settled");
        close();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant={primary ? "primary" : "secondary"}
        className="flex-1 justify-center"
        onClick={() => setOpen(true)}
      >
        Record a signed form…
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Record a signed form"
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit} disabled={!file || !signedAt}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <FormField label="Signed on" required error={fieldErrors.signedAt}>
            {(p) => (
              <Input
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                type="date"
                max={latestSigningDate(new Date())}
                value={signedAt}
                onChange={(e) => setSignedAt(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Signed form (scan or photo)" required hint="PDF · PNG · JPG — max 10 MB." error={fieldErrors.file}>
            {(p) => (
              <input
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                aria-invalid={p.invalid || undefined}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="text-xs text-fg-secondary"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
