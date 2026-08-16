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

export interface Loadout<A extends HeldAssetLike> {
  slots: Array<{ slot: SlotLike; asset: A | null }>;
  /** held assets no slot claimed — shown in the holding area / table view */
  unslotted: A[];
  filled: number;
  totalSlots: number;
  missingRequired: number;
}

/** Greedy fill in slot order: each slot takes the first remaining held asset of its type. */
export function computeLoadout<A extends HeldAssetLike>(slots: SlotLike[], held: A[]): Loadout<A> {
  const remaining = [...held];
  const filledSlots = slots.map((slot) => {
    const i = slot.assetTypeId ? remaining.findIndex((a) => a.typeId === slot.assetTypeId) : -1;
    return { slot, asset: i >= 0 ? remaining.splice(i, 1)[0] : null };
  });
  return {
    slots: filledSlots,
    unslotted: remaining,
    filled: filledSlots.filter((s) => s.asset).length,
    totalSlots: slots.length,
    missingRequired: filledSlots.filter((s) => !s.asset && s.slot.required).length,
  };
}
