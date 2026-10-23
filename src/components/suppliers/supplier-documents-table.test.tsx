import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SupplierDocumentsTable } from "./supplier-documents-table";
import type { SupplierDocumentRow } from "./supplier-documents-card";

const row = (over: Partial<SupplierDocumentRow> = {}): SupplierDocumentRow => ({
  id: "v1", kind: "certificate", fileName: "2303.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ana Cruz",
  downloadHref: "/purchases/suppliers/s1/documents/v1/download", ...over,
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("SupplierDocumentsTable (a vendor's documents)", () => {
  it("each row: the kind's words, the file, its uploader and upload time to the minute, Preview and Download", () => {
    const html = renderToStaticMarkup(<SupplierDocumentsTable docs={[row()]} />);
    expect(text(html)).toContain("Certificate 2303.pdf Ana Cruz 22 Oct 2026 09:41");
    expect(html).not.toContain(">certificate<");
    expect(html).toMatch(/<button[^>]*>Preview<span class="sr-only"> 2303.pdf<\/span><\/button>/);
    expect(html).toMatch(/<a href="\/purchases\/suppliers\/s1\/documents\/v1\/download"[^>]*>Download<\/a>/);
  });

  it("no uploader: a dash, not \"system\"", () => {
    const t = text(renderToStaticMarkup(<SupplierDocumentsTable docs={[row({ uploadedBy: null })]} />));
    expect(t).toContain("2303.pdf — 22 Oct 2026 09:41");
    expect(t).not.toContain("system");
  });

  it("none: the empty line", () => {
    expect(renderToStaticMarkup(<SupplierDocumentsTable docs={[]} />)).toContain("No documents on file for this vendor.");
  });
});
