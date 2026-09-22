/**
 * The loadout view's brain: equipment policies define expected slots per
 * role/department, so "what do they have" and "what's missing" are the same
 * glance. Role (title) policy beats department policy; policy edits never
 * touch existing assignments.
 */
export interface PolicyLike {
  id: string;
  name: string;
  appliesToTitle: string | null;
  appliesToDepartmentId: string | null;
}

export interface SlotLike {
  id: string;
  name: string;
  assetTypeId: string | null;
  required: boolean;
  /** Phase 16: filled only by a device on loan (TEMPORARY). */
  loaner: boolean;
  /** Phase 16: set when this slot comes from an ADD exception — the row's id, so the UI can remove it. */
  exceptionId?: string;
}

export interface ExceptionLike {
  id: string;
  kind: "ADD" | "WAIVE";
  slotId: string | null;
  name: string | null;
  assetTypeId: string | null;
  required: boolean;
  loaner: boolean;
}

export interface HeldAssetLike {
  id: string;
  tag: string;
  model: string;
  typeId: string | null;
  status: string;
}

export function resolvePolicy<P extends PolicyLike>(
  employee: { title: string; departmentId: string },
  policies: P[],
): P | null {
  const title = employee.title.trim().toLowerCase();
  return (
    policies.find((p) => p.appliesToTitle?.trim().toLowerCase() === title) ??
    policies.find((p) => p.appliesToDepartmentId === employee.departmentId) ??
    null
  );
}

/**
 * Phase 16 (spec §3.3): one person's slots = their policy's slots minus the
 * ones waived for them, plus the ones added for them. A waiver naming a slot
 * that is not in `slots` (their policy changed) is ignored, not an error.
 */
