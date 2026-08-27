import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { fmtDate } from "@/lib/format";
import { PrintButton } from "@/components/ui/print-button";

const STRIPES = "repeating-linear-gradient(135deg, #EEF1F5 0 6px, #F7F9FB 6px 12px)";

export default async function AccountabilityFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { department: true, assets: { orderBy: { tag: "asc" } } },
  });
  if (!employee) notFound();

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex justify-end pb-3 print:hidden">
        <PrintButton />
      </div>
      {/* The sheet is deliberately light-theme-only: it's a printed artifact. */}
      <div className="flex flex-col gap-6 rounded-(--radius-card) border border-border bg-white p-8 text-[#101828] shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-center justify-between border-b-2 border-[#101828] pb-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-6 place-items-center bg-[#101828] font-mono text-[11px] font-bold text-white">BR</span>
            <div>
              <p className="text-[15px] font-semibold">Backroom IT — Equipment accountability form</p>
              <p className="font-mono text-[10px] text-[#667085]">generated {fmtDate(new Date())} · from live records</p>
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
          <div className="flex gap-2"><dt className="w-24 text-[#667085]">Department</dt><dd>{employee.department.name}</dd></div>
        </dl>

        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-[#D0D5DD] text-left font-mono text-[9.5px] uppercase tracking-[0.06em] text-[#667085]">
              <th className="py-1.5 pr-3">#</th>
              <th className="py-1.5 pr-3">Asset tag</th>
              <th className="py-1.5 pr-3">Model</th>
              <th className="py-1.5 pr-3">Serial</th>
              <th className="py-1.5">Issued</th>
            </tr>
          </thead>
          <tbody>
            {employee.assets.map((a, i) => (
              <tr key={a.id} className="border-b border-[#F2F4F7]">
                <td className="py-1.5 pr-3 font-mono">{String(i + 1).padStart(2, "0")}</td>
                <td className="py-1.5 pr-3 font-mono">{a.tag}</td>
                <td className="py-1.5 pr-3">{a.model}</td>
                <td className="py-1.5 pr-3 font-mono">{a.serial ?? "—"}</td>
                <td className="py-1.5 font-mono">{fmtDate(a.purchasedAt)}</td>
              </tr>
            ))}
            {employee.assets.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-center text-[#667085]">No equipment currently issued.</td></tr>
            )}
          </tbody>
        </table>

        {/* Acknowledgement copy is placeholder-final: flagged for HR review (handover open item). */}
        <p className="text-[12px] leading-relaxed text-[#475467]">
          I acknowledge receipt of the equipment listed above, issued for the performance of my duties.
          I agree to keep it in good working condition, to report loss, theft or damage within one
          business day, and to return every item on request or upon separation. Replacement cost for
          unreturned or negligently damaged items may be recovered as permitted by law and company policy.
        </p>

        <div className="grid grid-cols-2 gap-10 pt-6">
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">{employee.name}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">employee signature · date</p>
          </div>
          <div className="border-t border-[#101828] pt-1.5">
            <p className="text-[11px] font-medium">Backroom IT</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-[#667085]">issued by · date</p>
          </div>
        </div>

        {/* #98A2B3 measured 2.57:1 on white — SERIOUS under axe, caught on a
            route no spec scanned before this sweep. #667085 is the same
            "quietest compliant tier" already used for every other muted line
            on this printed sheet (dt labels, table header, empty state) —
            there is no lighter shade of it that still clears 4.5:1. */}
        {/* "scan the code to open this record" was removed, not reworded:
            THIS SHEET CARRIES NO CODE. It renders no barcode and no QR — the
            file imports neither — so the clause instructed an operator to scan
            something that has never been on the page. The remaining "signed
            scan" is a different sense of the word and is true: it means the
            signed paper, scanned and uploaded, which `uploadDocument` in
            src/server/modules/inventory/document-actions.ts really does.
            Putting a real code here is a separate piece of work, not a
            reword — a different sheet, a different payload and a different
            reader from the asset label's. */}
        <p className="font-mono text-[8.5px] text-[#667085]">
          {employee.employeeNo} · the signed scan uploads back into the equipment&apos;s documents
        </p>
      </div>
    </div>
  );
}
