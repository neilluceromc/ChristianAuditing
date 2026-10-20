import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import { fmtFileSize } from "@/lib/finance-asset-page";
import { ATTACHMENT_KINDS, ATTACHMENT_KIND_LABELS, type AssetAttachmentView, type AttachmentKind } from "@/lib/asset-notes";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AttachmentUpload } from "./attachment-upload";
import { DocPreview } from "./doc-preview";

export interface AttachmentsTabProps {
  assetId: string;
  /** `assetAttachments` (src/server/modules/assets/queries.ts), newest first. */
  attachments: AssetAttachmentView[];
  /** `canPostOnAsset(role, cls)`: shows the upload area. */
  canUpload: boolean;
  /** The kind filter (`ak` in the URL). */
  kind: AttachmentKind | "all";
  /** The attachment open in the preview (`att` in the URL). */
  selectedId: string | null;
  /** This page's URL with the kind filter and / or the selected attachment changed (each page keeps its own params). */
  hrefFor: (patch: { ak?: AttachmentKind | "all"; att?: string | null }) => string;
}

/**
 * Phase 47 (spec §4.2a, §4.4): the asset's Attachments — shared by the Finance asset page and the Inventory record
 * (no money in it). The upload area (for those who can post), kind filters with counts, the list (name, kind,
 * uploader, date, size) and the selected file's preview beside it. A Server Component: `hrefFor` runs here, so only
 * strings reach the client parts. No one deletes an attachment; replacing one uploads a new one.
 */
export function AttachmentsTab({ assetId, attachments, canUpload, kind, selectedId, hrefFor }: AttachmentsTabProps) {
  const counts = Object.fromEntries(ATTACHMENT_KINDS.map((k) => [k, attachments.filter((a) => a.kind === k).length])) as Record<AttachmentKind, number>;
  const shown = kind === "all" ? attachments : attachments.filter((a) => a.kind === kind);
  const selected = selectedId ? shown.find((a) => a.id === selectedId) ?? null : null;
  const filters: Array<{ key: AttachmentKind | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: attachments.length },
    ...ATTACHMENT_KINDS.map((k) => ({ key: k, label: ATTACHMENT_KIND_LABELS[k], count: counts[k] })),
  ];

  return (
    <div className="flex flex-col gap-3">
      {canUpload && (
        <Card className="px-4 py-3">
          <AttachmentUpload assetId={assetId} />
        </Card>
      )}

      {attachments.length === 0 ? (
        <Card>
          <EmptyState
            title="No attachments yet"
            description="Proofs of payment, quotations and photos are shared with everyone who can see this asset."
          />
        </Card>
      ) : (
        <>
          <nav aria-label="Attachment kind" className="flex flex-wrap gap-1.5">
            {filters.map((f) => {
              const on = kind === f.key;
              return (
                <Link
                  key={f.key}
                  href={hrefFor({ ak: f.key, att: null })}
                  scroll={false}
                  prefetch={false}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-(--dur-1)",
                    on ? "border-accent bg-accent-soft text-accent-soft-text" : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
                  )}
                >
                  {f.label}
                  <span className="tabular-nums text-fg-muted">{f.count}</span>
                </Link>
              );
            })}
          </nav>

          <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card className="overflow-hidden">
              {shown.length === 0 ? (
                <EmptyState
                  title={`No ${kind === "all" ? "" : ATTACHMENT_KIND_LABELS[kind].toLowerCase()} attachments`}
                  description="Pick another kind, or All."
                />
              ) : (
                <ul aria-label="Attachments">
                  {shown.map((a) => {
                    const on = selected?.id === a.id;
                    return (
                      <li key={a.id} className="border-b border-border-faint last:border-b-0">
                        <Link
                          href={hrefFor({ att: on ? null : a.id })}
                          scroll={false}
                          prefetch={false}
                          aria-current={on ? "true" : undefined}
                          className={cn(
                            "flex flex-col gap-0.5 px-4 py-2.5 transition-colors duration-(--dur-1)",
                            on ? "bg-accent-tint" : "hover:bg-surface-subtle",
                          )}
                        >
                          <span className="truncate text-[13px] font-medium text-accent">{a.fileName}</span>
                          <span className="flex flex-wrap gap-x-2 text-[11.5px] text-fg-muted">
                            <span>{ATTACHMENT_KIND_LABELS[a.kind]}</span>
                            <span aria-hidden>·</span>
                            <span>{a.uploadedBy ?? "Unknown"}</span>
                            <span aria-hidden>·</span>
                            <span>{fmtDate(a.createdAt)}</span>
                            <span aria-hidden>·</span>
                            <span className="font-mono">{fmtFileSize(a.size)}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            {selected ? (
              <DocPreview
                assetId={assetId}
                doc={{ id: selected.id, fileName: selected.fileName, size: selected.size }}
                title={ATTACHMENT_KIND_LABELS[selected.kind]}
                closeHref={hrefFor({ att: null })}
              />
            ) : (
              <Card className="hidden xl:block">
                <p className="px-4 py-12 text-center text-xs text-fg-muted">Select a file to preview it.</p>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
