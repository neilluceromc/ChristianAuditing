import { EDIT_REASON, type IntakeField, type PoMoneyField, type PO_TOTALS_KEY } from "./intake-rules";

/** The hint under every PO reason box: Finance/IT's fix reason, Purchasing's reply, a cancel and a close-short all use EDIT_REASON. */
export const PO_REASON_HINT = `${EDIT_REASON.min}–${EDIT_REASON.max} characters`;

/**
 * The checklist a PO send-back offers (spec §4 way 1, §5): Purchasing's money fields, the three money documents,
 * and Other. Keys equal sendBackPurchaseOrder's `SEND_BACK_KEYS` — MONEY_FIELDS, the PO number, paid by and the
 * invoice totals (spec §5b.4), plus these documents and "other" — and the notes thread and the notifications use the
 * same words.
 */
export const PO_SEND_BACK_FIELDS = [
  { key: "poNumber", label: "PO number", group: "Purchase" },
  { key: "invoiceRef", label: "SI number", group: "Purchase" },
  { key: "receiptRef", label: "OR number", group: "Purchase" },
  { key: "vendorId", label: "Vendor", group: "Purchase" },
  { key: "purchasedAt", label: "Invoice date", group: "Purchase" },
  { key: "paidBy", label: "Paid by", group: "Purchase" },
  { key: "cost", label: "Unit price", group: "Purchase" },
  { key: "totals", label: "Invoice totals", group: "Purchase" },
  { key: "fees", label: "Fees", group: "Purchase" },
  { key: "doc:invoice", label: "Sales invoice", group: "Documents" },
  { key: "doc:official-receipt", label: "Official receipt", group: "Documents" },
  { key: "doc:delivery-receipt", label: "Delivery receipt", group: "Documents" },
  { key: "other", label: "Other (explain in the note)", group: "Anything else" },
] as const satisfies ReadonlyArray<{
  key: IntakeField | PoMoneyField | typeof PO_TOTALS_KEY | `doc:${string}` | "other"; label: string; group: string;
}>;

export type PoSendBackKey = (typeof PO_SEND_BACK_FIELDS)[number]["key"];

/**
 * What the send-back dialog offers on this PO (final review M2). The A3 form has no fees field (spec §4), so "Fees" is
 * offered only on a legacy PO (formV2 false) that has a fee; sendBackPurchaseOrder still accepts `fees`, and
 * poFieldWords still words it, for send-backs made before.
 */
export function poSendBackFields(po: { formV2: boolean; fees: number | null }) {
  const offerFees = !po.formV2 && po.fees !== null;
  return PO_SEND_BACK_FIELDS.filter((f) => f.key !== "fees" || offerFees);
}
export const PO_SEND_BACK_GROUPS = ["Purchase", "Documents", "Anything else"] as const;

/** The checklist labels of the given keys, in the order given; an unknown key shows as itself. */
export function poFieldWords(keys: readonly string[]): string[] {
  return keys.map((k) => PO_SEND_BACK_FIELDS.find((f) => f.key === k)?.label ?? k);
}
