import Link from "next/link";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { Pagination } from "@/components/ui/pagination";
import { fmtDate } from "@/lib/format";
import { MOVEMENT_KIND_LABEL } from "@/lib/stock-movement-rules";
import type { MovementRow } from "@/server/modules/stock/queries";

// P-5: Receipt and Adjustment read as accent; Opening and Issue stay neutral.
const ACCENT_KINDS = new Set(["RECEIPT", "ADJUSTMENT"]);

function detailFor(m: MovementRow): React.ReactNode {
  if (m.kind === "RECEIPT") {
    return [m.lot?.reference, m.lot?.supplier].filter(Boolean).join(" · ") || "—";
  }
  if (m.kind === "ISSUE") {
    return [m.department, m.employee].filter(Boolean).join(" · ") || "—";
  }
  if (m.kind === "ADJUSTMENT") {
    return (
      <span className="inline-flex items-center gap-1.5">
        {m.reason || "—"}
        {m.stocktake && (
          <Link href={`/stock/stocktakes/${m.stocktake.id}`} className="text-accent hover:underline">
            {m.stocktake.refNo}
          </Link>
        )}
      </span>
    );
  }
  return "—";
}

/** Signed quantity, real minus (U+2212) for a negative — never a hyphen-minus. */
function fmtQuantity(q: number): string {
  return q >= 0 ? `+${q}` : `−${Math.abs(q)}`;
}

export function MovementHistory({
  rows,
  page,
  pageCount,
}: {
  rows: MovementRow[];
  page: number;
  pageCount: number;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-fg-muted">No movements yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <THead>
          <Tr>
            <Th>Date</Th>
            <Th>Kind</Th>
            <Th align="right">Quantity</Th>
            <Th>Detail</Th>
            <Th>By</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((m) => (
            <Tr key={m.id}>
              <Td mono>{fmtDate(m.occurredAt)}</Td>
              <Td>
                <Pill tone={ACCENT_KINDS.has(m.kind) ? "accent" : "neutral"}>{MOVEMENT_KIND_LABEL[m.kind]}</Pill>
              </Td>
              <Td align="right" mono>{fmtQuantity(m.quantity)}</Td>
              <Td>{detailFor(m)}</Td>
              <Td>{m.actor}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      <Pagination page={page} pageCount={pageCount} hrefFor={(p) => (p > 1 ? `?page=${p}` : "?")} />
    </div>
  );
}
