import { EDIT_REASON, type IntakeField } from "./intake-rules";

/** The hint under every PO reason box: Finance/IT's fix reason, Purchasing's reply, a cancel and a close-short all use EDIT_REASON. */
export const PO_REASON_HINT = `${EDIT_REASON.min}–${EDIT_REASON.max} characters`;

/**
 * The checklist a PO send-back offers (spec §4 way 1, §5): Purchasing's money fields, the three money documents,
 * and Other. Keys equal sendBackPurchaseOrder's `SEND_BACK_KEYS` — MONEY_FIELDS plus these documents and "other" —
 * and the notes thread and the notifications use the same words.
 */
export const PO_SEND_BACK_FIELDS = [
  { key: "invoiceRef", label: "SI number", group: "Purchase" },
  { key: "receiptRef", label: "OR number", group: "Purchase" },
  { key: "vendorId", label: "Supplier", group: "Purchase" },
  { key: "purchasedAt", label: "Purchase date", group: "Purchase" },
  { key: "cost", label: "Unit price", group: "Purchase" },
  { key: "fees", label: "Fees", group: "Purchase" },
  { key: "doc:invoice", label: "Sales invoice", group: "Documents" },
  { key: "doc:official-receipt", label: "Official receipt", group: "Documents" },
  { key: "doc:delivery-receipt", label: "Delivery receipt", group: "Documents" },
  { key: "other", label: "Other (explain in the note)", group: "Anything else" },
] as const satisfies ReadonlyArray<{ key: IntakeField | `doc:${string}` | "other"; label: string; group: string }>;

export type PoSendBackKey = (typeof PO_SEND_BACK_FIELDS)[number]["key"];
export const PO_SEND_BACK_GROUPS = ["Purchase", "Documents", "Anything else"] as const;

/** The checklist labels of the given keys, in the order given; an unknown key shows as itself. */
export function poFieldWords(keys: readonly string[]): string[] {
  return keys.map((k) => PO_SEND_BACK_FIELDS.find((f) => f.key === k)?.label ?? k);
}
