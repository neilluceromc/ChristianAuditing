"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
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
        <FormField label="Reason" required error={fieldErrors.reason}>
          {(p) => (
            <Textarea
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              invalid={p.invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}

export function AddSlotDialog({
  employeeId,
  itTypes,
  open,
  onClose,
}: {
  employeeId: string;
  itTypes: Array<{ id: string; name: string }>;
  open: boolean;
  onClose: () => void;
}) {
  const { router, pending, startTransition, error, fieldErrors, retryAfter, setRetryAfter, handle, reset } =
    useExceptionAction();
  const toast = useToast();
  const [name, setName] = useState("");
  const [assetTypeId, setAssetTypeId] = useState(itTypes[0]?.id ?? "");
  const [required, setRequired] = useState(true);
  const [loaner, setLoaner] = useState(false);
  const [reason, setReason] = useState("");

  function close() {
    reset();
    setName("");
    setAssetTypeId(itTypes[0]?.id ?? "");
    setRequired(true);
    setLoaner(false);
    setReason("");
    onClose();
  }

  function submit() {
    reset();
    startTransition(async () => {
      handle(await addSlotException({ employeeId, name, assetTypeId, required, loaner, reason }), () => {
        toast(`${name} added for this person`, "settled");
        setName("");
        setRequired(true);
        setLoaner(false);
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
      title="Add a slot for this person"
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Add</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <p className="text-xs text-fg-muted">
          Only this person gets it — the policy itself is untouched.
        </p>
        <FormField label="Slot name" required error={fieldErrors.name}>
          {(p) => (
            <Input
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              invalid={p.invalid}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. loaner laptop"
            />
          )}
        </FormField>
        {itTypes.length === 0 ? (
          <p className="text-xs text-fg-muted">No IT asset types exist yet — create one before adding a slot.</p>
        ) : (
          <FormField label="Asset type" required error={fieldErrors.assetTypeId}>
            {(p) => (
              <Select
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={assetTypeId}
                onChange={(e) => setAssetTypeId(e.target.value)}
              >
                {itTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            )}
          </FormField>
        )}
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
          required — counts as a policy gap while empty
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <Checkbox checked={loaner} onChange={(e) => setLoaner(e.target.checked)} />
          loaner slot — filled only by a device on loan (TEMPORARY)
        </label>
        <FormField label="Reason" required error={fieldErrors.reason}>
          {(p) => (
            <Textarea
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              invalid={p.invalid}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </FormField>
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
