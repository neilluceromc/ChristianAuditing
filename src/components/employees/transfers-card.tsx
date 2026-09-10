import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import type { getTransfers } from "@/server/modules/employees/queries";

/**
 * Phase 20 (spec §3, plan P-2): every transfer this person has ever had,
 * newest first — the same `getTransfers` read the employee page's own
 * "Transferred from X on Y" line uses, so the two never disagree. Server
 * component (no client state) — the page hands it the rows it already
 * fetched rather than this card querying a second time.
 */
export function TransfersCard({ transfers }: { transfers: Awaited<ReturnType<typeof getTransfers>> }) {
  return (
    <Card>
      <CardHeader title="Transfers" />
      <CardBody className="flex flex-col gap-3">
        {transfers.length === 0 ? (
          <p className="text-xs text-fg-muted">No transfers on record.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {transfers.map((t) => (
              <li key={t.id} className="flex flex-col gap-0.5 text-xs text-fg-secondary">
                <span>
                  <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(t.effectiveAt)}</span>
                  {" · "}
                  {t.from} → {t.to}
                  {t.fromTitle !== t.toTitle && (
                    <span className="text-fg-muted"> · {t.fromTitle} → {t.toTitle}</span>
                  )}
                </span>
                {t.reason && <span className="text-[11px] text-fg-muted">{t.reason}</span>}
                <span className="font-mono text-[10.5px] text-fg-faint">by {t.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
