import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 6, spec §4.2a, §4.4; Review Focus 3): asset attachments, against a mocked Prisma and storage. The
 * real validateUpload runs; storeUpload is recorded, so "a refused upload stored nothing" is an assertion.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  rate: { allowed: true, retryAfterSec: 0 },
  assets: [] as Array<{ id: string; cls: string }>,
  docs: [] as Array<Record<string, unknown>>,
  reads: 0,
  stored: [] as Array<{ dir: string; name: string }>,
  creates: [] as Array<{ data: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
  docQuery: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  requireUser: async () => { if (!h.user) throw new Error("NEXT_REDIRECT /login"); return h.user; },
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => h.rate }));
vi.mock("@/server/audit", () => ({ writeAudit: async (_tx: unknown, entry: Record<string, unknown>) => { h.audits.push(entry); } }));
vi.mock("@/server/uploads", async (orig) => {
  const actual = await orig<typeof import("@/server/uploads")>();
  return {
    ...actual,
    storeUpload: async (dir: string, file: File) => {
      h.stored.push({ dir, name: file.name });
      return { relPath: `${dir}/123-${file.name}`, checksum: "abc", fileName: file.name, size: file.size };
    },
  };
});
vi.mock("@/server/db/client", () => {
  const assetDocument = {
    create: async (args: { data: Record<string, unknown> }) => {
      h.creates.push(args);
      return { id: `d${h.creates.length}`, ...args.data };
    },
  };
  return {
    prisma: {
      asset: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          h.reads += 1;
          return h.assets.find((a) => a.id === where.id) ?? null;
        },
      },
      assetDocument: {
        findMany: async (args: unknown) => {
          h.reads += 1;
          h.docQuery = args;
          return h.docs;
        },
      },
      $transaction: async (fn: (tx: { assetDocument: typeof assetDocument }) => Promise<unknown>) => fn({ assetDocument }),
    },
  };
});

import { uploadAttachment, uploadAttachmentFormAction } from "./attachments";

const FIN = { id: "u-fin", name: "Ana Cruz", role: "finance_staff" };
const IT = { id: "u-it", name: "Ivan Tan", role: "it_staff" };
const PUR = { id: "u-pur", name: "Pia Lim", role: "purchasing_staff" };
const VIEW = { id: "u-view", name: "Vic Ong", role: "viewer" };

const pdf = (name = "quote.pdf", bytes = 1234) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
const form = (fields: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};

beforeEach(() => {
  h.user = FIN;
  h.rate = { allowed: true, retryAfterSec: 0 };
  h.assets = [{ id: "a-it", cls: "IT" }, { id: "a-pur", cls: "PURCHASING" }];
  h.docs = [];
  h.reads = 0;
  h.stored = [];
  h.creates = [];
  h.audits = [];
  h.revalidated = [];
  h.docQuery = null;
});

const nothingWritten = () => {
  expect(h.stored).toHaveLength(0);
  expect(h.creates).toHaveLength(0);
  expect(h.audits).toHaveLength(0);
  expect(h.revalidated).toHaveLength(0);
};

const FORBIDDEN = { ok: false, kind: "forbidden" };

describe("uploadAttachment: who (spec §4.2a, Review Focus 3)", () => {
  it("refuses a signed-out caller and a viewer before any read", async () => {
    h.user = null;
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo", file: pdf() }))).toMatchObject(FORBIDDEN);
    h.user = VIEW;
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo", file: pdf() }))).toMatchObject(FORBIDDEN);
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses it_staff on a Purchasing asset", async () => {
    h.user = IT;
    expect(await uploadAttachment(form({ assetId: "a-pur", kind: "quotation", file: pdf() }))).toMatchObject(FORBIDDEN);
    nothingWritten();
  });

  it("refuses purchasing_staff on an IT asset it can see", async () => {
    h.user = PUR;
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "quotation", file: pdf() }))).toMatchObject(FORBIDDEN);
    nothingWritten();
  });

  it("refuses a rate-limited caller", async () => {
    h.rate = { allowed: false, retryAfterSec: 5 };
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo", file: pdf() }))).toMatchObject({ ok: false, kind: "rate_limited" });
    nothingWritten();
  });
});

