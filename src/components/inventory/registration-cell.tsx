"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import { REG_LABEL } from "@/lib/registration";
import type { AssetRow } from "@/server/modules/inventory/queries";
import { ResubmitDialog } from "./resubmit-dialog";

/**
 * Phase 35 (spec §3.1/§3.4): the list's Registration cell — the pill, and for a needs-correction row what
 * Finance flagged, with Edit (when the viewer may edit) and Mark corrected… (when the viewer manages the class).
 */
export function RegistrationCell({ row, canEdit, canMutate }: { row: AssetRow; canEdit: boolean; canMutate: boolean }) {
  const [open, setOpen] = useState(false);
  const flagged = row.reg === "needs-correction";
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusPill value={row.reg} label={REG_LABEL[row.reg]} ns="registration" />
      {flagged && (
        <div className="flex flex-col gap-1 text-[11px] leading-snug text-fg-secondary">
          {row.regItems.length > 0 && (
            <div>
              <span className="font-medium">Finance flagged:</span>
              <ul className="list-disc pl-4">
                {row.regItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {row.regNote && <p>{"“"}{row.regNote}{"”"}</p>}
          {(row.regBy || row.regAt) && (
            <p className="text-fg-muted">{"— "}{[row.regBy, row.regAt].filter(Boolean).join(", ")}</p>
          )}
          {(canEdit || canMutate) && (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {canEdit && (
                <Link href={`/inventory/${row.id}/edit`} className="text-accent hover:underline">Edit</Link>
              )}
              {canMutate && (
                <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Mark corrected…</Button>
              )}
            </div>
          )}
        </div>
      )}
      {flagged && canMutate && (
        // outside the row's click handler: nothing inside the dialog may open the record
        <div onClick={(e) => e.stopPropagation()}>
          <ResubmitDialog open={open} onClose={() => setOpen(false)} asset={{ id: row.id, tag: row.tag }} />
        </div>
      )}
    </div>
  );
}
