import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 4, spec §4.4): the asset document download route gains `?inline=1` — `Content-Disposition: inline`
 * for PDF, PNG and JPG only (the asset page's preview); everything else still downloads. Auth and the class
 * visibility check are unchanged.
 */

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "finance_staff" } as { id: string; role: string },
  doc: null as Record<string, unknown> | null,
  requireUser: vi.fn(),
  readUpload: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/db/client", () => ({ prisma: { assetDocument: { findUnique: vi.fn(async () => h.doc) } } }));
vi.mock("@/server/storage", () => ({ readUpload: h.readUpload, writeObject: vi.fn() }));

import { GET } from "./route";

const call = (qs = "") =>
  GET(new Request(`http://localhost/inventory/a1/documents/d1/download${qs}`), { params: Promise.resolve({ id: "a1", docId: "d1" }) });

function doc(fileName: string, cls = "IT") {
  return { id: "d1", assetId: "a1", fileName, path: `assets/a1/${fileName}`, asset: { cls } };
}

beforeEach(() => {
  h.requireUser.mockReset().mockImplementation(async () => h.user);
  h.readUpload.mockReset().mockImplementation(async () => Buffer.from("%PDF-1.4"));
  h.user = { id: "u1", role: "finance_staff" };
  h.doc = doc("invoice.pdf");
});

describe("document download ?inline=1", () => {
  it("without inline: an attachment, as before", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="invoice.pdf"/);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  });

  for (const [name, type] of [["invoice.pdf", "application/pdf"], ["box.png", "image/png"], ["box.JPG", "image/jpeg"], ["scan.jpeg", "image/jpeg"]]) {
    it(`inline=1 on ${name}: inline, ${type}, nosniff`, async () => {
      h.doc = doc(name);
      const res = await call("?inline=1");
      expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^inline; filename="${name.replace(".", "\\.")}"`));
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });
  }

  it("inline=1 on any other type still downloads", async () => {
    for (const name of ["page.html", "notes.svg", "sheet.xlsx", "noext"]) {
      h.doc = doc(name);
      const res = await call("?inline=1");
      expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
    }
  });

  it("inline must be exactly 1", async () => {
    const res = await call("?inline=true");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
  });

  it("auth unchanged: the class check still hides another class's document, inline or not", async () => {
    h.user = { id: "u2", role: "it_staff" };
    h.doc = doc("quote.pdf", "PURCHASING");
    expect((await call("?inline=1")).status).toBe(404);
    expect(h.requireUser).toHaveBeenCalled();
  });

  it("a document of another asset is not found", async () => {
    h.doc = { ...doc("invoice.pdf"), assetId: "other" };
    expect((await call("?inline=1")).status).toBe(404);
  });
});
