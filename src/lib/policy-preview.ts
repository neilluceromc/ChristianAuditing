import { numberSlotLabels, resolvePolicy, slotLabel, type PolicyLike } from "./loadout";

/** A policy slot as the preview reads it: the flags plus its type and category (null on an untyped legacy slot). */
export interface PreviewSlot {
  name: string;
  required: boolean;
  loaner: boolean;
  assetTypeId: string | null;
  assetType: { name: string; category: { name: string } } | null;
}

/** Phase 37 (spec §5.1): one numbered line of the resolved policy — "Monitor", "Monitor 2" … */
export interface PolicyLine {
  label: string;
  required: boolean;
  loaner: boolean;
  assetTypeId: string | null;
}

export interface PolicyPreviewResult {
  name: string;
  slots: number;
  via: "title" | "department";
  lines: PolicyLine[];
}

/** Lines in slot order; labels from the type (§3.2), numbered on repeats; an untyped legacy slot keeps its name. */
export function policyLines(slots: PreviewSlot[]): PolicyLine[] {
  const labels = numberSlotLabels(slots.map((s) => (s.assetType ? slotLabel(s.assetType.category.name, s.assetType.name) : s.name)));
  return slots.map((s, i) => ({ label: labels[i], required: s.required, loaner: s.loaner, assetTypeId: s.assetTypeId }));
}

/**
 * Phase 29 (spec §5.3): the New form's live line under Title — the same resolution the profile uses.
 * Phase 37 (spec §5.1): the lines come too, and with no title yet the group's own base policy is what
 * "what is entered so far" resolves to (the Add-employee panel shows it before a title is typed).
 */
export function previewPolicyFor<P extends PolicyLike & { slots: PreviewSlot[] }>(
  title: string, departmentId: string, policies: P[],
): PolicyPreviewResult | null {
  const typed = title.trim();
  const policy = typed
    ? resolvePolicy({ title, departmentId }, policies)
    : departmentId
      ? policies.find((p) => p.appliesToDepartmentId === departmentId && !p.appliesToTitle) ?? null
      : null;
  if (!policy) return null;
  const via = typed && policy.appliesToTitle?.trim().toLowerCase() === typed.toLowerCase() ? "title" : "department";
  return { name: policy.name, slots: policy.slots.length, via, lines: policyLines(policy.slots) };
}
