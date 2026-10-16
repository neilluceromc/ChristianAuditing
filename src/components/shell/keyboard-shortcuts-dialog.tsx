"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Kbd } from "@/components/ui/kbd";
import { useSearchShortcutLabel } from "./use-search-shortcut-label";

/**
 * Spec §2.3: the top bar's old Help link (to /dev/kitchen-sink, a 404 in
 * production) becomes this button. The dialog lists only shortcuts that exist.
 */
export function KeyboardShortcutsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Keyboard shortcuts"
        className={className ?? "grid size-[34px] place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle"}
      >
        <Icon name="keyboard" size={16} />
      </button>
      {open && <KeyboardShortcutsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  const search = useSearchShortcutLabel();
  const rows: Array<{ keys: string[]; what: string }> = [
    { keys: [search], what: "Search assets, people, requests" },
    { keys: ["/"], what: "Focus this page's search box" },
    { keys: ["J", "K"], what: "Approvals: move down or up the queue" },
    { keys: ["A"], what: "Approvals: approve the highlighted request" },
    { keys: ["Esc"], what: "Close a panel or dialog" },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title="Keyboard shortcuts"
      footer={<Button size="sm" onClick={onClose}>Close</Button>}
    >
      <dl className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.what} className="flex items-center justify-between gap-3">
            <dt className="flex shrink-0 items-center gap-1">
              {r.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
            </dt>
            <dd className="text-right text-xs text-fg-secondary">{r.what}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-fg-muted">Single-key shortcuts do nothing while you type in a field.</p>
    </Dialog>
  );
}
