import { describe, expect, it, vi } from "vitest";
import { regWhere } from "@/lib/registration";

/*
 * Finance follow-up, Task 3 (spec §4): "N left to review" counts exactly the set "Next:" is picked from — the class's
 * assets with Finance — so the two never disagree.
 */

const h = vi.hoisted(() => ({
  count: vi.fn(async (args: unknown) => { void args; return 4; }),
  findFirst: vi.fn(async (args: unknown) => { void args; return null; }),
}));
vi.mock("@/server/db/client", () => ({ prisma: { asset: { count: h.count, findFirst: h.findFirst } } }));

import { toReviewCount } from "./review-queue";
import { nextToReview } from "./queries";

describe("toReviewCount", () => {
  it("counts the class's assets with Finance (To review)", async () => {
    expect(await toReviewCount("PURCHASING")).toBe(4);
    expect(h.count).toHaveBeenLastCalledWith({ where: { cls: "PURCHASING", ...regWhere("with-finance") } });
  });

  it("is nextToReview's set, without the asset just decided", async () => {
    await toReviewCount("IT");
    await nextToReview("a1", "IT");
    const counted = (h.count.mock.lastCall![0] as { where: Record<string, unknown> }).where;
    const { id, ...picked } = (h.findFirst.mock.lastCall![0] as { where: Record<string, unknown> }).where;
    expect(id).toEqual({ not: "a1" });
    expect(picked).toEqual(counted);
  });
});
