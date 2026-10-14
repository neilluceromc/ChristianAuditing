"use client";

import type { AssetClass } from "@prisma/client";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { DEFAULT_STATUS } from "@/lib/asset-class";
import type { CreatableStatus } from "@/lib/asset-rules";
import { minLoanDue } from "@/lib/lifecycle";

/** Phase 34 (spec §4.4): the choices in words people use, not the status names. */
const WHERE_LABEL: Record<CreatableStatus, string> = {
  SPARE: "Spare stock", DEPLOYED: "Give to someone", TEMPORARY: "Lend", STORED: "Stored", OPERATIONAL: "In use",
};

/** Spec §5.3: what the chosen initial state means, in one line. */
function stateLine(status: CreatableStatus, cls: AssetClass): string {
  if (status === DEFAULT_STATUS[cls]) return cls === "IT" ? "Goes to spare stock, ready to hand out." : "Goes to storage.";
  if (status === "TEMPORARY") return "Lent to the chosen person until the date below.";
  if (status === "OPERATIONAL") return "In use from today.";
  return "Given to the chosen person.";
}

/**
 * Phase 30 (spec §5.3): quantity 1 only — the state the asset starts in, and
 * for a holder state who holds it (and, for a loan, until when), so no loan is
 * born without a due date. The caller decides what is offered (ruling R4: Loan
 * only where the registrant applies it directly).
 */
export function RegisterInitialState({
  cls,
  offered,
  status,
  onStatus,
  holder,
  direct,
  employees,
  recentEmployees,
  assigneeId,
  onAssignee,
  loanDueAt,
  onLoanDue,
  errors,
}: {
  cls: AssetClass;
  offered: readonly CreatableStatus[];
  status: CreatableStatus;
  onStatus: (status: CreatableStatus) => void;
  /** The state puts the asset in someone's hands. */
  holder: boolean;
  /** The registrant applies it directly; otherwise it files a request. */
  direct: boolean;
  employees: ComboOption[];
  recentEmployees: string[];
  assigneeId: string | null;
  onAssignee: (id: string | null) => void;
  loanDueAt: string;
  onLoanDue: (date: string) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <SegmentedControl
          aria-label="Where does it go"
          aria-invalid={!!errors.requestedStatus}
          className="self-start"
          options={offered.map((s) => ({ value: s, label: WHERE_LABEL[s] }))}
          value={status}
          onChange={(v) => onStatus(v as CreatableStatus)}
        />
        <p className="text-[11px] text-fg-muted">{stateLine(status, cls)}</p>
        {holder && !direct && <p className="text-[11px] text-fg-muted">This files a request for approval.</p>}
        <FormError>{errors.requestedStatus}</FormError>
      </div>
      {holder && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Who" required error={errors.assigneeId}>
            {(p) => (
              <EntityCombobox
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={employees}
                recent={recentEmployees}
                value={assigneeId}
                onChange={onAssignee}
                placeholder="Type a name or EMP number…"
              />
            )}
          </FormField>
          {status === "TEMPORARY" && (
            <FormField label="Back by" required error={errors.loanDueAt}>
              {(p) => (
                <Input
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  type="date"
                  min={minLoanDue(new Date())}
                  value={loanDueAt}
                  onChange={(e) => onLoanDue(e.target.value)}
                />
              )}
            </FormField>
          )}
        </div>
      )}
    </div>
  );
}
