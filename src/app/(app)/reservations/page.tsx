import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { toSearchParams } from "@/lib/url-state";
import {
  RESERVATION_TABS, listReservations, parseReservationTab,
} from "@/server/modules/reservations/queries";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const tab = parseReservationTab(toSearchParams(await searchParams).get("state"));
  const { rows, counts } = await listReservations(tab);

  return (
    <>
      <PageHeader
        title="Reservations"
        badge={user.role === "viewer" ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      />
      <div className="flex flex-col gap-3">
        <Banner tone="neutral" title="A hold never changes an asset's status">
          Reserved stock still reads <span className="font-mono">SPARE</span> in inventory, marked{" "}
          <span className="font-mono">HOLD</span> — pretending it is gone creates phantom spares. Holds
          are placed and released on the asset record.
        </Banner>

        <Tabs
          items={RESERVATION_TABS.map((t) => ({
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                <span className="font-mono text-[10px] text-fg-muted">{counts[t.id]}</span>
              </span>
            ),
            href: `/reservations?state=${t.id}`,
            active: t.id === tab,
          }))}
          className="pb-1"
        />

        {rows.length === 0 ? (
          <EmptyState
            title={tab === "ACTIVE" ? "No active holds" : "Nothing in this tab"}
            description={
              tab === "ACTIVE"
                ? "Reserve a spare from an asset record when it is promised to someone but not yet assigned."
                : "Holds land here once they are fulfilled, released or expired."
            }
          />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th width={19}><span className="sr-only">Hold state colour</span></Th>
                <Th width={104}>State</Th>
                <Th width={112}>Asset</Th>
                <Th>Model</Th>
                <Th width={96}>Reads</Th>
                <Th width={186}>For</Th>
                <Th>Reason</Th>
                <Th width={104}>Expires</Th>
                <Th width={160}>Closed</Th>
              </Tr>
            </THead>
            <TBody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="pr-0"><StatusDot value={r.state} /></Td>
                  <Td mono className="text-[10.5px]">{r.state}</Td>
                  <Td mono>
                    <Link href={`/inventory/${r.assetId}`} className="text-accent hover:underline">{r.tag}</Link>
                  </Td>
                  <Td>{r.model}</Td>
                  {/* the point of the column: the hold did not move the status */}
                  <Td mono className="text-[10.5px]">{r.assetStatus}</Td>
                  <Td>
                    <Link href={`/employees/${r.employeeId}`} className="text-accent hover:underline">
                      {r.employeeName}
                    </Link>
                    <span className="pl-1.5 font-mono text-[10.5px] text-fg-muted">{r.employeeNo}</span>
                  </Td>
                  <Td>{r.reason ?? "—"}</Td>
                  <Td mono>{r.expires}</Td>
                  <Td>
                    {r.closedBy === null ? (
                      <span className="text-fg-faint">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-muted">
                        <Icon name={r.closedBy === "clock" ? "sla" : "employee"} size={13} />
                        {r.closedBy === "clock" ? "expired" : "released"} {r.resolved}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </>
  );
}
