import { describe, expect, it } from "vitest";
import {
  LABELS_PER_PAGE, LABEL_CELL_MM, LABEL_USABLE_MM, MIN_MODULE_MM, PREFERRED_MODULE_MM,
  barcodeFit, labelPages,
} from "./label-geometry";

describe("sheet geometry", () => {
  it("is a 3x4 grid on A4 inside a 10mm page margin", () => {
    expect(LABELS_PER_PAGE).toBe(12);
    expect(LABEL_CELL_MM.width).toBeCloseTo((210 - 20) / 3, 2);
    expect(LABEL_CELL_MM.height).toBeCloseTo((297 - 20) / 4, 2);
  });

  // Anchored to a literal mm value rather than to LABEL_USABLE_MM itself: the
  // barcodeFit "stays inside the label" assertions compare fit.widthMm against
  // the live LABEL_USABLE_MM import, so if the padding collapsed to 0 both
  // sides of that comparison would move together and silently still pass.
  // This test is what actually pins the 5mm side margin in place.
  it("keeps a 5mm margin inside the cell so a barcode never touches the die-cut edge", () => {
    expect(LABEL_USABLE_MM).toBeCloseTo((210 - 20) / 3 - 10, 2);
  });
});

describe("labelPages", () => {
  it("returns no pages for no tags", () => {
    expect(labelPages([])).toEqual([]);
  });

  it("puts one tag on one page", () => {
    expect(labelPages(["BR-LT-0148"])).toEqual([["BR-LT-0148"]]);
  });

  it("fills a page exactly at 12 and spills at 13", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `BR-LT-00${10 + i}`);
    expect(labelPages(twelve)).toHaveLength(1);
    expect(labelPages([...twelve, "BR-LT-9999"])).toHaveLength(2);
    expect(labelPages([...twelve, "BR-LT-9999"])[1]).toEqual(["BR-LT-9999"]);
  });

  it("paginates the bulk cap into whole sheets", () => {
    const pages = labelPages(Array.from({ length: 200 }, (_, i) => `BR-ZZ-${String(i).padStart(4, "0")}`));
    expect(pages).toHaveLength(17);
    expect(pages.at(-1)).toHaveLength(200 - 16 * 12);
  });

  it("preserves order across the page break", () => {
    const tags = Array.from({ length: 13 }, (_, i) => `T${i}`);
    expect(labelPages(tags).flat()).toEqual(tags);
  });
});

describe("barcodeFit", () => {
  it("uses the preferred module for a normal tag and stays inside the label", () => {
    const fit = barcodeFit("BR-LT-0148");
    expect(fit.moduleMm).toBeCloseTo(PREFERRED_MODULE_MM, 6);
    expect(fit.widthMm).toBeLessThanOrEqual(LABEL_USABLE_MM);
    expect(fit.widthMm).toBeCloseTo(145 * PREFERRED_MODULE_MM, 3);
  });

  it("never exceeds the usable width, however long the tag", () => {
    for (const n of [11, 12, 16, 20]) {
      const fit = barcodeFit("A".repeat(n));
      expect(fit.widthMm).toBeLessThanOrEqual(LABEL_USABLE_MM + 1e-9);
    }
  });

  it("shrinks the module rather than overflowing once the tag is long", () => {
    expect(barcodeFit("A".repeat(16)).moduleMm).toBeLessThan(PREFERRED_MODULE_MM);
  });

  // The honest refusal: a code too fine to scan is worse than no code, because
  // it looks like a working sticker.
  it("omits the barcode when fitting it would go below the scannable floor", () => {
    const fit = barcodeFit("A".repeat(40));
    expect(fit.moduleMm).toBeLessThan(MIN_MODULE_MM);
    expect(fit.encodable).toBe(false);
  });

  it("still encodes at exactly the floor", () => {
    const fit = barcodeFit("BR-LT-0148");
    expect(fit.encodable).toBe(true);
    expect(fit.moduleMm).toBeGreaterThanOrEqual(MIN_MODULE_MM);
  });

  it("refuses an empty tag instead of throwing", () => {
    expect(() => barcodeFit("")).not.toThrow();
    expect(barcodeFit("").encodable).toBe(false);
  });

  // Storable via raw SQL: no DB CHECK constraint enforces TAG_SHAPE. If this
  // returned encodable:true, the renderer would throw and take the whole
  // 200-label sheet down with it.
  it("refuses a tag with characters Code 128-B cannot encode, instead of throwing", () => {
    expect(() => barcodeFit("BR-LT-01é")).not.toThrow();
    expect(barcodeFit("BR-LT-01é").encodable).toBe(false);
  });

  it("never throws for any input a database could hold", () => {
    for (const t of ["", " ", "\t", "BR-LT-0148", "A".repeat(40), "😀"]) {
      expect(() => barcodeFit(t)).not.toThrow();
    }
  });
});
