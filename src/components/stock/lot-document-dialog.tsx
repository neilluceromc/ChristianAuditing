"use client";

import { useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { LOT_DOCUMENT_KINDS, type LotDocumentKind } from "@/lib/stock-schema";
import { uploadLotDocument } from "@/server/modules/stock/document-actions";
import { useStockRunner } from "./use-stock-runner";

/** Shared with lots-card.tsx's document pills — mirrors documents.ts's REQUEST_DOCUMENT_LABEL convention. */
export const LOT_DOCUMENT_LABEL: Record<LotDocumentKind, string> = {
  "delivery-receipt": "Delivery receipt",
  invoice: "Invoice",
  other: "Other",
};

/** Spec §5.3/§6.4, mirrors request-documents-card.tsx's upload half inside a Dialog instead of an inline card. */
export function LotDocumentDialog({ lotId }: { lotId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LotDocumentKind>(LOT_DOCUMENT_KINDS[0]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useStockRunner(["kind", "file"]);

  function openDialog() {
    reset();
    setKind(LOT_DOCUMENT_KINDS[0]);
    if (inputRef.current) inputRef.current.value = "";
    setOpen(true);
  }

  function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("lotId", lotId);
    fd.set("kind", kind);
    fd.set("file", file);
    run(() => uploadLotDocument(fd), "Document attached", { onOk: () => setOpen(false) });
  }

  return (
    <>
      <Button size="sm" onClick={openDialog}>Attach document</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Attach document"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Upload</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Kind</label>
            <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as LotDocumentKind)}>
              {LOT_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{LOT_DOCUMENT_LABEL[k]}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">File</label>
            <input
              ref={inputRef}
              type="file"
              aria-label="File"
              accept=".pdf,.png,.jpg,.jpeg"
              className="text-xs text-fg-secondary"
            />
            <FormError>{fieldErrors.file}</FormError>
            <p className="font-mono text-[10px] text-fg-faint">PDF · PNG · JPG — max 10 MB</p>
          </div>
        </div>
      </Dialog>
    </>
  );
}
