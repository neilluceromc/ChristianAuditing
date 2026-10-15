import type { AssetClass, Prisma } from "@prisma/client";
import { isAwaitingItCheck } from "./asset-class";

/**
 * Phase 35 (spec §3.1): an asset's registration review, DERIVED from today's columns — never stored.
 * Order matters: awaiting IT → registered → needs correction → with Finance.
 */
export type RegState = "awaiting-it" | "with-finance" | "needs-correction" | "registered";
export const REG_STATES: readonly RegState[] = ["needs-correction", "with-finance", "awaiting-it", "registered"];

export const REG_LABEL: Record<RegState, string> = {
  "awaiting-it": "Waiting for IT check",
  "with-finance": "With Finance",
  "needs-correction": "Needs correction",
  registered: "Fully registered",
};

export const REG_LABEL_FINANCE: Record<RegState, string> = {
  "awaiting-it": "Waiting for IT",
  "with-finance": "To review",
  "needs-correction": "Sent back",
  registered: "Approved",
};

export interface RegFacts { cls: AssetClass; itVerifiedAt: Date | null; financeConfirmedAt: Date | null; financeReturnedAt: Date | null }

export function registrationState(a: RegFacts): RegState {
  if (isAwaitingItCheck(a)) return "awaiting-it";
  if (a.financeConfirmedAt) return "registered";
  if (a.financeReturnedAt) return "needs-correction";
  return "with-finance";
}

/** The list/record label: "Fully registered" gains "· not capitalised" when Finance approved it that way (spec §3.1). */
export function regLabel(state: RegState, notCapitalised: boolean): string {
  return state === "registered" && notCapitalised ? `${REG_LABEL.registered} · not capitalised` : REG_LABEL[state];
}

/**
 * Spec §3.6 (final review I-1): an APPROVED asset that had no cost and is given one goes back to Finance —
 * Finance never saw that cost. Covers "approved as not capitalised" and legacy approvals with no cost.
 */
export function shouldReopen(asset: { financeConfirmedAt: Date | null; cost: unknown }, newCost: unknown): boolean {
  return asset.financeConfirmedAt !== null && asset.cost === null && newCost !== null;
}

export function parseRegState(raw: string | null | undefined): RegState | null {
  return raw && (REG_STATES as readonly string[]).includes(raw) ? (raw as RegState) : null;
}

const AWAITING_IT: Prisma.AssetWhereInput = { cls: "IT", itVerifiedAt: null };

export function regWhere(s: RegState): Prisma.AssetWhereInput {
  switch (s) {
    case "awaiting-it": return { ...AWAITING_IT };
    case "registered": return { NOT: AWAITING_IT, financeConfirmedAt: { not: null } };
    case "needs-correction": return { NOT: AWAITING_IT, financeConfirmedAt: null, financeReturnedAt: { not: null } };
    case "with-finance": return { NOT: AWAITING_IT, financeConfirmedAt: null, financeReturnedAt: null };
  }
}

/**
 * Phase 35 (spec §3.3, plan P-7): every field IT or Purchasing can fix from Edit (or the Documents tab),
 * in the form's order. Keys equal AssetForm's field keys, so the Edit page can flag them; documents are `doc:<kind>`.
 */
export const REGISTRATION_FIELDS = [
  { key: "cost", label: "Cost", group: "Purchase" },
  { key: "purchasedAt", label: "Purchase date", group: "Purchase" },
  { key: "vendorId", label: "Vendor", group: "Purchase" },
  { key: "invoiceRef", label: "Invoice no.", group: "Purchase" },
  { key: "receiptRef", label: "Official receipt (OR) no.", group: "Purchase" },
  { key: "warrantyUntil", label: "Warranty until", group: "Warranty" },
  { key: "warrantyCoveredBy", label: "Covered by", group: "Warranty" },
  { key: "warrantyContact", label: "Who to call for repairs", group: "Warranty" },
  { key: "brand", label: "Brand", group: "Asset details" },
  { key: "model", label: "Model", group: "Asset details" },
  { key: "categoryId", label: "Category", group: "Asset details" },
  { key: "serial", label: "Serial number", group: "Asset details" },
  { key: "doc:invoice", label: "Sales invoice", group: "Documents" },
  { key: "doc:official-receipt", label: "Official receipt", group: "Documents" },
  { key: "doc:warranty-slip", label: "Warranty slip", group: "Documents" },
  { key: "doc:delivery-receipt", label: "Delivery receipt", group: "Documents" },
  { key: "other", label: "Other (explain in the note)", group: "Anything else" },
] as const;

export type RegFieldKey = (typeof REGISTRATION_FIELDS)[number]["key"];
export type RegFieldGroup = (typeof REGISTRATION_FIELDS)[number]["group"];
export const REGISTRATION_FIELD_KEYS = REGISTRATION_FIELDS.map((f) => f.key) as unknown as [RegFieldKey, ...RegFieldKey[]];
export const REG_FIELD_GROUPS: readonly RegFieldGroup[] = ["Purchase", "Warranty", "Asset details", "Documents", "Anything else"];

export function fieldLabels(keys: readonly string[]): string[] {
  const set = new Set(keys);
  return REGISTRATION_FIELDS.filter((f) => set.has(f.key)).map((f) => f.label);
}

/** What IT reads: the ticked labels, and the note (a pre-Phase-35 reason reads as the note). */
export function returnSummary(a: { financeReturnFields: string[]; financeReturnReason: string | null }): { items: string[]; note: string | null } {
  return { items: fieldLabels(a.financeReturnFields), note: a.financeReturnReason };
}

/** Phase 35 (spec §4.1): Finance's list chips. */
export type FinFilter = "with-finance" | "needs-correction" | "awaiting-it" | "approved" | "not-capitalised" | "no-cost";
export const FIN_FILTERS: readonly FinFilter[] = ["with-finance", "needs-correction", "awaiting-it", "approved", "not-capitalised", "no-cost"];
export const FIN_LABEL: Record<FinFilter, string> = {
  "with-finance": "To review", "needs-correction": "Sent back", "awaiting-it": "Waiting for IT",
  approved: "Approved", "not-capitalised": "Not capitalised", "no-cost": "No cost",
};

export function parseFin(raw: string | null | undefined): FinFilter | null {
  return raw && (FIN_FILTERS as readonly string[]).includes(raw) ? (raw as FinFilter) : null;
}

export function finWhere(f: FinFilter): Prisma.AssetWhereInput {
  switch (f) {
    case "approved": return { ...regWhere("registered"), financeNotCapitalised: false };
    case "not-capitalised": return { ...regWhere("registered"), financeNotCapitalised: true };
    case "no-cost": return { cost: null };
    default: return regWhere(f);
  }
}

/** Plan P-10: one page of `firstCount` rows of group A followed by group B, as two (skip, take) windows. */
export function pageAcross(firstCount: number, skip: number, take: number) {
  const firstSkip = Math.min(skip, firstCount);
  const firstTake = Math.max(0, Math.min(take, firstCount - skip));
  const restSkip = Math.max(0, skip - firstCount);
  return { first: { skip: firstTake ? firstSkip : 0, take: firstTake }, rest: { skip: restSkip, take: take - firstTake } };
}
