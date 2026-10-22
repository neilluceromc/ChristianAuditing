/** The document kinds a row can be tagged with (spec §2.3 adds "invoice" for batch uploads). */
export const DOCUMENT_KINDS = ["receipt", "accountability-form", "photo", "other", "invoice", "official-receipt", "warranty-slip", "delivery-receipt"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** Phase 30 (spec §4.4, §5.4): the words a kind picker shows — the record's Documents tab and Register. */
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  receipt: "Receipt", "accountability-form": "Accountability form", photo: "Photo", other: "Other", invoice: "Invoice",
  "official-receipt": "Official receipt", "warranty-slip": "Warranty slip", "delivery-receipt": "Delivery receipt",
};

/** Phase 18 spec §2.3 — supplier and request document kinds, each with its label. */
export const SUPPLIER_DOCUMENT_KINDS = ["registration", "certificate", "contract", "other"] as const;
export const SUPPLIER_DOCUMENT_LABEL: Record<(typeof SUPPLIER_DOCUMENT_KINDS)[number], string> = {
  registration: "Registration record", certificate: "Certificate", contract: "Contract", other: "Other",
};
// Purchase orders (spec §2): the money documents Finance checks (sales invoice, OR, delivery receipt), the warranty slip,
// and the older quotation / purchase-order kinds that existing documents carry.
export const REQUEST_DOCUMENT_KINDS = ["invoice", "official-receipt", "delivery-receipt", "warranty-slip", "quotation", "purchase-order", "other"] as const;
/**
 * PO form redesign (spec §2.8): the PO form's four document slots, saved with the PO as the form fields
 * `doc:<kind>`. The sales invoice is required on a PO from the new form; the others are optional.
 */
export const PO_DOCUMENT_SLOTS = ["invoice", "official-receipt", "delivery-receipt", "warranty-slip"] as const;
export type PoDocumentSlot = (typeof PO_DOCUMENT_SLOTS)[number];
export const REQUEST_DOCUMENT_LABEL: Record<(typeof REQUEST_DOCUMENT_KINDS)[number], string> = {
  quotation: "Quotation", "purchase-order": "Purchase order", invoice: "Sales invoice", "official-receipt": "Official receipt",
  "delivery-receipt": "Delivery receipt", "warranty-slip": "Warranty slip", other: "Other",
};
