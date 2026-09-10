import { fmtMoney } from "./format";
import { withFilter, type ListState } from "./url-state";

/**
 * Repairs is a SAVED VIEW over the inventory list, not a route and not an enum
 * (README 7b): every stage is derived from the vendor/RMA/quote/defectiveSince
 * fields that already exist on Asset. Ids are URL-safe slugs; the uppercase
 * words are display only.
 */
export const REPAIR_STAGES = ["to-assess", "at-vendor", "returned-ok", "beyond-repair"] as const;

export type RepairStage = (typeof REPAIR_STAGES)[number];

export const REPAIR_STAGE_LABEL: Record<RepairStage, string> = {
  "to-assess": "TO ASSESS",
  "at-vendor": "AT VENDOR",
  "returned-ok": "RETURNED OK",
  "beyond-repair": "BEYOND REPAIR",
};

/** The named URL behind the "Repairs" saved view — sorted by the down clock, oldest first. */
export const REPAIRS_SAVED_VIEW = "/inventory?status=DEFECTIVE&sort=defectiveSince";

/**
 * A stated default, not a discovered truth (scope decision #6): a quote at or
 * above this share of what the unit cost is a replace decision, not a repair
 * one. It lives in exactly one place so moving the line is a one-line change.
 */
export const REPAIR_WRITE_OFF_SHARE = 0.6;

export interface RepairLike {
  status: string;
  vendorId: string | null;
  rmaRef: string | null;
  repairQuote: number | null;
  cost: number | null;
  defectiveSince: Date | null;
}

export function isRepairStage(value: string): value is RepairStage {
  return (REPAIR_STAGES as readonly string[]).includes(value);
}

export function beyondRepair(quote: number | null, cost: number | null): boolean {
  if (quote === null || cost === null || cost <= 0) return false;
  // Compared in whole centavos, which is exact for the Decimal(12,2) these
  // come from. `quote >= cost * 0.6` is NOT inclusive on the centavo grid:
  // 10000.95 * 0.6 is 6000.570000000001 in IEEE-754, so a ₱6,000.57 quote on a
  // ₱10,000.95 unit — exactly the 60% the copy calls "at or above" — fell to
  // the wrong side and dropped the write-off warning entirely. Whole-peso
  // costs never hit it, which is why the seed and the first test did not.
  return Math.round(quote * 100) >= Math.round(cost * REPAIR_WRITE_OFF_SHARE * 100);
}

/**
 * RETURNED OK deliberately steps outside `status=DEFECTIVE` — it is the stage
 * for an item that came back — which is why the chips write a URL rather than
 * filtering the current page.
 */
export function repairStage(a: RepairLike): RepairStage | null {
  if (a.status !== "DEFECTIVE") return a.defectiveSince ? "returned-ok" : null;
  if (beyondRepair(a.repairQuote, a.cost)) return "beyond-repair";
  if (a.vendorId || a.rmaRef) return "at-vendor";
  return "to-assess";
}

/**
 * Days out of service — the column that changes behaviour. null once the item
 * no longer reads DEFECTIVE: the clock stopped and we don't record when, so a
 * number here would be a lie.
 */
export function downDays(
  a: Pick<RepairLike, "status" | "defectiveSince">,
  now: Date = new Date(),
): number | null {
  if (a.status !== "DEFECTIVE" || !a.defectiveSince) return null;
  return Math.max(0, Math.floor((now.getTime() - a.defectiveSince.getTime()) / 86_400_000));
}

/** The sentence on the record when repairing costs too much of a new unit. */
export function quoteWarning(quote: number | null, cost: number | null): string | null {
  if (!beyondRepair(quote, cost)) return null;
  const share = Math.round((quote! / cost!) * 100);
  return `The ${fmtMoney(quote)} quote is ${share}% of the ${fmtMoney(cost)} this unit cost — at or above the ${Math.round(REPAIR_WRITE_OFF_SHARE * 100)}% write-off line. Replace rather than repair.`;
}

/**
 * What a stage chip writes. A stage and a status are two answers to the same
 * question, and one stage — `returned-ok` — is DEFINED as "not DEFECTIVE", so
 * writing a stage always clears `status`.
 *
 * Without this, a chip clicked from REPAIRS_SAVED_VIEW keeps that view's
 * `status=DEFECTIVE` pin (`withFilter` replaces only the facet it is handed)
 * and composes to `status IN (DEFECTIVE) AND (status = DEFECTIVE OR
 * defectiveSince IS NOT NULL)` — which matches nothing, for every possible
 * dataset, while the chip row still shows both filters as active. It lives
 * here, beside the rule, rather than in the chip component, so that a second
 * chip somewhere else cannot reintroduce the contradiction.
 *
 * Clearing the stage (`null`) restores the `status=DEFECTIVE` pin rather than
 * clearing both: un-picking a chip means "show me all defective again", and
 * leaving both empty would drop the list out of repair mode altogether —
 * `isRepairView` would go false and the Stage and Down columns would vanish.
 */
export function withRepairStage(state: ListState, stage: RepairStage | null): ListState {
  return stage
    ? withFilter(withFilter(state, "stage", [stage]), "status", [])
    : withFilter(withFilter(state, "stage", []), "status", ["DEFECTIVE"]);
}

