"use client";

import { useState } from "react";
import { Td, Tr } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { CLASS_LABEL } from "@/lib/asset-class";
import { fmtDate } from "@/lib/format";
import { lifeFromYearsMonths, policyDirty } from "@/lib/depreciation-input";
import { setCategoryPolicy } from "@/server/modules/finance/depreciation-actions";
import type { PolicyRow as PolicyRowData } from "@/server/modules/finance/depreciation-queries";
import { useFinanceRunner } from "./use-finance-runner";

const BAD_LIFE = "Enter whole years and 0–11 months, up to 50 years";

export function PolicyRow({ row }: { row: PolicyRowData }) {
  const initYears = row.lifeMonths === null ? "" : String(Math.floor(row.lifeMonths / 12));
  const initMonths = row.lifeMonths === null ? "" : String(row.lifeMonths % 12);
  const initSalvage = row.salvagePercent === null ? "" : String(row.salvagePercent);
  const [years, setYears] = useState(initYears);
  const [months, setMonths] = useState(initMonths);
  const [salvage, setSalvage] = useState(initSalvage);
  const [lifeError, setLifeError] = useState<string | null>(null);
  const runner = useFinanceRunner(["lifeMonths", "salvagePercent"]);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = runner;

  const dirty = policyDirty({ years, months, salvage }, { lifeMonths: row.lifeMonths, salvagePercent: row.salvagePercent });

  function save() {
    setLifeError(null);
    const life = lifeFromYearsMonths(years, months);
    if (life === "bad") {
      setLifeError(BAD_LIFE);
      return;
    }
    const pct = salvage.trim() === "" ? null : Number(salvage);
    if (pct !== null && !Number.isFinite(pct)) {
      runner.setFieldErrors({ salvagePercent: "Enter a number, for example 5 or 7.5" });
      return;
    }
    run(
      () => setCategoryPolicy({ categoryId: row.id, lifeMonths: life, salvagePercent: pct }),
      `Saved — ${row.name}`,
    );
  }

  const lifeMsg = lifeError ?? fieldErrors.lifeMonths;
  const salvageMsg = fieldErrors.salvagePercent;
  const changed = row.changedAt ? `${row.changedBy ?? "—"} · ${fmtDate(row.changedAt)}` : "—";

  return (
    <Tr>
      <Td className="font-medium text-fg">{row.name}</Td>
      <Td><Pill>{CLASS_LABEL[row.cls]}</Pill></Td>
      <Td align="right" mono>{row.costed}</Td>
      <Td className="py-2">
        <div className="flex items-center gap-1.5">
          <Input
            type="text" inputMode="numeric" aria-label={`Years for ${row.name}`} className="w-14"
            value={years} invalid={!!lifeMsg} onChange={(e) => setYears(e.target.value)}
          />
          <span className="text-fg-muted">y</span>
          <Input
            type="text" inputMode="numeric" aria-label={`Months for ${row.name}`} className="w-14"
            value={months} invalid={!!lifeMsg} onChange={(e) => setMonths(e.target.value)}
          />
          <span className="text-fg-muted">m</span>
        </div>
        {lifeMsg && <p role="alert" className="mt-1 text-xs text-[var(--error-text,var(--danger-fg))]">{lifeMsg}</p>}
      </Td>
      <Td className="py-2">
        <div className="flex items-center gap-1.5">
          <Input
            type="text" inputMode="decimal" aria-label={`Salvage percent for ${row.name}`} className="w-20"
            value={salvage} invalid={!!salvageMsg} onChange={(e) => setSalvage(e.target.value)}
          />
          <span className="text-fg-muted">%</span>
        </div>
        {salvageMsg && <p role="alert" className="mt-1 text-xs text-[var(--error-text,var(--danger-fg))]">{salvageMsg}</p>}
      </Td>
      <Td className="text-fg-muted">{changed}</Td>
      <Td className="py-2">
        <div className="flex flex-col items-start gap-1">
          <Button size="sm" variant="primary" onClick={save} loading={pending} disabled={!dirty}>Save</Button>
          {dirty && row.affected > 0 && (
            <p className="max-w-56 text-xs text-fg-muted">
              This updates the book value of {row.affected} assets, including past months on the schedule.
            </p>
          )}
          {error && <p role="alert" className="max-w-56 text-xs text-[var(--error-text,var(--danger-fg))]">{error}</p>}
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        </div>
      </Td>
    </Tr>
  );
}
