"use client";

import { useEffect, useRef, useState } from "react";
import { frameLoadFailed, previewKindOf, uploadedLine, type FrameSeen } from "@/lib/file-preview";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Dialog } from "@/components/ui/dialog";

/**
 * Document preview (plan 2026-10-23): one Preview dialog for every uploaded file. A PDF shows in a frame and a PNG or
 * JPG as an image, both fitted to a large dialog (full screen on a phone); anything else says so and offers Download.
 * The header names the file and says when and by whom it was uploaded. The frame and image load through the file's
 * download route with `?inline=1` (its auth and ownership checks unchanged); a held file loads through an object URL.
 */

/** What every preview needs to know about its file. */
export interface PreviewFile {
  /** What the file is ("Sales invoice"); the dialog's name. The file name when absent. */
  title?: string;
  fileName: string;
  /** The download route (or a held file's object URL): Download. */
  href: string;
  /** The same route with `?inline=1` (or the object URL): the frame, the image, and Open in new tab. */
  inlineHref: string;
  uploadedAt?: string | null;
  uploadedBy?: string | null;
  /** Replaces the uploaded line: "Not saved yet" for a file held on the form. */
  note?: string;
}

const FAILED = "Couldn't load this file";
const UNSUPPORTED = "This file type can't be shown here";

/**
 * What a loaded frame lets the page read, for `frameLoadFailed` (src/lib/file-preview.ts): the same-origin document's
 * type and the frame's path. A cross-origin or unreadable frame gives null, which never counts as failed. (Browsers
 * fire no `error` on a frame for an HTTP error, so `load` is the only place to look.)
 */
function readFrame(frame: HTMLIFrameElement): FrameSeen {
  try {
    // the frame's initial about:blank is not the file; never judge it
    if (frame.contentWindow?.location.href.startsWith("about:")) return null;
    const doc = frame.contentDocument;
    if (!doc) return null;
    return { contentType: doc.contentType || null, pathname: frame.contentWindow?.location.pathname ?? null };
  } catch {
    return null;
  }
}

/** The inline URL's path, to tell a redirect (sign-in) from the file; none for a held file's object URL. */
function pathOf(inlineHref: string): string | null {
  if (inlineHref.startsWith("blob:")) return null;
  try {
    return new URL(inlineHref, window.location.href).pathname;
  } catch {
    return null;
  }
}

export function FilePreviewDialog({ open, onClose, ...file }: PreviewFile & { open: boolean; onClose: () => void }) {
  const { title, fileName, href, inlineHref, uploadedAt, uploadedBy, note } = file;
  // keyed by the URL that failed, so the next file (or the next open) starts clean
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = failedFor === inlineHref;
  const kind = previewKindOf(fileName);
  const shown = kind !== null && !failed;
  const line = note ?? uploadedLine(uploadedAt, uploadedBy);
  const fail = () => setFailedFor(inlineHref);
  // a held file's object URL has no name of its own; a route names its file in its content-disposition
  const downloadName = href.startsWith("blob:") ? fileName : undefined;

  function close() {
    setFailedFor(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="viewer"
      title={title ?? fileName}
      description={title || line ? (
        <>
          {title && <p className="truncate" title={fileName}>{fileName}</p>}
          {line && <p>{line}</p>}
        </>
      ) : undefined}
      headerActions={(
        <>
          {shown && <ButtonLink native newTab size="sm" href={inlineHref}>Open in new tab</ButtonLink>}
          {shown && <ButtonLink native size="sm" href={href} download={downloadName}>Download</ButtonLink>}
          <Button type="button" size="sm" variant="ghost" onClick={close}>Close</Button>
        </>
      )}
    >
      {shown && kind === "pdf" ? (
        <iframe
          title={fileName}
          src={inlineHref}
          onLoad={(e) => { if (frameLoadFailed(readFrame(e.currentTarget), pathOf(inlineHref))) fail(); }}
          className="block min-h-0 w-full flex-1 border-0 bg-surface-subtle"
        />
      ) : shown ? (
        <div className="relative min-h-0 flex-1 bg-surface-subtle">
          {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated route's bytes or a held file, not a static asset */}
          <img src={inlineHref} alt={fileName} onError={fail} className="absolute inset-0 h-full w-full object-contain p-3" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-surface-subtle px-4 py-10 text-center">
          <p role={failed ? "alert" : undefined} className="text-[13px] text-fg-secondary">{failed ? FAILED : UNSUPPORTED}</p>
          <ButtonLink native variant="primary" size="sm" href={href} download={downloadName}>Download</ButtonLink>
        </div>
      )}
    </Dialog>
  );
}

/**
 * "Preview <file name>": a button that opens the Preview dialog and owns its open state. Focus goes back to it when
 * the dialog closes (the focus trap does this too; this covers a browser that never focused the button on click).
 * `label` replaces the word Preview (a file name that opens its own preview); `plain` drops the button look.
 */
export function PreviewButton({
  label, className, plain = false, describedBy, ...file
}: PreviewFile & { label?: string; className?: string; plain?: boolean; describedBy?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const content = label ?? <>Preview<span className="sr-only"> {file.fileName}</span></>;
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  return (
    <>
      {plain ? (
        <button ref={button} type="button" className={className} title={label ? file.fileName : undefined} aria-describedby={describedBy} onClick={() => setOpen(true)}>
          {content}
        </button>
      ) : (
        <Button ref={button} type="button" variant="ghost" size="sm" className={className} aria-describedby={describedBy} onClick={() => setOpen(true)}>
          {content}
        </Button>
      )}
      <FilePreviewDialog open={open} onClose={close} {...file} />
    </>
  );
}

/**
 * Preview for a file held in the browser (picked on the PO form, not saved yet): its object URL is made when the
 * dialog opens and let go when it closes (or the slot goes), so none outlive the preview.
 */
export function HeldPreviewButton({ file, title, describedBy }: { file: File; title?: string; describedBy?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => () => {
    if (current.current) URL.revokeObjectURL(current.current);
  }, []);

  function open() {
    if (current.current) URL.revokeObjectURL(current.current);
    const next = URL.createObjectURL(file);
    current.current = next;
    setUrl(next);
  }

  function close() {
    if (current.current) URL.revokeObjectURL(current.current);
    current.current = null;
    setUrl(null);
    requestAnimationFrame(() => button.current?.focus());
  }

  return (
    <>
      <Button ref={button} type="button" variant="ghost" size="sm" aria-describedby={describedBy} onClick={open}>
        Preview<span className="sr-only"> {file.name}</span>
      </Button>
      {url && (
        <FilePreviewDialog
          open onClose={close} title={title} fileName={file.name} href={url} inlineHref={url} note="Not saved yet"
        />
      )}
    </>
  );
}
