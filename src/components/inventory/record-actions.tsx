"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { actionLabel, type RecordAction } from "@/lib/record-actions";
import { CLASS_LABEL, withClsQS } from "@/lib/asset-class";
import type { AssetClass, AssetStatus } from "@prisma/client";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { AssignDialog, ReserveDialog, ReturnDialog } from "./holder-control";
import { ReplaceDialog } from "./replace-control";
import { ChangeStatusDialog } from "./status-control";
import { TriageDialog } from "./triage-control";
import { LoanDueDialog } from "./loan-due-control";
import { ItCheckDialog } from "./it-check";
import { ResubmitDialog } from "./resubmit-dialog";

/**
 * Phase 30 (spec §4.1, plan P-3/P-4): the record's one state-chosen primary, Edit visible, the rest in More.
 * The twin of ProfileActions: this component owns which dialog is open; the dialogs own nothing but their form.
 */
export function RecordActions(props: {
  plan: { primary: RecordAction | null; more: RecordAction[]; edit: boolean };
  asset: { id: string; tag: string; model: string; cls: AssetClass; status: AssetStatus; hasHolder: boolean; loanDueAt: string | null };
  holder: { id: string; name: string } | null;
  direct: boolean;
  recentPeople: ComboOption[];
  heldFor?: { id: string; name: string; active: boolean };
  spares: { options: ComboOption[]; hidden: number };
  holdExpiry: { defaultExpiry: string; minExpiry: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<RecordAction | null>(null);
  const { plan, asset, direct, holder } = props;
  const close = () => setOpen(null);

  function run(action: RecordAction) {
    if (action === "print-label") { router.push("/inventory/labels" + withClsQS(`?ids=${asset.id}`, asset.cls)); return; }
    setOpen(action);
  }

  const items: MenuItem[] = plan.more.map((a) => ({ label: actionLabel(a, { cls: asset.cls, direct, inMenu: true }), onSelect: () => run(a) }));
  const nothing = !plan.primary && !plan.edit && items.length === 0;

  return (
    <>
      {nothing && <span className="text-xs text-fg-muted">Managed by {CLASS_LABEL[asset.cls]} — view only</span>}
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
        recentPeople={props.recentPeople} heldFor={props.heldFor}
      />
      {holder && <ReturnDialog open={open === "return"} onClose={close} asset={asset} holder={holder} direct={direct} />}
      {holder && (
        <ReplaceDialog open={open === "replace"} onClose={close} asset={asset} holder={holder} spares={props.spares.options} hidden={props.spares.hidden} />
      )}
      <ReserveDialog
        open={open === "reserve"} onClose={close} asset={asset}
        recentPeople={props.recentPeople} {...props.holdExpiry}
      />
      <ChangeStatusDialog open={open === "change-status"} onClose={close} asset={asset} direct={direct} />
      <TriageDialog open={open === "triage"} onClose={close} asset={asset} />
      <LoanDueDialog open={open === "set-loan-date"} onClose={close} asset={asset} loanDueAt={asset.loanDueAt} />
      <ItCheckDialog open={open === "mark-checked"} onClose={close} asset={asset} />
      <ResubmitDialog open={open === "mark-corrected"} onClose={close} asset={asset} />
    </>
  );
}
