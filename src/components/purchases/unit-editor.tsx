"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { saveUnit } from "@/server/modules/purchases/actions";
import type { PurchaseUnitView } from "@/server/modules/purchases/queries";

/**
 * README 1j: the IT slot editor and the Finance unit editor are the same row,
 * rendered for whoever's turn it is. Saving a unit does NOT re-submit the
 * request — this component never calls a transition action.
 */
export function UnitEditor({ unit, mode }: { unit: PurchaseUnitView; mode: "it" | "finance" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [specs, setSpecs] = useState(unit.specs ?? "");
  const [itSlotNotes, setItSlotNotes] = useState(unit.itSlotNotes ?? "");
  const [financeNotes, setFinanceNotes] = useState(unit.financeNotes ?? "");
  const [state, setState] = useState<string>(unit.state);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      // saveUnit guards each field it writes on the previous value it read, so
      // sending a field nobody touched risks conflicting with someone else's
      // concurrent edit to the OTHER field on this same line (see actions.ts).
      // Sending only what actually changed here keeps the two edits from
      // stepping on each other.
      const input: { unitId: string; specs?: string; itSlotNotes?: string; financeNotes?: string; state?: string } = {
        unitId: unit.id,
      };
      if (mode === "it") {
        if (specs !== (unit.specs ?? "")) input.specs = specs;
        if (itSlotNotes !== (unit.itSlotNotes ?? "")) input.itSlotNotes = itSlotNotes;
      } else {
        if (financeNotes !== (unit.financeNotes ?? "")) input.financeNotes = financeNotes;
        if (state !== unit.state) input.state = state;
      }

      const res = await saveUnit(input);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-(--radius-card) border border-border-faint bg-surface-subtle p-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {mode === "it" ? (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Specs
              <Input value={specs} onChange={(e) => setSpecs(e.target.value)} placeholder="IPS, USB-C 90W" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              IT slot note
              <Input value={itSlotNotes} onChange={(e) => setItSlotNotes(e.target.value)} placeholder="Confirm wattage for T14" />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Finance note
              <Input value={financeNotes} onChange={(e) => setFinanceNotes(e.target.value)} placeholder="Within standing rate" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
              Unit decision
              <Select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </Select>
            </label>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" loading={pending} onClick={save}>{saved ? "✓ Saved" : "Save line"}</Button>
        <span className="text-[11px] text-fg-muted">Saving a line does not re-submit the request.</span>
      </div>
    </div>
  );
}
