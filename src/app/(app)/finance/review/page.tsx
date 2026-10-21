import type { Metadata } from "next";
import Link from "next/link";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { reviewGroups } from "@/server/modules/finance/groups";
import { fmtDate, fmtMoneyExact } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button-link";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: pageTitle("To review") };

const TEAM_LABEL = { IT: "IT", PURCHASING: "Purchasing" } as const;

/**
 * Task 6 (spec §5): Finance's To review queue — one row per registration group (a PO's registered lines, or a direct
 * registration batch), oldest first, instead of one row per asset. An asset registered before groups were recorded is
 * its own row and opens its own Finance page. Finance → Assets stays for browsing.
 */
export default async function FinanceReviewPage() {
  await requireRole("admin", "finance_staff");
  const groups = await reviewGroups();
  const assets = groups.reduce((n, g) => n + g.count, 0);

  return (
    <>
      <PageHeader title="To review" />
      {groups.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing to review"
            description="When IT or Purchasing registers a purchase, it shows up here as one group to check and approve."
            actions={<ButtonLink href="/finance/assets">Browse assets</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-fg-muted">
            {groups.length} {groups.length === 1 ? "group" : "groups"} · {assets} {assets === 1 ? "asset" : "assets"} waiting
          </p>
          <Table striped>
            <THead>
              <Tr>
                <Th>Purchase order</Th>
                <Th>What</Th>
                <Th>From</Th>
                <Th align="right">Assets</Th>
                <Th align="right">Total</Th>
                <Th>Registered</Th>
              </Tr>
            </THead>
            <TBody>
              {groups.map((g) => {
                const href = g.recordId ? `/finance/review/${g.recordId}` : `/finance/assets/${g.assetId}`;
                return (
                  <Tr key={g.key}>
                    <Td mono>
                      <Link href={href} className="text-accent hover:underline">
                        {g.refNo ?? (g.recordId ? "Direct registration" : "No PO")}
                      </Link>
                    </Td>
                    <Td><span className="block max-w-[20rem] truncate" title={g.title}>{g.title}</span></Td>
                    <Td>{TEAM_LABEL[g.team]}</Td>
                    <Td align="right" mono>{g.count}</Td>
                    <Td align="right" mono>{fmtMoneyExact(Number(g.total))}</Td>
                    <Td mono>{fmtDate(g.registeredAt)}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
