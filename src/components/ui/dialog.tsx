"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useState } from "react";
import { useFocusTrap } from "./use-focus-trap";

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "default",
  description,
  headerActions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * "viewer": a document viewer (the file Preview): full screen on a phone, about 90vw � 85vh from `sm` up. The title,
   * `description` and `headerActions` sit in a header bar that never scrolls away, and `children` fill the rest.
   * Focus starts on the panel itself (it is named by the title), so Tab reaches the actions before a framed PDF.
   */
  size?: "default" | "viewer";
  /** Viewer only: the line under the title, which also describes the dialog. */
  description?: React.ReactNode;
  /** Viewer only: the buttons at the header's end (they wrap under the title on a phone). */
  headerActions?: React.ReactNode;
}) {
  const viewer = size === "viewer";
  const setTrapRef = useFocusTrap(open, onClose, viewer ? { initialFocus: "container" } : undefined);
  const titleId = useId();
  // Focus lands on the first focusable element (Cancel, typically), never on
  // the body text — without aria-describedby a screen reader announces the
  // title and then "Cancel, button" and nothing else, so the entire reason
  // the dialog exists is never read out.
  const descId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  if (viewer) {
    return createPortal(
      <div className="fixed inset-0 z-50 grid place-items-center sm:p-4 print:hidden">
        <div
          aria-hidden
          onClick={onClose}
          className="absolute inset-0 bg-black/40"
          style={{ animation: "veil var(--dur-4) var(--ease-std)" }}
        />
        <div
          ref={setTrapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className="relative flex h-dvh w-full flex-col overflow-hidden bg-surface-raised shadow-dialog focus:outline-none sm:h-[85vh] sm:w-[90vw] sm:max-w-[1280px] sm:rounded-(--radius-card) sm:border sm:border-border"
          style={{ animation: "pop var(--dur-4) var(--ease-std)" }}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-faint px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
            <div className="min-w-0 flex-1 basis-56">
              <h2 id={titleId} className="truncate text-[15px] font-semibold text-fg" title={title}>{title}</h2>
              {description && <div id={descId} className="mt-0.5 text-[12px] text-fg-muted">{description}</div>}
            </div>
            {headerActions && <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]">{children}</div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    // print:hidden — a dialog is never part of a printout (iOS Safari returns from print() before it renders)
    <div className="fixed inset-0 z-50 grid place-items-center p-4 print:hidden">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        style={{ animation: "veil var(--dur-4) var(--ease-std)" }}
      />
      <div
        ref={setTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="relative max-h-[calc(100vh-2rem)] w-[352px] max-w-full overflow-y-auto rounded-(--radius-card) border border-border bg-surface-raised p-4 shadow-dialog"
        style={{ animation: "pop var(--dur-4) var(--ease-std)" }}
      >
        <h2 id={titleId} className="text-[15px] font-semibold text-fg">{title}</h2>
        <div id={descId} className="mt-2 text-[13px] text-fg-secondary">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
