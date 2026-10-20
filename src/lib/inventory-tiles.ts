import type { AssetClass } from "@prisma/client";
import type { StatusFamily } from "./status";
import type { ListState } from "./url-state";
import type { TileDef } from "@/components/patterns/count-tiles";

/** One count tile of the inventory list: a status filter, or the attention filter. */
export interface TileSpec {
  key: string;
  label: string;
  /** the 12 px line under the number */
  caption: string;
  family: StatusFamily;
  /** the status this tile filters to; absent on the attention tile */
  status?: string;
  /** the attention tile (`?attention=1`) */
  attention?: true;
}

const ATTENTION: TileSpec = {
  key: "attention", label: "Need attention", caption: "Someone owes an action", family: "attention", attention: true,
};

/** Phase 45 (spec §2.1): the tiles per class. Retired and Sold are closed states and get none. */
export const TILE_SPECS: Record<AssetClass, TileSpec[]> = {
  IT: [
    { key: "in-stock", label: "In stock", caption: "Spare, ready to assign", family: "neutral", status: "SPARE" },
    { key: "deployed", label: "Deployed", caption: "With staff", family: "settled", status: "DEPLOYED" },
    { key: "on-loan", label: "Loan", caption: "Due back", family: "inflight", status: "TEMPORARY" },
    { key: "in-repair", label: "In repair", caption: "Defective, out of service", family: "fault", status: "DEFECTIVE" },
    { key: "missing", label: "Missing", caption: "Custody lost", family: "fault", status: "MISSING" },
    ATTENTION,
  ],
  PURCHASING: [
    { key: "in-use", label: "In use", caption: "Working where it is", family: "settled", status: "OPERATIONAL" },
    { key: "stored", label: "Stored", caption: "Kept, ready to use", family: "neutral", status: "STORED" },
    { key: "repairing", label: "Repairing", caption: "Out for repair", family: "fault", status: "REPAIRING" },
    { key: "lost", label: "Lost", caption: "Custody lost", family: "fault", status: "LOST" },
    ATTENTION,
  ],
};

/**
 * The list state a click on a tile leads to. One tile is pressed at a time: pressing it again (`on`) clears the
 * status and attention filters; otherwise only this tile's filter is set and the other is cleared. Page 1 always.
 */
export function tileState(state: ListState, spec: TileSpec, on: boolean): ListState {
  const filters = { ...state.filters };
  delete filters.status;
  delete filters.attention;
  if (!on) {
    if (spec.attention) filters.attention = ["1"];
    else if (spec.status) filters.status = [spec.status];
  }
  return { ...state, filters, page: 1 };
}

function isOn(state: ListState, spec: TileSpec): boolean {
  const statuses = state.filters.status ?? [];
  const attention = state.filters.attention?.includes("1") ?? false;
  if (spec.attention) return attention && statuses.length === 0;
  return !attention && statuses.length === 1 && statuses[0] === spec.status;
}

/** The tiles for a class; none in the Repairs view (any `stage` set), where the stage chips do the job. */
export function buildInventoryTiles(
  cls: AssetClass,
  state: ListState,
  counts: Record<string, number>,
  hrefFor: (s: ListState) => string,
): TileDef[] {
  if (state.filters.stage?.length) return [];
  return TILE_SPECS[cls].map((spec) => {
    const on = isOn(state, spec);
    return {
      key: spec.key,
      label: spec.label,
      caption: spec.caption,
      family: spec.family,
      count: counts[spec.key] ?? 0,
      href: hrefFor(tileState(state, spec, on)),
      on,
    };
  });
}
