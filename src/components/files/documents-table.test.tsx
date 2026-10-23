import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentsTable, type DocumentsTableRow } from "./documents-table";

const row = (over: Partial<DocumentsTableRow> = {}): DocumentsTableRow => ({
  id: "d1", label: "Quotation", fileName: "quote.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ana Cruz",
  downloadHref: "/purchases/po1/documents/d1/download", ...over,
});
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("DocumentsTable", () => {
  it("kind, file, uploader, the upload time to the minute, then Preview and Download", () => {
    const html = renderToStaticMarkup(<DocumentsTable rows={[row()]} />);
    const t = text(html);
    expect(t).toContain("Quotation quote.pdf Ana Cruz 22 Oct 2026 09:41");
    expect(html).toMatch(/<button[^>]*>Preview<span class="sr-only"> quote.pdf<\/span><\/button>/);
    expect(html).toMatch(/<a href="\/purchases\/po1\/documents\/d1\/download"[^>]*>Download<\/a>/);
    expect(html).not.toContain("target=\"_blank\"");
  });

  it("no uploader: a dash, never a stand-in name", () => {
    const t = text(renderToStaticMarkup(<DocumentsTable rows={[row({ uploadedBy: null })]} />));
    expect(t).toContain("quote.pdf — 22 Oct 2026 09:41");
    expect(t).not.toMatch(/system|Unknown/);
  });
});
