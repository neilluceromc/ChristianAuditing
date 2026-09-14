import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { pagedSnapshot } from "./paged";
import { pageOf } from "@/lib/paging";

/**
 * No prisma mock exists in the suite (P-3) — `pagedSnapshot` takes an
 * optional `client`, so the fake here only has to shape `$transaction` the
 * way the real client does: call the callback with a "tx" and hand the
 * options object back out so the test can inspect it.
 */
function fakeClient(fakeTx: unknown) {
  const seen: { isolationLevel?: string } = {};
  const client = {
    $transaction: (
      fn: (tx: unknown) => Promise<unknown>,
      opts?: { isolationLevel?: string },
    ) => {
      Object.assign(seen, opts);
      return fn(fakeTx);
    },
  } as unknown as PrismaClient;
  return { client, seen };
}

describe("pagedSnapshot", () => {
  it("reads count before rows, in one RepeatableRead transaction", async () => {
    const order: string[] = [];
    const fakeTx = { marker: "tx" };
    const { client, seen } = fakeClient(fakeTx);

    const result = await pagedSnapshot(
      25,
      9,
      async (tx) => {
        expect(tx).toBe(fakeTx);
        order.push("count");
        return 30;
      },
      async (tx, pg) => {
        expect(tx).toBe(fakeTx);
        order.push("rows");
        // requested 9, total 30, size 25 -> pageOf gives page 2, skip 25
        expect(pg).toEqual(pageOf(30, 9, 25));
        return ["a", "b", "c"];
      },
      client,
    );

    expect(order).toEqual(["count", "rows"]);
    expect(seen.isolationLevel).toBe("RepeatableRead");

    const expectedPage = pageOf(30, 9, 25);
    expect(result).toEqual({ ...expectedPage, rows: ["a", "b", "c"] });
    expect(result.page).toBe(2);
    expect(result.skip).toBe(25);
  });

  it("defaults an empty page's rows call to page 1, skip 0", async () => {
    const fakeTx = { marker: "tx" };
    const { client } = fakeClient(fakeTx);

    const result = await pagedSnapshot(
      25,
      1,
      async () => 0,
      async (_tx, pg) => {
        expect(pg).toEqual(pageOf(0, 1, 25));
        return [];
      },
      client,
    );

    expect(result).toEqual({ ...pageOf(0, 1, 25), rows: [] });
  });
});
