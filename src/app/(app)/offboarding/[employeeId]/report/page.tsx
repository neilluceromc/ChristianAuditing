import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { decidedItems, getWizard } from "@/server/modules/offboarding/queries";
import { OUTCOME_LABEL, OUTCOME_STATUS } from "@/lib/offboarding";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PrintButton } from "@/components/ui/print-button";
import { ButtonLink } from "@/components/ui/button-link";

const STRIPES = "repeating-linear-gradient(135deg, #EEF1F5 0 6px, #F7F9FB 6px 12px)";

export default async function FarewellReportPage({ params }: { params: Promise<{ employeeId: string }> }) {
  await requireUser();
  const { employeeId } = await params;
  const data = await getWizard(employeeId);
  if (!data) notFound();
  const { employee, totals } = data;
  // `decidedItems` is shared with the .xlsx export route so the sheet and the
  // printed page can never disagree about which rows belong (§6a rule 47).
  const decided = decidedItems(data.items);

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex justify-end gap-2 pb-3 print:hidden">
        <ButtonLink href={`/offboarding/${employeeId}/report/export`} variant="secondary">
          Export sheet
        </ButtonLink>
        <PrintButton />
      </div>
      {/* Light-theme-only on purpose: this is a printed artifact. */}
      <div className="flex flex-col gap-6 rounded-(--radius-card) border border-border bg-white p-8 text-[#101828] shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-center justify-between border-b-2 border-[#101828] pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-6 place-items-center bg-[#101828] font-mono text-[11px] font-bold text-white">BR</span>
            <div>
              <p className="text-[15px] font-semibold">Backroom IT — Offboarding farewell report</p>
              <p className="font-mono text-[10px] text-[#667085]">
                generated {fmtDate(new Date())} · from live records · {employee.employment}
              </p>
            </div>
          </div>
          {/* aria-label on a bare <span> (no role) is prohibited — SERIOUS
              under axe, caught on a route no spec scanned before this sweep.
              role="img" is what actually makes the label legal here, and it
              matches what this element visually is: a graphic placeholder,
              not text. */}
          <span role="img" aria-label="scan code placeholder" className="h-10 w-24" style={{ background: STRIPES }} />
        </header>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-[13px]">
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Employee</dt><dd className="font-medium">{employee.name}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Number</dt><dd className="font-mono">{employee.employeeNo}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Title</dt><dd>{employee.title}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Department</dt><dd>{employee.department}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Joined</dt><dd className="font-mono">{employee.joined}</dd></div>
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">M365</dt><dd className="font-mono">{employee.m365Status ?? "no sync yet"}</dd></div>
        </dl>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#D0D5DD] text-left font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#667085]">
              <th className="py-1.5 pr-3">#</th>
              <th className="py-1.5 pr-3">Asset tag</th>
              <th className="py-1.5 pr-3">Model</th>
              <th className="py-1.5 pr-3">Outcome</th>
              <th className="py-1.5 pr-3">Reason</th>
              <th className="py-1.5 pr-3 text-right">Value</th>
              <th className="py-1.5">Request</th>
            </tr>
          </thead>
          <tbody>
            {decided.map((i, n) => (
              <tr key={i.assetId} className="border-b border-[#F2F4F7]">
                <td className="py-1.5 pr-3 font-mono">{String(n + 1).padStart(2, "0")}</td>
                <td className="py-1.5 pr-3 font-mono">{i.tag}</td>
                <td className="py-1.5 pr-3">{i.model}</td>
                <td className="py-1.5 pr-3">
                  {OUTCOME_LABEL[i.decision.outcome]}
                  <span className="pl-1 font-mono text-[9.5px] text-[#667085]">{OUTCOME_STATUS[i.decision.outcome]}</span>
                </td>
                <td className="py-1.5 pr-3">{i.decision.reason ?? "—"}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{i.costLabel}</td>
                <td className="py-1.5 font-mono text-[10px]">
                  {i.decision.refNo} ·{" "}
                  {/* EXECUTED and PENDING/EXECUTION_FAILED share this column's
                      one muted weight otherwise, and a state this small must not
                      rely on the reader parsing the word under it — the sheet
                      must not read as "returned" when the return has not moved */}
                  <span className={i.decision.state === "EXECUTED" ? undefined : "font-semibold"}>
                    {i.decision.state}
                  </span>
                </td>
              </tr>
            ))}
            {decided.length === 0 && (
              <tr><td colSpan={7} className="py-3 text-center text-[#667085]">No equipment decisions were recorded.</td></tr>
            )}
          </tbody>
        </table>

        {/* These three totals count DECIDED items, not completed movements —
            a PENDING or EXECUTION_FAILED return is already in `recovered`
            because the decision was made, not because equipment moved. The
            Request column's state is what discloses whether one has actually
            executed; do not read these figures as a settled ledger. */}
        <dl className="grid grid-cols-3 gap-6 border-t border-[#D0D5DD] pt-4 text-[12px]">
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[#667085]">Recovered</dt>
            <dd className="font-mono text-[15px] font-semibold">{fmtMoney(totals.recovered)}</dd>
            <dd className="text-[10.5px] text-[#667085]">
              {totals.counts.RETURNED} returned · {totals.counts.DEFECTIVE} defective — back in the fleet as each request executes
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[#667085]">Bought out</dt>
            <dd className="font-mono text-[15px] font-semibold">{fmtMoney(totals.boughtOut)}</dd>
            <dd className="text-[10.5px] text-[#667085]">{totals.counts.BUYOUT} item(s) the employee pays for</dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-[#667085]">Value lost</dt>
            <dd className="font-mono text-[15px] font-semibold">{fmtMoney(totals.lost)}</dd>
            <dd className="text-[10.5px] text-[#667085]">{totals.counts.MISSING} item(s) missing — custody lost</dd>
            {/* "₱0 · 1 item missing" would invite the reading that the loss was
                zero; an item with no cost on record has an unknown loss, not none */}
            {decided.some((i) => i.decision.outcome === "MISSING" && i.cost === null) && (
              <dd className="text-[10.5px] text-[#667085]">
                {decided.filter((i) => i.decision.outcome === "MISSING" && i.cost === null).length} of them
                {" "}have no cost on record — that loss is unknown, not zero
              </dd>
            )}
          </div>
        </dl>

        {/* Acknowledgement copy is placeholder-final: flagged for HR review (handover open item). */}
        <p className="text-[12px] leading-relaxed text-[#475467]">
          This report records the equipment outcomes for the separation above, generated from the
          approval trail rather than typed. Items marked returned or defective are back in company
          custody; items marked buyout were purchased by the employee; items marked missing remain
          unaccounted for and stay open for investigation. Replacement cost for unreturned or
          negligently damaged items may be recovered as permitted by law and company policy.
        </p>

        {/* The sentence above speaks in the present tense about custody, but a
            decision and a movement are not the same event — the totals count
            the former. Rather than rewrite copy that is pending HR review, the
            distinction is disclosed here, next to the column that carries it. */}
        <p className="text-[11px] leading-relaxed text-[#667085]">
          Each row&apos;s <span className="font-mono">Request</span> column carries the approval that
          records the decision and its state. A request that has not reached{" "}
          <span className="font-mono">EXECUTED</span> has been decided but has not yet moved the
          asset, and its state is shown in bold above.
        </p>

        <div className="grid grid-cols-2 gap-10 pt-6">
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">{employee.name}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">employee signature · date</p>
          </div>
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">Backroom IT</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">released by · date</p>
          </div>
        </div>

        {/* #98A2B3 measured 2.57:1 on white — SERIOUS under axe, caught on a
            route no spec scanned before this sweep. #667085 is the same
            "quietest compliant tier" already used for every other muted line
            on this printed sheet (dt labels, table header, empty state) —
            there is no lighter shade of it that still clears 4.5:1. */}
        <p className="font-mono text-[8.5px] text-[#667085]">
          {employee.employeeNo} · {decided.length} decision(s) · the HR email is a future handoff, not yet built
        </p>
      </div>
    </div>
  );
}
