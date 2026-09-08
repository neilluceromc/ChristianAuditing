import Link from "next/link";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { CONTRACT_STATUS_LABEL } from "@/lib/supplier-schema";
import { fmtDate } from "@/lib/format";
import type { SupplierRow } from "@/server/modules/suppliers/queries";

export function SuppliersTable({ rows }: { rows: SupplierRow[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Name</Th>
          <Th>Category</Th>
          <Th>Contact</Th>
          <Th>Contract</Th>
          <Th align="right">Requests</Th>
          <Th align="right">Assets</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((s) => {
          const contact = [s.contactPerson, s.phone, s.email].filter(Boolean).join(" · ");
          return (
            <Tr key={s.id}>
              <Td>
                <div className="flex flex-col gap-0.5 py-1">
                  <span className="inline-flex items-center gap-2">
                    <Link href={`/purchases/suppliers/${s.id}`} className="text-accent hover:underline">
                      {s.name}
                    </Link>
                    {s.archived && <Pill>ARCHIVED</Pill>}
                  </span>
                  {s.registeredName && <span className="text-[11px] text-fg-muted">{s.registeredName}</span>}
                </div>
              </Td>
              <Td>{s.category ?? "—"}</Td>
              <Td>{contact || "—"}</Td>
              <Td>
                <div className="flex flex-col gap-0.5 py-1">
                  <Pill tone={s.contractStatus === "ACTIVE" ? "accent" : "neutral"}>
                    {CONTRACT_STATUS_LABEL[s.contractStatus]}
                  </Pill>
                  {s.contractEnd && <span className="text-[11px] text-fg-muted">{fmtDate(s.contractEnd)}</span>}
                </div>
              </Td>
              <Td align="right" mono>{s.requests}</Td>
              <Td align="right" mono>{s.assets}</Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
