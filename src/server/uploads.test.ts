import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkUploadMeta, contentDisposition, fileResponse, storeUpload, UPLOAD_MAX_BYTES } from "./uploads";
import { writeObject } from "./storage";

vi.mock("./storage", () => ({ writeObject: vi.fn(async () => undefined) }));

describe("checkUploadMeta", () => {
  it("accepts pdf, png, jpg, jpeg with matching MIME", () => {
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: 10 })).toBeNull();
    expect(checkUploadMeta({ name: "a.JPG", type: "image/jpeg", size: 10 })).toBeNull();
    expect(checkUploadMeta({ name: "a.jpeg", type: "", size: 10 })).toBeNull(); // no MIME reported: extension decides
  });
  it("refuses other extensions and MIME mismatches", () => {
    expect(checkUploadMeta({ name: "a.exe", type: "application/octet-stream", size: 10 })).toBe("That type isn't allowed. Accepted: PDF, PNG, JPG.");
    expect(checkUploadMeta({ name: "a.pdf", type: "image/png", size: 10 })).toBe("That type isn't allowed. Accepted: PDF, PNG, JPG.");
  });
  it("refuses empty and oversized files", () => {
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: 0 })).toBe("Pick a file first");
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: UPLOAD_MAX_BYTES + 1 })).toBe("Too big — the cap is 4 MB");
  });
});

describe("upload cap", () => {
  it("is exactly 4_000_000 bytes: that passes, one more is refused", () => {
    expect(UPLOAD_MAX_BYTES).toBe(4_000_000);
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: 4_000_000 })).toBeNull();
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: 4_000_001 })).toBe("Too big — the cap is 4 MB");
  });
});

describe("contentDisposition (ruling R11)", () => {
  it("strips quotes from the ascii filename", () => {
    expect(contentDisposition('quote"scan.pdf')).toContain('filename="quotescan.pdf"');
  });
  it("replaces non-Latin-1-safe characters with _ in the ascii name, and carries the real name in filename*", () => {
    const header = contentDisposition("résumé 收据.pdf");
    expect(header).toContain('filename="r_sum_ __.pdf"');
    expect(header).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%E6%94%B6%E6%8D%AE.pdf");
  });
  it("never lets CR/LF into the header value", () => {
    const header = contentDisposition("evil\r\nX-Injected: yes.pdf");
    expect(header).not.toMatch(/[\r\n]/);
  });
});

describe("fileResponse: every download route's response", () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const req = (qs = "") => new Request(`http://localhost/x/documents/d1/download${qs}`);

  it("?inline=1 on a PDF: inline, application/pdf, the bytes as the body", async () => {
    const res = fileResponse(bytes, "invoice.pdf", req("?inline=1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="invoice\.pdf"/);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("?inline=1 on an upper-case .JPG: inline, image/jpeg", () => {
    const res = fileResponse(bytes, "IMG_2041.JPG", req("?inline=1"));
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="IMG_2041\.JPG"/);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("?inline=1 on a .docx still downloads, as application/octet-stream", () => {
    const res = fileResponse(bytes, "quote.docx", req("?inline=1"));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="quote\.docx"/);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("without inline (or with any value but 1) a PDF is an attachment", () => {
    expect(fileResponse(bytes, "invoice.pdf", req()).headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(fileResponse(bytes, "invoice.pdf", req("?inline=true")).headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(fileResponse(bytes, "invoice.pdf", req("?inline=0")).headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("always sends nosniff, inline or not, previewable or not", () => {
    for (const [name, qs] of [["invoice.pdf", "?inline=1"], ["invoice.pdf", ""], ["quote.docx", "?inline=1"], ["noext", ""]]) {
      expect(fileResponse(bytes, name, req(qs)).headers.get("x-content-type-options"), `${name}${qs}`).toBe("nosniff");
    }
  });

  it("a non-Latin-1 name goes through contentDisposition: an ASCII fallback plus filename*", () => {
    const res = fileResponse(bytes, "résumé 收据.pdf", req("?inline=1"));
    expect(res.headers.get("content-disposition")).toBe(contentDisposition("résumé 收据.pdf", "inline"));
    expect(res.headers.get("content-disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%E6%94%B6%E6%8D%AE.pdf");
  });
});

describe("storeUpload", () => {
  beforeEach(() => vi.mocked(writeObject).mockClear());

  it.each([
    ["scan.pdf", "application/pdf"],
    ["scan.png", "image/png"],
    ["scan.jpg", "image/jpeg"],
    ["scan.JPEG", "image/jpeg"],
  ])("hands %s to writeObject as %s", async (name, type) => {
    const out = await storeUpload("lots/1", new File([new Uint8Array([1, 2, 3])], name));
    expect(writeObject).toHaveBeenCalledTimes(1);
    const [relPath, bytes, contentType] = vi.mocked(writeObject).mock.calls[0];
    expect(relPath).toBe(out.relPath);
    expect(relPath).toMatch(/^lots\/1\/\d+-scan\./);
    expect(Buffer.from(bytes).equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(contentType).toBe(type);
  });

  it("returns the byte length as size", async () => {
    const out = await storeUpload("lots/1", new File([new Uint8Array([1, 2, 3, 4, 5])], "scan.pdf"));
    expect(out.size).toBe(5);
  });
});
