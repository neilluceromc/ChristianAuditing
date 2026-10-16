"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormError, FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { slotLabel, numberSlotLabels } from "@/lib/loadout";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { addSlotException, removeSlotException, waiveSlot } from "@/server/modules/employees/exception-actions";
import type { ActionResult } from "@/server/action-result";

/**
 * The three exception surfaces share one shape: an async mutation that
 * returns the house ActionResult union, a pending spinner, a field-error map
 * the caller's FormFields read from, and a rate-limit countdown. Same
 * `handle(res, onOk)` split as loadout-view.tsx:95-100 — kept local (not
 * imported) since that file exports no such helper, and each control here
 * needs its own independent pending/error state.
 */
function useExceptionAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function handle<T>(res: ActionResult<T>, onOk: (data: T) => void) {
    if (res.ok) onOk(res.data);
    else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
    else setError(res.message);
  }

  function reset() {
    setError(null);
    setFieldErrors({});
  }

  return { router, pending, startTransition, error, fieldErrors, retryAfter, setRetryAfter, handle, reset };
}

export function WaiveSlotDialog({
  employeeId,
  slot,
  open,
  onClose,
}: {
  employeeId: string;
  slot: { id: string; name: string };
  open: boolean;
  onClose: () => void;
}) {
  const { router, pending, startTransition, error, fieldErrors, retryAfter, setRetryAfter, handle, reset } =
    useExceptionAction();
  const toast = useToast();
  const [reason, setReason] = useState("");

  function close() {
    reset();
    setReason("");
    onClose();
  }

  function submit() {
    reset();
    startTransition(async () => {
      handle(await waiveSlot({ employeeId, slotId: slot.id, reason }), () => {
        toast(`${slot.name} waived for this person`, "settled");
        setReason("");
        onClose();
        router.refresh();
      });
    });
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Waive the ${slot.name} slot?`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Waive</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <p className="text-xs text-fg-muted">
          This person stops needing a {slot.name} — it drops off their loadout and, if required, stops
          counting as a policy gap. The policy itself is untouched; this only applies to them.
        </p>
        <ReasonField
          required error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={REASON_CHIPS["policy.exception.waive"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}

export interface ItCategoryOption {
  id: string;
  name: string;
  types: Array<{ id: string; name: string }>;
}

/**
 * Phase 37 (spec §4.7): the category first, then the type when the category has
 * more than one; the slot names itself from them (`slotLabel`), numbered
 * against the labels this person's tiles already carry.
 */
export function AddSlotDialog({
  employeeId,
  employeeName,
  itCategories,
  currentLabels,
  open,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  itCategories: ItCategoryOption[];
  /** This person's tile labels, un-numbered, in policy order. */
  currentLabels: string[];
  open: boolean;
  onClose: () => void;
}) {
  const { router, pending, startTransition, error, fieldErrors, retryAfter, setRetryAfter, handle, reset } =
    useExceptionAction();
  const toast = useToast();
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [required, setRequired] = useState(true);
  const [loaner, setLoaner] = useState(false);
  const [reason, setReason] = useState("");

  const category = itCategories.find((c) => c.id === categoryId) ?? null;
  const type = category?.types.find((t) => t.id === typeId) ?? null;
  const showsAs = category && type
    ? numberSlotLabels([...currentLabels, slotLabel(category.name, type.name)]).at(-1) ?? null
    : null;

  function pickCategory(id: string) {
    setCategoryId(id);
    // A category with one type needs no second question; otherwise the type is asked again.
    const types = itCategories.find((c) => c.id === id)?.types ?? [];
    setTypeId(types.length === 1 ? types[0].id : "");
  }

  function clear() {
    setCategoryId("");
    setTypeId("");
    setRequired(true);
    setLoaner(false);
    setReason("");
  }

  function close() {
    reset();
    clear();
    onClose();
  }

  function submit() {
    reset();
    startTransition(async () => {
      handle(await addSlotException({ employeeId, assetTypeId: typeId, required, loaner, reason }), () => {
        toast(`${showsAs ?? "Slot"} added for this person`, "settled");
        clear();
        onClose();
        router.refresh();
      });
    });
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Add a slot for ${employeeName}`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={itCategories.length === 0} onClick={submit}>Add</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <p className="text-xs text-fg-muted">
          Only this person gets it — the policy itself is untouched.
        </p>
        {itCategories.length === 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-fg-muted">No IT categories with types exist yet — create one before adding a slot.</p>
            <FormError>{fieldErrors.assetTypeId}</FormError>
          </div>
        ) : (
          <>
            <FormField label="What" required error={category && category.types.length >= 2 ? undefined : fieldErrors.assetTypeId}>
              {(p) => (
                <Select
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  invalid={p.invalid}
                  value={categoryId}
                  onChange={(e) => pickCategory(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {itCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              )}
            </FormField>
            {category && category.types.length >= 2 && (
              <FormField label="Which kind" required error={fieldErrors.assetTypeId}>
                {(p) => (
                  <Select
                    id={p.id}
                    aria-describedby={p["aria-describedby"]}
                    invalid={p.invalid}
                    value={typeId}
                    onChange={(e) => setTypeId(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {category.types.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
            {showsAs && <p className="text-sm text-fg-secondary">Shows as &ldquo;{showsAs}&rdquo;</p>}
          </>
        )}
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
          required — counts as a policy gap while empty
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <Checkbox checked={loaner} onChange={(e) => setLoaner(e.target.checked)} />
          loaner slot — filled only by a device on loan (TEMPORARY)
        </label>
        <ReasonField
          required error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={REASON_CHIPS["policy.exception.add"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}

export function RemoveExceptionButton({ id, label }: { id: string; label: string }) {
  const { router, pending, startTransition, error, retryAfter, setRetryAfter, handle } = useExceptionAction();
  const toast = useToast();

  function submit() {
    startTransition(async () => {
      handle(await removeSlotException({ id }), () => {
        toast("Exception removed", "settled");
        router.refresh();
      });
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Button variant="ghost" size="sm" loading={pending} onClick={submit}>
        {label}
      </Button>
    </span>
  );
}
