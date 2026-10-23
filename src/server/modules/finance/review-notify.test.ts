import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { COLLAPSE_ABOVE, FINANCE_WORDS, notifyAssetsByTeam } from "./review-notify";

/** Just enough of a transaction client for notify(): it records what it writes. */
function fakeTx() {
  const written: Array<Record<string, unknown>> = [];
  const tx = {
    notification: { create: async ({ data }: { data: Record<string, unknown> }) => { written.push(data); return data; } },
    user: { findUnique: async () => null },
  } as unknown as Prisma.TransactionClient;
  return { tx, written };
}

const finance = { id: "u-fin", role: "finance_staff" as const };

describe("FINANCE_WORDS: the one definition of each verbatim string", () => {
  it("names every step in the Global Constraints' words", () => {
    expect(FINANCE_WORDS.accepted.one("BR-LT-1")).toBe("BR-LT-1: Finance accepted the correction");
    expect(FINANCE_WORDS.accepted.many(4)).toBe("4 corrections accepted by Finance");
    expect(FINANCE_WORDS.reopened.one("BR-LT-1")).toBe("BR-LT-1: Finance reopened its review");
    expect(FINANCE_WORDS.tookBack.one("BR-LT-1")).toBe("BR-LT-1: Finance took back the send-back");
    expect(FINANCE_WORDS.poApproved("PO-0214")).toBe("PO-0214: Finance approved all its assets");
    expect(FINANCE_WORDS.poSendBackUndone("PO-0214")).toBe("PO-0214: the send-back was taken back");
  });
});

describe("notifyAssetsByTeam", () => {
  it("one asset: one CHANGED on the asset, with the body when given", async () => {
    const { tx, written } = fakeTx();
    await notifyAssetsByTeam(
      tx, [{ team: "IT", id: "a1", tag: "BR-LT-1" }], FINANCE_WORDS.reopened, finance,
      { body: "Wrong cost", group: { entityType: "asset", entityId: "a1" } },
    );
    expect(written).toEqual([{
      team: "IT", kind: "CHANGED", title: "BR-LT-1: Finance reopened its review", body: "Wrong cost",
      href: "/inventory/a1", actorId: "u-fin", entityType: "asset", entityId: "a1",
    }]);
  });

  it("no body: written as null", async () => {
    const { tx, written } = fakeTx();
    await notifyAssetsByTeam(
      tx, [{ team: "PURCHASING", id: "a2", tag: "BR-MN-2" }], FINANCE_WORDS.accepted, finance,
      { group: { entityType: "asset", entityId: "a2" } },
    );
    expect(written.map((n) => [n.team, n.title, n.body, n.href])).toEqual([
      ["PURCHASING", "BR-MN-2: Finance accepted the correction", null, "/inventory/a2"],
    ]);
  });

  it(`past ${COLLAPSE_ABOVE} to one team: one for that team on the group; the other team keeps its own`, async () => {
    const { tx, written } = fakeTx();
    const it4 = [1, 2, 3, 4].map((i) => ({ team: "IT" as const, id: `i${i}`, tag: `BR-LT-${i}` }));
    await notifyAssetsByTeam(
      tx, [...it4, { team: "PURCHASING", id: "p1", tag: "BR-MN-1" }], FINANCE_WORDS.accepted, finance,
      { group: { entityType: "purchase-record", entityId: "r1" } },
    );
    expect(written.map((n) => [n.team, n.title, n.href, n.entityType, n.entityId])).toEqual([
      ["IT", "4 corrections accepted by Finance", "/inventory", "purchase-record", "r1"],
      ["PURCHASING", "BR-MN-1: Finance accepted the correction", "/inventory/p1", "asset", "p1"],
    ]);
  });

  it("the actor's own team is never rung", async () => {
    const { tx, written } = fakeTx();
    await notifyAssetsByTeam(
      tx, [{ team: "IT", id: "a1", tag: "BR-LT-1" }], FINANCE_WORDS.accepted, { id: "u-it", role: "it_staff" },
      { group: { entityType: "asset", entityId: "a1" } },
    );
    expect(written).toEqual([]);
  });
});
