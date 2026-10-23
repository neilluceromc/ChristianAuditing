"use client";

import { DocumentsTable } from "@/components/files/documents-table";
import { SUPPLIER_DOCUMENT_KINDS, SUPPLIER_DOCUMENT_LABEL } from "@/lib/documents";
import type { SupplierDocumentRow } from "./supplier-documents-card";

type SupplierDocKind = (typeof SUPPLIER_DOCUMENT_KINDS)[number];

/** The row half of supplier-documents-card.tsx, split out to keep that file under the 120-line guideline (mirrors bank-accounts-table.tsx). */
export function SupplierDocumentsTable({ docs }: { docs: SupplierDocumentRow[] }) {
  if (docs.length === 0) {
    return <p className="py-2 text-center text-xs text-fg-muted">No documents on file for this vendor.</p>;
  }
  return <DocumentsTable rows={docs.map((d) => ({ ...d, label: SUPPLIER_DOCUMENT_LABEL[d.kind as SupplierDocKind] ?? d.kind }))} />;
}
