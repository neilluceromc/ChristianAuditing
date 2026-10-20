"use client";

import { Button } from "@/components/ui/button";

/**
 * Phase 45 (spec §2.4, §3.4): the bulk actions bar, floating at the bottom centre of the window while any row
 * is ticked. It sits 64 px up (plus the device's safe area) so it clears the list's 48 px sticky footer.
 * "N selected", then the caller's actions, then Clear. Nothing renders while nothing is ticked.
 */
export function FloatingBulkBar({
  count,
  children,
  onClear,
}: {
  count: number;
  children: React.ReactNode;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      style={{ bottom: "calc(64px + env(safe-area-inset-bottom))" }}
    >
      <div
        role="region"
        aria-label="Bulk actions"
        className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-(--radius-card) border border-border bg-surface-raised py-1.5 pl-3.5 pr-1.5 shadow-pop"
        style={{ animation: "toastIn var(--dur-3) var(--ease-std)" }}
      >
        <span className="pr-1 font-mono text-[12px] text-fg-secondary" aria-live="polite">
          {count.toLocaleString("en-US")} selected
        </span>
        <span aria-hidden className="h-5 w-px bg-border" />
        {children}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
