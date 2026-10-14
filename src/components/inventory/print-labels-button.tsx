"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { markLabelsPrinted } from "@/server/modules/inventory/label-actions";

/**
 * Phase 34 (spec §5): opens the browser print, then stamps the queue's labels as printed. Tags from
 * the Reprint box are not sent (they were printed before); a reprint never moves labelPrintedAt.
 *
 * Marks once per click, on `afterprint` or as soon as `print()` returns, whichever comes first.
 * Chromium's `print()` blocks until the dialog closes (and a headless one may never fire
 * `afterprint`), so returning from it means printing was attempted; the flag keeps the two paths
 * from sending twice. `markLabelsPrinted` is idempotent either way (Review Focus 5).
 */
export function PrintLabelsButton({ count, queuedAssetIds }: { count: number; queuedAssetIds: string[] }) {
  const [pending, start] = useTransition();
  function print() {
    let done = false;
    const mark = () => {
      window.removeEventListener("afterprint", mark);
      if (done) return;
      done = true;
      if (queuedAssetIds.length) start(async () => { await markLabelsPrinted({ assetIds: queuedAssetIds.slice(0, 200) }); });
    };
    window.addEventListener("afterprint", mark);
    window.print();
    mark();
  }
  return (
    <Button variant="primary" className="print:hidden" onClick={print} loading={pending} disabled={count === 0}>
      {`Print ${count} label${count === 1 ? "" : "s"}`}
    </Button>
  );
}
