import type { ApprovalType, Priority, Prisma } from "@prisma/client";

/** PENDING/CLAIMED/APPROVED blockers for "one open request per asset". */
export const OPEN_APPROVAL_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

const DEFAULT_SLA_HOURS = 48;

export function newSlaAt(): Date {
  return new Date(Date.now() + DEFAULT_SLA_HOURS * 3_600_000);
}

/**
 * Phase 3 never mutates asset lifecycle directly — it creates Approval rows;
 * Phase 4's worker executes them. refNo continues the seeded APR-#### range
 * via the approval_ref_seq sequence (seed left it at 2041).
 */
export async function createApproval(
  tx: Prisma.TransactionClient,
  input: {
    type: ApprovalType;
    payload: Prisma.InputJsonObject;
    requestedById: string;
    assetId?: string;
    employeeId?: string;
    priority?: Priority;
  },
) {
  const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('approval_ref_seq')`;
  return tx.approval.create({
    data: {
      refNo: `APR-${nextval}`,
      type: input.type,
      payload: input.payload,
      requestedById: input.requestedById,
      assetId: input.assetId,
      employeeId: input.employeeId,
      priority: input.priority ?? "NORMAL",
      slaAt: newSlaAt(),
    },
  });
}

export function openApprovalForAsset(tx: Prisma.TransactionClient, assetId: string) {
  return tx.approval.findFirst({
    where: { assetId, state: { in: [...OPEN_APPROVAL_STATES] } },
    orderBy: { createdAt: "desc" },
  });
}
