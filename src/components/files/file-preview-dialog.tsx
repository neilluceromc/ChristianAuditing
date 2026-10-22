"use client";

import { useEffect, useRef, useState } from "react";
import { previewKindOf, uploadedLine } from "@/lib/file-preview";
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
 * A route that refuses (a 404 for a missing object, a sign-in redirect) answers with text or a page, never the file:
 * a same-origin frame whose document is text/plain or text/html did not get its PDF. A PDF viewer's document reports
 * application/pdf, and a frame that can't be read is left alone.
 */
function frameFailed(frame: HTMLIFrameElement): boolean {
  try {
    const type = frame.contentDocument?.contentType ?? "";
    return type === "text/plain" || type === "text/html";
  } catch {
    return false;
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
      description={(
        <>
          {title && <p className="truncate" title={fileName}>{fileName}</p>}
          {line && <p>{line}</p>}
        </>
      )}
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
          onLoad={(e) => { if (frameFailed(e.currentTarget)) fail(); }}
          onError={fail}
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
