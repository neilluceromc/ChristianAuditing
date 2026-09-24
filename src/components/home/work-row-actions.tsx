"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { TriageDialog } from "@/components/inventory/triage-control";
import { ItCheckDialog } from "@/components/inventory/it-check";
import { LoanDueDialog } from "@/components/inventory/loan-due-control";
import { AssignDialog } from "@/components/inventory/holder-control";
import { workActionLabel, type WorkRow } from "@/lib/worklist";

/** The record page's own date-input shape (inventory/[id]/(record)/layout.tsx). */
const isoDay = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/**
 * Spec §5.1: a control opens the record's own dialog in place; everything
 * else stays a link. One dialog instance per row — the Phase 30 dialogs reset
 * their local state when they open, so rows never share one.
 */
export function WorkRowActions({ row, canAct, direct, employees }: {
  row: WorkRow; canAct: boolean; direct: boolean; employees: ComboOption[];
}) {
  const [open, setOpen] = useState(false);
  const label = workActionLabel(row, canAct);
  const c = row.control;
  if (!canAct || !c) {
    return <Link href={row.href} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{label}</Link>;
  }
  const close = () => setOpen(false);
  return (
    <>
      <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>{label}</Button>
      {c.kind === "triage" && <TriageDialog open={open} onClose={close} asset={c.asset} />}
      {c.kind === "it-check" && <ItCheckDialog open={open} onClose={close} asset={c.asset} />}
      {c.kind === "loan-due" && <LoanDueDialog open={open} onClose={close} asset={c.asset} loanDueAt={isoDay(c.loanDueAt)} />}
      {c.kind === "assign" && <AssignDialog open={open} onClose={close} asset={c.asset} direct={direct} employees={employees} />}
    </>
  );
}
