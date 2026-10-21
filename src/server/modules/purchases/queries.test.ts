import { describe, expect, it, vi } from "vitest";

/*
 * Final review I3: the /purchases "Ready to register" tab count leaves out completed POs (they stay READY), as the
 * tab's own where does (purchaseWhere) — so the count equals the rows the tab lists.
 */

const h = vi.hoisted(() => ({ countWhere: [] as unknown[] }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    purchaseOrder: {
      groupBy: async () => [
        { state: "WITH_IT", _count: { _all: 3 } },
        { state: "READY", _count: { _all: 75 } },
        { state: "CANCELLED", _count: { _all: 16 } },
      ],
      count: async ({ where }: { where: unknown }) => {
        h.countWhere.push(where);
        return 71;
      },
    },
  },
}));

import { stateCounts } from "./queries";

describe("stateCounts", () => {
  it("Ready to register counts READY POs that are not completed; All still counts every PO", async () => {
    expect(await stateCounts()).toEqual({ ALL: 94, WITH_IT: 3, SENT_BACK: 0, READY: 4, CANCELLED: 16 });
    expect(h.countWhere).toEqual([{ state: "READY", completedAt: { not: null } }]);
  });
});
