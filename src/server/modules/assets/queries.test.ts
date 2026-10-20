import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 6, spec §4.2a; Review Focus 3): the notes and attachments reads, off the server-action surface.
 * Anyone who can see the asset's class reads — including the roles that cannot post (a viewer on IT, Purchasing on
 * IT) — and anyone else reads nothing. The asset id is normalised once and that value reaches every query.
 */

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  assets: [] as Array<{ id: string; cls: string }>,
  notes: [] as Array<Record<string, unknown>>,
  docs: [] as Array<Record<string, unknown>>,
  users: [] as Array<{ id: string; name: string }>,
  assetQueries: [] as unknown[],
  noteQueries: [] as unknown[],
  docQueries: [] as unknown[],
}));

vi.mock("@/server/auth/guards", () => ({
  requireUser: async () => { if (!h.user) throw new Error("NEXT_REDIRECT /login"); return h.user; },
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    asset: {
      findUnique: async (args: { where: { id: unknown } }) => {
        h.assetQueries.push(args);
        return h.assets.find((a) => a.id === args.where.id) ?? null;
      },
    },
    assetNote: {
      findMany: async (args: { where: { assetId: unknown } }) => {
        h.noteQueries.push(args);
        return h.notes.filter((n) => n.assetId === args.where.assetId);
      },
    },
    assetDocument: {
      findMany: async (args: { where: { assetId: unknown } }) => {
        h.docQueries.push(args);
        return h.docs.filter((d) => d.assetId === args.where.assetId);
      },
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.users.filter((u) => where.id.in.includes(u.id)),
    },
  },
}));

import { assetAttachments, assetNotes } from "./queries";

const FIN = { id: "u-fin", name: "Ana Cruz", role: "finance_staff" };
const IT = { id: "u-it", name: "Ivan Tan", role: "it_staff" };
const PUR = { id: "u-pur", name: "Pia Lim", role: "purchasing_staff" };
const VIEW = { id: "u-view", name: "Vic Ong", role: "viewer" };

const at = (d: number) => new Date(Date.UTC(2026, 9, d, 2));
const note = (over: Record<string, unknown>) => ({
  parentId: null, authorId: FIN.id, authorLabel: FIN.name, body: "A note", resolvedAt: null, resolvedById: null,
  createdAt: at(1), author: { role: "finance_staff" }, ...over,
});

beforeEach(() => {
  h.user = FIN;
  h.assets = [{ id: "a-it", cls: "IT" }, { id: "a-pur", cls: "PURCHASING" }];
  h.notes = [
    note({ id: "t-it", assetId: "a-it", createdAt: at(1) }),
    note({ id: "r-it", assetId: "a-it", parentId: "t-it", createdAt: at(2), authorId: IT.id, authorLabel: IT.name, author: { role: "it_staff" } }),
    note({ id: "t-pur", assetId: "a-pur", createdAt: at(3) }),
    note({ id: "t-done", assetId: "a-it", createdAt: at(4), resolvedAt: at(5), resolvedById: FIN.id }),
  ];
  h.docs = [];
  h.users = [FIN, IT];
  h.assetQueries = [];
  h.noteQueries = [];
  h.docQueries = [];
});

describe("assetNotes (read on canSeeClass)", () => {
  it("a viewer reads an IT asset's threads with replies", async () => {
    h.user = VIEW;
    const threads = await assetNotes("a-it");
    expect(threads.map((t) => t.id)).toEqual(["t-done", "t-it"]);
    expect(threads[1].replies).toEqual([expect.objectContaining({ id: "r-it", authorLabel: IT.name, authorRole: "it_staff" })]);
    expect(threads[0]).toMatchObject({ resolvedByLabel: FIN.name });
  });

  it("purchasing_staff reads an IT asset it cannot post on", async () => {
    h.user = PUR;
    expect((await assetNotes("a-it")).length).toBe(2);
  });

  it("it_staff reads nothing on a Purchasing asset, and a missing asset reads nothing", async () => {
    h.user = IT;
    expect(await assetNotes("a-pur")).toEqual([]);
    expect(await assetNotes("nope")).toEqual([]);
    expect(h.noteQueries).toHaveLength(0);
  });

  it("an array id reads nothing and queries nothing (Minor 2)", async () => {
    expect(await assetNotes(["a-it"] as unknown as string)).toEqual([]);
    expect(h.assetQueries).toHaveLength(0);
    expect(h.noteQueries).toHaveLength(0);
  });

  it("a padded id is trimmed once and the same value reaches both queries", async () => {
    expect((await assetNotes(" a-it ")).length).toBe(2);
    expect(h.assetQueries).toEqual([expect.objectContaining({ where: { id: "a-it" } })]);
    expect(h.noteQueries).toEqual([expect.objectContaining({ where: { assetId: "a-it" } })]);
  });
});

describe("assetAttachments (read on canSeeClass)", () => {
  const created = new Date("2026-10-20T02:00:00Z");

  it("a viewer reads an IT asset's attachments, newest first, with kind and uploader", async () => {
    h.user = VIEW;
    h.docs = [
      { id: "d2", assetId: "a-it", kind: "attachment:quotation", fileName: "q.pdf", size: 900, createdAt: created, uploadedBy: { name: "Ana Cruz" } },
      { id: "d1", assetId: "a-it", kind: "attachment:photo", fileName: "p.jpg", size: null, createdAt: created, uploadedBy: null },
    ];
    expect(await assetAttachments("a-it")).toEqual([
      { id: "d2", kind: "quotation", fileName: "q.pdf", size: 900, createdAt: created, uploadedBy: "Ana Cruz" },
      { id: "d1", kind: "photo", fileName: "p.jpg", size: null, createdAt: created, uploadedBy: null },
    ]);
    expect(h.docQueries[0]).toMatchObject({
      where: { assetId: "a-it", kind: { startsWith: "attachment:" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("an attachment:<kind> this build does not know reads as Other", async () => {
    h.docs = [{ id: "d3", assetId: "a-it", kind: "attachment:legacy", fileName: "x.pdf", size: 1, createdAt: created, uploadedBy: null }];
    expect((await assetAttachments("a-it"))[0].kind).toBe("other");
  });

  it("it_staff reads nothing on a Purchasing asset; a missing asset reads nothing", async () => {
    h.user = IT;
    expect(await assetAttachments("a-pur")).toEqual([]);
    expect(await assetAttachments("nope")).toEqual([]);
    expect(h.docQueries).toHaveLength(0);
  });

  it("an array id reads nothing and queries nothing; a padded id is trimmed for both queries (Minor 2)", async () => {
    expect(await assetAttachments(["a-it"] as unknown as string)).toEqual([]);
    expect(h.assetQueries).toHaveLength(0);
    await assetAttachments(" a-it ");
    expect(h.assetQueries).toEqual([expect.objectContaining({ where: { id: "a-it" } })]);
    expect(h.docQueries).toEqual([expect.objectContaining({ where: expect.objectContaining({ assetId: "a-it" }) })]);
  });
});
