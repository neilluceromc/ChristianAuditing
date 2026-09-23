"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass, AssetStatus } from "@prisma/client";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { DEFAULT_STATUS, HOLDER_STATUSES, STATUS_LABEL, statusesFor } from "@/lib/asset-class";
import { DEFAULT_LOAN_DAYS, defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { bulkRequestStatusChange } from "@/server/modules/inventory/actions";
import { bulkAssign, bulkChangeStatus } from "@/server/modules/lifecycle/actions";
import type { ActionResult } from "@/server/action-result";

export type BulkMode = "status" | "assign";
type Mode = BulkMode;

/** How many selected tags the drawer names before it says `and {k} more`. */
const TAGS_SHOWN = 5;

/**
 * Phase 30 (spec §6.4, plan P-6): a bulk status target is any status of the class except a holder
 * status — the bulk action never assigns, so it offers `statusTargets` of an unheld device whatever
 * each selected device reads now (the server skips the ones it cannot change).
 */
function bulkTargets(cls: AssetClass): readonly string[] {
  const holder = HOLDER_STATUSES[cls] as readonly string[];
  return statusesFor(cls).filter((s) => !holder.includes(s));
}

export function BulkDrawer({
  open,
  initialMode = "status",
  onClose,
  selectedIds,
  selectedTags,
  allMatching,
  filtersQS,
  total,
  cls,
  direct,
  employees,
  recentEmployees,
  onDone,
}: {
  open: boolean;
  /** the mode the selection bar opened the drawer in — `Change status…` or `Assign…` (plan P-14) */
  initialMode?: BulkMode;
  onClose: () => void;
  selectedIds: string[];
  /** the selected rows' tags, in page order — the drawer names what it will touch */
  selectedTags: string[];
  allMatching: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
  cls: AssetClass;
  direct: boolean;
  employees: ComboOption[];
  recentEmployees?: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [to, setTo] = useState<string>(DEFAULT_STATUS[cls]);
  // Normalized, not trusted: the drawer outlives a class switch only if the
  // list island is not remounted, and then `to` would be an IT status against
  // Purchasing options — a controlled select showing one thing and submitting
  // another. Same-class or the class default, always.
  const targets = bulkTargets(cls);
  const effectiveTo = targets.includes(to) ? to : DEFAULT_STATUS[cls];
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // Phase 16 (spec §5): assign mode only exists where direct lifecycle IT
  // assignment does — the same gate `assignAsset` itself enforces server-side.
  // A drawer that outlived a class switch would otherwise keep "assign" mode
  // selected against Purchasing, which has no such target.
  const canAssignMode = direct && cls === "IT";
  const [mode, setMode] = useState<Mode>(initialMode);
  const effectiveMode: Mode = canAssignMode ? mode : "status";
  // The drawer stays mounted between openings; each opening starts in the mode its button named.
  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [assignKind, setAssignKind] = useState<"DEPLOYED" | "TEMPORARY">("DEPLOYED");
  const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));
  const [skippedList, setSkippedList] = useState<Array<{ tag: string; reason: string }>>([]);

  const scope = allMatching ? `all ${total} matching assets` : `${selectedIds.length} selected asset${selectedIds.length === 1 ? "" : "s"}`;
  // spec §6.4: the drawer names what it will touch — the first few tags, then a count.
  const named = allMatching
    ? `all ${total} matching`
    : selectedTags.slice(0, TAGS_SHOWN).join(", ") +
      (selectedTags.length > TAGS_SHOWN ? ` and ${selectedTags.length - TAGS_SHOWN} more` : "");

  /** Failure handling shared by every bulk call — they share every ActionResult failure shape. */
  function applyFailure(res: Extract<ActionResult<unknown>, { ok: false }>) {
    if (res.kind === "rate_limited") {
      setRetryAfter(res.retryAfterSec ?? 60);
    } else if (res.kind === "validation") {
      setFieldErrors(res.fieldErrors ?? {});
      // Field errors no FormField below claims (ids/filters/status/_form) must not
      // dead-end silently — surface them in the banner.
      const unclaimed = res.fieldErrors?.ids ?? res.fieldErrors?.filters ?? res.fieldErrors?.status ?? res.fieldErrors?._form;
      if (unclaimed) setError(unclaimed);
    } else {
      setError(res.message);
    }
  }

  function submit() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
    startTransition(async () => {
      if (effectiveMode === "assign") {
        const res = await bulkAssign({
          ids: allMatching ? undefined : selectedIds,
          filters: allMatching ? filtersQS : undefined,
          employeeId: employeeId ?? "",
          status: assignKind,
          loanDueAt: assignKind === "TEMPORARY" ? loanDueAt : undefined,
          reason,
        });
        if (res.ok) {
          const { assigned, skipped } = res.data;
          const name = employees.find((e) => e.value === employeeId)?.label ?? "them";
          toast(`${assigned} asset${assigned === 1 ? "" : "s"} assigned to ${name}`, "settled");
          setReason(""); // a fresh batch never inherits the last batch's reason
          onDone();
          router.refresh();
          if (skipped.length > 0) setSkippedList(skipped);
          else handleClose();
        } else {
          applyFailure(res);
        }
        return;
      }
      const payload = {
        ids: allMatching ? undefined : selectedIds,
        filters: allMatching ? filtersQS : undefined,
        to: effectiveTo,
        reason,
      };
      if (direct) {
        // Phase 20 (spec §6.1, gap 1): bulkChangeStatus's `skipped` is now
        // the same {tag, reason}[] shape bulkAssign already returns — mirror
        // that path exactly: toast the count, keep the drawer open on the
        // skipped list (never auto-close) when anything was skipped.
        const res = await bulkChangeStatus(payload);
        if (res.ok) {
          const { changed, skipped } = res.data;
          // Count first, then the destination status — the file's toast
          // house style, and the operator sees what the assets became.
          toast(
            `${changed} asset${changed === 1 ? "" : "s"} now ${effectiveTo}` +
            (skipped.length > 0 ? ` · ${skipped.length} skipped` : ""),
            "settled",
          );
          setReason(""); // a fresh batch never inherits the last batch's reason
          onDone();
          router.refresh();
          if (skipped.length > 0) setSkippedList(skipped);
          else handleClose();
        } else {
          applyFailure(res);
        }
        return;
      }
      const res = handleResult(await bulkRequestStatusChange(payload), ({ created, skipped }) =>
        `${created} approval${created === 1 ? "" : "s"} created` +
        (skipped ? ` · ${skipped} skipped (already there or already requested)` : ""));
      if (res === "ok") {
        setReason(""); // a fresh batch never inherits the last batch's reason
        onDone();
        handleClose();
        router.refresh();
      }
    });
  }

  /** Result handling for the approval-request call: toast on success, `applyFailure` otherwise. The direct status branch above handles its own result because its skipped list keeps the drawer open. */
  function handleResult<T>(res: ActionResult<T>, successMessage: (data: T) => string): "ok" | "failed" {
    if (res.ok) {
      toast(successMessage(res.data), "settled");
      return "ok";
    }
    applyFailure(res);
    return "failed";
  }

  function handleClose() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
    setSkippedList([]);
    onClose();
  }

  return (
    <Drawer open={open} onClose={handleClose} title="Bulk actions">
      <div className="flex flex-col gap-4">
        {canAssignMode && (
          <SegmentedControl
            aria-label="Bulk action"
            value={mode}
            options={[{ value: "status", label: "Change status" }, { value: "assign", label: "Assign to a person" }]}
            onChange={(v) => setMode(v as Mode)}
          />
        )}
        <p className="text-xs text-fg-muted">
          {effectiveMode === "assign" ? (
            <>Assigns <b>{scope}</b> to one person now. Devices that are not spares, are untriaged, reserved for
            someone else or held by an open request are skipped and listed.</>
          ) : direct ? (
            <>Changes the status of <b>{scope}</b> now. Held devices and stock that is not assigned to anyone are
            skipped and listed — return or handle those one at a time.</>
          ) : (
            <>Acting on <span className="font-medium text-fg-secondary">{scope}</span>. Each asset gets its
            own <span className="font-mono">lifecycle.change-status</span> approval — nothing changes until
            it&apos;s approved and executed.</>
          )}
        </p>
        {named && <p className="font-mono text-[11px] text-fg-secondary">{named}</p>}
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        {skippedList.length > 0 && (
          <Banner
            tone="attention"
            title={`${skippedList.length} skipped`}
            actions={<Button size="sm" variant="ghost" onClick={handleClose}>Done</Button>}
          >
            <ul className="list-disc pl-4">
              {skippedList.map((s) => <li key={s.tag}>{s.tag} — {s.reason}</li>)}
            </ul>
          </Banner>
        )}
        {/* Phase 16 fix: a partial result (some assets skipped) settles the
            drawer on the skipped list — the form and its Confirm button would
            otherwise still be sitting there, inviting a resubmission of a
            batch that already partly ran. Done (in the Banner above) is the
            only way forward from here. */}
        {skippedList.length === 0 && (
          <>
            {effectiveMode === "assign" ? (
              <>
                <FormField label="Assign to" required error={fieldErrors.employeeId}>
                  {(props) => (
                    <EntityCombobox
                      id={props.id}
                      aria-describedby={props["aria-describedby"]}
                      invalid={props.invalid}
                      options={employees}
                      value={employeeId}
                      onChange={setEmployeeId}
                      placeholder="Type a name or EMP number…"
                      recent={recentEmployees}
                    />
                  )}
                </FormField>
                <SegmentedControl
                  aria-label="Assignment kind"
                  value={assignKind}
                  options={[{ value: "DEPLOYED", label: "Deployed" }, { value: "TEMPORARY", label: "Loan" }]}
                  onChange={(v) => setAssignKind(v as "DEPLOYED" | "TEMPORARY")}
                />
                {assignKind === "TEMPORARY" && (
                  <FormField label="Loan until" required error={fieldErrors.loanDueAt} hint={`Defaults to ${DEFAULT_LOAN_DAYS} days.`}>
                    {(props) => (
                      <Input
                        id={props.id}
                        aria-describedby={props["aria-describedby"]}
                        invalid={props.invalid}
                        type="date"
                        min={minLoanDue(new Date())}
                        value={loanDueAt}
                        onChange={(e) => setLoanDueAt(e.target.value)}
                      />
                    )}
                  </FormField>
                )}
                <ReasonField
                  error={fieldErrors.reason} value={reason} onChange={setReason}
                  chips={REASON_CHIPS["asset.assign"]} disabled={pending}
                />
              </>
            ) : (
              <>
                <FormField label="Target status" required error={fieldErrors.to}>
                  {(props) => (
                    <Select
                      id={props.id}
                      aria-describedby={props["aria-describedby"]}
                      invalid={props.invalid}
                      value={effectiveTo}
                      onChange={(e) => setTo(e.target.value)}
                    >
                      {targets.map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s as AssetStatus]}</option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <ReasonField
                  required={!direct} error={fieldErrors.reason} hint="Goes into every approval's payload." value={reason} onChange={setReason}
                  chips={REASON_CHIPS["asset.status"]} disabled={pending}
                />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                variant="primary"
                loading={pending}
                onClick={submit}
                disabled={effectiveMode === "assign" && !employeeId}
              >
                {effectiveMode === "assign" ? "Confirm" : direct ? "Confirm" : "Request status change"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
