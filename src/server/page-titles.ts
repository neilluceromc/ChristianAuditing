import { cache } from "react";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { getApproval } from "@/server/modules/approvals/queries";
import { getVisibleAsset } from "@/server/modules/inventory/queries";

/**
 * Spec §5: record pages title themselves by what they show — the asset's tag,
 * the person's name, the request's reference. These lookups run from
 * `generateMetadata`, beside the page's own render, so each one:
 * - signs the viewer in first (requireUser) and applies the same visibility
 *   rule the page does (an asset class the role cannot see names nothing);
 * - reads only the one column the title needs;
 * - returns null for a missing record — the page's own notFound() answers
 *   that, and the tab falls back to the section name.
 */

export const assetTagFor = cache(async (id: string): Promise<string | null> => {
  const user = await requireUser();
  return (await getVisibleAsset(id, user.role))?.tag ?? null;
});

export const employeeNameFor = cache(async (id: string): Promise<string | null> => {
  await requireUser();
  const row = await prisma.employee.findUnique({ where: { id }, select: { name: true } });
  return row?.name ?? null;
});

export const purchaseRefFor = cache(async (id: string): Promise<string | null> => {
  await requireUser();
  const row = await prisma.purchaseRequest.findUnique({ where: { id }, select: { refNo: true } });
  return row?.refNo ?? null;
});

export const supplierNameFor = cache(async (id: string): Promise<string | null> => {
  await requireUser();
  const row = await prisma.vendor.findUnique({ where: { id }, select: { name: true } });
  return row?.name ?? null;
});

export const stockItemTitleFor = cache(async (id: string): Promise<string | null> => {
  await requireUser();
  const row = await prisma.stockItem.findUnique({ where: { id }, select: { code: true, name: true } });
  return row ? `${row.code} · ${row.name}` : null;
});

export const stocktakeRefFor = cache(async (id: string): Promise<string | null> => {
  await requireUser();
  const row = await prisma.stocktake.findUnique({ where: { id }, select: { refNo: true } });
  return row?.refNo ?? null;
});

export const approvalRefFor = cache(async (id: string): Promise<string | null> => {
  await requireUser();
  return (await getApproval(id))?.refNo ?? null;
});
