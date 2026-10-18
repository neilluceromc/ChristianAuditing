import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { formatSlowQuery, parseSlowQueryMs, slowQueryHandler, withSlowQueryLog } from "./slow-query";

/** A clock that answers the given readings in order: the handler reads it once before and once after the query. */
function clock(...readings: number[]) {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)];
}

const SECRET = "hunter2-should-never-appear";

describe("parseSlowQueryMs (Phase 43 spec §4: off when unset)", () => {
  it("is off when unset, empty, zero, negative or not a number", () => {
    for (const raw of [undefined, "", "  ", "0", "-5", "abc", "NaN", "Infinity"]) {
      expect(parseSlowQueryMs(raw)).toBeNull();
    }
  });

  it("reads a positive number of milliseconds", () => {
    expect(parseSlowQueryMs("200")).toBe(200);
    expect(parseSlowQueryMs(" 50 ")).toBe(50);
    expect(parseSlowQueryMs("12.5")).toBe(12.5);
  });
});

describe("formatSlowQuery", () => {
  it("names the model and operation and rounds the duration", () => {
    expect(formatSlowQuery("Asset", "findMany", 1234.4)).toBe("[slow-query] Asset.findMany 1234ms");
  });

  it("names a raw query by its operation alone (there is no model)", () => {
    expect(formatSlowQuery(undefined, "$queryRaw", 250.6)).toBe("[slow-query] $queryRaw 251ms");
  });
});

describe("slowQueryHandler", () => {
  it("warns with model, operation and duration when the query is slower than the threshold", async () => {
    const warn = vi.fn();
    const handler = slowQueryHandler(100, { now: clock(1_000, 1_250), warn });
    const result = await handler({ model: "Asset", operation: "findMany", args: { where: { tag: "x" } }, query: async () => ["row"] });
    expect(result).toEqual(["row"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[slow-query] Asset.findMany 250ms");
  });

  it("stays silent at or under the threshold", async () => {
    const warn = vi.fn();
    const handler = slowQueryHandler(100, { now: clock(0, 100), warn });
    await handler({ model: "Asset", operation: "count", args: {}, query: async () => 3 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("never logs the query's arguments", async () => {
    const warn = vi.fn();
    const handler = slowQueryHandler(1, { now: clock(0, 5_000), warn });
    await handler({
      model: "User",
      operation: "findUnique",
      args: { where: { email: SECRET }, data: { passwordHash: SECRET } },
      query: async () => null,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
  });

  it("passes the arguments through to the query untouched", async () => {
    const args = { where: { id: "a" } };
    const query = vi.fn(async (a: unknown) => a);
    const handler = slowQueryHandler(100, { now: clock(0, 1), warn: vi.fn() });
    await expect(handler({ model: "Asset", operation: "findFirst", args, query })).resolves.toBe(args);
    expect(query).toHaveBeenCalledWith(args);
  });

  it("still reports a slow query that fails, and rethrows its error", async () => {
    const warn = vi.fn();
    const handler = slowQueryHandler(100, { now: clock(0, 700), warn });
    const boom = new Error("P2024 timed out");
    await expect(
      handler({ model: "Approval", operation: "update", args: { data: SECRET }, query: async () => { throw boom; } }),
    ).rejects.toBe(boom);
    expect(warn).toHaveBeenCalledWith("[slow-query] Approval.update 700ms");
  });
});

describe("withSlowQueryLog", () => {
  function fakeClient() {
    const extended = { extended: true };
    const $extends = vi.fn(() => extended);
    return { client: { $extends } as unknown as PrismaClient, $extends, extended };
  }

  it("returns the client itself, unextended, when SLOW_QUERY_MS is unset or not a positive number", () => {
    for (const raw of [undefined, "", "0", "off"]) {
      const { client, $extends } = fakeClient();
      expect(withSlowQueryLog(client, raw)).toBe(client);
      expect($extends).not.toHaveBeenCalled();
    }
  });

  it("adds one query extension over every operation when SLOW_QUERY_MS is set", () => {
    const { client, $extends, extended } = fakeClient();
    expect(withSlowQueryLog(client, "200")).toBe(extended);
    expect($extends).toHaveBeenCalledTimes(1);
    const ext = ($extends.mock.calls[0] as unknown[])[0] as { name: string; query: { $allOperations: unknown } };
    expect(ext.name).toBe("slow-query-log");
    expect(typeof ext.query.$allOperations).toBe("function");
  });
});
