"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { FileDrop } from "@/components/patterns/file-drop";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { markDocumentSigned, uploadDocument } from "@/server/modules/inventory/document-actions";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL as KIND_LABELS, type DocumentKind } from "@/lib/documents";
import { ATTACHMENT_DOC_PREFIX, ATTACHMENT_KIND_LABELS, attachmentKindOf } from "@/lib/asset-notes";
import { splitDocuments } from "@/lib/inventory-record";

export interface DocumentRow {
  id: string;
  kind: string;
  fileName: string;
  signed: boolean;
  uploadedBy: string;
  at: string;
  downloadHref: string;
}

const KIND_OPTIONS = DOCUMENT_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }));

/** The words for a row's kind: a document kind, or (for `attachment:*`) the attachment kind — never the raw string. */
function kindLabel(kind: string): string {
  if (kind.startsWith(ATTACHMENT_DOC_PREFIX)) return ATTACHMENT_KIND_LABELS[attachmentKindOf(kind) ?? "other"];
  return KIND_LABELS[kind as DocumentKind] ?? kind;
}

/** One list of document rows. An attachment is never signable: only an accountability form shows Mark signed. */
function DocList({ rows, canSign, onSign, label }: { rows: DocumentRow[]; canSign: boolean; onSign: (docId: string) => void; label?: string }) {
  return (
    <ul aria-label={label} className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
      {rows.map((doc) => (
        <li key={doc.id} className="flex items-center gap-3 border-b border-border-faint px-3 py-2.5 last:border-b-0">
          <Pill>{kindLabel(doc.kind)}</Pill>
          <a href={doc.downloadHref} className="min-w-0 flex-1 truncate text-[12.5px] text-accent hover:underline">
            {doc.fileName}
          </a>
          {doc.signed ? (
            <Pill tone="accent">SIGNED</Pill>
          ) : (
            canSign && doc.kind === "accountability-form" && (
              <Button size="sm" variant="ghost" onClick={() => onSign(doc.id)}>Mark signed</Button>
            )
          )}
          <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">
            {doc.uploadedBy} · {doc.at}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DocumentsPanel({
  assetId,
  docs,
  canUpload,
  canSign,
}: {
  assetId: string;
  docs: DocumentRow[];
  /** Phase 16 (ruling R14): the managing department, or the registering
   * department while IT has not yet checked this asset — `canAttachDocuments`. */
  canUpload: boolean;
  /** Marking an accountability form signed stays `canManageClass` — unchanged by R14. */
  canSign: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [uploading, startUpload] = useTransition();
  const [, startSign] = useTransition();
  // Phase 30 (spec §4.4): a chosen or dropped file waits here, with its kind,
  // until Upload — nothing is stored on drop. `lastKind` is the kind the
  // operator last picked, which a non-image file starts on.
  const [staged, setStaged] = useState<{ file: File; kind: DocumentKind } | null>(null);
  const [lastKind, setLastKind] = useState<DocumentKind>("receipt");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  // Phase 47 (spec §4.2a): shared attachments (`attachment:*`) list under their own heading, apart from the document slots
  const { documents, attachments } = splitDocuments(docs);

  function choose(file: File) {
    setError(null);
    setRetryAfter(null);
    setStaged({ file, kind: file.type.startsWith("image/") ? "photo" : lastKind });
  }

  function upload() {
    if (!staged) return;
    setError(null);
    setRetryAfter(null);
    const fd = new FormData();
    fd.set("assetId", assetId);
    fd.set("kind", staged.kind);
    fd.set("file", staged.file);
    startUpload(async () => {
      const res = await uploadDocument(fd);
      if (res.ok) {
        setStaged(null);
        toast("Document uploaded — audit entry written", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  function sign(docId: string) {
    startSign(async () => {
      const res = await markDocumentSigned({ docId });
      if (res.ok) {
        toast("Marked signed", "settled");
        router.refresh();
      } else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}

      {docs.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-muted">
          Nothing attached yet — receipts, photos and signed accountability forms live here.
        </p>
      ) : (
        <>
          {documents.length > 0 && <DocList rows={documents} canSign={canSign} onSign={sign} />}
          {attachments.length > 0 && (
            <section aria-labelledby="record-attachments-heading" className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 id="record-attachments-heading" className="text-[13px] font-semibold text-fg">Attachments</h3>
                <Link href={`/inventory/${encodeURIComponent(assetId)}/attachments`} className="text-xs text-accent hover:underline">
                  Open the Attachments tab
                </Link>
              </div>
              <DocList rows={attachments} canSign={false} onSign={sign} />
            </section>
          )}
        </>
      )}

      {canUpload && (
        <div className="flex flex-col gap-2">
          <FileDrop label="Document file" onFile={choose} disabled={uploading} />
          {staged && (
            <div className="flex flex-wrap items-center gap-2 rounded-(--radius-card) border border-border bg-surface px-3 py-2.5 shadow-card">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{staged.file.name}</span>
              <Select
                aria-label="Document kind"
                value={staged.kind}
                disabled={uploading}
                onChange={(e) => {
                  const kind = e.target.value as DocumentKind;
                  setStaged((s) => (s ? { ...s, kind } : s));
                  setLastKind(kind);
                }}
                className="w-auto py-1.5 text-xs"
              >
                {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <Button size="sm" variant="primary" loading={uploading} onClick={upload}>Upload</Button>
              <Button size="sm" variant="ghost" disabled={uploading} onClick={() => { setStaged(null); setError(null); }}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
