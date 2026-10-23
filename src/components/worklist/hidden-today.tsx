"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { undismissShiftRow } from "@/server/modules/home/actions";
import type { WorkRow } from "@/lib/worklist";

/** Spec §5.2, kept from the old page: the open queue's rows hidden today, each with Unhide, behind "{n} hidden today". */
export function HiddenToday({ rows }: { rows: WorkRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative inline-flex h-9 items-center text-accent hover:underline after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']"
      >
        {rows.length} hidden today
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hidden until tomorrow"
        footer={<Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>}>
        <ul className="flex flex-col">
          {rows.map((row) => <HiddenRow key={row.key} row={row} />)}
        </ul>
      </Dialog>
    </>
  );
}

function HiddenRow({ row }: { row: WorkRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-3 border-b border-border-faint py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{row.title}</span>
      <Button
        size="sm" variant="secondary" className="shrink-0" aria-label={`Unhide ${row.title}`} disabled={pending}
        onClick={() => startTransition(async () => {
          const res = await undismissShiftRow({ key: row.key });
          if (!res.ok) { toast(res.message, "fault"); return; }
          router.refresh();
        })}
      >
        Unhide
      </Button>
    </li>
  );
}
