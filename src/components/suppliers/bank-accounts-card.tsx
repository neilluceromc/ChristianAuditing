"use client";

import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { addBankAccount, removeBankAccount, revealBankAccount } from "@/server/modules/suppliers/bank-actions";
import { useSupplierRunner } from "./use-supplier-runner";
import { BankAccountsTable, type BankAccountRow } from "./bank-accounts-table";

export type { BankAccountRow };

const EMPTY_FORM = { label: "", bankName: "", accountName: "", accountNumber: "" };
const CLAIMED = ["label", "bankName", "accountName", "accountNumber"];

/**
 * Spec §4.2. `revealed` is client-state only — never persisted, never sent
 * anywhere but this component's own render — so a reveal never touches
 * router.refresh() (ruling R2: the server writes no revalidatable state for
 * it). Add/remove DO refresh — they change the server-rendered row list.
 */
export function BankAccountsCard({
  vendorId,
  accounts,
  canManage,
  canReveal,
}: {
  vendorId: string;
  accounts: BankAccountRow[];
  canManage: boolean;
  canReveal: boolean;
}) {
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealPending, startReveal] = useTransition();
  const [revealError, setRevealError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useSupplierRunner(CLAIMED);

  /**
   * Reveal keeps its own inline banner (`revealError`) rather than the one
   * shared by the Add/Remove dialogs — it has no dialog of its own to host
   * one, and unlike Add/Remove it never calls router.refresh() (ruling R2).
   * It still shares the runner's `retryAfter` so a reveal that gets rate
   * limited counts against, and is shown by, the exact same countdown as
   * Add/Remove — one 60/min bucket, one piece of state — instead of a second
   * ad-hoc timer. Neither rate_limited nor forbidden is discarded any more.
   */
  function reveal(id: string) {
    setRevealError(null);
    startReveal(async () => {
      const res = await revealBankAccount({ id });
      if (res.ok) setRevealed((prev) => ({ ...prev, [id]: res.data.accountNumber }));
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setRevealError(res.message);
    });
  }

  return (
    <Card>
      <CardHeader
        title="Bank accounts"
        actions={canManage && (
          <Button size="sm" onClick={() => { reset(); setForm(EMPTY_FORM); setAdding(true); }}>
            Add account
          </Button>
        )}
      />
      <CardBody className="flex flex-col gap-3">
        {/* Gated on both dialogs being closed: while one is open, its own
            RateLimitNotice below already shows this same shared retryAfter —
            rendering it here too would double it up behind the dialog veil. */}
        {!adding && !removing && retryAfter !== null && (
          <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
        )}
        {revealError && <Banner tone="fault" title={revealError} />}
        <BankAccountsTable
          accounts={accounts}
          revealed={revealed}
          revealPending={revealPending}
          canReveal={canReveal}
          canManage={canManage}
          onReveal={reveal}
          onRemove={(id) => { reset(); setRemoving(id); }}
        />
      </CardBody>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this account?"
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => removing && run(() => removeBankAccount({ id: removing }), "Account removed", { onOk: () => setRemoving(null) })}
            >
              Remove
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
        Only the record here is removed; nothing is sent to the bank.
      </Dialog>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a bank account"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => run(() => addBankAccount({ vendorId, ...form }), "Account added", {
                onOk: () => { setAdding(false); setForm(EMPTY_FORM); },
              })}
            >
              Add
            </Button>
          </>
        }
      >
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <div className="flex flex-col gap-3">
          <FormField label="Label" required error={fieldErrors.label}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />}
          </FormField>
          <FormField label="Bank name" required error={fieldErrors.bankName}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />}
          </FormField>
          <FormField label="Account name" required error={fieldErrors.accountName}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} />}
          </FormField>
          <FormField label="Account number" required error={fieldErrors.accountNumber}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />}
          </FormField>
        </div>
      </Dialog>
    </Card>
  );
}
