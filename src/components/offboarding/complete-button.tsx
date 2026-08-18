"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { completeOffboarding } from "@/server/modules/offboarding/actions";

/**
 * A Dialog, not an inline button: completing an offboarding flips the person to
 * OFFBOARDED, and the README reserves dialogs for decisions like that.
 */
export function CompleteButton({
  employeeId,
  name,
  itemCount,
}: {
  employeeId: string;
  name: string;
  itemCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await completeOffboarding({ employeeId });
      if (res.ok) {
        setOpen(false);
        toast(`${name} is now OFFBOARDED`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Button variant="primary" onClick={() => setOpen(true)}>Complete offboarding</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Complete ${name}'s offboarding?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Complete</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p>
            {name} flips to <span className="font-mono">OFFBOARDED</span>. The{" "}
            {itemCount} equipment decision{itemCount === 1 ? "" : "s"} already exist as their own
            requests — completing changes nothing about the kit.
          </p>
          <p className="text-xs text-fg-muted">
            The farewell report stays available afterwards.
          </p>
        </div>
      </Dialog>
    </>
  );
}
