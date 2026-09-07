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
