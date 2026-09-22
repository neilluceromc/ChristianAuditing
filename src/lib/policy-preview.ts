import { resolvePolicy, type PolicyLike } from "./loadout";

/** Phase 29 (spec §5.3): the New form's live line under Title — the same resolution the profile uses. */
export function previewPolicyFor<P extends PolicyLike & { slots: unknown[] }>(
  title: string, departmentId: string, policies: P[],
): { name: string; slots: number; via: "title" | "department" } | null {
  if (!title.trim()) return null;
  const policy = resolvePolicy({ title, departmentId }, policies);
  if (!policy) return null;
  const via = policy.appliesToTitle?.trim().toLowerCase() === title.trim().toLowerCase() ? "title" : "department";
  return { name: policy.name, slots: policy.slots.length, via };
}
