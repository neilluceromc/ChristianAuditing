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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const setTrapRef = useFocusTrap(open, onClose);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
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
        className="relative max-h-[calc(100vh-2rem)] w-[352px] max-w-full overflow-y-auto rounded-(--radius-card) border border-border bg-surface-raised p-4 shadow-dialog"
        style={{ animation: "pop var(--dur-4) var(--ease-std)" }}
      >
        <h2 id={titleId} className="text-[15px] font-semibold text-fg">{title}</h2>
        <div className="mt-2 text-[13px] text-fg-secondary">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
