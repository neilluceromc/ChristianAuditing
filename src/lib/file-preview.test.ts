import { describe, expect, it } from "vitest";
import { previewKindOf, uploadedLine } from "./file-preview";

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
