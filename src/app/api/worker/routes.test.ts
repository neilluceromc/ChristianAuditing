import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Cloud staging (spec §4.3): the routes Supabase pg_cron calls. Secret-guarded; never an escaped 500. */

vi.mock("@/worker/run", () => ({
  recoverStale: vi.fn(),
  runTicks: vi.fn(),
  safePrune: vi.fn(),
  safeExpire: vi.fn(),
  safeSnapshot: vi.fn(),
  snapshotMissing: vi.fn(),
}));

import * as run from "@/worker/run";
import * as tickRoute from "./tick/route";
import * as maintenanceRoute from "./maintenance/route";

const SECRET = "test-cron-secret";

function req(path: string, auth?: string): Request {
  return new Request(`http://localhost/api/worker/${path}`, {
    method: "POST",
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.mocked(run.recoverStale).mockResolvedValue(2);
  vi.mocked(run.runTicks).mockResolvedValue({ done: 3, budgetHit: false });
  vi.mocked(run.safePrune).mockResolvedValue(undefined);
  vi.mocked(run.safeExpire).mockResolvedValue(undefined);
  vi.mocked(run.safeSnapshot).mockResolvedValue(true);
  vi.mocked(run.snapshotMissing).mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("route config", () => {
  it("both routes run up to 60 s and are never cached", () => {
    for (const r of [tickRoute, maintenanceRoute]) {
      expect(r.maxDuration).toBe(60);
      expect(r.dynamic).toBe("force-dynamic");
    }
  });
});

describe.each([
  ["tick", tickRoute.POST],
  ["maintenance", maintenanceRoute.POST],
] as const)("POST /api/worker/%s auth", (path, POST) => {
  it("401 with no header", async () => {
    const res = await POST(req(path));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(run.runTicks).not.toHaveBeenCalled();
    expect(run.safePrune).not.toHaveBeenCalled();
  });

  it("401 with the wrong secret", async () => {
    const res = await POST(req(path, "Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("401 when CRON_SECRET is unset, even with header `Bearer `", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(req(path, "Bearer "));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(run.recoverStale).not.toHaveBeenCalled();
    expect(run.safePrune).not.toHaveBeenCalled();
  });

  it("401 when CRON_SECRET is deleted, even with header `Bearer undefined`", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const res = await POST(req(path, "Bearer undefined"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/worker/tick", () => {
  it("200 with the JSON shape", async () => {
    const res = await tickRoute.POST(req("tick", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recovered: 2, done: 3, budgetHit: false });
    expect(run.recoverStale).toHaveBeenCalledTimes(1);
    expect(run.runTicks).toHaveBeenCalledWith(expect.objectContaining({ budgetMs: 45_000 }));
    expect(vi.mocked(run.recoverStale).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(run.runTicks).mock.invocationCallOrder[0],
    );
  });

  it("an unexpected error is logged and answered as a 503 JSON body, never an escaped 500", async () => {
    vi.mocked(run.runTicks).mockRejectedValueOnce(new Error("connection refused"));
    const res = await tickRoute.POST(req("tick", `Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "connection refused" });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("POST /api/worker/maintenance", () => {
  it("200 with the JSON shape: prune, expire, then the missing snapshot is written", async () => {
    const res = await maintenanceRoute.POST(req("maintenance", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: "written" });
    const order = [run.safePrune, run.safeExpire, run.snapshotMissing, run.safeSnapshot].map(
      (fn) => vi.mocked(fn).mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("Maintenance returns `exists` when snapshotMissing is false, and writes nothing", async () => {
    vi.mocked(run.snapshotMissing).mockResolvedValueOnce(false);
    const res = await maintenanceRoute.POST(req("maintenance", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: "exists" });
    expect(run.safeSnapshot).not.toHaveBeenCalled();
    expect(run.safePrune).toHaveBeenCalledTimes(1);
    expect(run.safeExpire).toHaveBeenCalledTimes(1);
  });

  it("returns `failed` when the snapshot write fails", async () => {
    vi.mocked(run.safeSnapshot).mockResolvedValueOnce(false);
    const res = await maintenanceRoute.POST(req("maintenance", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: "failed" });
  });

  it("returns `failed`, not a 500, when the snapshot check itself throws", async () => {
    vi.mocked(run.snapshotMissing).mockRejectedValueOnce(new Error("db down"));
    const res = await maintenanceRoute.POST(req("maintenance", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: "failed" });
    expect(run.safeSnapshot).not.toHaveBeenCalled();
  });
});
