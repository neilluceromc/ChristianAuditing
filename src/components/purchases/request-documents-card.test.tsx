import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Markup tests never press a button: the router, the toast and the server actions are stand-ins.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/server/modules/purchases/document-actions", () => ({
  uploadPoDocument: vi.fn(), replacePoDocument: vi.fn(), removePoDocument: vi.fn(),
}));

import { RequestDocumentsCard, type RequestDocumentRow } from "./request-documents-card";

/*
 * PO form redesign (spec §2.8, §5b.1): the PO page's documents — the form's four slots, stored straight away
 * (Replace adds the newest of the kind, Remove marks it superseded), then "Other documents": the quotation,
 * purchase-order and other kinds, in today's upload table.
 */

const row = (id: string, kind: string, fileName: string, uploadedBy: string | null = "Ana Cruz"): RequestDocumentRow => ({
  id, kind, fileName, uploadedBy, uploadedAt: "2026-10-22T01:41:00.000Z", downloadHref: `/purchases/po1/documents/${id}/download`,
});
// newest first, as getPurchase lists them
const docs = [
  row("d4", "invoice", "si-new.jpg"),
  row("d3", "quotation", "quote.pdf"),
  row("d2", "invoice", "si-old.pdf"),
  row("d1", "warranty-slip", "warranty.pdf", null),
];
const render = (extra: Partial<Parameters<typeof RequestDocumentsCard>[0]> = {}) =>
  renderToStaticMarkup(<RequestDocumentsCard requestId="po1" docs={docs} canUpload invoiceRequired si="44511" {...extra} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("RequestDocumentsCard (the PO page)", () => {
  it("the four slots show the newest document of each kind, with Preview, Replace and Remove", () => {
    const html = render();
    const t = text(html);
    expect(t).toContain("si-new.jpg Uploaded 22 Oct 2026 09:41 · Ana Cruz");
    // nobody uploaded it (a system or imported row): the time alone
    expect(t).toContain("warranty.pdf Uploaded 22 Oct 2026 09:41 Preview");
    expect(t).not.toMatch(/system|Unknown/);
    // the thumbnail is the stored image, inline; Preview opens the dialog, never a new tab
    expect(html).toMatch(/<img[^>]*src="\/purchases\/po1\/documents\/d4\/download\?inline=1"/);
    expect(html).toMatch(/<button[^>]*><span[^>]*>Preview<span class="sr-only"> si-new.jpg<\/span><\/span><\/button>/);
    expect(html).toMatch(/<button[^>]*><span[^>]*>Preview<span class="sr-only"> warranty.pdf<\/span><\/span><\/button>/);
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('aria-label="Remove sales invoice"');
    expect(html).toContain('aria-label="Remove warranty slip"');
    // the empty two are drop zones with their hints
    expect(t).toContain("Official receipt Optional Add it when it arrives.");
    expect(t).toContain("Delivery receipt Optional If the vendor gave one.");
    expect(t).toContain("2 of 4 attached");
    const inputs = [...html.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
    expect(inputs.filter((i) => i.includes('accept=".pdf,.png,.jpg,.jpeg"'))).toHaveLength(inputs.length);
  });

  it("Other documents: the other kinds and the earlier copies, with today's upload for quotation, purchase order and other", () => {
    const html = render();
    const other = html.slice(html.indexOf("Other documents"));
    const t = text(other);
    expect(t).toContain("Quotation quote.pdf Ana Cruz 22 Oct 2026 09:41");
    expect(t).toContain("Sales invoice · earlier si-old.pdf Ana Cruz 22 Oct 2026 09:41");
    expect(other).toMatch(/<button[^>]*>Preview<span class="sr-only"> quote.pdf<\/span><\/button>/);
    expect(other).toMatch(/<button[^>]*>Preview<span class="sr-only"> si-old.pdf<\/span><\/button>/);
    expect(t).not.toContain("si-new.jpg");
    const options = [...other.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(options).toEqual(["quotation", "purchase-order", "other"]);
    expect(other).toContain('aria-label="Document kind"');
    expect(other).toContain('aria-label="Document file"');
  });

  it("a slot document with no upload time: no empty line under its name", () => {
    const html = render({ docs: [{ ...row("d9", "invoice", "si.pdf"), uploadedAt: "" }] });
    expect(html).not.toMatch(/<span[^>]*title=""[^>]*><\/span>/);
    expect(html).not.toContain("Uploaded");
  });

  it("an empty sales invoice slot is Required on a PO from the new form, and names the SI number", () => {
    const t = text(render({ docs: [] }));
    expect(t).toContain("Sales invoice Required The page with № 44511.");
    expect(t).toContain("No other documents.");
    expect(text(render({ docs: [], invoiceRequired: false }))).toContain("Sales invoice Optional");
  });

  it("read-only (a viewer, a cancelled PO): no drop zones, no Replace or Remove, no upload", () => {
    const html = render({ canUpload: false });
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Remove sales invoice");
    expect(html).not.toMatch(/>Replace</);
    expect(text(html).match(/Not attached/g)).toHaveLength(2);
    expect(html).toMatch(/<button[^>]*><span[^>]*>Preview<span class="sr-only"> si-new.jpg<\/span><\/span><\/button>/); // Preview still works
    expect(html).toContain('href="/purchases/po1/documents/d3/download"'); // and Download
  });
});
