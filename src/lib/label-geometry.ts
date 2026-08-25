import { canEncode128, code128ModuleCount } from "./code128";

/**
 * Physical geometry for the printable asset-label sheet, and the pagination
 * that follows from it. Pure: no React, no Prisma, no DOM — so the numbers the
 * printed sheet depends on are unit-testable without a browser.
 *
 * A4 is 210x297mm. A 10mm page margin leaves 190x277mm for a 3x4 grid.
 */
export const PAGE_MM = { width: 210, height: 297 } as const;
export const PAGE_MARGIN_MM = 10;
export const LABEL_COLUMNS = 3;
export const LABEL_ROWS = 4;
export const LABELS_PER_PAGE = LABEL_COLUMNS * LABEL_ROWS;

export const LABEL_CELL_MM = {
  width: (PAGE_MM.width - 2 * PAGE_MARGIN_MM) / LABEL_COLUMNS,
  height: (PAGE_MM.height - 2 * PAGE_MARGIN_MM) / LABEL_ROWS,
} as const;

/** Side padding inside a cell, so the barcode never touches the die-cut edge. */
export const LABEL_PADDING_MM = 5;
export const LABEL_USABLE_MM = LABEL_CELL_MM.width - 2 * LABEL_PADDING_MM;

/** ~13 mil. Comfortable for any cheap handheld. */
export const PREFERRED_MODULE_MM = 0.33;
/**
 * ~7.5 mil, the floor below which a consumer laser scanner stops reading
 * reliably. Under this we print NO barcode and say so on the label: an
 * unscannable code is worse than an absent one, because the sticker looks
 * finished.
 */
export const MIN_MODULE_MM = 0.19;

/** The calibration bar's true length. The operator measures it to prove the
 * browser printed at 100% rather than "fit to printable area". */
export const CALIBRATION_MM = 100;

export function labelPages(tags: readonly string[]): string[][] {
  const pages: string[][] = [];
  for (let i = 0; i < tags.length; i += LABELS_PER_PAGE) {
    pages.push(tags.slice(i, i + LABELS_PER_PAGE));
  }
  return pages;
}

export interface BarcodeFit {
  /** Module width to render at, in mm. Zero when `encodable` is false. */
  moduleMm: number;
  /** Total symbol width in mm at that module. Zero when `encodable` is false. */
  widthMm: number;
  /** False when this tag must render NO barcode at all. */
  encodable: boolean;
}

/**
 * Fit-to-width rather than a fixed module.
 *
 * TOTAL BY CONSTRUCTION: this never throws, because `encodable` is the
 * renderer's ONE guard and it has to cover every reason `code128Modules` would
 * refuse — empty, out-of-charset, or too fine to scan — not just the width. A
 * throw here escapes a Server Component rendering up to 200 labels and 500s
 * the whole sheet rather than dropping one barcode.
 *
 * NOTE the shrink and floor branches are DEFENSIVE, not routine: the asset-tag
 * shape (`/^BR-[A-Z]{2}-\d{4}$/`, enforced in `src/lib/import-assets.ts` and
 * `src/server/modules/inventory/actions.ts`) fixes every tag at exactly 10
 * characters on both write paths, so nothing the application itself can store
 * reaches them. They exist because no DB CHECK constraint enforces that
 * format — a longer tag is unproducible through the app but not impossible —
 * and because without any width check at all a 13-character tag would
 * silently overflow the die-cut.
 */
export function barcodeFit(tag: string): BarcodeFit {
  if (!canEncode128(tag)) return { moduleMm: 0, widthMm: 0, encodable: false };
  const modules = code128ModuleCount(tag.length);
  const moduleMm = Math.min(PREFERRED_MODULE_MM, LABEL_USABLE_MM / modules);
  return { moduleMm, widthMm: modules * moduleMm, encodable: moduleMm >= MIN_MODULE_MM };
}
