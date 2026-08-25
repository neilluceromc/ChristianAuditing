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
            {/*
              row.first used to drop these three cells to opacity-40 on the
              repeat rows of a multi-field entry, purely to de-emphasize the
              duplicate timestamp/actor/action. axe's color-contrast rule
              caught it as a SERIOUS violation (1.71–1.93:1 against the
              required 4.5:1) on a route no other spec scanned — and there is
              no headroom to fix it with a lighter compliant token instead:
              --text-muted/--text-faint are already the palette's dimmest
              tier that still clears 4.5:1 on this background (see the
              tiering note in globals.css), so any opacity on top of them
              fails. Rendering at full contrast on every row is the fix,
              not a lighter shade of the same idea.
            */}
            <Td mono>{fmtDate(row.at)}</Td>
            <Td>{row.actor}</Td>
            <Td mono className="text-[10.5px]">{row.action}</Td>
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
