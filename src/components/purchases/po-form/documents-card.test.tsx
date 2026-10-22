import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentsCard, type DocumentsCardProps } from "./documents-card";

/*
 * PO form redesign (spec §2.8): the Documents card's four slots — the sales invoice (required on a new PO), the
 * official receipt, delivery receipt and warranty slip (optional). An empty slot is a drop zone around a real file
 * input; a filled one shows the file with Preview / Replace / Remove.
 */

const props = (extra: Partial<DocumentsCardProps> = {}): DocumentsCardProps => ({
  files: {}, onFiles: () => {}, onFile: {}, si: "44511", strict: true, errors: {}, flagged: () => false, ...extra,
});
const render = (extra: Partial<DocumentsCardProps> = {}) => renderToStaticMarkup(<DocumentsCard {...props(extra)} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const button = (label: string) => new RegExp(`<button[^>]*><span[^>]*>${label}</span></button>`);
const pdf = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

describe("DocumentsCard", () => {
  it("four slots in order, each with its tag and hint", () => {
    const t = text(render());
    expect(t).toContain("Sales invoice Required The page with № 44511.");
    expect(t).toContain("Official receipt Optional Add it when it arrives.");
    expect(t).toContain("Delivery receipt Optional If the vendor gave one.");
    expect(t).toContain("Warranty slip Optional Helps IT with repairs later.");
    const order = ["Sales invoice", "Official receipt", "Delivery receipt", "Warranty slip"].map((s) => t.indexOf(s));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain("0 of 4 attached");
    expect(text(render({ si: "  " }))).toContain("The page with № —.");
  });

  it("on a legacy PO the sales invoice is optional too", () => {
    const t = text(render({ strict: false }));
    expect(t).toContain("Sales invoice Optional");
    expect(t).not.toContain("Required");
  });

  it("an empty slot is a drop zone: a real file input behind a label, taking PDF, PNG and JPG", () => {
    const html = render();
    const inputs = [...html.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input).toContain('accept=".pdf,.png,.jpg,.jpeg"');
    expect(inputs.map((i) => i.match(/aria-label="([^"]+)"/)?.[1])).toEqual([
      "Sales invoice", "Official receipt", "Delivery receipt", "Warranty slip",
    ]);
    expect(html.match(/<label[^>]*>(?:(?!<\/label>).)*?<input[^>]*type="file"/gs)).toHaveLength(4);
    expect(text(html).match(/Drop a file or browse/g)).toHaveLength(4);
  });

  it("a filled slot shows the file, its size, and Preview / Replace / Remove", () => {
    const html = render({ files: { invoice: pdf("si-44511.pdf", 812_000) } });
    const t = text(html);
    expect(t).toContain("1 of 4 attached");
    expect(t).toContain("Attached");
    expect(t).toContain("si-44511.pdf · 0.8 MB");
    expect(html).toMatch(button("Preview"));
    expect(html).toMatch(button("Replace"));
    expect(html).toContain('aria-label="Remove sales invoice"');
    // the other three are still drop zones
    expect(t.match(/Drop a file or browse/g)).toHaveLength(3);
  });

  it("an edit: the document on file previews in place and can be replaced, not removed here", () => {
    const html = render({ onFile: { invoice: { fileName: "si.pdf", href: "/purchases/po1/documents/d1/download" } } });
    expect(text(html)).toContain("si.pdf · on file");
    expect(html).toContain('href="/purchases/po1/documents/d1/download?inline=1"');
    expect(html).toMatch(button("Replace"));
    expect(html).not.toContain('aria-label="Remove sales invoice"');
    expect(text(html)).toContain("1 of 4 attached");
  });

  it("a slot's error, its mark for a failed save, and a flagged slot", () => {
    const html = render({ errors: { "doc:invoice": "Attach the sales invoice", docs: "Together the files are too big" }, flagged: (k) => k === "doc:official-receipt" });
    expect(html).toContain("Attach the sales invoice");
    expect(html).toContain("Together the files are too big");
    for (const mark of ["doc:invoice", "doc:official-receipt", "doc:delivery-receipt", "doc:warranty-slip", "docs"]) {
      expect(html, mark).toContain(`data-po-field="${mark}"`);
    }
    expect(text(html)).toContain("Flagged — check this one");
  });
});
