import { describe, expect, it } from "vitest";
import { frameLoadFailed, previewKindOf, uploadedLine } from "./file-preview";

describe("uploadedLine", () => {
  it("the time to the minute (Manila) and the uploader's name", () => {
    expect(uploadedLine("2026-10-22T01:41:00.000Z", "A. Reyes")).toBe("Uploaded 22 Oct 2026 09:41 · A. Reyes");
  });
  it("no uploader (a system or imported row): the time alone, never a stand-in name", () => {
    expect(uploadedLine("2026-10-22T01:41:00.000Z", null)).toBe("Uploaded 22 Oct 2026 09:41");
    expect(uploadedLine("2026-10-22T01:41:00.000Z", undefined)).toBe("Uploaded 22 Oct 2026 09:41");
    expect(uploadedLine("2026-10-22T01:41:00.000Z", "  ")).toBe("Uploaded 22 Oct 2026 09:41");
  });
  it("takes a Date too", () => {
    expect(uploadedLine(new Date("2026-10-22T01:41:00.000Z"), "A. Reyes")).toBe("Uploaded 22 Oct 2026 09:41 · A. Reyes");
  });
  it("no date: no line at all", () => {
    expect(uploadedLine(null, "A. Reyes")).toBeNull();
    expect(uploadedLine(undefined, null)).toBeNull();
    expect(uploadedLine("", null)).toBeNull();
  });
});

describe("previewKindOf", () => {
  it("a PDF in a frame, a PNG or JPG as an image, any case", () => {
    expect(previewKindOf("invoice.pdf")).toBe("pdf");
    expect(previewKindOf("INVOICE.PDF")).toBe("pdf");
    expect(previewKindOf("photo.png")).toBe("image");
    expect(previewKindOf("IMG_2041.JPG")).toBe("image");
    expect(previewKindOf("scan.jpeg")).toBe("image");
  });
  it("anything else is not shown in place", () => {
    expect(previewKindOf("quote.docx")).toBeNull();
    expect(previewKindOf("noext")).toBeNull();
    expect(previewKindOf(".pdf")).toBeNull(); // a dotfile, as the route sees it
    expect(previewKindOf("page.svg")).toBeNull();
  });
});

describe("frameLoadFailed: whether the Preview's frame shows the file's failure instead of the file", () => {
  const path = "/purchases/po1/documents/d1/download";
  it("the route's own 404 (a plain-text body at the inline URL): failed", () => {
    expect(frameLoadFailed({ contentType: "text/plain", pathname: path }, path)).toBe(true);
  });
  it("a PDF that loaded (Chrome, Safari: an application/pdf document): not failed", () => {
    expect(frameLoadFailed({ contentType: "application/pdf", pathname: path }, path)).toBe(false);
  });
  it("a frame that can't be read (Firefox's pdf.js viewer is cross-origin; any cross-origin frame): not failed", () => {
    expect(frameLoadFailed(null, path)).toBe(false);
    expect(frameLoadFailed({ contentType: null, pathname: null }, path)).toBe(false);
  });
  it("an HTML document still at the file's own path (a viewer page): not failed", () => {
    expect(frameLoadFailed({ contentType: "text/html", pathname: path }, path)).toBe(false);
  });
  it("the frame went somewhere else (a sign-in redirect): failed", () => {
    expect(frameLoadFailed({ contentType: "text/html", pathname: "/login" }, path)).toBe(true);
    expect(frameLoadFailed({ contentType: null, pathname: "/login" }, path)).toBe(true);
  });
  it("no path to compare (a held file's object URL cannot redirect): only the plain-text check applies", () => {
    expect(frameLoadFailed({ contentType: "application/pdf", pathname: "http://localhost/uuid" }, null)).toBe(false);
    expect(frameLoadFailed({ contentType: "text/plain", pathname: "http://localhost/uuid" }, null)).toBe(true);
  });
});
