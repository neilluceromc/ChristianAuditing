"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { uploadSupplierDocument } from "@/server/modules/suppliers/document-actions";
import { SUPPLIER_DOCUMENT_KINDS, SUPPLIER_DOCUMENT_LABEL } from "@/lib/documents";
import { SupplierDocumentsTable } from "./supplier-documents-table";

export interface SupplierDocumentRow {
  id: string;
  kind: string;
  fileName: string;
  uploadedBy: string;
  at: string;
  downloadHref: string;
}

type SupplierDocKind = (typeof SUPPLIER_DOCUMENT_KINDS)[number];

/** The upload half of inventory/documents-panel.tsx, minus signing and drag-and-drop — spec §4.2. */
export function SupplierDocumentsCard({
  vendorId,
  docs,
  canUpload,
}: {
  vendorId: string;
  docs: SupplierDocumentRow[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<SupplierDocKind>(SUPPLIER_DOCUMENT_KINDS[0]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    setRetryAfter(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.set("vendorId", vendorId);
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadSupplierDocument(fd);
      setFileName(null);
      if (res.ok) {
        toast("Document uploaded", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  return (
    <Card>
      <CardHeader title="Documents" />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}

        <SupplierDocumentsTable docs={docs} />

        {canUpload && (
          <div className="flex items-center gap-2 border-t border-border-faint pt-3">
            <Select
              aria-label="Document kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SupplierDocKind)}
              className="w-auto py-1.5 text-xs"
            >
              {SUPPLIER_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{SUPPLIER_DOCUMENT_LABEL[k]}</option>)}
            </Select>
            {pending && fileName ? (
              <span className="inline-flex items-center gap-2 text-xs text-fg-secondary">
                <Spinner size={12} /> uploading {fileName}…
              </span>
            ) : (
              <Button size="sm" onClick={() => inputRef.current?.click()}>Upload</Button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="sr-only"
              aria-label="Document file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
            <p className="font-mono text-[10px] text-fg-faint">PDF · PNG · JPG — max 10 MB</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
