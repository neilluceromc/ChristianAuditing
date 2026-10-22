import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Purchase orders (spec §2): Purchasing, IT and Finance can all upload or re-upload a PO's documents; a viewer can't,
 * and a cancelled PO takes nothing new. Re-uploading a kind adds another document: nothing is replaced or deleted.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  po: null as { id: string; state: string; refNo?: string } | null,
  docs: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({ actionUser: async () => h.user }));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => ({ allowed: true, retryAfterSec: 0 }) }));
vi.mock("@/server/audit", () => ({ writeAudit: async (_tx: unknown, e: Record<string, unknown>) => { h.audits.push(e); } }));
vi.mock("@/server/uploads", () => ({
  validateUpload: (f: unknown) => (f instanceof File ? { ok: true, file: f } : { ok: false, error: "Choose a file" }),
  storeUpload: async (_dir: string, f: File) => ({ relPath: `requests/x/${f.name}`, checksum: "abc", fileName: f.name, size: f.size }),
}));
vi.mock("@/server/db/client", () => {
  const tx = {
    requestDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `doc-${h.docs.length + 1}`, supersededAt: null, ...data };
        h.docs.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: { id: string; supersededAt: null }; data: Record<string, unknown> }) => {
        const hit = h.docs.filter((d) => d.id === where.id && d.supersededAt === null);
        for (const d of hit) Object.assign(d, data);
        return { count: hit.length };
      },
    },
  };
  return {
    prisma: {
      purchaseOrder: { findUnique: async () => h.po },
      requestDocument: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const d = h.docs.find((x) => x.id === where.id);
          return d ? { ...d, order: h.po } : null;
        },
      },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { removePoDocument, replacePoDocument, uploadPoDocument } from "./document-actions";

function form(kind = "invoice", name = "si.pdf") {
  const fd = new FormData();
  fd.set("requestId", "po-1");
  fd.set("kind", kind);
  fd.set("file", new File(["x"], name, { type: "application/pdf" }));
  return fd;
}

beforeEach(() => {
  h.user = null;
  h.po = { id: "po-1", state: "WITH_IT" };
  h.docs = [];
  h.audits = [];
  h.revalidated = [];
});

describe("uploadPoDocument", () => {
  it.each(["purchasing_staff", "it_staff", "finance_staff", "admin"])("%s can upload to a PO", async (role) => {
    h.user = { id: "u1", name: "Pat", role };
    const res = await uploadPoDocument(form());
    expect(res.ok).toBe(true);
    expect(h.docs).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ entityType: "purchase-order", entityId: "po-1", action: "document.uploaded" });
  });

  it("finance and IT can upload to a PO that is ready or sent back too", async () => {
    for (const role of ["finance_staff", "it_staff"]) {
      for (const state of ["READY", "SENT_BACK"]) {
        h.user = { id: "u1", name: "Pat", role };
        h.po = { id: "po-1", state };
        expect((await uploadPoDocument(form())).ok).toBe(true);
      }
    }
  });

  it("viewer refused", async () => {
    h.user = { id: "u2", name: "Vi", role: "viewer" };
    const res = await uploadPoDocument(form());
    expect(res.ok).toBe(false);
    expect(h.docs).toHaveLength(0);
  });

  it("nobody signed in is refused", async () => {
    expect((await uploadPoDocument(form())).ok).toBe(false);
    expect(h.docs).toHaveLength(0);
  });

  it("a cancelled PO takes no new document", async () => {
    h.user = { id: "u1", name: "Pat", role: "purchasing_staff" };
    h.po = { id: "po-1", state: "CANCELLED" };
    const res = await uploadPoDocument(form());
    expect(res.ok).toBe(false);
    expect(h.docs).toHaveLength(0);
  });

  it("re-uploading a kind adds a second document and deletes nothing", async () => {
    h.user = { id: "u1", name: "Pat", role: "finance_staff" };
    await uploadPoDocument(form("invoice", "si-v1.pdf"));
    await uploadPoDocument(form("invoice", "si-v2.pdf"));
    expect(h.docs.map((d) => d.fileName)).toEqual(["si-v1.pdf", "si-v2.pdf"]);
  });

  it("official receipts and warranty slips are document kinds a PO accepts", async () => {
    h.user = { id: "u1", name: "Pat", role: "it_staff" };
    expect((await uploadPoDocument(form("official-receipt"))).ok).toBe(true);
    expect((await uploadPoDocument(form("warranty-slip"))).ok).toBe(true);
  });
});