describe("uploadAttachment: validation", () => {
  it.each(["invoice", "attachment:photo", "", "receipt"])("refuses the kind %j", async (kind) => {
    expect(await uploadAttachment(form({ assetId: "a-it", kind, file: pdf() }))).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { kind: "Pick an attachment kind" },
    });
    nothingWritten();
  });

  it("refuses a missing file, a disallowed type and an empty file (validateUpload)", async () => {
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo" }))).toMatchObject({ ok: false, kind: "validation", fieldErrors: { file: "Pick a file first" } });
    const exe = new File([new Uint8Array(10)], "run.exe", { type: "application/octet-stream" });
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo", file: exe }))).toMatchObject({ ok: false, kind: "validation" });
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo", file: pdf("x.pdf", 0) }))).toMatchObject({ ok: false, kind: "validation" });
    nothingWritten();
  });

  it("says when the asset is missing", async () => {
    expect(await uploadAttachment(form({ assetId: "", kind: "photo", file: pdf() }))).toMatchObject({ ok: false, kind: "conflict" });
    expect(await uploadAttachment(form({ assetId: "nope", kind: "photo", file: pdf() }))).toMatchObject({ ok: false, kind: "conflict" });
    nothingWritten();
  });
});

describe("uploadAttachment: the write", () => {
  it("stores the file, the row (kind attachment:<kind>, size), the audit (source web) and revalidates both pages", async () => {
    const res = await uploadAttachment(form({ assetId: "a-pur", kind: "proof-of-payment", file: pdf("paid.pdf", 2048) }));
    expect(res).toEqual({ ok: true, data: { id: "d1" } });
    expect(h.stored).toEqual([{ dir: "assets/a-pur", name: "paid.pdf" }]);
    expect(h.creates[0].data).toEqual({
      assetId: "a-pur", kind: "attachment:proof-of-payment", fileName: "paid.pdf", path: "assets/a-pur/123-paid.pdf",
      checksum: "abc", size: 2048, uploadedById: FIN.id,
    });
    expect(h.audits).toEqual([{
      actorId: FIN.id, actorLabel: FIN.name, entityType: "asset", entityId: "a-pur", action: "attachment.uploaded",
      diff: { attachment: { from: null, to: "paid.pdf" } }, source: "web",
    }]);
    expect(h.revalidated).toEqual(expect.arrayContaining([
      "/finance/assets/a-pur", "/inventory/a-pur", "/inventory/a-pur/attachments", "/inventory/a-pur/documents",
    ]));
  });

  it("lets it_staff attach to an IT asset and purchasing_staff to a Purchasing one", async () => {
    h.user = IT;
    expect(await uploadAttachment(form({ assetId: "a-it", kind: "photo", file: pdf("p.pdf") }))).toMatchObject({ ok: true });
    h.user = PUR;
    expect(await uploadAttachment(form({ assetId: "a-pur", kind: "other", file: pdf("o.pdf") }))).toMatchObject({ ok: true });
    expect(h.creates.map((c) => c.data.kind)).toEqual(["attachment:photo", "attachment:other"]);
  });
});

describe("ids are normalised once (fix round 1)", () => {
  it("refuses a file as the asset id, before any read", async () => {
    expect(await uploadAttachment(form({ assetId: new File(["a-it"], "a.txt"), kind: "photo", file: pdf() }))).toMatchObject({
      ok: false, kind: "conflict",
    });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("trims the asset id and uses the trimmed value for the row, the storage folder, the audit and the paths", async () => {
    expect(await uploadAttachment(form({ assetId: " a-it ", kind: "photo", file: pdf("p.pdf") }))).toMatchObject({ ok: true });
    expect(h.stored).toEqual([{ dir: "assets/a-it", name: "p.pdf" }]);
    expect(h.creates[0].data).toMatchObject({ assetId: "a-it" });
    expect(h.audits[0]).toMatchObject({ entityId: "a-it" });
    expect(h.revalidated).toContain("/inventory/a-it/attachments");
  });
});

describe("uploadAttachmentFormAction (useActionState, fix round 1)", () => {
  it("uploads from the form, ignoring the previous state", async () => {
    const prev = { ok: false as const, kind: "validation" as const, message: "Fix the highlighted fields." };
    expect(await uploadAttachmentFormAction(prev, form({ assetId: "a-it", kind: "quotation", file: pdf() }))).toEqual({ ok: true, data: { id: "d1" } });
    expect(h.creates[0].data).toMatchObject({ kind: "attachment:quotation" });
  });

  it("returns the same refusals as uploadAttachment", async () => {
    expect(await uploadAttachmentFormAction(null, form({ assetId: "a-it", kind: "invoice", file: pdf() }))).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { kind: "Pick an attachment kind" },
    });
    h.user = VIEW;
    expect(await uploadAttachmentFormAction(null, form({ assetId: "a-it", kind: "photo", file: pdf() }))).toMatchObject(FORBIDDEN);
    nothingWritten();
  });
});
