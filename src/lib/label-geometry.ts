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

/**
 * A discriminated union rather than a flat shape with nullable-by-convention
 * fields: when `encodable` is false there is no width or module to read, and
 * making that a type error (rather than a doc comment saying "zero when...")
 * means a caller can't accidentally render a full-width, unscannable barcode
 * for a tag that was refused. `fit.widthMm` won't typecheck until `encodable`
 * is narrowed to `true`.
 */
export type BarcodeFit =
  | { encodable: true; moduleMm: number; widthMm: number }
  | { encodable: false };

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
 * shape enforced in `src/lib/import-assets.ts` and
 * `src/server/modules/inventory/actions.ts` fixes every tag at exactly 10
 * characters on both write paths, so nothing the application itself can store
 * reaches them. They exist because no DB CHECK constraint enforces that
 * shape — a longer tag is unproducible through the app but not impossible —
 * and because without any width check at all a 13-character tag would
 * silently overflow the die-cut.
 */
export function barcodeFit(tag: string): BarcodeFit {
  if (!canEncode128(tag)) return { encodable: false };
  const modules = code128ModuleCount(tag.length);
  const moduleMm = Math.min(PREFERRED_MODULE_MM, LABEL_USABLE_MM / modules);
  if (moduleMm < MIN_MODULE_MM) return { encodable: false };
  return { encodable: true, moduleMm, widthMm: modules * moduleMm };
}

/** QR mandates 4 clear modules on every side. This is not padding to taste —
 *  a reader may fail without it, and it is what actually competes for space
 *  on the label: the footprint is `modules + 8`, not `modules`. */
export const QR_QUIET_MODULES = 4;

/**
 * Phone-camera module sizes, and the two least certain numbers in this feature.
 *
 * NOT `MIN_MODULE_MM` (0.19), which was chosen for a handheld laser scanner —
 * a phone camera at arm's length tolerates less. These are a judgement about
 * optics, not a measured result: the physical read test (spec §4) is what
 * validates or corrects them, and the outcome should be recorded against
 * these constants so a future change argues with a measurement.
 */
export const QR_PREFERRED_MODULE_MM = 0.5;
export const QR_MIN_MODULE_MM = 0.4;

/** The cap on the dark area's edge, past which the module shrinks instead of
 *  the symbol growing. The cell has roughly 40mm of spare height, so this
 *  leaves comfortable room (worst case footprint is ~27.9mm at version 8). */
export const QR_MAX_DARK_MM = 24;

export type QrFit =
  | { renderable: true; moduleMm: number; sizeMm: number }
  | { renderable: false };

/**
 * Deliberately the same shape as `barcodeFit`: take the preferred module size
 * unless the symbol is too big for its budget, then refuse below the floor.
 * Reading the two side by side should show one idea, not two.
 *
 * `modules` comes from the encoder (`qrMatrix().size`), never from a guess —
 * the realistic label URL clears version 4's capacity by three bytes, so a
 * hardcoded version would be a bug that only appears for longer hostnames.
 *
 * Legal QR sizes are 21 + 4n for versions 1–40, i.e. 21…177.
 */
export function qrFit(modules: number): QrFit {
  const legal =
    Number.isInteger(modules) && modules >= 21 && modules <= 177 && (modules - 21) % 4 === 0;
  if (!legal) return { renderable: false };

  const moduleMm = Math.min(QR_PREFERRED_MODULE_MM, QR_MAX_DARK_MM / modules);
  if (moduleMm < QR_MIN_MODULE_MM) return { renderable: false };

  return { renderable: true, moduleMm, sizeMm: (modules + 2 * QR_QUIET_MODULES) * moduleMm };
}
