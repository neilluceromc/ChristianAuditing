import { describe, expect, it } from "vitest";
import type { ListState } from "./url-state";
import {
  REPAIRS_SAVED_VIEW, REPAIR_STAGES, REPAIR_STAGE_LABEL, REPAIR_WRITE_OFF_SHARE,
  beyondRepair, downDays, isRepairStage, isRepairView, quoteWarning, repairStage,
  type RepairLike,
} from "./repairs";

const asset = (over: Partial<RepairLike> = {}): RepairLike => ({
  status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: null,
  cost: 55_000, defectiveSince: new Date("2026-08-01T00:00:00Z"), ...over,
});

describe("the four stages are derived, not stored", () => {
  it("names them in the order the chips render, as URL-safe ids", () => {
    expect(REPAIR_STAGES).toEqual(["to-assess", "at-vendor", "returned-ok", "beyond-repair"]);
    expect(REPAIR_STAGE_LABEL["beyond-repair"]).toBe("BEYOND REPAIR");
    expect(isRepairStage("at-vendor")).toBe(true);
    expect(isRepairStage("AT VENDOR")).toBe(false);
  });

  it("DEFECTIVE with no vendor and no RMA is still to assess (seeded BR-LT-0122, BR-KB-0402)", () => {
    expect(repairStage(asset())).toBe("to-assess");
  });

  it("a vendor OR an RMA is enough to be at the vendor (seeded BR-LT-0118, BR-MN-0731, BR-DK-0033)", () => {
    expect(repairStage(asset({ vendorId: "v1" }))).toBe("at-vendor");
    expect(repairStage(asset({ rmaRef: "RMA-8802" }))).toBe("at-vendor");
  });

  it("a quote at or above the write-off share outranks being at a vendor (seeded BR-LT-0090)", () => {
    expect(repairStage(asset({ vendorId: "v1", repairQuote: 34_000, cost: 55_000 }))).toBe("beyond-repair");
    expect(repairStage(asset({ repairQuote: 33_000, cost: 55_000 }))).toBe("beyond-repair"); // exactly 60%
    expect(repairStage(asset({ repairQuote: 18_400, cost: 55_000 }))).toBe("to-assess"); // 33% — repair it
  });

  it("an item that came back reads RETURNED OK — the one stage outside status=DEFECTIVE", () => {
    expect(repairStage(asset({ status: "SPARE" }))).toBe("returned-ok");
    expect(repairStage(asset({ status: "DEPLOYED" }))).toBe("returned-ok");
  });

  it("an asset that was never defective has no stage at all", () => {
    expect(repairStage(asset({ status: "SPARE", defectiveSince: null }))).toBeNull();
  });

  it("is inclusive on the CENTAVO grid, not just on whole pesos", () => {
    // Asset.cost is Decimal(12,2) and the forms accept centavos, so the
    // boundary has to hold here too — `quote >= cost * 0.6` does not, because
    // 10000.95 * 0.6 is 6000.570000000001 in binary floating point.
    expect(beyondRepair(6_000.57, 10_000.95)).toBe(true); // exactly 60%
    expect(beyondRepair(614.79, 1_024.65)).toBe(true); // exactly 60%
    expect(beyondRepair(3.09, 5.15)).toBe(true); // exactly 60%
    expect(beyondRepair(6_000.56, 10_000.95)).toBe(false); // one centavo under
    expect(repairStage(asset({ repairQuote: 6_000.57, cost: 10_000.95 }))).toBe("beyond-repair");
  });

  it("beyondRepair needs both numbers and refuses to divide by a zero cost", () => {
    expect(beyondRepair(34_000, 55_000)).toBe(true);
    expect(beyondRepair(null, 55_000)).toBe(false);
    expect(beyondRepair(34_000, null)).toBe(false);
    expect(beyondRepair(34_000, 0)).toBe(false);
    expect(REPAIR_WRITE_OFF_SHARE).toBe(0.6);
  });
});

describe("the Down column — the number that changes behaviour", () => {
  const now = new Date("2026-08-18T00:00:00Z");

  it("counts whole days out of service", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: new Date("2026-08-01T00:00:00Z") }, now)).toBe(17);
  });

  it("is null once the item no longer reads DEFECTIVE — the clock stopped and we don't record when", () => {
    expect(downDays({ status: "SPARE", defectiveSince: new Date("2026-08-01T00:00:00Z") }, now)).toBeNull();
  });

  it("is null without a defectiveSince, never 0 — unknown is not 'today'", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: null }, now)).toBeNull();
  });

  it("never goes negative on a clock-skewed row", () => {
    expect(downDays({ status: "DEFECTIVE", defectiveSince: new Date("2026-08-19T00:00:00Z") }, now)).toBe(0);
  });
});

describe("quoteWarning names the share, so moving the line is visible", () => {
  it("warns with both amounts and the percentage", () => {
    const warning = quoteWarning(34_000, 55_000);
    expect(warning).toContain("₱34,000");
    expect(warning).toContain("₱55,000");
    expect(warning).toContain("62%");
    expect(warning).toContain("60%");
  });

  it("says nothing about a repair worth doing", () => {
    expect(quoteWarning(18_400, 55_000)).toBeNull();
    expect(quoteWarning(null, 55_000)).toBeNull();
  });
});

describe("repairs is a saved view, so the URL decides", () => {
  // built directly rather than parsed: this is the predicate's contract, and the
  // parser's own contract (that `stage` IS a facet) is tested in inventory-list.
  const state = (filters: Record<string, string[]>): ListState => ({ q: "", page: 1, sort: [], filters });

  it("the named URL pins DEFECTIVE and sorts by the down clock", () => {
    expect(REPAIRS_SAVED_VIEW).toBe("/inventory?status=DEFECTIVE&sort=defectiveSince");
  });

  it("status pinned to exactly DEFECTIVE is repair mode", () => {
    expect(isRepairView(state({ status: ["DEFECTIVE"] }))).toBe(true);
    expect(isRepairView(state({ status: ["DEFECTIVE", "SPARE"] }))).toBe(false);
    expect(isRepairView(state({ status: ["SPARE"] }))).toBe(false);
    expect(isRepairView(state({}))).toBe(false);
  });

  it("any stage facet is repair mode, even the one that isn't DEFECTIVE", () => {
    expect(isRepairView(state({ stage: ["returned-ok"] }))).toBe(true);
    expect(isRepairView(state({ stage: ["nonsense"] }))).toBe(false);
  });
});
