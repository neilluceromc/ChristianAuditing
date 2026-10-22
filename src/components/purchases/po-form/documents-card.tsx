"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { PO_DOCUMENT_SLOTS, type PoDocumentSlot } from "@/lib/documents";
import { checkUploadMeta, fileExtension, UPLOAD_TYPES } from "@/lib/upload-meta";
import { Button, IconButton } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { FLAGGED_HINT, RING, SectionCard } from "./fields";
import { fileSize, type HeldFiles } from "./po-form-model";

/**
 * PO form redesign (spec §2.8, §5b.1): the four document slots — the sales invoice (required on a PO from the new
 * form), then the official receipt, delivery receipt and warranty slip (optional). An empty slot is a drop zone: a
 * label around a real file input. A filled one shows a thumbnail, the file and Preview / Replace / Remove.
 *
 * `DocSlot` is shared: the form holds the files in the browser until Save (DocumentsCard, below), and the PO page
 * stores each one straight away (request-documents-card.tsx: replacePoDocument / removePoDocument).
 */

/** The file types the slots take: the same list the server checks (src/lib/upload-meta.ts). */
export const ACCEPT = Object.keys(UPLOAD_TYPES).join(",");

/** Each slot's title, and the hint under an empty one. The sales invoice's hint names the SI number typed above. */
export const SLOT_COPY: Record<PoDocumentSlot, { title: string; hint: (si: string) => string }> = {
  invoice: { title: "Sales invoice", hint: (si) => `The page with № ${si.trim() || "—"}.` },
  "official-receipt": { title: "Official receipt", hint: () => "Add it when it arrives." },
  "delivery-receipt": { title: "Delivery receipt", hint: () => "If the vendor gave one." },
  "warranty-slip": { title: "Warranty slip", hint: () => "Helps IT with repairs later." },
};

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg"]);
const isImage = (name: string) => IMAGE_EXT.has(fileExtension(name).toLowerCase());

