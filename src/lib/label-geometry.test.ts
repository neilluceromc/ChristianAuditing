import { describe, expect, it } from "vitest";
import {
  LABELS_PER_PAGE, LABEL_CELL_MM, LABEL_USABLE_MM,
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
  // Every literal below (0.33, 47.85, 0.1925, 22/23) is pinned by hand, not
  // derived from PREFERRED_MODULE_MM/MIN_MODULE_MM: comparing against the
  // live constants under test is self-referential — mutating the constant
  // moves both sides of the assertion together and the test stays green. See
  // the sibling finding on LABEL_USABLE_MM/LABEL_PADDING_MM above.
  it("uses a 0.33mm module for a normal tag and stays inside the label", () => {
    const fit = barcodeFit("BR-LT-0148");
    expect(fit.encodable).toBe(true);
    if (!fit.encodable) return;
    expect(fit.moduleMm).toBeCloseTo(0.33, 6);
    expect(fit.widthMm).toBeLessThanOrEqual(LABEL_USABLE_MM);
    expect(fit.widthMm).toBeCloseTo(47.85, 3); // 145 modules * 0.33mm
  });

  it("never exceeds the usable width, however long the tag", () => {
    for (const n of [11, 12, 16, 20]) {
      const fit = barcodeFit("A".repeat(n));
      expect(fit.encodable).toBe(true);
      if (!fit.encodable) continue;
      expect(fit.widthMm).toBeLessThanOrEqual(LABEL_USABLE_MM + 1e-9);
    }
  });

  it("shrinks the module rather than overflowing once the tag is long", () => {
    const fit = barcodeFit("A".repeat(16));
    expect(fit.encodable).toBe(true);
    if (!fit.encodable) return;
    expect(fit.moduleMm).toBeLessThan(0.33);
  });

  // The real floor boundary, pinned to literals rather than to the constants
  // under test: 22 chars (277 modules) fit at 53.333/277 = 0.1925mm, 23 chars
  // (288 modules) need 53.333/288 = 0.1852mm and get no barcode. Nothing
  // lands exactly ON 0.19 (that needs 280.7 modules), so >= vs > is
  // behaviourally unreachable — this pins the number, not the operator.
  it("encodes at 22 characters and refuses at 23", () => {
    const fitsOk = barcodeFit("A".repeat(22));
    expect(fitsOk.encodable).toBe(true);
    if (fitsOk.encodable) expect(fitsOk.moduleMm).toBeCloseTo(0.1925, 4);

    const fitsBad = barcodeFit("A".repeat(23));
    expect(fitsBad.encodable).toBe(false);
  });

  // The honest refusal: a code too fine to scan is worse than no code, because
  // it looks like a working sticker. The numeric boundary is pinned above;
  // this just confirms the well-past-the-floor case reports unencodable.
  it("reports unencodable once fitting the tag would fall well below the scannable floor", () => {
    const fit = barcodeFit("A".repeat(40));
    expect(fit.encodable).toBe(false);
  });

  it("refuses an empty tag instead of throwing", () => {
    expect(() => barcodeFit("")).not.toThrow();
    expect(barcodeFit("").encodable).toBe(false);
  });

  // Storable via raw SQL: no DB CHECK constraint enforces the asset-tag shape.
  // If this returned encodable:true, the renderer would throw and take the
  // whole 200-label sheet down with it.
  it("refuses a tag with characters Code 128-B cannot encode, instead of throwing", () => {
    expect(() => barcodeFit("BR-LT-01é")).not.toThrow();
    expect(barcodeFit("BR-LT-01é").encodable).toBe(false);
  });

  // The two cases above (empty, out-of-charset) and the below-floor and
  // preferred-module cases each have a dedicated test already; the two
  // inputs here that aren't covered elsewhere are " " and "\t", so this
  // checks their actual verdicts rather than only that nothing throws.
  it("never throws for any input a database could hold, and reports the right verdict", () => {
    const cases: Array<[string, boolean]> = [
      ["", false],
      [" ", true],
      ["\t", false],
      ["BR-LT-0148", true],
      ["A".repeat(40), false],
      ["😀", false],
    ];
    for (const [t, expected] of cases) {
      expect(() => barcodeFit(t)).not.toThrow();
      expect(barcodeFit(t).encodable).toBe(expected);
    }
  });
});
