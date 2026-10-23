import Link from "next/link";
import { assetDocHref, fmtFileSize } from "@/lib/finance-asset-page";
import { previewKindOf, uploadedLine } from "@/lib/file-preview";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";

/**
 * Phase 47 (spec §4.1, §4.4): a document or attachment previewed in the page — a PDF in a titled frame, a PNG or JPG
 * as an image — through the asset document download route's `?inline=1` (its auth and class checks unchanged). Open
 * full size (a new tab), Download, and Close when the preview is something the person opened (`closeHref`).
 * Shared by the Finance asset page and the Inventory record. No hooks: a Server or Client Component can render it.
 */
export function DocPreview({
  assetId,
  doc,
  title,
  closeHref,
  uploadedAt,
  uploadedBy,
}: {
  assetId: string;
  doc: { id: string; fileName: string; size?: number | null };
  /** What the file is ("Sales invoice"); the file name alone when absent. */
  title?: string;
  closeHref?: string;
  /** When it was uploaded (ISO) and by whom: "Uploaded 22 Oct 2026 09:41 · A. Reyes" under the name. */
  uploadedAt?: string | null;
  uploadedBy?: string | null;
}) {
  const kind = previewKindOf(doc.fileName);
  const line = uploadedLine(uploadedAt, uploadedBy);
  const inline = assetDocHref(assetId, doc.id, true);
  const download = assetDocHref(assetId, doc.id);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-faint px-4 py-2.5">
        <div className="min-w-0 flex-1">
          {title && <p className="text-[11px] text-fg-muted">{title}</p>}
          <p className="truncate text-[13px] font-medium text-fg" title={doc.fileName}>
            {doc.fileName}
            {doc.size !== undefined && doc.size !== null && (
              <span className="ml-2 font-mono text-[11px] font-normal text-fg-muted">{fmtFileSize(doc.size)}</span>
            )}
          </p>
          {line && <p className="text-[11.5px] text-fg-muted">{line}</p>}
        </div>
        {kind && (
          <a
            href={inline}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-fg-secondary hover:bg-surface-subtle"
          >
            Open full size<span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
        <ButtonLink native size="sm" href={download}>Download</ButtonLink>
        {closeHref && (
          <Link
            href={closeHref}
            scroll={false}
            prefetch={false}
            className="rounded-(--radius-btn) border border-transparent px-2.5 py-1.5 text-[11.5px] font-medium text-fg-secondary hover:bg-surface-subtle"
          >
            Close<span className="sr-only"> the preview</span>
          </Link>
        )}
      </div>
      {kind === "pdf" ? (
        <iframe title={`Preview of ${doc.fileName}`} src={inline} className="block h-[520px] w-full bg-surface-subtle" />
      ) : kind === "image" ? (
        <div className="flex justify-center bg-surface-subtle p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated route's bytes, not a static asset */}
          <img src={inline} alt={doc.fileName} className="max-h-[520px] max-w-full object-contain" />
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-fg-muted">This file type can&apos;t be previewed here. Download it to open it.</p>
      )}
    </Card>
  );
}
