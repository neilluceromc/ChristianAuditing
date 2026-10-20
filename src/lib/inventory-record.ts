import type { AssetClass } from "@prisma/client";
import { ATTACHMENT_DOC_PREFIX, ATTACHMENT_KINDS, type AttachmentKind } from "@/lib/asset-notes";

/*
 * Phase 47 (Task 8, spec §4.2a): the Inventory record's tab bar and the Notes / Attachments routes' URL state.
 * Pure, so the tab list, the badges and the hrefs are unit-tested in node. No money here: the record's tabs never
 * carry a figure, whatever the role.
 */

/** One tab of the record's bar. `tone` is set only for the badge that asks for attention (an open note thread). */
export interface RecordTabItem {
  key: string;
  label: string;
  href: string;
  /** The count in the badge; absent for tabs that carry none (Overview, History, ...). */
  count?: number;
  tone?: "attention";
}

export interface RecordTabCounts {
  /** Top-level note threads. */
  notes: number;
  /** Threads not yet resolved: the Notes badge is amber while any is open. */
  openNotes: number;
  /** Attachments (`attachment:*` documents). */
  attachments: number;
}

/**
 * The record's tabs, in order: Overview, History, Timeline, Documents, Notes, Attachments, then Secrets and
 * Reservations where they apply. Notes and Attachments are there for every role that can open the record.
 */
export function recordTabItems(
  assetId: string,
  opts: { cls: AssetClass; showSecrets: boolean; counts: RecordTabCounts },
): RecordTabItem[] {
  const base = `/inventory/${encodeURIComponent(assetId)}`;
  const { counts } = opts;
  return [
    { key: "overview", label: "Overview", href: base },
    { key: "history", label: "History", href: `${base}/history` },
    { key: "timeline", label: "Timeline", href: `${base}/timeline` },
    { key: "documents", label: "Documents", href: `${base}/documents` },
    {
      key: "notes", label: "Notes", href: `${base}/notes`, count: counts.notes,
      ...(counts.openNotes > 0 ? { tone: "attention" as const } : {}),
    },
    { key: "attachments", label: "Attachments", href: `${base}/attachments`, count: counts.attachments },
    ...(opts.showSecrets ? [{ key: "secrets", label: "Secrets", href: `${base}/secrets` }] : []),
    ...(opts.cls === "IT" ? [{ key: "reservations", label: "Reservations", href: `${base}/reservations` }] : []),
  ];
}

/** The Attachments route's URL state: the kind filter (`ak`) and the open attachment (`att`). */
export interface RecordAttachmentState {
  ak: AttachmentKind | "all";
  att: string | null;
}

/** An unknown `ak` reads as All; an empty `att` as none. */
export function parseRecordAttachmentState(sp: URLSearchParams): RecordAttachmentState {
  const ak = sp.get("ak") ?? "";
  const att = sp.get("att");
  return {
    ak: (ATTACHMENT_KINDS as readonly string[]).includes(ak) ? (ak as AttachmentKind) : "all",
    att: att ? att : null,
  };
}

/** The Attachments tab's URL with `patch` applied to `state`; defaults are left out. */
export function recordAttachmentsHref(assetId: string, state: RecordAttachmentState, patch: Partial<RecordAttachmentState> = {}): string {
  const s = { ...state, ...patch };
  const p = new URLSearchParams();
  if (s.ak !== "all") p.set("ak", s.ak);
  if (s.att) p.set("att", s.att);
  const qs = p.toString();
  return `/inventory/${encodeURIComponent(assetId)}/attachments${qs ? `?${qs}` : ""}`;
}

/** The Documents list splits in two: the asset's document slots, and the shared attachments (kind `attachment:*`). */
export function splitDocuments<T extends { kind: string }>(rows: readonly T[]): { documents: T[]; attachments: T[] } {
  const documents: T[] = [];
  const attachments: T[] = [];
  for (const r of rows) (r.kind.startsWith(ATTACHMENT_DOC_PREFIX) ? attachments : documents).push(r);
  return { documents, attachments };
}
