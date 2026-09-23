"use client";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FileDrop } from "@/components/patterns/file-drop";
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/documents";

export interface StagedDocument {
  file: File;
  kind: DocumentKind;
}

/**
 * Phase 30 (spec §5.4): Register's documents, in the record's own drop zone.
 * Quantity 1 takes several files, each with a kind; a batch takes one invoice
 * that is attached to every unit. Nothing uploads until the assets exist.
 */
export function RegisterDocuments({
  single,
  files,
  onFiles,
  invoiceFile,
  onInvoiceFile,
  disabled,
}: {
  single: boolean;
  files: StagedDocument[];
  onFiles: (files: StagedDocument[]) => void;
  invoiceFile: File | null;
  onInvoiceFile: (file: File | null) => void;
  disabled: boolean;
}) {
  if (!single) {
    return (
      <div className="flex flex-col gap-2 sm:col-span-2">
        <span className="text-xs font-medium text-fg">Invoice document</span>
        <FileDrop label="Invoice document" disabled={disabled} onFile={onInvoiceFile} />
        {invoiceFile && (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{invoiceFile.name}</span>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${invoiceFile.name}`} onClick={() => onInvoiceFile(null)}>
              Remove
            </Button>
          </div>
        )}
        <p className="text-[11px] text-fg-muted">Attached to every unit in this batch.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:col-span-2">
      <span className="text-xs font-medium text-fg">Documents</span>
      <FileDrop
        multiple
        label="Documents"
        disabled={disabled}
        // The record's Documents tab starts an image on Photo; anything else on Receipt.
        onFiles={(chosen) =>
          onFiles([...files, ...chosen.map((file) => ({ file, kind: (file.type.startsWith("image/") ? "photo" : "receipt") as DocumentKind }))])
        }
      />
      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f, i) => (
            <li key={`${f.file.name}-${i}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{f.file.name}</span>
              <Select
                aria-label={`Kind for ${f.file.name}`}
                className="w-auto"
                value={f.kind}
                onChange={(e) => {
                  const kind = e.target.value as DocumentKind;
                  onFiles(files.map((x, j) => (j === i ? { ...x, kind } : x)));
                }}
              >
                {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k]}</option>)}
              </Select>
              <Button
                type="button" variant="ghost" size="sm" aria-label={`Remove ${f.file.name}`}
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
