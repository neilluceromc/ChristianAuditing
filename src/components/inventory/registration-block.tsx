import Link from "next/link";
import type { AssetClass, Role } from "@prisma/client";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status";
import { fmtDate } from "@/lib/format";
import { REG_LABEL, registrationState, returnSummary } from "@/lib/registration";

/** Phase 35 (spec §3.1): where the asset stands in Finance's registration review, as IT and Purchasing read it. */
export function RegistrationBlock({
  asset,
  viewerRole,
}: {
  asset: {
    id: string;
    tag: string;
    cls: AssetClass;
    itVerifiedAt: Date | null;
    financeConfirmedAt: Date | null;
    financeReturnedAt: Date | null;
    financeReturnFields: string[];
    financeReturnReason: string | null;
    financeResubmitNote: string | null;
    financeNotCapitalised: boolean;
    financeReturnedBy: { name: string } | null;
    financeConfirmedBy: { name: string } | null;
  };
  viewerRole: Role;
}) {
  const state = registrationState(asset);
  const isFinance = viewerRole === "finance_staff" || viewerRole === "admin";
  const summary = state === "needs-correction" ? returnSummary(asset) : null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Registration" actions={<StatusPill value={state} label={REG_LABEL[state]} ns="registration" />} />
      <CardBody className="flex flex-col gap-2 text-xs text-fg-secondary">
        {state === "registered" && (
          <p>
            Approved by {asset.financeConfirmedBy?.name ?? "Finance"} · {fmtDate(asset.financeConfirmedAt)}
            {asset.financeNotCapitalised && " · not capitalised"}
          </p>
        )}
        {summary && (
          <div className="flex flex-col gap-1">
            {summary.items.length > 0 && (
              <div>
                <span className="font-medium">Finance flagged:</span>
                <ul className="list-disc pl-4">
                  {summary.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            {summary.note && <p>{"“"}{summary.note}{"”"}</p>}
            <p className="text-fg-muted">
              {"— "}{[asset.financeReturnedBy?.name, fmtDate(asset.financeReturnedAt)].filter(Boolean).join(", ")}
            </p>
          </div>
        )}
        {state === "with-finance" && asset.financeResubmitNote && (
          <p>Your reply: {"“"}{asset.financeResubmitNote}{"”"}</p>
        )}
        {state === "awaiting-it" && <p>Finance reviews it once IT has checked it.</p>}
        {isFinance && (
          <p>
            <Link href={`/finance/assets/${asset.id}`} className="text-accent hover:underline">Review in Finance →</Link>
          </p>
        )}
      </CardBody>
    </Card>
  );
}
