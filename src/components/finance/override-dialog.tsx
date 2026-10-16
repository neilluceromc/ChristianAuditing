"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { asOfMonth, depreciate, monthLabel, resolvePolicy } from "@/lib/depreciation";
import { lifeFromYearsMonths } from "@/lib/depreciation-input";
import { fmtMoneyExact } from "@/lib/format";
import { clearAssetOverride, setAssetOverride } from "@/server/modules/finance/depreciation-actions";
import { useFinanceRunner } from "./use-finance-runner";

export interface OverrideAsset {
  id: string;
  tag: string;
  costC: number | null;
  /** The month it starts depreciating (`depStartMonth`: the purchase month), or null while Finance has not approved it. */
  startMonth: number | null;
  custom: boolean;
  lifeMonths: number | null;
  salvageC: number | null;
  note: string | null;
  /** "Category: 3 years, 10% salvage" or "Category: no policy". */
  categoryText: string;
  categoryLife: number | null;
  categorySalvagePercent: number | null;
}

/**
 * Phase 35 (spec 4.1 / 4.2): one asset's own useful life and salvage, with a live preview.
 * Controlled by the caller (the row menu here, the asset page in Task 10).
 */
export function OverrideDialog({ open, onClose, asset }: { open: boolean; onClose: () => void; asset: OverrideAsset }) {
  const runner = useFinanceRunner(["lifeMonths", "salvage", "note"]);
  const { pending, error, setError, fieldErrors, retryAfter, setRetryAfter, reset, run } = runner;
  const [years, setYears] = useState("");
  const [months, setMonths] = useState("");
  const [salvage, setSalvage] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    reset();
    const has = asset.custom && asset.lifeMonths !== null;
    setYears(has ? String(Math.floor(asset.lifeMonths! / 12)) : "");
    setMonths(has ? String(asset.lifeMonths! % 12) : "");
    setSalvage(asset.custom && asset.salvageC !== null ? String(asset.salvageC / 100) : "");
    setNote(asset.custom ? (asset.note ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const life = lifeFromYearsMonths(years, months);
  const salvagePesos = salvage.trim() === "" ? 0 : Number(salvage);
  const salvageOk = Number.isFinite(salvagePesos) && salvagePesos >= 0;

  let preview: string | null = null;
  if (asset.costC !== null && typeof life === "number" && salvageOk) {
    const policy = resolvePolicy(
      { cost: asset.costC, lifeMonths: life, salvage: Math.round(salvagePesos * 100) },
      { lifeMonths: asset.categoryLife, salvagePercent: asset.categorySalvagePercent },
    );
    const r = depreciate(asset.costC, asset.startMonth, policy, asOfMonth(new Date()));
    const base = asset.costC - policy!.salvage;
    if (policy!.salvage >= asset.costC) {
      preview = "With this: salvage is not below cost";
    } else {
      const monthly = fmtMoneyExact(Math.floor(base / life) / 100);
      const book = fmtMoneyExact(r.bookValue / 100);
      preview = `With this: ${monthly} a month · book value now ${book}`;
      if (r.state === "not-started") {
        preview += r.startMonth !== null
          ? `. It depreciates from ${monthLabel(r.startMonth)}, the purchase month.`
          : ". It starts depreciating once Finance approves it, from the purchase month.";
      }
    }
  }

  function save() {
    if (life === null || life === "bad") {
      setError("Enter the asset's useful life");
      return;
    }
    if (!salvageOk) {
      runner.setFieldErrors({ salvage: "Enter an amount in pesos, for example 2500" });
      return;
    }
    run(
      () => setAssetOverride({ assetId: asset.id, lifeMonths: life, salvage: salvagePesos, note }),
      `Custom depreciation saved — ${asset.tag}`,
      { onOk: onClose },
    );
  }

  function clear() {
    run(() => clearAssetOverride({ assetId: asset.id }), `Custom depreciation cleared — ${asset.tag}`, { onOk: onClose });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Depreciation for ${asset.tag}`}
      footer={
        <>
          {asset.custom && <Button variant="ghost" onClick={clear} disabled={pending}>Clear override</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <p className="text-xs text-fg-muted">{asset.categoryText}</p>
        <div className="flex gap-3">
          <FormField label="Years" error={fieldErrors.lifeMonths}>
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} inputMode="numeric"
                value={years} onChange={(e) => setYears(e.target.value)} />
            )}
          </FormField>
          <FormField label="Months">
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} inputMode="numeric"
                value={months} onChange={(e) => setMonths(e.target.value)} />
            )}
          </FormField>
        </div>
        <FormField label="Salvage (₱)" error={fieldErrors.salvage}>
          {(p) => (
            <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} inputMode="decimal"
              value={salvage} onChange={(e) => setSalvage(e.target.value)} />
          )}
        </FormField>
        {preview && <p className="font-mono text-xs text-fg-secondary">{preview}</p>}
        <ReasonField required error={fieldErrors.note} value={note} onChange={setNote} chips={[]} disabled={pending} />
      </div>
    </Dialog>
  );
}
