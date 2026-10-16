"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import type { PickerGroup } from "@/lib/groups";
import type { getTransfers } from "@/server/modules/employees/queries";
import { TransferDialog } from "../transfer-dialog";

/**
 * Phase 20 (spec §3), Phase 39 (spec §2.5): the side card's Transfers tab — the latest 3 from the same
 * `getTransfers` read the header's "Transferred from X on Y" line uses, so the two never disagree; the rest live
 * on the (paged) Timeline. With none, an empty state whose "Transfer…" opens the existing dialog — shown only when
 * the user may transfer and the person is ACTIVE (`canTransfer`).
 */
export function TransfersTab({
  employeeId, employeeName, currentTitle, departments, transfers, total, canTransfer,
}: {
  employeeId: string;
  employeeName: string;
  currentTitle: string;
  departments: PickerGroup[];
  transfers: Awaited<ReturnType<typeof getTransfers>>;
  total: number;
  canTransfer: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (total === 0) {
    return (
      <div className="flex flex-col items-start gap-1.5 py-1">
        <p className="text-[12.5px] font-medium text-fg">No transfers yet</p>
        <p className="text-[11.5px] text-fg-muted">Moves between departments or clients show here.</p>
        {canTransfer && (
          <>
            <Button size="sm" className="mt-1.5" onClick={() => setOpen(true)}>Transfer…</Button>
            <TransferDialog
              open={open} onClose={() => setOpen(false)} employeeId={employeeId} employeeName={employeeName}
              currentTitle={currentTitle} departments={departments}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {transfers.map((t) => (
          <li key={t.id} className="flex flex-col gap-0.5 text-xs text-fg-secondary">
            <span>
              <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(t.effectiveAt)}</span>
              {" · "}
              {t.from} → {t.to}
              {t.fromTitle !== t.toTitle && (
                <span className="text-fg-muted"> · {t.fromTitle} → {t.toTitle}</span>
              )}
            </span>
            {t.reason && <span className="text-[11px] text-fg-muted">{t.reason}</span>}
            <span className="font-mono text-[10.5px] text-fg-faint">by {t.actor}</span>
          </li>
        ))}
      </ul>
      {total > transfers.length && (
        <Link href={`/employees/${employeeId}/timeline`} className="text-[12px] font-medium text-accent hover:underline">
          See all in Timeline →
        </Link>
      )}
    </div>
  );
}