export function effectiveSlots(slots: SlotLike[], exceptions: ExceptionLike[]): SlotLike[] {
  const waived = new Set(exceptions.filter((e) => e.kind === "WAIVE" && e.slotId).map((e) => e.slotId as string));
  const kept = slots.filter((s) => !waived.has(s.id));
  const added = exceptions
    .filter((e) => e.kind === "ADD")
    .map<SlotLike>((e) => ({
      id: `x:${e.id}`, name: e.name ?? "extra", assetTypeId: e.assetTypeId, required: e.required, loaner: e.loaner, exceptionId: e.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [...kept, ...added];
}

/**
 * Phase 17: how many heads each policy covers, from a grouped
 * (title, departmentId) count rather than one row per employee — the same
 * resolvePolicy brain, so the number can't drift from the per-employee read
 * it replaces. A group that resolves to no policy is not counted.
 */
export function headcountByPolicy<P extends PolicyLike>(
  groups: Array<{ title: string; departmentId: string; count: number }>,
  policies: P[],
): Map<string, number> {
  const heads = new Map<string, number>();
  for (const g of groups) {
    const policy = resolvePolicy({ title: g.title, departmentId: g.departmentId }, policies);
    if (!policy) continue;
    heads.set(policy.id, (heads.get(policy.id) ?? 0) + g.count);
  }
  return heads;
}

/**
 * Bucket exception rows by the employee they belong to, preserving each
 * employee's row order. Every consumer that fetches exceptions for a set of
 * employees (the employees list, Home's hires/fleet, offboarding) needs this
 * same grouping — sharing it is what keeps the loop from drifting between
 * call sites.
 */
export function groupExceptionsByEmployee<E extends { employeeId: string }>(rows: E[]): Map<string, E[]> {
  const byEmployee = new Map<string, E[]>();
  for (const row of rows) {
    const list = byEmployee.get(row.employeeId);
    if (list) list.push(row);
    else byEmployee.set(row.employeeId, [row]);
  }
  return byEmployee;
}

export interface Loadout<A extends HeldAssetLike> {
  slots: Array<{ slot: SlotLike; asset: A | null; coveredByLoan: boolean }>;
  /** held assets no slot claimed — shown in the holding area / table view */
  unslotted: A[];
  /** Phase 16: TEMPORARY devices no loaner slot claimed — never "extras" */
  onLoan: A[];
  filled: number;
  totalSlots: number;
  missingRequired: number;
  /** Phase 20 (spec §6.3, gap 3): standard slots covered by a device on loan — see `coveredByLoan` below. */
  coveredByLoan: number;
}

/**
 * Greedy fill in slot order. A standard slot takes the first remaining
 * non-loan asset of its type; a loaner slot the first remaining TEMPORARY
 * one.
 *
 * Phase 20 (spec §6.3, gap 3): after that fill, a REQUIRED-or-not standard
 * slot left empty whose type still has a remaining TEMPORARY device is
 * "covered by loan" rather than plainly missing — someone standing in for
 * their own broken kit with a loaner is not a policy gap. The device is NOT
 * consumed (it stays in `onLoan`, exactly as before), so this second pass
 * tracks coverage in its own pool rather than splicing `remaining` — one
 * physical unit covers at most ONE slot, the same "greedy, in order" rule
 * the fill above already follows. A loaner slot's own greedy match above
 * always wins first: it is the only kind of slot whose fill condition can
 * take a TEMPORARY asset at all, so by the time this pass runs, any device a
 * loaner slot claimed is already gone from `remaining` and cannot also
 * "cover" a standard slot of the same type.
 */
export function computeLoadout<A extends HeldAssetLike>(slots: SlotLike[], held: A[]): Loadout<A> {
  const remaining = [...held];
  const filledSlots = slots.map((slot) => {
    const i = slot.assetTypeId
      ? remaining.findIndex((a) => a.typeId === slot.assetTypeId && (a.status === "TEMPORARY") === slot.loaner)
      : -1;
    return { slot, asset: i >= 0 ? remaining.splice(i, 1)[0] : null, coveredByLoan: false };
  });

  const loanPool = remaining.filter((a) => a.status === "TEMPORARY");
  for (const entry of filledSlots) {
    if (entry.asset || entry.slot.loaner || !entry.slot.assetTypeId) continue;
    const i = loanPool.findIndex((a) => a.typeId === entry.slot.assetTypeId);
    if (i >= 0) {
      entry.coveredByLoan = true;
      loanPool.splice(i, 1);
    }
  }

  return {
    slots: filledSlots,
    unslotted: remaining.filter((a) => a.status !== "TEMPORARY"),
    onLoan: remaining.filter((a) => a.status === "TEMPORARY"),
    filled: filledSlots.filter((s) => s.asset).length,
    totalSlots: slots.length,
    missingRequired: filledSlots.filter((s) => !s.asset && s.slot.required && !s.coveredByLoan).length,
    coveredByLoan: filledSlots.filter((s) => s.coveredByLoan).length,
  };
}

/** Phase 29 (spec §4.1): the header's one state-chosen primary; null when Edit should lead. */
export function profilePrimary(input: { employment: string; totalSlots: number; filled: number; missingRequired: number }): { kind: "assign-kit" | "fill-gaps" | "wizard"; label: string } | null {
  if (input.employment === "OFFBOARDING") return { kind: "wizard", label: "Open the offboarding wizard" };
  if (input.employment !== "ACTIVE" || input.totalSlots === 0) return null;
  if (input.filled === 0 && input.missingRequired > 0) return { kind: "assign-kit", label: "Assign kit" };
  if (input.missingRequired > 0) return { kind: "fill-gaps", label: `Fill ${input.missingRequired} gap${input.missingRequired === 1 ? "" : "s"}` };
  return null;
}

/** Phase 29 (spec §4.4): required gaps first, then filled (and loan-covered) tiles, then optional gaps — stable within each band. */
export function orderTiles<T extends { asset: unknown | null; required: boolean; coveredByLoan: boolean }>(tiles: T[]): T[] {
  const band = (t: T) => (!t.asset && !t.coveredByLoan ? (t.required ? 0 : 2) : 1);
  return [...tiles].sort((a, b) => band(a) - band(b));
}

export type TileMenuItem = "replace" | "return" | "open" | "reserve" | "waive" | "remove-exception";

/** Phase 29 (spec §4.4): the items a tile's menu offers, in order. Pure so the view and the tests agree. */
export function tileMenuItems(
  tile: { filled: boolean; pending: boolean; required: boolean; exceptionId: string | null; waivable: boolean },
  ctx: { mayAct: boolean; direct: boolean },
): TileMenuItem[] {
  if (tile.filled) {
    if (tile.pending || !ctx.mayAct) return ["open"];
    const items: TileMenuItem[] = [];
    if (ctx.direct) items.push("replace");
    items.push("return", "open");
    if (tile.exceptionId) items.push("remove-exception");
    else if (tile.waivable) items.push("waive");
    return items;
  }
  if (!ctx.mayAct) return [];
  const items: TileMenuItem[] = [];
  if (ctx.direct) items.push("reserve");
  if (tile.exceptionId) items.push("remove-exception");
  else if (tile.waivable) items.push("waive");
  return items;
}
