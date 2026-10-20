import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 (Task 6, spec §4.2a, §4.3; Review Focus 3): the shared asset notes, against a mocked Prisma. Every write
 * is recorded, so "a role that can see the asset but not post is refused ON THE SERVER, and nothing was written" is an
 * assertion. That reads work for those same roles is queries.test.ts.
 */

type Note = {
  id: string; assetId: string; parentId: string | null; authorId: string | null; authorLabel: string; body: string;
  resolvedAt: Date | null; resolvedById: string | null; createdAt: Date; author?: { role: string } | null;
};

const h = vi.hoisted(() => ({
  user: null as { id: string; name: string; role: string } | null,
  rate: { allowed: true, retryAfterSec: 0 },
  assets: [] as Array<{ id: string; cls: string }>,
  notes: [] as Note[],
  users: [] as Array<{ id: string; name: string }>,
  reads: 0,
  transactions: 0,
  creates: [] as Array<{ data: Record<string, unknown> }>,
  updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  audits: [] as Array<Record<string, unknown>>,
  revalidated: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/server/auth/guards", () => ({
  actionUser: async () => h.user,
  requireUser: async () => { if (!h.user) throw new Error("NEXT_REDIRECT /login"); return h.user; },
}));
vi.mock("@/server/rate-limit", () => ({ checkRate: async () => h.rate }));
vi.mock("@/server/audit", () => ({ writeAudit: async (_tx: unknown, entry: Record<string, unknown>) => { h.audits.push(entry); } }));
vi.mock("@/server/db/client", () => {
  const assetNote = {
    create: async (args: { data: Record<string, unknown> }) => {
      h.creates.push(args);
      return { id: `n${h.creates.length}`, ...args.data };
    },
    updateMany: async (args: { where: { id: string; resolvedAt?: unknown }; data: Record<string, unknown> }) => {
      h.updates.push(args);
      const n = h.notes.find((x) => x.id === args.where.id);
      if (!n) return { count: 0 };
      // the guard on the current state: resolve only an open thread, reopen only a resolved one
      if (args.where.resolvedAt === null && n.resolvedAt !== null) return { count: 0 };
      if (args.where.resolvedAt && typeof args.where.resolvedAt === "object" && n.resolvedAt === null) return { count: 0 };
      return { count: 1 };
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
      assetNote: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          h.reads += 1;
          const n = h.notes.find((x) => x.id === where.id);
          if (!n) return null;
          const asset = h.assets.find((a) => a.id === n.assetId)!;
          return { ...n, asset: { cls: asset.cls } };
        },
        findMany: async ({ where }: { where: { assetId: string } }) => {
          h.reads += 1;
          return h.notes.filter((n) => n.assetId === where.assetId);
        },
      },
      user: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) => h.users.filter((u) => where.id.in.includes(u.id)),
      },
      $transaction: async (fn: (tx: { assetNote: typeof assetNote }) => Promise<unknown>) => {
        h.transactions += 1;
        return fn({ assetNote });
      },
    },
  };
});

import { postNote, postNoteFormAction, setNoteResolved } from "./notes";

const FIN = { id: "u-fin", name: "Ana Cruz", role: "finance_staff" };
const IT = { id: "u-it", name: "Ivan Tan", role: "it_staff" };
const PUR = { id: "u-pur", name: "Pia Lim", role: "purchasing_staff" };
const VIEW = { id: "u-view", name: "Vic Ong", role: "viewer" };
const ADMIN = { id: "u-adm", name: "Ada Admin", role: "admin" };

const at = (d: number) => new Date(Date.UTC(2026, 9, d, 2));
const note = (over: Partial<Note> & { id: string; assetId: string }): Note => ({
  parentId: null, authorId: FIN.id, authorLabel: FIN.name, body: "A note", resolvedAt: null, resolvedById: null,
  createdAt: at(1), author: { role: "finance_staff" }, ...over,
});

