"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { countStocktakeLine } from "@/server/modules/stock/stocktake-actions";

export interface CountLine {
  id: string; // StocktakeLine id — what countStocktakeLine takes as lineId
  code: string;
  name: string;
  unit: string;
  countedQty: number | null;
}

/**
 * Spec §5.3, Task 5 Step 4 — the blind count screen. Book quantity is
 * NEVER rendered here (that's the review's job); each row saves itself on
 * blur or Enter (P-3: one line per action, no batch endpoint), independent
 * of every other row's pending/saved state.
 */
export function StocktakeCount({
  stocktakeId,
  lines,
  canCount,
}: {
  stocktakeId: string;
  lines: CountLine[];
  canCount: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.countedQty === null ? "" : String(l.countedQty)])),
  );
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counted = lines.filter((l) => (values[l.id] ?? "").trim() !== "").length;
  const total = lines.length;

  function setValue(id: string, value: string) {
    setValues((s) => ({ ...s, [id]: value }));
    setSaved((s) => ({ ...s, [id]: false }));
  }

  async function save(id: string) {
    if (savingId === id) return; // a forced blur mid-save (Enter already fired one) must not double-submit
    const raw = (values[id] ?? "").trim();
    if (raw === "") return;
    const countedQty = Number(raw);
    if (!Number.isInteger(countedQty) || countedQty < 0) return;
    setError(null);
    setSavingId(id);
    const res = await countStocktakeLine({ lineId: id, countedQty });
    setSavingId(null);
    if (res.ok) {
      setSaved((s) => ({ ...s, [id]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [id]: false })), 3000);
    } else {
      setError(res.message);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Banner tone="fault" title={error} />}
      <Table>
        <THead>
          <Tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>Unit</Th>
            <Th align="right">Counted</Th>
          </Tr>
        </THead>
        <TBody>
          {lines.map((l) => (
            <Tr key={l.id}>
              <Td mono>{l.code}</Td>
              <Td>{l.name}</Td>
              <Td>{l.unit}</Td>
              <Td align="right">
                <span className="inline-flex items-center justify-end gap-2">
                  <Input
                    aria-label={`Counted ${l.code}`}
                    type="number"
                    min={0}
                    step={1}
                    disabled={!canCount}
                    className="w-24 text-right"
                    value={values[l.id] ?? ""}
                    onChange={(e) => setValue(l.id, e.target.value)}
                    onBlur={() => save(l.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); save(l.id); }
                    }}
                  />
                  {saved[l.id] && (
                    <span className="text-accent" title="Saved">
                      <span aria-hidden>✓</span>
                      <span className="sr-only">Saved</span>
                    </span>
                  )}
                </span>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] text-fg-muted">{counted}/{total} counted</p>
        <ButtonLink href={`/stock/stocktakes/${stocktakeId}?view=review`} variant="primary">Review variance</ButtonLink>
      </div>
    </div>
  );
}
