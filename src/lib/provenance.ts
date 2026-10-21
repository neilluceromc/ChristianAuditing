import type { Prisma } from "@prisma/client";

/** Spec §6. Derived from two columns; never stored (§6a: derived state beats stored state). */
export type Provenance = "PURCHASE_REQUEST" | "DIRECT" | "HISTORICAL";
export const PROVENANCES: readonly Provenance[] = ["PURCHASE_REQUEST", "DIRECT", "HISTORICAL"];
export const PROVENANCE_LABEL: Record<Provenance, string> = {
  PURCHASE_REQUEST: "From a purchase request",
  DIRECT: "Registered directly",
  HISTORICAL: "Historical import",
};

/** Migration 38: the column is the PO link now (`purchaseOrderId`); the "PURCHASE_REQUEST" value stays as the URL key. */
export function provenanceOf(a: { purchaseOrderId: string | null; importedAt: Date | null }): Provenance {
  if (a.purchaseOrderId) return "PURCHASE_REQUEST";
  return a.importedAt ? "HISTORICAL" : "DIRECT";
}

export function provenanceWhere(p: Provenance): Prisma.AssetWhereInput {
  switch (p) {
    case "PURCHASE_REQUEST": return { purchaseOrderId: { not: null } };
    case "DIRECT": return { purchaseOrderId: null, importedAt: null };
    case "HISTORICAL": return { purchaseOrderId: null, importedAt: { not: null } };
  }
}

export function parseProvenance(raw: string | null | undefined): Provenance | null {
  return raw && (PROVENANCES as readonly string[]).includes(raw) ? (raw as Provenance) : null;
}
