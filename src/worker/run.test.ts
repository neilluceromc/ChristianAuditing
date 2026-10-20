import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JOB_ATTEMPTS } from "../lib/jobs";

/* Cloud staging (spec §4.3): the worker's steps, shared by the loop, the cron routes and kickWorker(). */

type Job = { id: string; type: string; payload: unknown; attempts: number };

const h = vi.hoisted(() => ({
  leased: [] as Job[],
  leasedBy: [] as unknown[],
  updates: [] as { where: unknown; data: Record<string, unknown> }[],
  updateManys: [] as { where: unknown; data: unknown }[],
  snapshotRow: null as { id: string } | null,
  snapshotWheres: [] as unknown[],
  ticking: [] as boolean[],
}));

vi.mock("../server/db/client", () => ({
  prisma: {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      h.leasedBy.push(values[0]);
      const job = h.leased.shift();
      return job ? [job] : [];
    },
    job: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        h.updateManys.push(args);
        return { count: 0 };
      },
      update: async (args: { where: unknown; data: Record<string, unknown> }) => {
        h.updates.push(args);
        return {};
      },
    },
    metricSnapshot: {
      findFirst: async ({ where }: { where: unknown }) => {
        h.snapshotWheres.push(where);
        return h.snapshotRow;
      },
    },
  },
}));

vi.mock("./execute-approval", () => ({
  executeApproval: vi.fn(async () => {
    throw new Error("boom");
  }),
}));
vi.mock("./deliver-webhook", () => ({
  deliverWebhook: vi.fn(async () => {}),
  PermanentDeliveryError: class PermanentDeliveryError extends Error {},
}));
vi.mock("./retention", () => ({ pruneRetention: vi.fn() }));
vi.mock("./holds", () => ({ expireHolds: vi.fn() }));
vi.mock("../server/modules/metrics/snapshot", () => ({ writeSnapshot: vi.fn() }));

import { runTicks, safeSnapshot, snapshotMissing, tick } from "./run";
import { writeSnapshot } from "../server/modules/metrics/snapshot";
import { isTicking } from "../lib/worker-state";

const approvalJob = (attempts: number): Job => ({
  id: `job-${attempts}`,
  type: "EXECUTE_APPROVAL",
  payload: { approvalId: "ap-1" },
  attempts,
});

beforeEach(() => {
  h.leased = [];
  h.leasedBy = [];
  h.updates = [];
  h.updateManys = [];
  h.snapshotRow = null;
  h.snapshotWheres = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTicks", () => {
  it("runTicks stops when tick finds no job", async () => {
    const r = await runTicks({ workerId: "w-test", budgetMs: 45_000 });
    expect(r).toEqual({ done: 0, budgetHit: false });
    expect(h.leasedBy).toEqual(["w-test"]);
    expect(isTicking()).toBe(false);
  });

  it("runTicks stops at the budget", async () => {
    // Always a job waiting: only the budget can stop it.
    for (let i = 0; i < 10; i++) h.leased.push({ id: `j${i}`, type: "DELIVER_WEBHOOK", payload: { deliveryId: "d" }, attempts: 1 });
    let t = 0;
    const now = () => (t += 30_000);
    const r = await runTicks({ workerId: "w-test", budgetMs: 45_000, now });
    expect(r.budgetHit).toBe(true);
    expect(r.done).toBe(1);
    expect(isTicking()).toBe(false);
  });

  it("sets the ticking flag while it runs and clears it after", async () => {
    h.leased.push({ id: "j1", type: "DELIVER_WEBHOOK", payload: { deliveryId: "d" }, attempts: 1 });
    const seen: boolean[] = [];
    const now = () => {
      seen.push(isTicking());
      return 0;
    };
    await runTicks({ workerId: "w-test", budgetMs: 45_000, now });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(isTicking()).toBe(false);
  });

  it("keeps working past a job whose handler throws, and counts it", async () => {
    h.leased.push(approvalJob(1), { id: "j2", type: "DELIVER_WEBHOOK", payload: { deliveryId: "d" }, attempts: 1 });
    const r = await runTicks({ workerId: "w-test", budgetMs: 45_000 });
    expect(r).toEqual({ done: 2, budgetHit: false });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].data.status).toBe("PENDING");
  });
});

describe("tick", () => {
  it("a job whose handler throws is retried with backoff below MAX_JOB_ATTEMPTS and DEAD at it", async () => {
    const before = Date.now();
    h.leased.push(approvalJob(MAX_JOB_ATTEMPTS - 1));
    expect(await tick("w-test")).toBe(true);
    const retry = h.updates[0];
    expect(retry.where).toEqual({ id: `job-${MAX_JOB_ATTEMPTS - 1}` });
    expect(retry.data).toMatchObject({ status: "PENDING", lockedAt: null, lockedBy: null });
    expect(String(retry.data.lastError)).toContain("boom");
    const runAt = (retry.data.runAt as Date).getTime();
    const backoff = 2 ** (MAX_JOB_ATTEMPTS - 1) * 30_000;
    expect(runAt).toBeGreaterThanOrEqual(before + backoff);
    expect(runAt).toBeLessThanOrEqual(Date.now() + backoff);

    h.leased.push(approvalJob(MAX_JOB_ATTEMPTS));
    expect(await tick("w-test")).toBe(true);
    const dead = h.updates[1];
    expect(dead.where).toEqual({ id: `job-${MAX_JOB_ATTEMPTS}` });
    expect(dead.data.status).toBe("DEAD");
    expect(dead.data).not.toHaveProperty("runAt");
    // Neither failed job was closed as DONE.
    expect(h.updateManys).toEqual([]);
  });

  it("closes a job that succeeds as DONE, guarded on RUNNING", async () => {
    h.leased.push({ id: "j1", type: "DELIVER_WEBHOOK", payload: { deliveryId: "d" }, attempts: 1 });
    expect(await tick("w-test")).toBe(true);
    expect(h.updateManys).toEqual([{ where: { id: "j1", status: "RUNNING" }, data: { status: "DONE" } }]);
  });
});

describe("snapshotMissing", () => {
  // 03:00Z is 2026-10-20 in Manila.
  const now = new Date("2026-10-20T03:00:00Z");

  it("snapshotMissing is false when a row exists for today's Manila day", async () => {
    h.snapshotRow = { id: "s1" };
    expect(await snapshotMissing(now)).toBe(false);
    expect(h.snapshotWheres).toEqual([{ day: new Date("2026-10-20T00:00:00Z") }]);
  });

  it("is true when no row exists, and checks the Manila day (16:00Z is already tomorrow)", async () => {
    expect(await snapshotMissing(new Date("2026-10-20T16:00:00Z"))).toBe(true);
    expect(h.snapshotWheres).toEqual([{ day: new Date("2026-10-21T00:00:00Z") }]);
  });
});

describe("safeSnapshot", () => {
  it("returns true and logs the day on success", async () => {
    vi.mocked(writeSnapshot).mockResolvedValueOnce(undefined);
    const now = new Date("2026-10-20T03:00:00Z");
    expect(await safeSnapshot(now)).toBe(true);
    expect(writeSnapshot).toHaveBeenCalledWith(now);
    expect(console.log).toHaveBeenCalledWith("[worker] metric snapshot written for 2026-10-20");
  });

  it("safeSnapshot returns false and logs on failure", async () => {
    vi.mocked(writeSnapshot).mockRejectedValueOnce(new Error("db down"));
    expect(await safeSnapshot(new Date("2026-10-20T03:00:00Z"))).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[worker] metric snapshot failed: db down");
  });
});
