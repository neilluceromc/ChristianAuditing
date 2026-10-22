import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Document preview (Task 1): the stock lot document route answers `?inline=1` through `fileResponse` — inline for
 * a PDF, PNG or JPG, an attachment otherwise, nosniff always. Its gate is unchanged: requireUser, then the document
 * must belong to this lot.
 */

const h = vi.hoisted(() => ({
  doc: null as Record<string, unknown> | null,
  requireUser: vi.fn(),
  readUpload: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/db/client", () => ({ prisma: { stockLotDocument: { findUnique: vi.fn(async () => h.doc) } } }));
vi.mock("@/server/storage", () => ({ readUpload: h.readUpload, writeObject: vi.fn() }));

import { GET } from "./route";

const call = (qs = "") =>
  GET(new Request(`http://localhost/stock/lots/l1/documents/d1/download${qs}`), { params: Promise.resolve({ id: "l1", docId: "d1" }) });

const doc = (fileName: string, lotId = "l1") => ({ id: "d1", lotId, fileName, path: `lots/l1/${fileName}` });

beforeEach(() => {
  h.requireUser.mockReset().mockImplementation(async () => ({ id: "u1", role: "it_staff" }));
  h.readUpload.mockReset().mockImplementation(async () => Buffer.from("%PDF-1.4"));
  h.doc = doc("delivery.pdf");
});

describe("stock lot document download ?inline=1", () => {
  it("inline=1 on a PDF: inline, application/pdf, nosniff", async () => {
    const res = await call("?inline=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="delivery\.pdf"/);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("inline=1 on a PNG: inline, image/png", async () => {
    h.doc = doc("label.png");
    const res = await call("?inline=1");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("without inline: an attachment, as before, and still nosniff", async () => {
    const res = await call();
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="delivery\.pdf"/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("inline=1 on another type still downloads", async () => {
    h.doc = doc("count.xlsx");
    const res = await call("?inline=1");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("gate unchanged: another lot's document is not found, inline or not", async () => {
    h.doc = doc("delivery.pdf", "l2");
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
