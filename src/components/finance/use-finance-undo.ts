"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { financeAssetHref, runFinanceUndo, type ReviewToastDeps, type UndoTarget } from "@/lib/finance-review-ui";
import { undoFinanceAction } from "@/server/modules/finance/undo-actions";

/**
 * Finance follow-up (spec §4): what the review toasts' Undo and "Open <tag>" buttons, and the asset page's Undo banner,
 * do. The buttons carry the asset's id and the router and toast are the app's own, so an Undo pressed after the page
 * moved on to the next asset still undoes the original one and goes back to it (Review Focus 3).
 */
export function useFinanceUndo(): ReviewToastDeps & { runUndo: (target: UndoTarget) => Promise<boolean> } {
  const router = useRouter();
  const toast = useToast();

  const runUndo = useCallback(
    (target: UndoTarget) =>
      runFinanceUndo(target, {
        call: undoFinanceAction,
        toast: (message, tone) => toast(message, tone),
        go: (href) => {
          // already on the asset (the banner, or a send-back): read it again; otherwise go back to it
          if (window.location.pathname === href) router.refresh();
          else router.push(href);
        },
      }),
    [router, toast],
  );

  return useMemo(
    () => ({
      runUndo,
      undo: (target: UndoTarget) => void runUndo(target),
      open: (assetId: string) => router.push(financeAssetHref(assetId)),
    }),
    [runUndo, router],
  );
}
