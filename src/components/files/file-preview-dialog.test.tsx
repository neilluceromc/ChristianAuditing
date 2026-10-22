import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The real Dialog portals into document.body after mount, which a node markup render never reaches. This stand-in
 * renders what it is given in place, so the markup the Preview dialog hands it can be read.
 */
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, title, description, headerActions, children, size }: {
    open: boolean; title: string; description?: React.ReactNode; headerActions?: React.ReactNode; children: React.ReactNode; size?: string;
  }) => (open ? (
    <div role="dialog" aria-label={title} data-size={size}>
      <h2>{title}</h2>
      <section data-part="description">{description}</section>
      <section data-part="actions">{headerActions}</section>
      <section data-part="body">{children}</section>
    </div>
  ) : null),
}));

import { FilePreviewDialog, HeldPreviewButton, PreviewButton } from "./file-preview-dialog";

const base = {
  fileName: "si-44511.pdf",
  href: "/purchases/po1/documents/d1/download",
  inlineHref: "/purchases/po1/documents/d1/download?inline=1",
  uploadedAt: "2026-10-22T01:41:00.000Z",
  uploadedBy: "A. Reyes",
};
const render = (extra: Partial<Parameters<typeof FilePreviewDialog>[0]> = {}) =>
  renderToStaticMarkup(<FilePreviewDialog open onClose={() => {}} {...base} {...extra} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const part = (html: string, name: string) => html.match(new RegExp(`<section data-part="${name}">(.*?)</section>`, "s"))?.[1] ?? "";

describe("FilePreviewDialog", () => {
  it("closed: nothing", () => {
    expect(render({ open: false })).toBe("");
  });

  it("a PDF: a viewer-sized dialog named by the file title, the PDF in a frame titled with the file name", () => {
    const html = render({ title: "Sales invoice" });
    expect(html).toContain('aria-label="Sales invoice"');
    expect(html).toContain('data-size="viewer"');
    expect(html).toMatch(/<iframe[^>]*title="si-44511.pdf"[^>]*src="\/purchases\/po1\/documents\/d1\/download\?inline=1"/);
    expect(html).not.toContain("<img");
  });

  it("the header: the file name under its title, then Uploaded <date time> · <name>", () => {
    const t = text(part(render({ title: "Sales invoice" }), "description"));
    expect(t).toContain("si-44511.pdf");
    expect(t).toContain("Uploaded 22 Oct 2026 09:41 · A. Reyes");
  });

  it("no title: the file name names the dialog and is not said twice", () => {
    const html = render();
    expect(html).toContain('aria-label="si-44511.pdf"');
    expect(text(part(html, "description")).trim()).toBe("Uploaded 22 Oct 2026 09:41 · A. Reyes");
  });

  it("no uploader: the time alone", () => {
    expect(text(render({ uploadedBy: null }))).toContain("Uploaded 22 Oct 2026 09:41");
    expect(text(render({ uploadedBy: null }))).not.toContain("·");
  });

  it("a note replaces the uploaded line (a file held on the form)", () => {
    const t = text(render({ note: "Not saved yet" }));
    expect(t).toContain("Not saved yet");
    expect(t).not.toContain("Uploaded");
  });

  it("Open in new tab, Download and Close", () => {
    const actions = part(render(), "actions");
    expect(actions).toMatch(/<a [^>]*href="\/purchases\/po1\/documents\/d1\/download\?inline=1"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Open in new tab<\/a>/);
    expect(actions).toMatch(/<a [^>]*href="\/purchases\/po1\/documents\/d1\/download"[^>]*>Download<\/a>/);
    expect(actions).toMatch(/<button[^>]*><span[^>]*>Close<\/span><\/button>/);
  });

  it("a PNG or JPG: an image with the file name as its alt text, fitted (object-contain) on a neutral surface", () => {
    const html = render({ fileName: "IMG_2041.JPG", href: "/x/download", inlineHref: "/x/download?inline=1" });
    expect(html).toMatch(/<img[^>]*src="\/x\/download\?inline=1"[^>]*alt="IMG_2041.JPG"/);
    expect(html).toMatch(/<img[^>]*class="[^"]*object-contain/);
    expect(html).not.toContain("<iframe");
  });

  it("another type: This file type can't be shown here, and Download (no Open in new tab)", () => {
    const html = render({ fileName: "quote.docx", href: "/x/download", inlineHref: "/x/download?inline=1" });
    expect(text(html)).toContain("This file type can&#x27;t be shown here");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Open in new tab");
    expect(html.match(/<a [^>]*href="\/x\/download"[^>]*>Download<\/a>/g)).toHaveLength(1);
  });

  it("a held file's object URL downloads under its own name", () => {
    const html = render({ href: "blob:http://localhost/1", inlineHref: "blob:http://localhost/1" });
    expect(html).toMatch(/<a [^>]*href="blob:http:\/\/localhost\/1"[^>]*download="si-44511.pdf"[^>]*>Download<\/a>/);
  });
});

describe("PreviewButton", () => {
  it("closed: a Preview button that names its file for a screen reader, and no dialog", () => {
    const html = renderToStaticMarkup(<PreviewButton {...base} />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>.*Preview<span class="sr-only"> si-44511.pdf<\/span>/);
    expect(html).not.toContain('role="dialog"');
  });

  it("a custom label (a file name that opens its own preview) is used as is", () => {
    const html = renderToStaticMarkup(<PreviewButton {...base} label="si-44511.pdf" plain className="text-accent" />);
    expect(html).toMatch(/<button type="button" class="text-accent"[^>]*>si-44511.pdf<\/button>/);
  });
});

describe("HeldPreviewButton", () => {
  it("closed: a Preview button; no object URL is made until it opens", () => {
    const spy = vi.spyOn(URL, "createObjectURL");
    const html = renderToStaticMarkup(<HeldPreviewButton file={new File([new Uint8Array(3)], "si.pdf", { type: "application/pdf" })} />);
    expect(html).toContain("Preview");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
