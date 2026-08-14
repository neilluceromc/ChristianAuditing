"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useState } from "react";
import { useFocusTrap } from "./use-focus-trap";

export function Drawer({
  open,
  onClose,
  title,
  width = 376,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  // Initial focus goes to the panel itself, not the ✕ Close button — a
  // stray Enter must never dismiss a drawer someone just opened to fill in.
  const setTrapRef = useFocusTrap(open, onClose, { initialFocus: "container" });
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
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
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-border bg-surface-raised shadow-drawer"
        style={{ width, animation: "sheet var(--dur-4) var(--ease-std)" }}
      >
        <div className="flex items-center justify-between border-b border-border-faint px-4 py-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-(--radius-ctl) px-2 py-1 text-fg-muted hover:bg-surface-subtle"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