describe("replacePoDocument and removePoDocument (PO form redesign, spec §5b.1)", () => {
  function replaceForm(kind = "invoice", name = "si-v2.pdf") {
    const fd = new FormData();
    fd.set("orderId", "po-1");
    fd.set("kind", kind);
    fd.set("file", new File(["x"], name, { type: "application/pdf" }));
    return fd;
  }

  it("replace adds a new document of the kind; the old one stays", async () => {
    h.user = { id: "u1", name: "Pat", role: "purchasing_staff" };
    await uploadPoDocument(form("invoice", "si-v1.pdf"));
    const r = await replacePoDocument(replaceForm());
    expect(r).toEqual({ ok: true, data: { id: "doc-2" } });
    expect(h.docs.map((d) => [d.kind, d.fileName, d.supersededAt])).toEqual([["invoice", "si-v1.pdf", null], ["invoice", "si-v2.pdf", null]]);
    expect(h.audits[1]).toMatchObject({ entityId: "po-1", action: "document.uploaded", source: "web" });
  });

  it("remove supersedes, never deletes", async () => {
    h.user = { id: "u1", name: "Pat", role: "finance_staff" };
    await uploadPoDocument(form("invoice", "si-v1.pdf"));
    const r = await removePoDocument({ documentId: "doc-1" });
    expect(r).toEqual({ ok: true, data: { id: "doc-1" } });
    expect(h.docs).toHaveLength(1);
    expect(h.docs[0]).toMatchObject({ fileName: "si-v1.pdf", supersededById: "u1" });
    expect(h.docs[0].supersededAt).toBeInstanceOf(Date);
    expect(h.audits[1]).toMatchObject({
      entityType: "purchase-order", entityId: "po-1", action: "document.superseded", source: "web",
      diff: { document: { from: "si-v1.pdf", to: null } },
    });
    // already removed: refused, and nothing changes
    const again = await removePoDocument({ documentId: "doc-1" });
    expect(again).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.audits).toHaveLength(2);
  });

  it("upload, replace and remove each refresh the PO page and its edit page (final review M1)", async () => {
    h.user = { id: "u1", name: "Pat", role: "purchasing_staff" };
    await uploadPoDocument(form("invoice", "si-v1.pdf"));
    expect(h.revalidated).toEqual(["/purchases/po-1", "/purchases/po-1/edit"]);
    h.revalidated = [];
    await replacePoDocument(replaceForm());
    expect(h.revalidated).toEqual(["/purchases/po-1", "/purchases/po-1/edit"]);
    h.revalidated = [];
    await removePoDocument({ documentId: "doc-2" });
    expect(h.revalidated).toEqual(["/purchases/po-1", "/purchases/po-1/edit"]);
  });

  it("the same roles and states as upload: a viewer or a cancelled PO is refused", async () => {
    h.user = { id: "u1", name: "Pat", role: "it_staff" };
    await uploadPoDocument(form());
    h.user = { id: "u2", name: "Vi", role: "viewer" };
    expect(await replacePoDocument(replaceForm())).toMatchObject({ ok: false, kind: "forbidden" });
    expect(await removePoDocument({ documentId: "doc-1" })).toMatchObject({ ok: false, kind: "forbidden" });
    h.user = { id: "u1", name: "Pat", role: "purchasing_staff" };
    h.po = { id: "po-1", state: "CANCELLED", refNo: "PO-0214" };
    expect(await replacePoDocument(replaceForm())).toMatchObject({ ok: false, kind: "conflict" });
    expect(await removePoDocument({ documentId: "doc-1" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.docs).toHaveLength(1);
    expect(h.docs[0].supersededAt).toBeNull();
    expect(await removePoDocument({ documentId: "nope" })).toMatchObject({ ok: false, kind: "conflict" });
  });
});