beforeEach(() => {
  h.user = FIN;
  h.rate = { allowed: true, retryAfterSec: 0 };
  h.assets = [{ id: "a-it", cls: "IT" }, { id: "a-pur", cls: "PURCHASING" }];
  h.notes = [
    note({ id: "t-it", assetId: "a-it", createdAt: at(1) }),
    note({ id: "r-it", assetId: "a-it", parentId: "t-it", createdAt: at(2), authorId: IT.id, authorLabel: IT.name, author: { role: "it_staff" } }),
    note({ id: "t-pur", assetId: "a-pur", createdAt: at(3) }),
    note({ id: "t-done", assetId: "a-it", createdAt: at(4), resolvedAt: at(5), resolvedById: FIN.id }),
  ];
  h.users = [FIN, IT];
  h.reads = 0;
  h.transactions = 0;
  h.creates = [];
  h.updates = [];
  h.audits = [];
  h.revalidated = [];
});

const nothingWritten = () => {
  expect(h.transactions).toBe(0);
  expect(h.creates).toHaveLength(0);
  expect(h.updates).toHaveLength(0);
  expect(h.audits).toHaveLength(0);
  expect(h.revalidated).toHaveLength(0);
};

const FORBIDDEN = { ok: false, kind: "forbidden" };

describe("postNote: who (spec §4.2a, Review Focus 3)", () => {
  it("refuses a signed-out caller before any read", async () => {
    h.user = null;
    expect(await postNote({ assetId: "a-it", body: "Hello" })).toMatchObject(FORBIDDEN);
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses a viewer on an IT asset it can see, before any read", async () => {
    h.user = VIEW;
    expect(await postNote({ assetId: "a-it", body: "Hello" })).toMatchObject(FORBIDDEN);
    expect(await postNote({ assetId: "a-it", body: "Reply", parentId: "t-it" })).toMatchObject(FORBIDDEN);
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses it_staff on a Purchasing asset", async () => {
    h.user = IT;
    expect(await postNote({ assetId: "a-pur", body: "Hello" })).toMatchObject(FORBIDDEN);
    expect(await postNote({ assetId: "a-pur", body: "Reply", parentId: "t-pur" })).toMatchObject(FORBIDDEN);
    nothingWritten();
  });

  it("refuses purchasing_staff on an IT asset it can see", async () => {
    h.user = PUR;
    expect(await postNote({ assetId: "a-it", body: "Hello" })).toMatchObject(FORBIDDEN);
    nothingWritten();
  });

  it("refuses a rate-limited caller", async () => {
    h.rate = { allowed: false, retryAfterSec: 9 };
    expect(await postNote({ assetId: "a-it", body: "Hello" })).toMatchObject({ ok: false, kind: "rate_limited", retryAfterSec: 9 });
    nothingWritten();
  });

  it("says when the asset is gone", async () => {
    expect(await postNote({ assetId: "nope", body: "Hello" })).toMatchObject({ ok: false, kind: "conflict" });
    nothingWritten();
  });

  it.each([
    [ADMIN, "a-it"], [ADMIN, "a-pur"], [FIN, "a-it"], [FIN, "a-pur"], [IT, "a-it"], [PUR, "a-pur"],
  ] as const)("lets %o post on %s", async (user, assetId) => {
    h.user = user;
    expect(await postNote({ assetId, body: "Hello" })).toMatchObject({ ok: true });
    expect(h.creates).toHaveLength(1);
  });
});

describe("postNote: body limits", () => {
  it("refuses an empty or whitespace body", async () => {
    for (const body of ["", "   \n"]) {
      expect(await postNote({ assetId: "a-it", body })).toMatchObject({
        ok: false, kind: "validation", fieldErrors: { body: "Write a note first" },
      });
    }
    nothingWritten();
  });

  it("refuses 2,001 characters", async () => {
    expect(await postNote({ assetId: "a-it", body: "x".repeat(2001) })).toMatchObject({
      ok: false, kind: "validation", fieldErrors: { body: "A note is at most 2,000 characters" },
    });
    nothingWritten();
  });

  it("accepts 2,000 characters and stores the trimmed body", async () => {
    const body = "x".repeat(2000);
    expect(await postNote({ assetId: "a-it", body: `  ${body}\n` })).toMatchObject({ ok: true });
    expect(h.creates[0].data.body).toBe(body);
  });
});

