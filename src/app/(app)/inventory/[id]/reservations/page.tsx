import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { getVisibleAsset } from "@/server/modules/inventory/queries";
import { fmtDate, localDateISO } from "@/lib/format";
import { DEFAULT_STATUS, isDirectLifecycle } from "@/lib/asset-class";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import { HoldPill } from "@/components/ui/hold-pill";
import { ReleaseHoldButton } from "@/components/inventory/release-hold-button";

export default async function AssetReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const asset = await getVisibleAsset(id, user.role);
  if (!asset) notFound();
  const reservations = await prisma.reservation.findMany({
    where: { assetId: id },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });
  const today = localDateISO(new Date());
  const canRelease = isDirectLifecycle(user.role, asset.cls);

  if (reservations.length === 0) {
    return (
      <EmptyState
        title="No holds on this asset"
        description={`Reserved stock still reads ${DEFAULT_STATUS[asset.cls]} in inventory — holds only appear here and on the reservations list.`}
      />
    );
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th width={19} aria-label="State colour" />
          <Th width={104}>State</Th>
          <Th>For</Th>
          <Th>Reason</Th>
          <Th width={110}>Expires</Th>
          <Th width={110}>Resolved</Th>
          <Th width={96}><span className="sr-only">Actions</span></Th>
        </Tr>
      </THead>
      <TBody>
        {reservations.map((r) => (
          <Tr key={r.id}>
            <Td className="pr-0"><StatusDot value={r.state} /></Td>
            <Td mono className="text-[10.5px]">{r.state}</Td>
            <Td>
              <a href={`/employees/${r.employee.id}`} className="text-accent hover:underline">
                {r.employee.name} · {r.employee.employeeNo}
              </a>
            </Td>
            <Td>{r.reason ?? "—"}</Td>
            <Td mono>
              {r.state === "ACTIVE" && r.expiresAt ? <HoldPill expiresAt={r.expiresAt} today={today} withDate /> : fmtDate(r.expiresAt)}
            </Td>
            <Td mono>{fmtDate(r.resolvedAt)}</Td>
            <Td>
              {r.state === "ACTIVE" && canRelease ? <ReleaseHoldButton reservationId={r.id} tag={asset.tag} size="sm" /> : null}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
