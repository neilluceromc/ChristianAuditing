"use client";

import { Fragment, useState } from "react";
import { Th, Td, Tr } from "@/components/ui/table";
import { monthLabel, type LifeYear } from "@/lib/depreciation";
import { fmtMoneyExact } from "@/lib/format";

const peso = (c: number) => fmtMoneyExact(c / 100);

/** Phase 35 (spec 4.2 item 5): one row per year of the asset's life; a year opens to its months. */
export function YearSchedule({ years }: { years: LifeYear[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (y: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface shadow-card">
      <table aria-label="Depreciation by year" className="w-full border-collapse text-[12.5px]">
        <thead className="bg-surface-subtle">
          <tr>
            <Th>Year</Th>
            <Th align="right">Book value at start</Th>
            <Th align="right">Depreciation</Th>
            <Th align="right">Book value at end</Th>
            <Th>Progress</Th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const expanded = open.has(y.year);
            return (
              <Fragment key={y.year}>
                <Tr>
                  <Td>
                    <button type="button" aria-expanded={expanded} onClick={() => toggle(y.year)}
                      className="font-mono text-xs font-medium text-accent hover:underline">
                      {y.year}
                    </button>
                  </Td>
                  <Td align="right" mono>{peso(y.opening)}</Td>
                  <Td align="right" mono>{peso(y.total)}</Td>
                  <Td align="right" mono>{peso(y.closing)}</Td>
                  <Td>{y.done} done · {y.projected} projected</Td>
                </Tr>
                {expanded && y.months.map((m) => (
                  <Tr key={m.month} className={m.projected ? "text-fg-muted" : undefined}>
                    <Td><span className="pl-4">{monthLabel(m.month)}</span></Td>
                    <Td align="right" mono>{peso(m.opening)}</Td>
                    <Td align="right" mono>{peso(m.charge)}</Td>
                    <Td align="right" mono>{peso(m.closing)}</Td>
                    <Td>{m.projected ? "projected" : "done"}</Td>
                  </Tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
