/** The document kinds a row can be tagged with (spec §2.3 adds "invoice" for batch uploads). */
export const DOCUMENT_KINDS = ["receipt", "accountability-form", "photo", "other", "invoice"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** Phase 30 (spec §4.4, §5.4): the words a kind picker shows — the record's Documents tab and Register. */
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  receipt: "Receipt", "accountability-form": "Accountability form", photo: "Photo", other: "Other", invoice: "Invoice",
};

/** Phase 18 spec §2.3 — supplier and request document kinds, each with its label. */
export const SUPPLIER_DOCUMENT_KINDS = ["registration", "certificate", "contract", "other"] as const;
export const SUPPLIER_DOCUMENT_LABEL: Record<(typeof SUPPLIER_DOCUMENT_KINDS)[number], string> = {
  registration: "Registration record", certificate: "Certificate", contract: "Contract", other: "Other",
};
export const REQUEST_DOCUMENT_KINDS = ["quotation", "purchase-order", "invoice", "delivery-receipt", "other"] as const;
export const REQUEST_DOCUMENT_LABEL: Record<(typeof REQUEST_DOCUMENT_KINDS)[number], string> = {
  quotation: "Quotation", "purchase-order": "Purchase order", invoice: "Invoice", "delivery-receipt": "Delivery receipt", other: "Other",
};
