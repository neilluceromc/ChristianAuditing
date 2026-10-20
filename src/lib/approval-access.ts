import type { AssetClass, Prisma, Role } from "@prisma/client";
import { ASSET_CLASSES, MANAGEABLE_CLASSES, canManageClass } from "./asset-class";

/**
 * Phase 14 (spec §6). Who may act on an approval, and which approvals a role's
 * queue shows. Both derive from MANAGEABLE_CLASSES: the approver of a lifecycle
 * change is whoever manages the asset's class.
 */

/** A role that manages at least one class may act on SOME approval. */
export function isApprover(role: Role): boolean {
  return MANAGEABLE_CLASSES[role].length > 0;
}

/**
 * An approval with no asset has no class (the seed carries two; systemChecks
 * already reports them unexecutable). Any approver may reject one; none may
 * execute it. Spec §6.3.
 */
export function canActOnApproval(role: Role, assetCls: AssetClass | null): boolean {
  if (assetCls === null) return isApprover(role);
  return canManageClass(role, assetCls);
}

/**
 * The where-fragment that scopes a queue, badge or count. A role that manages
 * every class or no class is unfiltered — admin acts on all, finance and viewer
 * read all. A single-class role sees its class plus the class-less rows.
 */
export function approvalClassWhere(role: Role): Prisma.ApprovalWhereInput {
  const mine = MANAGEABLE_CLASSES[role];
  if (mine.length === 0 || mine.length === ASSET_CLASSES.length) return {};
  return { OR: [{ assetId: null }, { asset: { cls: { in: [...mine] } } }] };
}

/** Phase 46 (spec §2.2): the per-class split the snapshot stores approvals under; `none` = no asset. */
export type ApprovalClassKey = "it" | "purchasing" | "none";
const CLASS_KEY: Record<AssetClass, ApprovalClassKey> = { IT: "it", PURCHASING: "purchasing" };

/**
 * The snapshot classes whose sum is the role's Approvals count: the same branches as approvalClassWhere (every
 * class when it is unfiltered, else the role's classes plus the class-less rows), so a summed history tile
 * matches the page it links to for every role.
 */
export function approvalClassKeys(role: Role): ApprovalClassKey[] {
  const mine = MANAGEABLE_CLASSES[role];
  const classes = mine.length === 0 || mine.length === ASSET_CLASSES.length ? ASSET_CLASSES : mine;
  return [...classes.map((c) => CLASS_KEY[c]), "none"];
}
