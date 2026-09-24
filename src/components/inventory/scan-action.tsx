"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { TriageDialog } from "@/components/inventory/triage-control";
import { ItCheckDialog } from "@/components/inventory/it-check";
import { AssignDialog, ReturnDialog } from "@/components/inventory/holder-control";

const LABEL = { triage: "Triage…", "mark-checked": "Mark checked", return: "Return…", assign: "Assign…" } as const;

export type ScanActionKind = keyof typeof LABEL;

/**
 * Spec §6 (plan P-14): the state's main action, full width and at least 44 px,
 * opening the record's own control. A client component because the page is a
 * server component and cannot hand an onClick to the DOM.
 */
export function ScanAction({ action, asset, holder, direct, employees, heldFor }: {
  action: ScanActionKind;
  asset: { id: string; tag: string; model: string };
  holder: { id: string; name: string } | null;
  direct: boolean;
  employees: ComboOption[];
  /** an ACTIVE hold's person, preselected in Assign exactly as the record header does */
  heldFor?: { id: string; name: string };
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant="primary" size="lg" className="min-h-11 w-full" onClick={() => setOpen(true)}>
        {LABEL[action]}
      </Button>
      {action === "triage" && <TriageDialog open={open} onClose={close} asset={asset} />}
      {action === "mark-checked" && <ItCheckDialog open={open} onClose={close} asset={asset} />}
      {action === "return" && holder && (
        <ReturnDialog open={open} onClose={close} asset={asset} holder={holder} direct={direct} />
      )}
      {action === "assign" && (
        <AssignDialog open={open} onClose={close} asset={asset} direct={direct} employees={employees} heldFor={heldFor} />
      )}
    </>
  );
}
