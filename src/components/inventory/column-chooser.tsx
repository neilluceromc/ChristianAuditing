"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { useToast } from "@/components/ui/toast";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";
import { saveColumns } from "@/server/preferences";

const LABELS: Record<string, string> = {
  category: "Category", assigned: "Assigned", purchased: "Purchased", warranty: "Warranty",
};

export function ColumnChooser({ visible }: { visible: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(visible));
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const focusTrigger = () => rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
  useOverlayLayer(open, () => { setOpen(false); focusTrigger(); });

  useEffect(() => {
    if (!open) return;
    setDraft(new Set(visible));
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function apply() {
    startTransition(async () => {
      const res = await saveColumns({ key: "columns:inventory", visible: [...draft] });
      if (!res.ok) {
        // a silently reverting preference reads as a broken chooser
        toast(res.message, "fault");
        return;
      }
      setOpen(false);
      focusTrigger();
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button size="sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Columns
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Choose columns"
          className="absolute right-0 top-full z-40 mt-1 w-[180px] rounded-(--radius-btn) border border-border bg-surface-raised p-2 shadow-pop"
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          <p className="px-1 pb-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-fg-faint">
            Yours only — not in the URL
          </p>
          {COLUMN_PREF_KEYS["columns:inventory"].map((col) => (
            <label key={col} className="flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 text-xs text-fg-secondary hover:bg-surface-subtle">
              <Checkbox
                checked={draft.has(col)}
                onChange={(e) => {
                  const next = new Set(draft);
                  if (e.target.checked) next.add(col);
                  else next.delete(col);
                  setDraft(next);
                }}
              />
              {LABELS[col]}
            </label>
          ))}
          <div className="mt-2 flex justify-end border-t border-border-faint pt-2">
            <Button size="sm" variant="primary" loading={pending} onClick={apply}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}
