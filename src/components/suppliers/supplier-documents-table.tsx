"use client";

import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { SUPPLIER_DOCUMENT_KINDS, SUPPLIER_DOCUMENT_LABEL } from "@/lib/documents";
import type { SupplierDocumentRow } from "./supplier-documents-card";

type SupplierDocKind = (typeof SUPPLIER_DOCUMENT_KINDS)[number];

/** The row half of supplier-documents-card.tsx, split out to keep that file under the 120-line guideline (mirrors bank-accounts-table.tsx). */
export function SupplierDocumentsTable({ docs }: { docs: SupplierDocumentRow[] }) {
  if (docs.length === 0) {
    return <p className="py-2 text-center text-xs text-fg-muted">No documents on file for this supplier.</p>;
  }
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Kind</Th>
          <Th>File</Th>
          <Th>Uploaded by</Th>
          <Th>Date</Th>
          <Th aria-label="Download" />
        </Tr>
      </THead>
      <TBody>
        {docs.map((d) => (
          <Tr key={d.id}>
            <Td>{SUPPLIER_DOCUMENT_LABEL[d.kind as SupplierDocKind] ?? d.kind}</Td>
            <Td>{d.fileName}</Td>
            <Td>{d.uploadedBy}</Td>
            <Td mono>{d.at}</Td>
            <Td align="right"><a href={d.downloadHref} className="text-accent hover:underline">Download</a></Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
