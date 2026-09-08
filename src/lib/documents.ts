/** The document kinds a row can be tagged with (spec §2.3 adds "invoice" for batch uploads). */
export const DOCUMENT_KINDS = ["receipt", "accountability-form", "photo", "other", "invoice"] as const;

/** Phase 18 spec §2.3 — supplier and request document kinds, each with its label. */
export const SUPPLIER_DOCUMENT_KINDS = ["registration", "certificate", "contract", "other"] as const;
export const SUPPLIER_DOCUMENT_LABEL: Record<(typeof SUPPLIER_DOCUMENT_KINDS)[number], string> = {
  registration: "Registration record", certificate: "Certificate", contract: "Contract", other: "Other",
};
export const REQUEST_DOCUMENT_KINDS = ["quotation", "purchase-order", "invoice", "delivery-receipt", "other"] as const;
export const REQUEST_DOCUMENT_LABEL: Record<(typeof REQUEST_DOCUMENT_KINDS)[number], string> = {
  quotation: "Quotation", "purchase-order": "Purchase order", invoice: "Invoice", "delivery-receipt": "Delivery receipt", other: "Other",
};
