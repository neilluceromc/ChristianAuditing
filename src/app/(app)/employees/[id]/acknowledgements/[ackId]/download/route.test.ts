import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Document preview (Task 1): the signed-form (acknowledgement) route answers `?inline=1` through `fileResponse` —
 * inline for a PDF, PNG or JPG, an attachment otherwise, nosniff always. Its gate is unchanged: requireUser, then
 * the form must belong to this employee.
 */

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  requireUser: vi.fn(),
  readUpload: vi.fn(),
}));

vi.mock("@/server/auth/guards", () => ({ requireUser: h.requireUser }));
vi.mock("@/server/db/client", () => ({ prisma: { acknowledgement: { findUnique: vi.fn(async () => h.row) } } }));
vi.mock("@/server/storage", () => ({ readUpload: h.readUpload, writeObject: vi.fn() }));

import { GET } from "./route";

const call = (qs = "") =>
  GET(new Request(`http://localhost/employees/e1/acknowledgements/k1/download${qs}`), { params: Promise.resolve({ id: "e1", ackId: "k1" }) });

const row = (fileName: string, employeeId = "e1") => ({ id: "k1", employeeId, fileName, path: `acks/e1/${fileName}` });

beforeEach(() => {
  h.requireUser.mockReset().mockImplementation(async () => ({ id: "u1", role: "it_staff" }));
  h.readUpload.mockReset().mockImplementation(async () => Buffer.from("%PDF-1.4"));
  h.row = row("signed-form.pdf");
});

describe("acknowledgement download ?inline=1", () => {
  it("inline=1 on a PDF: inline, application/pdf, nosniff", async () => {
    const res = await call("?inline=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="signed-form\.pdf"/);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("inline=1 on a .jpeg photo of the form: inline, image/jpeg", async () => {
    h.row = row("form-photo.jpeg");
    const res = await call("?inline=1");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; /);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("without inline: an attachment, as before, and still nosniff", async () => {
    const res = await call();
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="signed-form\.pdf"/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("inline=1 on another type still downloads", async () => {
    h.row = row("form.html");
    const res = await call("?inline=1");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("gate unchanged: another employee's form is not found, inline or not", async () => {
    h.row = row("signed-form.pdf", "e2");
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
