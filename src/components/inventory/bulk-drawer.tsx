"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { DEFAULT_STATUS, statusesFor } from "@/lib/asset-class";
import { DEFAULT_LOAN_DAYS, defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { bulkRequestStatusChange } from "@/server/modules/inventory/actions";
import { bulkAssign, bulkChangeStatus } from "@/server/modules/lifecycle/actions";
import type { ActionResult } from "@/server/action-result";

type Mode = "status" | "assign";

export function BulkDrawer({
  open,
  onClose,
  selectedIds,
  allMatching,
  filtersQS,
  total,
  cls,
  direct,
  employees,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedIds: string[];
  allMatching: boolean;
  filtersQS: string; // serialized current list state, no leading "?"
  total: number;
  cls: AssetClass;
  direct: boolean;
  employees: ComboOption[];
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
  const effectiveTo = (statusesFor(cls) as readonly string[]).includes(to) ? to : DEFAULT_STATUS[cls];
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // Phase 16 (spec §5): assign mode only exists where direct lifecycle IT
  // assignment does — the same gate `assignAsset` itself enforces server-side.
  // A drawer that outlived a class switch would otherwise keep "assign" mode
  // selected against Purchasing, which has no such target.
  const canAssignMode = direct && cls === "IT";
  const [mode, setMode] = useState<Mode>("status");
  const effectiveMode: Mode = canAssignMode ? mode : "status";
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [assignKind, setAssignKind] = useState<"DEPLOYED" | "TEMPORARY">("DEPLOYED");
  const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));
  const [skippedList, setSkippedList] = useState<Array<{ tag: string; reason: string }>>([]);

  const scope = allMatching ? `all ${total} matching assets` : `${selectedIds.length} selected asset${selectedIds.length === 1 ? "" : "s"}`;

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
      const res = direct
        ? handleResult(await bulkChangeStatus(payload), ({ changed, skipped }) =>
            `${changed} asset${changed === 1 ? "" : "s"} now ${effectiveTo}` +
            (skipped ? ` · ${skipped} skipped (held, already there, or already requested)` : ""))
        : handleResult(await bulkRequestStatusChange(payload), ({ created, skipped }) =>
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

  /** Shared result handling for both the direct and approval-request calls — they share every ActionResult failure shape and differ only in the success payload's field names. */
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
            <>Changes the status of <b>{scope}</b> now. Held devices and off-the-books stock are
            skipped — return or handle those one at a time.</>
          ) : (
            <>Acting on <span className="font-medium text-fg-secondary">{scope}</span>. Each asset gets its
            own <span className="font-mono">lifecycle.change-status</span> approval — nothing changes until
            it&apos;s approved and executed.</>
          )}
        </p>
        <a
          href={allMatching || selectedIds.length === 0
            ? `/inventory/export${filtersQS ? `?${filtersQS}` : ""}`
            : `/inventory/export?ids=${selectedIds.join(",")}`}
          className="text-xs text-accent hover:underline"
        >
          Export this selection as a spreadsheet
        </a>
        {/* Labels come from an explicit selection only: "all matching" would
            make one click a 17-sheet print job, and labelling a whole filtered
            fleet is not a real intent. `selectedIds.length > 0` is
            belt-and-braces rather than a live branch today — the drawer only
            opens via "Bulk actions…" in inventory-table.tsx, which itself
            requires selected.size > 0, so this component can't currently be
            rendered with an empty, non-allMatching selection. Kept anyway so
            the link stays ABSENT, not disabled, if that caller ever changes —
            the house rule for affordances that cannot act. */}
        {/* /inventory/labels admits both departments (and prints what the role
            manages). Labels need an explicit selection, so the affordance is
            absent when "all matching" mode is on. */}
        {!allMatching && selectedIds.length > 0 && (
          <a
            href={`/inventory/labels?ids=${selectedIds.join(",")}`}
            className="text-xs text-accent hover:underline"
          >
            Print labels for {selectedIds.length} selected
          </a>
        )}
        {/* The branch that actually matters: "all matching" has no id list to
            build a ?ids= from, and printing a whole filtered fleet was never
            a real intent (see above) — so under this state the affordance is
            silently absent rather than merely disabled. That silence needs a
            sentence, the same way every other unreachable-affordance case in
            this app gets one, because the alternative is an operator staring
            at a drawer with no explanation for why Print labels isn't there. */}
        {allMatching && <p className="text-xs text-fg-faint">Labels need an explicit selection.</p>}
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
            <FormField label="Reason" error={fieldErrors.reason}>
              {(props) => (
                <Textarea
                  id={props.id}
                  aria-describedby={props["aria-describedby"]}
                  invalid={props.invalid}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </FormField>
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
                  {statusesFor(cls).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Reason" required={!direct} error={fieldErrors.reason} hint="Goes into every approval's payload.">
              {(props) => (
                <Textarea
                  id={props.id}
                  aria-describedby={props["aria-describedby"]}
                  invalid={props.invalid}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </FormField>
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
      </div>
    </Drawer>
  );
}
