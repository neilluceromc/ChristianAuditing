import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.6, Review Focus #5): three failed sign-ins for one lower-cased email within 15 minutes
 * pause that email for 15 minutes. The SignInAttempt table is faked in memory with the same filters Postgres applies.
 */

type Row = { id: string; emailKey: string; createdAt: Date };

const h = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }));

vi.mock("../db/client", () => ({
  prisma: {
    signInAttempt: {
      create: async ({ data }: { data: { emailKey: string; createdAt?: Date } }) => {
        const row = { id: `a${++h.seq}`, emailKey: data.emailKey, createdAt: data.createdAt ?? new Date() };
        h.rows.push(row);
        return row;
      },
      findMany: async ({ where, orderBy, take }: {
        where: { emailKey: string; createdAt: { gt: Date } };
        orderBy?: { createdAt: "asc" | "desc" };
        take?: number;
      }) => {
        const found = h.rows
          .filter((r) => r.emailKey === where.emailKey && r.createdAt > where.createdAt.gt)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (orderBy?.createdAt === "desc") found.reverse();
        return (take ? found.slice(0, take) : found).map((r) => ({ createdAt: r.createdAt }));
      },
      deleteMany: async ({ where }: { where: { emailKey: string } }) => {
        const before = h.rows.length;
        h.rows = h.rows.filter((r) => r.emailKey !== where.emailKey);
        return { count: before - h.rows.length };
      },
    },
  },
}));

import { SIGN_IN_LIMIT, clearSignInFailures, recordSignInFailure, signInPaused } from "./sign-in-limit";

const T0 = new Date("2026-10-24T02:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

async function failAt(email: string, ms: number) {
  vi.setSystemTime(at(ms));
  await recordSignInFailure(email);
}

beforeEach(() => {
  h.rows = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SIGN_IN_LIMIT", () => {
  it("is three tries in 15 minutes", () => {
    expect(SIGN_IN_LIMIT).toEqual({ tries: 3, windowMs: 15 * 60_000 });
  });
});

describe("signInPaused", () => {
  it("is false with fewer than three failures", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    expect(await signInPaused("a@b.co", at(2 * MIN))).toBe(false);
  });

  it("three failures in 15 minutes pause the email", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    await failAt("a@b.co", 2 * MIN);
    expect(await signInPaused("a@b.co", at(2 * MIN + 1))).toBe(true);
  });

  it("the third failure at 14:59 after the first still pauses", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", 7 * MIN);
    await failAt("a@b.co", 14 * MIN + 59_000);
    expect(await signInPaused("a@b.co", at(15 * MIN))).toBe(true);
  });

  it("the pause lasts 15 minutes from the third failure, then lifts", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    await failAt("a@b.co", 2 * MIN);
    expect(await signInPaused("a@b.co", at(16 * MIN))).toBe(true);
    expect(await signInPaused("a@b.co", at(17 * MIN - 1))).toBe(true);
    expect(await signInPaused("a@b.co", at(17 * MIN))).toBe(false);
  });

  it("failures older than 15 minutes don't count", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    await failAt("a@b.co", 20 * MIN);
    expect(await signInPaused("a@b.co", at(20 * MIN + 1))).toBe(false);
    // Three failures spread wider than 15 minutes are not a pause either
    await failAt("b@b.co", 0);
    await failAt("b@b.co", 8 * MIN);
    await failAt("b@b.co", 16 * MIN);
    expect(await signInPaused("b@b.co", at(16 * MIN + 1))).toBe(false);
  });

  it("counts per lower-cased, trimmed email", async () => {
    await failAt("Nina@Example.com", 0);
    await failAt(" nina@example.com ", MIN);
    await failAt("NINA@EXAMPLE.COM", 2 * MIN);
    expect(h.rows.every((r) => r.emailKey === "nina@example.com")).toBe(true);
    expect(await signInPaused("nina@example.com", at(3 * MIN))).toBe(true);
    expect(await signInPaused("other@example.com", at(3 * MIN))).toBe(false);
  });
});

describe("clearSignInFailures", () => {
  it("resets the count for that email only", async () => {
    for (const ms of [0, MIN, 2 * MIN]) {
      await failAt("a@b.co", ms);
      await failAt("c@b.co", ms);
    }
    await clearSignInFailures("A@B.co");
    expect(await signInPaused("a@b.co", at(3 * MIN))).toBe(false);
    expect(await signInPaused("c@b.co", at(3 * MIN))).toBe(true);
  });
});
