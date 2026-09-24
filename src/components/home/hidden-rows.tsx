"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { undismissShiftRow } from "@/server/modules/home/actions";
import type { WorkRow } from "@/lib/worklist";

/** Spec §5.2: today's hidden rows of one section, behind a Show disclosure, each with Unhide. */
export function HiddenRows({ rows }: { rows: WorkRow[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (rows.length === 0) return null;
  return (
    <div className="mt-1">
      <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}>
        Show
      </Button>
      {open && (
        <ul id={listId} className="flex flex-col">
          {rows.map((row) => <HiddenRow key={row.key} row={row} />)}
        </ul>
      )}
    </div>
  );
}

function HiddenRow({ row }: { row: WorkRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-3 border-b border-border-faint py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-[12px] text-fg-muted">{row.title}</span>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        aria-label={`Unhide ${row.title}`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await undismissShiftRow({ key: row.key });
            if (!res.ok) { toast(res.message, "fault"); return; }
            router.refresh();
          })
        }
      >
        Unhide
      </Button>
    </li>
  );
}
