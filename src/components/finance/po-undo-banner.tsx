"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { runPoSendBackUndo } from "@/lib/finance-review-ui";
import { undoPoSendBack } from "@/server/modules/purchases/po-actions";
import { TimedUndoBanner } from "./undo-banner";

/** Task 6 fix round 1: "You sent PO-0214 back to Purchasing at 10:42 · Undo", for the person who sent it back. */
export function PoSendBackUndoBanner({ poId, state }: { poId: string; state: { label: string; msLeft: number; endsAt: number } }) {
  const router = useRouter();
  const toast = useToast();
  return (
    <TimedUndoBanner
      state={state}
      onUndo={() => runPoSendBackUndo(poId, { call: undoPoSendBack, toast: (m, tone) => toast(m, tone), refresh: () => router.refresh() })}
    />
  );
}
