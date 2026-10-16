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

/**
 * Phase 37 (spec §3.1, copy to others): gives each copied line the id of the first unused existing slot with the
 * same assetTypeId, in order, so identical lines stay updates and their waivers survive. A line with no match
 * carries no slotId (a create); existing slots nothing matched are left for planSlotChanges to remove.
 */
export function matchCopiedLines(existing: ExistingSlot[], lines: PolicyLine[]): PolicyLine[] {
  const used = new Set<string>();
  return lines.map((line) => {
    const match = existing.find((s) => s.assetTypeId === line.assetTypeId && !used.has(s.id));
    const rest: PolicyLine = { assetTypeId: line.assetTypeId, required: line.required, loaner: line.loaner };
    if (!match) return rest;
    used.add(match.id);
    return { ...rest, slotId: match.id };
  });
}

/**
 * Phase 37 (spec §3.3, editor): the slot id an edited line carries. A line keeps the slot it was loaded with while
 * its type is unchanged or still in the category it was loaded with; moving it to another category makes it a new
 * slot (no id), and moving it back restores the id, so an edit undone reads as unchanged.
 */
export function editedSlotId(
  loaded: { slotId?: string; assetTypeId: string; categoryId?: string },
  now: { assetTypeId: string; categoryId?: string },
): string | undefined {
  if (!loaded.slotId) return undefined;
  if (now.assetTypeId === loaded.assetTypeId) return loaded.slotId;
  return loaded.categoryId !== undefined && now.categoryId === loaded.categoryId ? loaded.slotId : undefined;
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
