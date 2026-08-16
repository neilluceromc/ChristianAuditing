"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { markDocumentSigned, uploadDocument } from "@/server/modules/inventory/document-actions";

export interface DocumentRow {
  id: string;
  kind: string;
  fileName: string;
  signed: boolean;
  uploadedBy: string;
  at: string;
  downloadHref: string;
}

const KIND_OPTIONS = [
  { value: "receipt", label: "Receipt" },
  { value: "accountability-form", label: "Accountability form" },
  { value: "photo", label: "Photo" },
  { value: "other", label: "Other" },
];

export function DocumentsPanel({
  assetId,
  docs,
  canMutate,
}: {
  assetId: string;
  docs: DocumentRow[];
  canMutate: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState("receipt");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    setRetryAfter(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.set("assetId", assetId);
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadDocument(fd);
      setFileName(null);
      if (res.ok) {
        toast("Document uploaded — audit entry written", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  function sign(docId: string) {
    startTransition(async () => {
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
        <ul className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 border-b border-border-faint px-3 py-2.5 last:border-b-0">
              <Pill>{doc.kind}</Pill>
              <a href={doc.downloadHref} className="min-w-0 flex-1 truncate text-[12.5px] text-accent hover:underline">
                {doc.fileName}
              </a>
              {doc.signed ? (
                <Pill tone="accent">SIGNED</Pill>
              ) : (
                canMutate && doc.kind === "accountability-form" && (
                  <Button size="sm" variant="ghost" onClick={() => sign(doc.id)}>Mark signed</Button>
                )
              )}
              <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">
                {doc.uploadedBy} · {doc.at}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canMutate && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) upload(file);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-(--radius-card) border border-dashed p-6 text-center",
            dragging ? "border-accent bg-accent-tint" : "border-border-strong",
          )}
        >
          {pending && fileName ? (
            <span className="inline-flex items-center gap-2 text-xs text-fg-secondary">
              <Spinner size={12} /> uploading {fileName}…
            </span>
          ) : (
            <>
              <p className="text-xs text-fg-secondary">Drop a file here, or</p>
              <div className="flex items-center gap-2">
                <Select aria-label="Document kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto py-1.5 text-xs">
                  {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
                <Button size="sm" onClick={() => inputRef.current?.click()}>Choose file</Button>
              </div>
              <p className="font-mono text-[10px] text-fg-faint">PDF · PNG · JPG — max 10 MB</p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="sr-only"
            aria-label="Upload document"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
