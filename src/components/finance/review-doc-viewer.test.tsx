import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewDocViewer } from "./review-doc-viewer";

/* Finance review (`?doc=<id>`): the opened document in the page, with when and by whom it was uploaded above it. */

const doc = {
  label: "Sales invoice", fileName: "si.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ana Cruz",
  downloadHref: "/purchases/po1/documents/d1/download", previewHref: "/purchases/po1/documents/d1/download?inline=1",
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("ReviewDocViewer", () => {
  it("the kind, the file, the uploaded line above the frame, then Download and Close", () => {
    const html = renderToStaticMarkup(<ReviewDocViewer doc={doc} closeHref="/finance/review/r1" />);
    expect(text(html)).toContain("Sales invoice si.pdf Uploaded 22 Oct 2026 09:41 · Ana Cruz Download");
    expect(html.indexOf("Uploaded 22 Oct")).toBeLessThan(html.indexOf("<iframe"));
    expect(html).toMatch(/<iframe[^>]*title="Preview of si.pdf"[^>]*src="\/purchases\/po1\/documents\/d1\/download\?inline=1"/);
    expect(html).toMatch(/<a [^>]*href="\/purchases\/po1\/documents\/d1\/download"[^>]*>Download<\/a>/);
    expect(html).toMatch(/href="\/finance\/review\/r1"[^>]*>Close/);
  });

  it("an image, and no uploader: the time alone", () => {
    const html = renderToStaticMarkup(
      <ReviewDocViewer doc={{ ...doc, fileName: "si.JPG", uploadedBy: null }} closeHref="/finance/review/r1" />,
    );
    expect(html).toMatch(/<img[^>]*alt="si.JPG"/);
    expect(text(html)).toContain("Uploaded 22 Oct 2026 09:41 Download");
    expect(text(html)).not.toMatch(/Unknown|system/);
  });
});
