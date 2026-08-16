import type { ApprovalType } from "@prisma/client";

/** Canonical M365 sync states; a `"use server"` file can't export a const, so it lives here. */
export const M365_CANONICAL = ["pending", "active", "offboarding", "inactive"] as const;

/** Prisma maps the dotted enum values to underscored names; the UI shows the dotted originals. */
export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
  lifecycle_assign: "lifecycle.assign",
  lifecycle_replace: "lifecycle.replace",
  lifecycle_transfer: "lifecycle.transfer",
  lifecycle_return: "lifecycle.return",
  lifecycle_change_status: "lifecycle.change-status",
};
