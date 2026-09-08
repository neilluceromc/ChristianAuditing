"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { uploadRequestDocument } from "@/server/modules/purchases/document-actions";
import { REQUEST_DOCUMENT_KINDS, REQUEST_DOCUMENT_LABEL } from "@/lib/documents";

export interface RequestDocumentRow {
  id: string;
  kind: string;
  fileName: string;
  uploadedBy: string;
  at: string;
  downloadHref: string;
}

type RequestDocKind = (typeof REQUEST_DOCUMENT_KINDS)[number];

/** The attachments half of suppliers/supplier-documents-card.tsx, with a request in place of a supplier — spec §5.3. */
export function RequestDocumentsCard({
  requestId,
  docs,
  canUpload,
}: {
  requestId: string;
  docs: RequestDocumentRow[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<RequestDocKind>(REQUEST_DOCUMENT_KINDS[0]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    setRetryAfter(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.set("requestId", requestId);
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadRequestDocument(fd);
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
      <CardHeader title="Attachments" />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}

        {docs.length === 0 ? (
          <p className="py-2 text-center text-xs text-fg-muted">No attachments yet.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Kind</Th>
                <Th>File</Th>
                <Th>Uploaded by</Th>
                <Th>Date</Th>
                <Th aria-label="Download" />
              </Tr>
            </THead>
            <TBody>
              {docs.map((d) => (
                <Tr key={d.id}>
                  <Td>{REQUEST_DOCUMENT_LABEL[d.kind as RequestDocKind] ?? d.kind}</Td>
                  <Td>{d.fileName}</Td>
                  <Td>{d.uploadedBy}</Td>
                  <Td mono>{d.at}</Td>
                  <Td align="right"><a href={d.downloadHref} className="text-accent hover:underline">Download</a></Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {canUpload && (
          <div className="flex items-center gap-2 border-t border-border-faint pt-3">
            <Select
              aria-label="Document kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as RequestDocKind)}
              className="w-auto py-1.5 text-xs"
            >
              {REQUEST_DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{REQUEST_DOCUMENT_LABEL[k]}</option>)}
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
