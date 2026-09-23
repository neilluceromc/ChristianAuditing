import type { DocumentKind } from "./documents";

/** A file chosen on Register, with the kind it will be stored as. */
export interface StagedDocument<F = File> {
  file: F;
  kind: DocumentKind;
}

export interface StagedDocuments<F = File> {
  /** Quantity 1: every file, each with its kind. */
  files: StagedDocument<F>[];
  /** Quantity > 1: the one invoice attached to every unit. */
  invoice: F | null;
}

/**
 * Phase 30 (review R11): what was staged survives a quantity switch instead of
 * vanishing. 1 → N: the first file becomes the batch's invoice and the rest
 * stay listed (a batch uploads only its invoice); N → 1: the invoice returns
 * as the first file, kind Invoice. N → M changes nothing.
 */
export function carryDocuments<F>(state: StagedDocuments<F>, fromQty: number, toQty: number): StagedDocuments<F> {
  if (fromQty === 1 && toQty > 1 && state.invoice === null && state.files.length > 0) {
    return { files: state.files.slice(1), invoice: state.files[0].file };
  }
  if (fromQty > 1 && toQty === 1 && state.invoice !== null) {
    return { files: [{ file: state.invoice, kind: "invoice" }, ...state.files], invoice: null };
  }
  return state;
}

/** The line under a batch's invoice for the quantity-1 files it will not upload. */
export function singleOnlyNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 more file applies to a single asset only — it is kept if you go back to 1."
    : `${count} more files apply to a single asset only — they are kept if you go back to 1.`;
}
