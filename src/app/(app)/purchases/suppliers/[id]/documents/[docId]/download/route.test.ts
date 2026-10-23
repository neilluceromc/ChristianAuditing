import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Document preview (Task 1): the vendor document route answers `?inline=1` through `fileResponse` — inline for a
 * PDF, PNG or JPG, an attachment otherwise, nosniff always. Its gate is unchanged: requireUser, then the document
 * must belong to this vendor.
 */

const h = vi.hoisted(() => ({
  doc: null as Record<string, unknown> | null,
  requireUser: vi.fn(),
  readUpload: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/db/client", () => ({ prisma: { vendorDocument: { findUnique: vi.fn(async () => h.doc) } } }));
vi.mock("@/server/storage", () => ({ readUpload: h.readUpload, writeObject: vi.fn() }));

import { GET } from "./route";

const call = (qs = "") =>
  GET(new Request(`http://localhost/purchases/suppliers/v1/documents/d1/download${qs}`), { params: Promise.resolve({ id: "v1", docId: "d1" }) });

const doc = (fileName: string, vendorId = "v1") => ({ id: "d1", vendorId, fileName, path: `vendors/v1/${fileName}` });

beforeEach(() => {
  h.requireUser.mockReset().mockImplementation(async () => ({ id: "u1", role: "purchasing_staff" }));
  h.readUpload.mockReset().mockImplementation(async () => Buffer.from("%PDF-1.4"));
  h.doc = doc("permit.pdf");
});

describe("vendor document download ?inline=1", () => {
  it("inline=1 on a PDF: inline, application/pdf, nosniff", async () => {
    const res = await call("?inline=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="permit\.pdf"/);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("inline=1 on an upper-case .JPG: inline, image/jpeg", async () => {
    h.doc = doc("storefront.JPG");
    const res = await call("?inline=1");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("without inline: an attachment, as before, and still nosniff", async () => {
    const res = await call();
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="permit\.pdf"/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("inline=1 on another type still downloads", async () => {
    h.doc = doc("terms.docx");
    const res = await call("?inline=1");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("gate unchanged: another vendor's document is not found, inline or not", async () => {
    h.doc = doc("permit.pdf", "v2");
    expect((await call("?inline=1")).status).toBe(404);
    expect(h.requireUser).toHaveBeenCalled();
  });

  it("gate unchanged: no signed-in user never reaches the file", async () => {
    h.requireUser.mockImplementation(async () => { throw new Error("NEXT_REDIRECT"); });
    await expect(call("?inline=1")).rejects.toThrow("NEXT_REDIRECT");
    expect(h.readUpload).not.toHaveBeenCalled();
  });

  it("a stored object that is missing is a 404", async () => {
    h.readUpload.mockImplementation(async () => null);
    expect((await call("?inline=1")).status).toBe(404);
  });
});
