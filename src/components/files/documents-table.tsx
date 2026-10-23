import { fmtDateTime } from "@/lib/format";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { PreviewButton } from "./file-preview-dialog";

/** One listed file: what it is, its name, when (ISO) and by whom it was uploaded, and its download route. */
export interface DocumentsTableRow {
  id: string;
  /** The kind's words ("Quotation", "Sales invoice · earlier"). */
  label: string;
  fileName: string;
  uploadedAt: string;
  /** Null for a row nobody uploaded (a system or imported row): the column shows a dash. */
  uploadedBy: string | null;
  downloadHref: string;
}

/**
 * The plain documents table (a PO's other documents, a direct registration's documents in Finance review, a vendor's
 * documents): kind, file, uploader, the upload time to the minute, then Preview (the dialog) and Download.
 */
export function DocumentsTable({ rows }: { rows: DocumentsTableRow[] }) {
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Kind</Th>
          <Th>File</Th>
          <Th>Uploaded by</Th>
          <Th>Date</Th>
          <Th aria-label="Preview and download" />
        </Tr>
      </THead>
      <TBody>
        {rows.map((d) => (
          <Tr key={d.id}>
            <Td>{d.label}</Td>
            <Td><span className="block max-w-[16rem] truncate" title={d.fileName}>{d.fileName}</span></Td>
            <Td>{d.uploadedBy ?? "—"}</Td>
            <Td mono>{fmtDateTime(d.uploadedAt)}</Td>
            <Td align="right">
              <span className="inline-flex items-center gap-3 whitespace-nowrap">
                <PreviewButton
                  plain className="text-accent hover:underline"
                  title={d.label} fileName={d.fileName} href={d.downloadHref} inlineHref={`${d.downloadHref}?inline=1`}
                  uploadedAt={d.uploadedAt} uploadedBy={d.uploadedBy}
                />
                <a href={d.downloadHref} className="text-accent hover:underline">Download</a>
              </span>
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
