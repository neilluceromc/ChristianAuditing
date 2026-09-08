"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { archiveSupplier, restoreSupplier } from "@/server/modules/suppliers/actions";
import { useSupplierRunner } from "./use-supplier-runner";

export function ArchiveControls({ id, archived }: { id: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const { pending, error, retryAfter, setRetryAfter, run } = useSupplierRunner();

  if (archived) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <Button loading={pending} onClick={() => run(() => restoreSupplier({ id }), "Supplier restored")}>
          Restore supplier
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Archive supplier</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Archive this supplier?"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => run(() => archiveSupplier({ id }), "Supplier archived", { onOk: () => setOpen(false) })}
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
        It disappears from pickers and the default list. Requests and assets that name it keep it. You can
        restore it any time.
      </Dialog>
    </>
  );
}
