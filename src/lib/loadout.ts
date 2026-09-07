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

export interface Loadout<A extends HeldAssetLike> {
  slots: Array<{ slot: SlotLike; asset: A | null }>;
  /** held assets no slot claimed — shown in the holding area / table view */
  unslotted: A[];
  /** Phase 16: TEMPORARY devices no loaner slot claimed — never "extras" */
  onLoan: A[];
  filled: number;
  totalSlots: number;
  missingRequired: number;
}

/** Greedy fill in slot order. A standard slot takes the first remaining non-loan asset of its type; a loaner slot the first remaining TEMPORARY one. */
export function computeLoadout<A extends HeldAssetLike>(slots: SlotLike[], held: A[]): Loadout<A> {
  const remaining = [...held];
  const filledSlots = slots.map((slot) => {
    const i = slot.assetTypeId
      ? remaining.findIndex((a) => a.typeId === slot.assetTypeId && (a.status === "TEMPORARY") === slot.loaner)
      : -1;
    return { slot, asset: i >= 0 ? remaining.splice(i, 1)[0] : null };
  });
  return {
    slots: filledSlots,
    unslotted: remaining.filter((a) => a.status !== "TEMPORARY"),
    onLoan: remaining.filter((a) => a.status === "TEMPORARY"),
    filled: filledSlots.filter((s) => s.asset).length,
    totalSlots: slots.length,
    missingRequired: filledSlots.filter((s) => !s.asset && s.slot.required).length,
  };
}
