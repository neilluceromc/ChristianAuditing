import type { AssetClass, Role } from "@prisma/client";
import type { PoState } from "./po-flow";
import { TOTAL_KEYS } from "./po-totals";
import type { RegFieldKey } from "./registration";

/**
 * Three-team intake (Purchasing → IT → Finance): who owns each field, who may edit it at which stage, and
 * where a purchase order's money sits. Pure — `Team` mirrors the Prisma enum added in Task 2.
 */
export type Team = "IT" | "PURCHASING" | "FINANCE";

export function teamOfRole(role: Role): Team | null {
  switch (role) {
    case "it_staff": return "IT";
    case "purchasing_staff": return "PURCHASING";
    case "finance_staff": return "FINANCE";
    default: return null;
  }
}

export const MONEY_FIELDS = ["cost", "fees", "purchasedAt", "vendorId", "invoiceRef", "receiptRef"] as const;
export const DEVICE_FIELDS = ["brand", "model", "categoryId", "serial", "warrantyUntil", "warrantyCoveredBy", "warrantyContact"] as const;
export type MoneyField = (typeof MONEY_FIELDS)[number];
export type DeviceField = (typeof DEVICE_FIELDS)[number];
export type IntakeField = MoneyField | DeviceField;

/**
 * Migration 39 (spec §5b.4): a PO's money fields — the asset-level ones plus the PO number, how it was paid and the
 * seven typed totals. All Purchasing's; `canEditField` holds them to the money rules. MONEY_FIELDS stays as it was,
 * so asset-level code is untouched.
 */
export const PO_MONEY_FIELDS = [...MONEY_FIELDS, "poNumber", "paidBy", ...TOTAL_KEYS] as const;
export type PoMoneyField = (typeof PO_MONEY_FIELDS)[number];

/** A PO send-back's one key for the seven typed totals (spec §5b.4: "Invoice totals" on the checklist). */
export const PO_TOTALS_KEY = "totals";

/**
 * A field key as the registration form and a send-back name it. "other" has no owner: the sender picks the team.
 * A PO's own money keys (PO_MONEY_FIELDS, and "totals") are here too: Purchasing's, like every money field.
 */
export type OwnedKey = IntakeField | PoMoneyField | typeof PO_TOTALS_KEY | Exclude<RegFieldKey, "other">;

const MONEY_DOCS: readonly string[] = ["doc:invoice", "doc:official-receipt", "doc:delivery-receipt"];

/**
 * A money field, or a document that proves the money (sales invoice, OR, delivery receipt). PO_MONEY_FIELDS holds
 * MONEY_FIELDS plus the PO's own keys (PO number, paid by, the totals), which no asset carries — so an asset's
 * answer is the same as before migration 39.
 */
export function isMoneyKey(key: OwnedKey): boolean {
  return (PO_MONEY_FIELDS as readonly string[]).includes(key) || key === PO_TOTALS_KEY || MONEY_DOCS.includes(key);
}

/** Money fields and money documents are Purchasing's; device fields and the warranty slip follow the asset's class. */
export function fieldOwner(key: OwnedKey, cls: AssetClass): "IT" | "PURCHASING" {
  if (isMoneyKey(key)) return "PURCHASING";
  return cls === "IT" ? "IT" : "PURCHASING";
}

/**
 * Who a Finance send-back lands on. The field's owner — except money on an asset with no PO (spec §5, way 3),
 * which goes back to the team that registered the batch, since no Purchasing PO ever existed for it.
 */
export function returnTeamFor(
  key: OwnedKey,
  cls: AssetClass,
  ctx: { hasPo: boolean; registeredByRole: Role | null },
): "IT" | "PURCHASING" {
  if (ctx.hasPo || !isMoneyKey(key)) return fieldOwner(key, cls);
  if (ctx.registeredByRole === "it_staff") return "IT";
  if (ctx.registeredByRole === "purchasing_staff") return "PURCHASING";
  return cls === "IT" ? "IT" : "PURCHASING";
}

export type IntakeStage = "with-purchasing" | "with-it" | "with-finance" | "approved";
export type EditVerdict = { ok: true; reasonRequired: boolean } | { ok: false; why: string };

const OK = { ok: true, reasonRequired: false } as const;
const OK_REASON = { ok: true, reasonRequired: true } as const;
const no = (why: string): EditVerdict => ({ ok: false, why });

/** A device field follows the class; anything else (MONEY_FIELDS, PO_MONEY_FIELDS) is money, held by the stage. */
export function canEditField(role: Role, field: IntakeField | PoMoneyField, cls: AssetClass, stage: IntakeStage): EditVerdict {
  if (role === "viewer") return no("Viewers cannot edit");

  if ((DEVICE_FIELDS as readonly string[]).includes(field)) {
    if (role === "admin") return OK;
    const owner = fieldOwner(field as DeviceField, cls);
    if (role === "finance_staff") return no(owner === "IT" ? "Send it back to IT" : "Send it back to Purchasing");
    return teamOfRole(role) === owner ? OK : no(owner === "IT" ? "IT owns this field" : "Purchasing owns this field");
  }

  // Money field: the stage decides who holds it.
  switch (stage) {
    case "with-purchasing":
      if (role === "purchasing_staff" || role === "admin") return OK;
      return no("It's with Purchasing");
    case "with-it":
      if (role === "purchasing_staff") return OK;
      if (role === "it_staff" || role === "admin") return OK_REASON;
      return no("It's with IT");
    case "with-finance":
      if (role === "finance_staff" || role === "admin") return OK_REASON;
      return no("It's with Finance; ask Finance to fix or send it back");
    case "approved":
      if (role === "finance_staff" || role === "admin") return OK_REASON;
      return no("Approved: only Finance can change it");
  }
}

/** The reason for a cross-team fix, and Purchasing's reply on a sent-back PO: trimmed, 5–300 characters. */
export const EDIT_REASON = { min: 5, max: 300 } as const;

export function reasonError(text: string | undefined): string | null {
  const n = (text ?? "").trim().length;
  if (n < EDIT_REASON.min) return `Give a reason of at least ${EDIT_REASON.min} characters`;
  if (n > EDIT_REASON.max) return `Keep the reason to ${EDIT_REASON.max} characters or fewer`;
  return null;
}

/** Where a PO's money sits. Rules in order — the first that matches wins. */
export function poMoneyStage(p: { state: PoState; registeredCount: number; approvedCount: number }): IntakeStage {
  if (p.approvedCount > 0) return "approved";
  if (p.state === "SENT_BACK") return "with-purchasing";
  if (p.registeredCount > 0) return "with-finance";
  if (p.state === "WITH_IT") return "with-it";
  return "with-purchasing";
}

/**
 * Where an asset with no PO has its money. Finance's decision wins (approved, or the team it returned to —
 * a return from before teams were recorded goes to the class's team); otherwise an IT asset IT has not
 * checked is with IT, and everything else waits on Finance.
 */
export function assetMoneyStage(a: {
  cls: AssetClass;
  itVerifiedAt: Date | null;
  financeConfirmedAt: Date | null;
  financeReturnedAt: Date | null;
  financeReturnedTo: Team | null;
}): IntakeStage {
  if (a.financeConfirmedAt) return "approved";
  if (a.financeReturnedAt) {
    const to = a.financeReturnedTo ?? (a.cls === "IT" ? "IT" : "PURCHASING");
    return to === "IT" ? "with-it" : to === "PURCHASING" ? "with-purchasing" : "with-finance";
  }
  if (a.cls === "IT" && a.itVerifiedAt === null) return "with-it";
  return "with-finance";
}