describe("postNote: threads and replies", () => {
  it("posts a thread, with the author, audit (source web, reason null) and both pages revalidated", async () => {
    const res = await postNote({ assetId: "a-it", body: " Paid by cheque 0042. " });
    expect(res).toEqual({ ok: true, data: { id: "n1" } });
    expect(h.creates[0].data).toEqual({
      assetId: "a-it", parentId: null, authorId: FIN.id, authorLabel: FIN.name, body: "Paid by cheque 0042.",
    });
    expect(h.audits).toEqual([{
      actorId: FIN.id, actorLabel: FIN.name, entityType: "asset", entityId: "a-it", action: "note.posted",
      diff: { note: { from: null, to: "Paid by cheque 0042." }, noteId: { from: null, to: "n1" } }, source: "web", reason: null,
    }]);
    expect(h.revalidated).toEqual(expect.arrayContaining([
      "/finance/assets/a-it", "/inventory/a-it", "/inventory/a-it/notes",
    ]));
  });

  it("replies to a thread on the same asset (note.replied)", async () => {
    h.user = IT;
    expect(await postNote({ assetId: "a-it", body: "Checked.", parentId: "t-it" })).toMatchObject({ ok: true });
    expect(h.creates[0].data).toMatchObject({ parentId: "t-it", authorId: IT.id });
    expect(h.audits[0]).toMatchObject({ action: "note.replied", source: "web", reason: null, entityId: "a-it" });
    // fix round 1: the trail says which thread was replied to
    expect(h.audits[0].diff).toEqual({ note: { from: null, to: "Checked." }, noteId: { from: null, to: "t-it" } });
  });

  it("refuses a reply to a reply (one level only)", async () => {
    expect(await postNote({ assetId: "a-it", body: "Deeper", parentId: "r-it" })).toMatchObject({ ok: false, kind: "conflict" });
    nothingWritten();
  });

  it("refuses a reply to a thread on another asset, or a missing thread", async () => {
    expect(await postNote({ assetId: "a-it", body: "Wrong asset", parentId: "t-pur" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(await postNote({ assetId: "a-it", body: "Gone", parentId: "nope" })).toMatchObject({ ok: false, kind: "conflict" });
    nothingWritten();
  });
});

describe("setNoteResolved", () => {
  it("refuses a viewer and it_staff on a Purchasing thread, and purchasing_staff on an IT thread", async () => {
    h.user = VIEW;
    expect(await setNoteResolved({ noteId: "t-it", resolved: true })).toMatchObject(FORBIDDEN);
    h.user = IT;
    expect(await setNoteResolved({ noteId: "t-pur", resolved: true })).toMatchObject(FORBIDDEN);
    h.user = PUR;
    expect(await setNoteResolved({ noteId: "t-it", resolved: true })).toMatchObject(FORBIDDEN);
    nothingWritten();
  });

  it("resolves a thread: stamps resolvedAt and resolvedById, audits note.resolved", async () => {
    h.user = IT;
    expect(await setNoteResolved({ noteId: "t-it", resolved: true })).toEqual({ ok: true, data: null });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].where).toEqual({ id: "t-it", parentId: null, resolvedAt: null });
    expect(h.updates[0].data.resolvedById).toBe(IT.id);
    expect(h.updates[0].data.resolvedAt).toBeInstanceOf(Date);
    expect(Object.keys(h.updates[0].data).sort()).toEqual(["resolvedAt", "resolvedById"]);
    expect(h.audits).toEqual([expect.objectContaining({
      actorId: IT.id, entityType: "asset", entityId: "a-it", action: "note.resolved", source: "web", reason: null,
      diff: { note: { from: "open", to: "resolved" }, noteId: { from: null, to: "t-it" } },
    })]);
    expect(h.revalidated).toEqual(expect.arrayContaining(["/finance/assets/a-it", "/inventory/a-it/notes"]));
  });

  it("reopens a resolved thread: clears both stamps, audits note.reopened", async () => {
    expect(await setNoteResolved({ noteId: "t-done", resolved: false })).toEqual({ ok: true, data: null });
    expect(h.updates[0].data).toEqual({ resolvedAt: null, resolvedById: null });
    expect(h.audits[0]).toMatchObject({
      action: "note.reopened", source: "web",
      diff: { note: { from: "resolved", to: "open" }, noteId: { from: null, to: "t-done" } },
    });
  });

  it("is a no-op (no audit) when the thread is already in that state", async () => {
    expect(await setNoteResolved({ noteId: "t-done", resolved: true })).toEqual({ ok: true, data: null });
    expect(await setNoteResolved({ noteId: "t-it", resolved: false })).toEqual({ ok: true, data: null });
    expect(h.audits).toHaveLength(0);
  });

  it("refuses a reply (threads only) and a missing note", async () => {
    expect(await setNoteResolved({ noteId: "r-it", resolved: true })).toMatchObject({ ok: false, kind: "conflict" });
    expect(await setNoteResolved({ noteId: "nope", resolved: true })).toMatchObject({ ok: false, kind: "conflict" });
    nothingWritten();
  });
});

describe("ids are normalised once (fix round 1)", () => {
  const asString = (v: unknown) => v as string;

  it("refuses an array or a number as the asset id, before any read", async () => {
    expect(await postNote({ assetId: asString(["a-it"]), body: "Hello" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(await postNote({ assetId: asString(42), body: "Hello" })).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses an array as the parent id, before any read", async () => {
    expect(await postNote({ assetId: "a-it", body: "Hi", parentId: asString(["t-it"]) })).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("refuses an array as the note id, before any read", async () => {
    expect(await setNoteResolved({ noteId: asString(["t-it"]), resolved: true })).toMatchObject({ ok: false, kind: "conflict" });
    expect(h.reads).toBe(0);
    nothingWritten();
  });

  it("trims the ids and uses the trimmed value in every query, write and path", async () => {
    expect(await postNote({ assetId: " a-it ", body: "Hi", parentId: " t-it " })).toMatchObject({ ok: true });
    expect(h.creates[0].data).toMatchObject({ assetId: "a-it", parentId: "t-it" });
    expect(h.audits[0]).toMatchObject({ entityId: "a-it" });
    expect(h.revalidated).toContain("/finance/assets/a-it");
    expect(await setNoteResolved({ noteId: " t-it ", resolved: true })).toMatchObject({ ok: true });
    expect(h.updates[0].where).toMatchObject({ id: "t-it" });
  });

  it("an empty parent id posts a thread", async () => {
    expect(await postNote({ assetId: "a-it", body: "Hi", parentId: "  " })).toMatchObject({ ok: true });
    expect(h.creates[0].data.parentId).toBeNull();
    expect(h.audits[0]).toMatchObject({ action: "note.posted" });
  });
});

describe("postNoteFormAction (useActionState, fix round 1)", () => {
  const fd = (fields: Record<string, string | Blob>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };

  it("posts a thread from the form, ignoring the previous state", async () => {
    const prev = { ok: false as const, kind: "validation" as const, message: "Fix the highlighted fields." };
    expect(await postNoteFormAction(prev, fd({ assetId: "a-it", body: "From the form" }))).toEqual({ ok: true, data: { id: "n1" } });
    expect(h.creates[0].data).toMatchObject({ assetId: "a-it", parentId: null, body: "From the form" });
  });

  it("posts a reply when the form carries parentId", async () => {
    expect(await postNoteFormAction(null, fd({ assetId: "a-it", body: "Reply", parentId: "t-it" }))).toMatchObject({ ok: true });
    expect(h.audits[0]).toMatchObject({ action: "note.replied" });
  });

  it("returns the same refusals as postNote", async () => {
    h.user = VIEW;
    expect(await postNoteFormAction(null, fd({ assetId: "a-it", body: "Hi" }))).toMatchObject(FORBIDDEN);
    h.user = FIN;
    expect(await postNoteFormAction(null, fd({ assetId: "a-it", body: " " }))).toMatchObject({ ok: false, kind: "validation" });
    expect(await postNoteFormAction(null, fd({ assetId: new Blob(["a-it"]), body: "Hi" }))).toMatchObject({ ok: false, kind: "conflict" });
    nothingWritten();
  });
});
