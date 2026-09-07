import { describe, expect, it } from "vitest";
import { checkUploadMeta, UPLOAD_MAX_BYTES } from "./uploads";

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
    expect(checkUploadMeta({ name: "a.pdf", type: "application/pdf", size: UPLOAD_MAX_BYTES + 1 })).toBe("Too big — the cap is 10 MB");
  });
});
