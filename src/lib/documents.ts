/** The document kinds a row can be tagged with (spec §2.3 adds "invoice" for batch uploads). */
export const DOCUMENT_KINDS = ["receipt", "accountability-form", "photo", "other", "invoice"] as const;