/** The inventory list switches into repair mode when the URL says so. */
export function isRepairView(state: ListState): boolean {
  if ((state.filters.stage ?? []).some(isRepairStage)) return true;
  const status = state.filters.status ?? [];
  return status.length === 1 && status[0] === "DEFECTIVE";
}

/**
 * Phase 20 (spec §6.6, plan P-1): `repairStageIds`' `$queryRaw` computes a
 * stage entirely in SQL, over the repair candidate set — this string is
 * exactly that CASE expression, mirroring `repairStage` above rule for rule.
 * vitest has no database, so this file's own unit test proves this text
 * against `repairStageFixture` below by re-deriving each row's expected
 * stage from `repairStage` (the one JS rule both this comment and the test
 * describe), and the SQL's actual agreement with that rule is proven
 * end-to-end in `it-gaps.spec.ts` (comparing the raw cut against
 * `repairStage` over every seeded asset) — nothing in this codebase
 * executes this string as a query; it exists so the two tests share one
 * written source of truth instead of a hand-copied twin that can drift.
 */
export const REPAIR_STAGE_CASE_SQL = `
CASE
  WHEN status <> 'DEFECTIVE' AND "defectiveSince" IS NOT NULL THEN 'returned-ok'
  WHEN status = 'DEFECTIVE' AND "repairQuote" IS NOT NULL AND cost > 0
    AND ROUND("repairQuote" * 100) >= ROUND(cost * 0.6 * 100) THEN 'beyond-repair'
  WHEN status = 'DEFECTIVE' AND ("vendorId" IS NOT NULL OR "rmaRef" IS NOT NULL) THEN 'at-vendor'
  ELSE 'to-assess'
END
`.trim();

/** One fixture row: a `RepairLike` asset plus the stage `repairStage` must return for it. */
export interface RepairStageFixtureRow {
  label: string;
  asset: RepairLike;
  expected: RepairStage | null;
}

/**
 * Twelve rows covering every branch of `repairStage` (and, via
 * `REPAIR_STAGE_CASE_SQL`'s comment above, every branch of its SQL mirror):
 * plain / vendor / RMA / high quote / exactly-60% quote / the centavo edge /
 * one centavo under the edge / a low quote / a quote with no cost to compare
 * against / a quote-less row with both a vendor and an RMA / a returned item
 * / an item that was never defective at all.
 */
export const repairStageFixture: RepairStageFixtureRow[] = [
  {
    label: "DEFECTIVE, no vendor, no RMA, no quote — nothing to go on yet",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: null, cost: 55_000, defectiveSince: new Date("2026-08-01T00:00:00Z") },
    expected: "to-assess",
  },
  {
    label: "DEFECTIVE with a vendor",
    asset: { status: "DEFECTIVE", vendorId: "v1", rmaRef: null, repairQuote: null, cost: 55_000, defectiveSince: new Date("2026-08-01T00:00:00Z") },
    expected: "at-vendor",
  },
  {
    label: "DEFECTIVE with an RMA ref, no vendor",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: "RMA-8802", repairQuote: null, cost: 55_000, defectiveSince: new Date("2026-08-01T00:00:00Z") },
    expected: "at-vendor",
  },
  {
    label: "DEFECTIVE, a vendor AND a high quote — the quote outranks being at a vendor",
    asset: { status: "DEFECTIVE", vendorId: "v1", rmaRef: null, repairQuote: 34_000, cost: 55_000, defectiveSince: null },
    expected: "beyond-repair",
  },
  {
    label: "DEFECTIVE, quote exactly 60% on round pesos",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: 33_000, cost: 55_000, defectiveSince: null },
    expected: "beyond-repair",
  },
  {
    label: "DEFECTIVE, the centavo edge — 6000.57 on 10000.95 is exactly 60%",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: 6_000.57, cost: 10_000.95, defectiveSince: null },
    expected: "beyond-repair",
  },
  {
    label: "DEFECTIVE, one centavo under the edge — 6000.56 on 10000.95",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: 6_000.56, cost: 10_000.95, defectiveSince: null },
    expected: "to-assess",
  },
  {
    label: "DEFECTIVE, quote clearly under 60% — repair it",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: 18_400, cost: 55_000, defectiveSince: null },
    expected: "to-assess",
  },
  {
    label: "DEFECTIVE, quote present but cost is 0 — nothing to compare against",
    asset: { status: "DEFECTIVE", vendorId: null, rmaRef: null, repairQuote: 5_000, cost: 0, defectiveSince: null },
    expected: "to-assess",
  },
  {
    label: "DEFECTIVE, no quote, but both a vendor AND an RMA — still at-vendor, not double-counted",
    asset: { status: "DEFECTIVE", vendorId: "v1", rmaRef: "RMA-9001", repairQuote: null, cost: 55_000, defectiveSince: null },
    expected: "at-vendor",
  },
  {
    label: "not DEFECTIVE, but it was — returned OK",
    asset: { status: "SPARE", vendorId: null, rmaRef: null, repairQuote: null, cost: 55_000, defectiveSince: new Date("2026-08-01T00:00:00Z") },
    expected: "returned-ok",
  },
  {
    label: "never DEFECTIVE — no stage at all",
    asset: { status: "DEPLOYED", vendorId: null, rmaRef: null, repairQuote: null, cost: 55_000, defectiveSince: null },
    expected: null,
  },
];
