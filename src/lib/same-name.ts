import { refKey } from "./tag-key";

/**
 * Phase 20 (spec §5). The same-name directory guard's own key — a thin,
 * named wrapper over `refKey` so `findSameName` and the import cause read as
 * "the same-name rule" rather than a reader having to know `refKey` (a
 * `tag-key.ts` export written for the import machinery) is what backs it.
 */
export function sameNameKey(name: string): string {
  return refKey(name);
}

/**
 * Scoped to a department (spec §5): two employees sharing a name in
 * DIFFERENT departments are not a collision, only two people with the same
 * name. Both halves go through `refKey` for the identical reason every
 * other NAME-keyed lookup in this app does (see `tag-key.ts`'s own
 * comment) — trimmed, lower-cased, internal whitespace collapsed — so a
 * sheet cell and a stored record agree even when one of them carries an
 * NBSP or extra spacing.
 */
export function nameDeptKey(name: string, departmentName: string): string {
  return `${refKey(name)}|${refKey(departmentName)}`;
}
