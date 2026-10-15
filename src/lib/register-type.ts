/** Phase 36 (spec §3.1): Register always asks the type — never copied from an older asset of the same model. */
export const TYPE_REQUIRED = "Pick the type";

export function typeChoice(types: ReadonlyArray<{ id: string }>): { show: boolean; required: boolean; auto: string | null } {
  if (types.length === 0) return { show: false, required: false, auto: null };
  if (types.length === 1) return { show: false, required: false, auto: types[0].id };
  return { show: true, required: true, auto: null };
}

export function typeAfterCategoryChange(): string {
  return "";
}
