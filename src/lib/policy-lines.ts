export interface PolicyLine { slotId?: string; assetTypeId: string; required: boolean; loaner: boolean }
export interface ExistingSlot { id: string; assetTypeId: string | null; required: boolean; loaner: boolean; name: string }
export interface SlotPlan {
  update: Array<{ id: string; assetTypeId: string; required: boolean; loaner: boolean }>;
  create: PolicyLine[];
  remove: string[];
}

export const POLICY_LINES_MIN = "Add at least one item, or remove the policy";

/**
 * Phase 37 (spec §3.1): turns the editor's lines into slot writes. A line carrying a slotId that exists is an
 * update (even when unchanged, so its waivers survive); other lines are creates; existing slots no line
 * references are removed. A slotId not in `existing` is a create, and a slotId used twice is an update once
 * and a create after that.
 */
export function planSlotChanges(existing: ExistingSlot[], lines: PolicyLine[]): SlotPlan {
  const known = new Set(existing.map((s) => s.id));
  const used = new Set<string>();
  const plan: SlotPlan = { update: [], create: [], remove: [] };
  for (const line of lines) {
    if (line.slotId && known.has(line.slotId) && !used.has(line.slotId)) {
      used.add(line.slotId);
      plan.update.push({ id: line.slotId, assetTypeId: line.assetTypeId, required: line.required, loaner: line.loaner });
    } else {
      plan.create.push({ assetTypeId: line.assetTypeId, required: line.required, loaner: line.loaner });
    }
  }
  plan.remove = existing.filter((s) => !used.has(s.id)).map((s) => s.id);
  return plan;
}

/** Base policy = the group's name; a title rule = "{group} · {title}"; a clash adds " (2)", " (3)" … */
export function policyNameFor(groupName: string, title: string | null, taken: (name: string) => boolean): string {
  const base = title ? `${groupName} · ${title}` : groupName;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken(candidate)) return candidate;
  }
}
