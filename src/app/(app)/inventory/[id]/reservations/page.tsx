import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getAsset } from "@/server/modules/inventory/queries";
import { fmtDate } from "@/lib/format";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { StatusDot } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AssetReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const reservations = await prisma.reservation.findMany({
    where: { assetId: id },
    include: { employee: true },
    orderBy: { createdAt: "desc" },
  });

  if (reservations.length === 0) {
    return (
      <EmptyState
        title="No holds on this asset"
        description="Reserved stock still reads SPARE in inventory — holds only appear here and on the reservations list."
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
            <Td mono>{fmtDate(r.expiresAt)}</Td>
            <Td mono>{fmtDate(r.resolvedAt)}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
