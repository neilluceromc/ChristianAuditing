"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Banner } from "@/components/ui/banner";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { recordAcknowledgement } from "@/server/modules/employees/acknowledgement-actions";
import { fmtDate } from "@/lib/format";
import { latestSigningDate, type AckItem } from "@/lib/acknowledgement";

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

/**
 * Spec §6: the signed paper, recorded on the person. The list here needs no
 * interactivity of its own — only the "Record a signed form…" dialog does —
 * but it lives in the same client module as that dialog (matches
 * DocumentsPanel's precedent) rather than a second file for a handful of
 * static rows.
 */
export function AcknowledgementCard({
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
  return (
    <Card>
      <CardHeader title="Accountability form" />
      <CardBody className="flex flex-col gap-3">
        {latest ? (
          <p className="text-[12.5px] text-fg-secondary">
            Signed {fmtDate(latest.signedAt)} · {itemCount(latest.items)} item{plural(itemCount(latest.items))} covered ·{" "}
            <a
              href={`/employees/${employeeId}/acknowledgements/${latest.id}/download`}
              className="text-accent hover:underline"
            >
              Download
            </a>
          </p>
        ) : (
          <p className="text-[12.5px] text-fg-muted">No signed form on file</p>
        )}

        {uncovered.length > 0 && (
          <Banner tone="attention" title={`Issued since last signature: ${uncovered.map((u) => u.tag).join(", ")}`} />
        )}

        <div className="flex flex-col gap-2">
          <ButtonLink href={`/employees/${employeeId}/form`} size="sm" className="w-full justify-center">
            Print form
          </ButtonLink>
          {canRecord && <RecordAcknowledgementDialog employeeId={employeeId} />}
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
                    <a
                      href={`/employees/${employeeId}/acknowledgements/${row.id}/download`}
                      className="text-accent hover:underline"
                    >
                      Download
                    </a>
                  </p>
                );
              })}
            </div>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function RecordAcknowledgementDialog({ employeeId }: { employeeId: string }) {
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
      <Button size="sm" className="w-full justify-center" onClick={() => setOpen(true)}>
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
