"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { archiveStockItem, restoreStockItem } from "@/server/modules/stock/item-actions";
import { useStockRunner } from "./use-stock-runner";

export function ItemArchiveControls({ id, archived }: { id: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const { pending, error, retryAfter, setRetryAfter, reset, run } = useStockRunner();

  if (archived) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <Button loading={pending} onClick={() => run(() => restoreStockItem({ id }), "Item restored")}>
          Restore item
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button onClick={() => { reset(); setOpen(true); }}>Archive item</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Archive this item?"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => run(() => archiveStockItem({ id }), "Item archived", { onOk: () => setOpen(false) })}
            >
              Archive
            </Button>
          </>
        }
      >
        {retryAfter !== null && (
          <div className="mb-3">
            <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
          </div>
        )}
        {error && <Banner tone="fault" title={error} className="mb-3" />}
        It disappears from pickers and the default list. Movements that name it keep it. You can restore it any
        time.
      </Dialog>
    </>
  );
}
