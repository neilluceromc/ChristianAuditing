import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getAsset } from "@/server/modules/inventory/queries";
import { historyRows } from "@/lib/history";
import { fmtDate } from "@/lib/format";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AssetHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAsset(id);
  if (!asset) notFound();
  const entries = await prisma.auditEntry.findMany({
    where: { entityType: "asset", entityId: id },
    orderBy: { createdAt: "desc" },
  });
  const rows = historyRows(entries);

  if (rows.length === 0) {
    return <EmptyState title="No changes recorded" description="Every field change lands here, one row per field." />;
  }

  return (
    <Table>
      <THead>
        <Tr>
          <Th width={130}>When</Th>
          <Th width={140}>Actor</Th>
          <Th width={130}>Action</Th>
          <Th width={120}>Field</Th>
          <Th>Change</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td mono className={row.first ? "" : "opacity-40"}>{fmtDate(row.at)}</Td>
            <Td className={row.first ? "" : "opacity-40"}>{row.actor}</Td>
            <Td mono className={row.first ? "text-[10.5px]" : "text-[10.5px] opacity-40"}>{row.action}</Td>
            <Td mono>{row.field}</Td>
            <Td>
              <span className="font-mono text-xs">
                <span className="text-fg-faint line-through decoration-[1px]">{row.from}</span>
                <span aria-hidden className="px-1.5 text-fg-faint">→</span>
                <span className="text-accent">{row.to}</span>
              </span>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
