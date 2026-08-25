import { tagKey } from "./import-assets";

/**
 * The offboarding wizard's scan rule. Pure, and deliberately outside the
 * component: three Phase 9 defects were pure logic sitting where vitest could
 * not reach it, each found only by review.
 *
 * `ScanItem` is the minimal STRUCTURAL shape this rule reads — never the
 * wizard's own `WizardItem` (`src/server/modules/offboarding/queries.ts`), so
 * the query and this rule can change independently. Two fields are already
 * narrower than what the page carries: `decided` is a boolean here where the
 * page has a nullable `decision: Decision | null`, and `blockedBy` is just the
 * blocking approval's `refNo` here where the page has `{ refNo, type } |
 * null`. Task 6, which wires this into the wizard, maps
 * `decided: i.decision != null` and `blockedBy: i.blockedBy?.refNo ?? null`.
 */
export interface ScanItem {
  assetId: string;
  tag: string;
  decided: boolean;
  /** refNo of a prior approval holding this asset's one open slot, or null. */
  blockedBy: string | null;
}

export type ScanVerdict =
  | { kind: "match"; assetId: string; tag: string }
  | { kind: "unknown"; value: string }
  | { kind: "already-decided"; tag: string }
  | { kind: "blocked"; tag: string; refNo: string }
  | { kind: "ignored" };

export function matchScan(buffer: string, items: readonly ScanItem[]): ScanVerdict {
  // tagKey is the app's own trim+upper-case rule, shared rather than
  // re-implemented: four hand-written twins of existing rules were removed in
  // Phase 9 and every one of them had drifted. tagKey already trims (it is
  // cellText(raw).toUpperCase(), and cellText trims) — an extra .trim() here
  // would be redundant and would misleadingly imply cellText does not.
  const key = tagKey(buffer);
  if (key === "") return { kind: "ignored" };

  const item = items.find((i) => tagKey(i.tag) === key);
  if (!item) return { kind: "unknown", value: key };
  // Decided beats blocked: the item is settled, and sending the operator to
  // resolve an approval they no longer need to resolve would be wrong.
  if (item.decided) return { kind: "already-decided", tag: item.tag };
  if (item.blockedBy) return { kind: "blocked", tag: item.tag, refNo: item.blockedBy };
  return { kind: "match", assetId: item.assetId, tag: item.tag };
}
