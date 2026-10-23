"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/server/action-result";
import { triageAsset, triageMany, undoTriage, undoTriageMany } from "@/server/modules/lifecycle/actions";
import { verifyAssetDetails, verifyMany } from "@/server/modules/inventory/actions";
import { dismissShiftRow, undismissShiftRow } from "@/server/modules/home/actions";
import { isUndoableTriage } from "@/lib/triage-undo";
import type { TriageOutcome } from "@/lib/lifecycle";
import type { WorkItem } from "@/lib/worklist";
import { assetIdOf, bulkToast, decisionToast, checkedToast, modelOf, refusalToast, undoReport, undoneToast } from "@/lib/worklist-view";

/**
 * Worklist H4: every decision the page makes, with its toast and Undo (plan calls 5–7).
 * - `clear(keys)` takes rows off the list at once and moves the selection on (decide → next); the refresh that
 *   follows brings the server's list.
 * - `restore(keys)` puts rows back after an Undo, and selects the first of them.
 * - `moveOn(key)`: a decision refused because the row changed elsewhere — the selection moves on, the refresh drops it.
 *   Any other refusal (an open request, already checked) toasts the server's sentence and keeps the selection.
 * Keep as spare and Send to repair carry Undo (undoTriage / undoTriageMany); Dispose, Donate and Mark checked do not.
 */
export function useWorklistUndo({ clear, restore, moveOn }: {
  clear: (keys: string[]) => void;
  restore: (keys: string[]) => void;
  moveOn: (key: string) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();

  /** A refusal: a changed-since conflict says so and moves on (refusalToast); anything else is the server's words. */
  function refused(res: Extract<ActionResult<unknown>, { ok: false }>, key?: string) {
    if (res.kind === "conflict") {
      const t = refusalToast(res.message);
      toast(t.message, "fault", t.detail ? { detail: t.detail } : undefined);
      if (t.moveOn) {
        if (key) moveOn(key);
        router.refresh();
      }
      return;
    }
    const field = res.fieldErrors ? Object.values(res.fieldErrors).find(Boolean) : undefined;
    toast(field ?? res.message, "fault");
  }

  function undoOne(auditId: string, item: WorkItem) {
    start(async () => {
      const res = await undoTriage({ auditId });
      if (!res.ok) { toast(res.message, "fault"); return; }
      restore([item.key]);
      router.refresh();
      toast(undoneToast(res.data.model), "neutral");
    });
  }

  function undoMany(auditIds: string[], items: WorkItem[]) {
    start(async () => {
      const res = await undoTriageMany({ auditIds });
      if (!res.ok) { toast(res.message, "fault"); return; }
      const back = items.filter((i) => res.data.done.includes(assetIdOf(i) ?? ""));
      if (back.length) restore(back.map((i) => i.key));
      router.refresh();
      if (res.data.failed.length) {
        toast(back.length ? undoneToast(back.length === 1 ? modelOf(back[0]) : `${back.length} items`) : "Nothing was undone", "fault",
          { detail: undoReport(back.length, res.data.failed.length, res.data.failed[0].reason) });
      } else toast(undoneToast(back.length === 1 ? modelOf(back[0]) : `${back.length} items`), "neutral");
    });
  }

  function triage(item: WorkItem, outcome: TriageOutcome, note?: string) {
    const assetId = assetIdOf(item);
    if (!assetId) return;
    start(async () => {
      const res = await triageAsset({ assetId, outcome, ...(note ? { note } : {}) });
      if (!res.ok) { refused(res, item.key); return; }
      clear([item.key]);
      router.refresh();
      const { auditId, model } = res.data;
      toast(decisionToast(outcome, model), "settled",
        isUndoableTriage(outcome) ? { label: "Undo", onAction: () => undoOne(auditId, item) } : undefined);
    });
  }

  function triageBulk(items: WorkItem[], outcome: "SPARE" | "DEFECTIVE") {
    const ids = items.map(assetIdOf).filter((x): x is string => x !== null);
    if (!ids.length) return;
    start(async () => {
      const res = await triageMany({ assetIds: ids, outcome });
      if (!res.ok) { refused(res); return; }
      const done = items.filter((i) => res.data.done.includes(assetIdOf(i) ?? ""));
      if (done.length) clear(done.map((i) => i.key));
      router.refresh();
      const t = bulkToast(outcome, done.map((i) => ({ model: modelOf(i) })), res.data.failed.length);
      const auditIds = res.data.auditIds;
      toast(t.message, t.tone, {
        detail: t.detail,
        actions: auditIds.length ? [{ label: "Undo", onAction: () => undoMany(auditIds, done) }] : [],
      });
    });
  }

  function check(item: WorkItem) {
    const id = assetIdOf(item);
    if (!id) return;
    start(async () => {
      const res = await verifyAssetDetails({ id });
      if (!res.ok) { refused(res, item.key); return; }
      clear([item.key]);
      router.refresh();
      toast(checkedToast(modelOf(item)), "settled");
    });
  }

  function checkBulk(items: WorkItem[]) {
    const ids = items.map(assetIdOf).filter((x): x is string => x !== null);
    if (!ids.length) return;
    start(async () => {
      const res = await verifyMany({ assetIds: ids });
      if (!res.ok) { refused(res); return; }
      const done = items.filter((i) => res.data.done.includes(assetIdOf(i) ?? ""));
      if (done.length) clear(done.map((i) => i.key));
      router.refresh();
      const t = bulkToast("CHECK", done.map((i) => ({ model: modelOf(i) })), res.data.failed.length);
      toast(t.message, t.tone, t.detail ? { detail: t.detail } : undefined);
    });
  }

  /** Hide until tomorrow (the old row menu's), with Undo. */
  function hide(item: WorkItem) {
    start(async () => {
      const res = await dismissShiftRow({ key: item.key });
      if (!res.ok) { refused(res); return; }
      clear([item.key]);
      router.refresh();
      toast("Hidden until tomorrow", "neutral", {
        label: "Undo",
        onAction: () => start(async () => {
          const back = await undismissShiftRow({ key: item.key });
          if (!back.ok) { toast(back.message, "fault"); return; }
          restore([item.key]);
          router.refresh();
        }),
      });
    });
  }

  return { busy, triage, triageBulk, check, checkBulk, hide };
}

export type WorklistDecisions = ReturnType<typeof useWorklistUndo>;
