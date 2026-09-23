"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { actionLabel, type RecordAction } from "@/lib/record-actions";
import { CLASS_LABEL } from "@/lib/asset-class";
import type { AssetClass, AssetStatus } from "@prisma/client";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { AssignDialog, ReserveDialog, ReturnDialog } from "./holder-control";
import { ReplaceDialog } from "./replace-control";
import { ChangeStatusDialog } from "./status-control";
import { TriageDialog } from "./triage-control";
import { LoanDueDialog } from "./loan-due-control";
import { ItCheckDialog } from "./it-check";
import { FinanceReviewDialog, type NextToReview } from "./finance-review";

/**
 * Phase 30 (spec §4.1, plan P-3/P-4): the record's one state-chosen primary, Edit visible, the rest in More.
 * The twin of ProfileActions: this component owns which dialog is open; the dialogs own nothing but their form.
 */
export function RecordActions(props: {
  plan: { primary: RecordAction | null; more: RecordAction[]; edit: boolean };
  asset: { id: string; tag: string; model: string; cls: AssetClass; status: AssetStatus; hasHolder: boolean; loanDueAt: string | null };
  holder: { id: string; name: string } | null;
  direct: boolean;
  employees: ComboOption[];
  recentEmployees: string[];
  heldFor?: { id: string; name: string };
  spares: { options: ComboOption[]; hidden: number };
  holdExpiry: { defaultExpiry: string; minExpiry: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<RecordAction | null>(null);
  // undefined until Finance confirms here; then the next record to review, or null for a clear queue (spec §4.6)
  const [next, setNext] = useState<NextToReview | undefined>(undefined);
  const { plan, asset, direct, holder } = props;
  const close = () => setOpen(null);

  function run(action: RecordAction) {
    if (action === "print-label") { router.push(`/inventory/labels?ids=${asset.id}`); return; }
    setOpen(action);
  }

  const items: MenuItem[] = plan.more.map((a) => ({ label: actionLabel(a, { cls: asset.cls, direct, inMenu: true }), onSelect: () => run(a) }));
  const nothing = !plan.primary && !plan.edit && items.length === 0;
  const financeMode = open === "confirm-details" ? "confirm" : open === "send-back" ? "return" : open === "mark-corrected" ? "resubmit" : null;

  return (
    <>
      {next !== undefined && (next
        ? <ButtonLink href={`/inventory/${next.id}`}>Next to review →</ButtonLink>
        : (
          <span className="text-xs text-fg-muted">
            Queue clear · <Link href="/finance/assets" className="text-accent underline hover:text-accent-hover">Back to the queue</Link>
          </span>
        ))}
      {nothing && next === undefined && <span className="text-xs text-fg-muted">Managed by {CLASS_LABEL[asset.cls]} — view only</span>}
      {plan.primary && (
        <Button variant="primary" onClick={() => run(plan.primary!)}>{actionLabel(plan.primary, { cls: asset.cls, direct, inMenu: false })}</Button>
      )}
      {plan.edit && <ButtonLink href={`/inventory/${asset.id}/edit`}>Edit</ButtonLink>}
      {items.length > 0 && (
        <Menu align="end" items={items} trigger={(p) => <IconButton {...p} aria-label="More actions">⋯</IconButton>} />
      )}
      {/* one dialog per action kind; each mounts closed and resets itself when it opens */}
      <AssignDialog
        open={open === "assign"} onClose={close} asset={asset} direct={direct}
        employees={props.employees} recentEmployees={props.recentEmployees} heldFor={props.heldFor}
      />
      {holder && <ReturnDialog open={open === "return"} onClose={close} asset={asset} holder={holder} direct={direct} />}
      {holder && (
        <ReplaceDialog open={open === "replace"} onClose={close} asset={asset} holder={holder} spares={props.spares.options} hidden={props.spares.hidden} />
      )}
      <ReserveDialog
        open={open === "reserve"} onClose={close} asset={asset}
        employees={props.employees} recentEmployees={props.recentEmployees} {...props.holdExpiry}
      />
      <ChangeStatusDialog open={open === "change-status"} onClose={close} asset={asset} direct={direct} />
      <TriageDialog open={open === "triage"} onClose={close} asset={asset} />
      <LoanDueDialog open={open === "set-loan-date"} onClose={close} asset={asset} loanDueAt={asset.loanDueAt} />
      <ItCheckDialog open={open === "mark-checked"} onClose={close} asset={asset} />
      <FinanceReviewDialog mode={financeMode} onClose={close} asset={asset} onConfirmed={setNext} />
    </>
  );
}
