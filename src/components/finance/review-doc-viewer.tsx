import { previewKindOf, uploadedLine } from "@/lib/file-preview";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";

/**
 * Task 6 (spec §5), Finance review: the document opened with `?doc=<id>`, shown in the page — a PDF in a titled frame,
 * a PNG or JPG as an image — with its kind, name and "Uploaded <date time> · <name>" above it, Download and Close.
 * Only a previewable document gets here (`previewHref`). No hooks: the Server Component page renders it.
 */
export function ReviewDocViewer({
  doc,
  closeHref,
}: {
  doc: { label: string; fileName: string; uploadedAt: string; uploadedBy: string | null; downloadHref: string; previewHref: string };
  closeHref: string;
}) {
  const line = uploadedLine(doc.uploadedAt, doc.uploadedBy);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-faint px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-fg-muted">{doc.label}</p>
          <p className="truncate text-[13px] font-medium text-fg" title={doc.fileName}>{doc.fileName}</p>
          {line && <p className="text-[11.5px] text-fg-muted">{line}</p>}
        </div>
        <ButtonLink native size="sm" href={doc.downloadHref}>Download</ButtonLink>
        <ButtonLink size="sm" variant="ghost" href={closeHref}>Close<span className="sr-only"> the preview</span></ButtonLink>
      </div>
      {previewKindOf(doc.fileName) === "pdf" ? (
        <iframe title={`Preview of ${doc.fileName}`} src={doc.previewHref} className="block h-[520px] w-full bg-surface-subtle" />
      ) : (
        <div className="flex justify-center bg-surface-subtle p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated route's bytes, not a static asset */}
          <img src={doc.previewHref} alt={doc.fileName} className="max-h-[520px] max-w-full object-contain" />
        </div>
      )}
    </Card>
  );
}