/** Opens a file held in the browser in a new tab (its own object URL, let go once the tab has had time to read it). */
function previewFile(file: File) {
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** What a filled slot shows. */
export interface SlotShown {
  fileName: string;
  /** After the name: "0.8 MB", "on file", "Ana Cruz · 22 Oct 2026". */
  detail: string;
  /** Preview: the stored document's inline URL, or the file held in the browser. */
  preview: string | File;
}

/** A held file's thumbnail: its own object URL, let go when the file changes or the slot goes. */
function HeldImage({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <Img src={url} /> : <Paper />;
}

function Img({ src }: { src: string }) {
  // Decorative: the file name is said right under it.
  // eslint-disable-next-line @next/next/no-img-element -- a held file's object URL or an authenticated route's bytes
  return <img src={src} alt="" className="max-h-[112px] max-w-[85%] rounded-[4px] object-contain shadow-[0_2px_8px_rgba(16,24,40,.12)]" />;
}

/** A PDF (or an image not loaded yet): a sketched page with "PDF" on it. */
function Paper({ pdf }: { pdf?: boolean }) {
  return (
    <span aria-hidden="true" className="relative flex h-[112px] w-[92px] -rotate-2 flex-col gap-[5px] rounded-[4px] bg-surface px-[9px] py-2.5 shadow-[0_2px_8px_rgba(16,24,40,.12)]">
      <span className="h-1.5 w-3/5 rounded-[2px] bg-fg" />
      <span className="h-[3px] w-4/5 rounded-[2px] bg-border-strong" />
      <span className="h-[3px] w-[70%] rounded-[2px] bg-border-strong" />
      <span className="mt-1 h-[18px] rounded-[2px] border border-border" />
      <span className="ml-auto h-[3px] w-1/2 rounded-[2px]" style={{ background: "var(--required-mark)" }} />
      {pdf && (
        <span className="absolute bottom-2 left-2 rounded-[3px] px-1 font-mono text-[9px] font-semibold text-[var(--danger-fg)]" style={{ background: "var(--danger-bg)" }}>
          PDF
        </span>
      )}
    </span>
  );
}

function Thumb({ shown }: { shown: SlotShown }) {
  if (!isImage(shown.fileName)) return <Paper pdf />;
  return shown.preview instanceof File ? <HeldImage file={shown.preview} /> : <Img src={shown.preview} />;
}

export interface DocSlotProps {
  kind: PoDocumentSlot;
  required: boolean;
  /** The sales invoice's SI number, for its hint. */
  si?: string;
  shown: SlotShown | null;
  /** A file picked or dropped: already checked against the limits (a refused one shows its error here instead). */
  onPick?: (file: File) => void;
  /** Absent: no Remove (an edit's document on file, or a viewer). */
  onRemove?: () => void;
  error?: string | null;
  flagged?: boolean;
  /** Storing a file or a removal (the PO page). */
  busy?: boolean;
}

/**
 * One slot. Without `onPick` it is read-only (a viewer, a cancelled PO): an empty slot says "Not attached".
 * The file input is always there, named by the slot's title, so the slot can be filled or replaced from the keyboard
 * and by a test; empty, it is the slot's tab stop inside the drop zone's label; filled, Replace opens it.
 */
export function DocSlot({ kind, required, si = "", shown, onPick, onRemove, error, flagged, busy }: DocSlotProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const copy = SLOT_COPY[kind];
  const title = copy.title;
  const shownError = refused ?? error ?? null;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [shown ? undefined : hintId, shownError ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  const editable = !!onPick && !busy;

  function take(list: FileList | null | undefined) {
    const file = list?.[0];
    if (!file || !onPick) return;
    const why = checkUploadMeta(file);
    setRefused(why);
    if (!why) onPick(file);
  }

  const fileInput = onPick ? (
    <input
      ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label={title} aria-describedby={describedBy}
      // the visible "Required" tag is outside the input's name and description, so say it here too
      aria-required={required || undefined}
      disabled={busy}
      // Filled, Replace is the tab stop; a second, invisible one would only lose the focus ring.
      tabIndex={shown ? -1 : undefined}
      onChange={(e) => {
        take(e.target.files);
        e.target.value = "";
      }}
    />
  ) : null;

  const tag = (
    <span className="text-xs font-medium" style={{ color: required ? "var(--required-mark)" : "var(--text-faint)" }}>
      {required ? "Required" : "Optional"}
    </span>
  );

  return (
    <div
      data-po-field={`doc:${kind}`}
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border bg-surface",
        shownError ? "border-[var(--error-border)]" : "border-border",
        flagged && RING,
      )}
    >
      {shown ? (
        <>
          <div className="relative flex h-[132px] items-center justify-center border-b border-border bg-surface-subtle">
            <Thumb shown={shown} />
            <span
              className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: "var(--st-settled-bg)", borderColor: "var(--st-settled-border)", color: "var(--st-settled-text)" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
              Attached
            </span>
          </div>
          <div className="flex flex-col gap-1 px-3.5 py-3">
            <span id={`${id}-title`} className="text-sm font-medium text-fg">{title}</span>
            <span id={`${id}-file`} className="truncate text-xs text-fg-muted" title={shown.fileName}>{shown.fileName} · {shown.detail}</span>
            <div className="mt-1.5 flex items-center gap-1">
              {typeof shown.preview === "string" ? (
                <a
                  href={shown.preview} target="_blank" rel="noreferrer" aria-describedby={`${id}-title`}
                  className="inline-flex items-center rounded-(--radius-btn) px-2.5 py-1.5 text-[11.5px] font-medium text-fg-secondary hover:bg-surface-subtle"
                >
                  Preview
                </a>
              ) : (
                <Button type="button" variant="ghost" size="sm" aria-describedby={`${id}-title`} onClick={() => previewFile(shown.preview as File)}>
                  Preview
                </Button>
              )}
              {onPick && (
                <Button
                  type="button" variant="secondary" size="sm" disabled={busy} aria-describedby={`${id}-title`}
                  // where a failed save's focus lands when the server refused this slot's file: Replace, not Preview
                  data-po-focus=""
                  onClick={() => input.current?.click()}
                >
                  Replace
                </Button>
              )}
              <span className="flex-1" />
              {busy && <Spinner size={12} />}
              {onRemove && (
                <IconButton
                  type="button" aria-label={`Remove ${title.toLowerCase()}`} disabled={busy} onClick={onRemove}
                  className="size-8 text-[var(--error-text)] hover:bg-[var(--st-fault-bg)]"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                </IconButton>
              )}
            </div>
            {fileInput}
          </div>
        </>
      ) : (
        <>
          {onPick ? (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                if (editable) setDragging(true);
              }}
              onDragLeave={(e) => {
                // crossing onto the zone's own icon or text fires a dragleave too: only leaving the zone ends the highlight
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (editable) take(e.dataTransfer.files);
              }}
              className={cn(
                "m-2.5 flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed text-fg-secondary",
                "transition-[border-color,background-color,box-shadow] duration-(--dur-1)",
                "has-[input:focus]:border-accent has-[input:focus]:shadow-[0_0_0_3px_var(--focus-shadow)]",
                dragging ? "border-accent bg-accent-tint" : "border-border-strong bg-surface-subtle hover:border-accent hover:bg-accent-tint",
                busy && "cursor-progress",
              )}
            >
              <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-surface">
                {busy ? <Spinner size={14} /> : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
                )}
              </span>
              <span aria-hidden="true" className="text-[13px]">
                {busy ? "Uploading…" : <>Drop a file or <span className="font-medium text-accent-soft-text">browse</span></>}
              </span>
              {fileInput}
            </label>
          ) : (
            <div className="m-2.5 flex h-28 items-center justify-center rounded-[10px] border border-dashed border-border bg-surface-subtle text-xs text-fg-muted">
              Not attached
            </div>
          )}
          <div className="flex flex-col gap-[3px] px-3.5 pb-3.5">
            <span className="text-sm font-medium text-fg">{title} {tag}</span>
            <span id={hintId} className="text-xs text-fg-muted">{kind === "invoice" ? copy.hint(si) : copy.hint("")}</span>
          </div>
        </>
      )}
      {(flagged || shownError) && (
        <div className="flex flex-col gap-1 px-3.5 pb-3">
          {flagged && <span className="text-[11.5px] text-fg-muted">{FLAGGED_HINT}.</span>}
          <FormError id={errorId}>{shownError}</FormError>
        </div>
      )}
    </div>
  );
}

