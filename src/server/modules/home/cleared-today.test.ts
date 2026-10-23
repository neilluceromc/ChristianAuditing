import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

/* Worklist split view (H4) Task 2: "Cleared today" — this person's worklist decisions since Manila midnight, less undos. */

type Row = { id: string; actorId: string; action: string; createdAt: Date; diff: unknown };

const h = vi.hoisted(() => ({ rows: [] as Row[], args: [] as Prisma.AuditEntryFindManyArgs[] }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    auditEntry: {
      findMany: async (args: Prisma.AuditEntryFindManyArgs) => {
        h.args.push(args);
        const w = args.where as { actorId: string; entityType: string; action: { in: string[] }; createdAt: { gte: Date } };
        return h.rows
          .filter((r) => r.actorId === w.actorId && w.action.in.includes(r.action) && r.createdAt.getTime() >= w.createdAt.gte.getTime())
          .map(({ id, action, diff }) => ({ id, action, diff }));
      },
    },
  },
}));

import { clearedToday } from "./queries";

const manila = (s: string) => new Date(`${s}+08:00`);
let n = 0;
const row = (action: string, at: string, extra: Partial<Row> = {}): Row => ({ id: `aud${++n}`, actorId: "u1", action, createdAt: manila(at), diff: {}, ...extra });

beforeEach(() => {
  h.rows = [];
  h.args = [];
  n = 0;
});

describe("clearedToday", () => {
  it("counts from Manila midnight, not UTC's", async () => {
    h.rows = [
      row("lifecycle.triage", "2026-10-23T23:59:59"), // yesterday, Manila
      row("lifecycle.triage", "2026-10-24T00:00:00"),
      row("it.verify", "2026-10-24T00:20:00"),
      row("loan.due-changed", "2026-10-24T00:25:00"),
      row("lifecycle.assign", "2026-10-24T00:26:00"), // not a worklist decision
      row("lifecycle.triage", "2026-10-24T00:27:00", { actorId: "u2" }), // someone else's
    ];
    // 00:30 Manila on the 24th is still the 23rd in UTC
    expect(await clearedToday("u1", manila("2026-10-24T00:30:00"))).toBe(3);
    expect(h.args[0].where).toMatchObject({
      actorId: "u1", entityType: "asset", createdAt: { gte: new Date("2026-10-23T16:00:00Z") },
    });
  });

  it("an undo takes its decision back off the count", async () => {
    const kept = row("lifecycle.triage", "2026-10-24T09:00:00");
    h.rows = [
      kept,
      row("lifecycle.triage", "2026-10-24T09:01:00"),
      row("lifecycle.triage.undone", "2026-10-24T09:05:00", { diff: { undoes: { from: null, to: kept.id } } }),
    ];
    expect(await clearedToday("u1", manila("2026-10-24T09:10:00"))).toBe(1);
  });
});