/** A stored document, as an edit hands it to the form. */
export interface OnFileDoc {
  fileName: string;
  /** Its download route; Preview adds `?inline=1`. */
  href: string;
}

export interface DocumentsCardProps {
  files: HeldFiles;
  onFiles: (next: HeldFiles, changed: PoDocumentSlot) => void;
  /** An edit: the newest document of each kind already on the PO. */
  onFile: Partial<Record<PoDocumentSlot, OnFileDoc>>;
  /** The SI number typed above, for the sales invoice's hint. */
  si: string;
  /** False on a legacy PO (spec §5b.3): the sales invoice is optional there. */
  strict: boolean;
  /** The last save's errors: `doc:<slot>`, and `docs` (the files together too big). */
  errors: Record<string, string>;
  flagged: (key: string) => boolean;
}

/**
 * The form's Documents card. Files are held in the browser and go with Save (spec §5b.1): before that, Replace and
 * Remove only change what is held. On an edit, a slot shows the document on file until a new file is picked for it;
 * Save then adds the new one (the PO page shows the newest), and Remove there takes back only the picked file — a
 * stored document is removed on the PO's page, where it is marked superseded, never deleted.
 */
export function DocumentsCard({ files, onFiles, onFile, si, strict, errors, flagged }: DocumentsCardProps) {
  const attached = PO_DOCUMENT_SLOTS.filter((s) => files[s] || onFile[s]).length;
  return (
    <SectionCard
      id="po-docs" icon="export" title="Documents"
      sub="A clear phone photo is enough. IT and Finance check your numbers against these."
      aside={<span className="text-[13px] text-fg-secondary">{attached} of 4 attached</span>}
    >
      <div data-po-field="docs" tabIndex={-1} className="flex flex-col gap-3 px-4 pb-5 pt-4 focus:outline-none sm:px-5">
        <FormError>{errors.docs}</FormError>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
          {PO_DOCUMENT_SLOTS.map((kind) => {
            const held = files[kind];
            const stored = onFile[kind];
            const shown: SlotShown | null = held
              ? { fileName: held.name, detail: fileSize(held.size), preview: held }
              : stored
                ? { fileName: stored.fileName, detail: "on file", preview: `${stored.href}?inline=1` }
                : null;
            return (
              <DocSlot
                key={kind} kind={kind} required={strict && kind === "invoice"} si={si} shown={shown}
                error={errors[`doc:${kind}`]} flagged={flagged(`doc:${kind}`)}
                onPick={(file) => onFiles({ ...files, [kind]: file }, kind)}
                onRemove={held ? () => {
                  const next = { ...files };
                  delete next[kind];
                  onFiles(next, kind);
                } : undefined}
              />
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
