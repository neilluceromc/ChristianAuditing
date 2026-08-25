# Phase 10 — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the printable 3×4 A4 asset-label sheet with real scannable barcodes, make a USB scan tick the matching row in the offboarding wizard, sweep every route with axe, and write a deployment README that has actually been executed.

**Architecture:** Four independent items. The label sheet is a pure encoder (`src/lib/code128.ts`) plus pure geometry (`src/lib/label-geometry.ts`) plus a Server-Component print route that reuses the two existing print surfaces' pattern. The scanner is a pure verdict function (`src/lib/scan.ts`) plus a thin client listener and a context that lets `ItemDecision` react. The axe work is two one-component fixes plus a route-table sweep spec. The README is a verification task, not a writing task.

**Tech Stack:** Next.js 15 App Router · React 19 · Prisma 6 / Postgres 16 · Tailwind v4 · vitest (node-only) · Playwright · `@axe-core/playwright`. **No new dependencies** — the Code 128 encoder is hand-rolled precisely to avoid §7's npm-on-Windows lockfile hazard.

**Spec:** `docs/superpowers/specs/2026-08-25-phase-10-polish-design.md`. Read its §0 first — two decisions deliberately contradict the design brief.

---

## Read this before Task 1

**Branch:** cut `phase-10-polish` from `main` (`bdc6c52` or later). Do not implement on `main`.

**Every task's plan text is a DRAFT. Check it against the code.** In Phase 9, fourteen of fourteen task
texts were wrong in a way that would have shipped a defect, and in five consecutive tasks an
implementer found an error in an amendment written to fix an earlier error. If the plan and the code
disagree, **the code wins and the plan gets amended** in a `docs(plan)` commit. Say so out loud rather
than implementing something you believe is wrong.

**Run the checklist in HANDOVER §0 item 5 against every task before calling it done.** The four that
will bite hardest here:

- **Rule 10 — does the surface consume EVERY refusal its rule can return?** The label route has three
  (over-cap, unknown ids, zero ids) and the scanner has four verdicts. This rule has been broken in
  *every* task in this codebase that paired a rule module with a page.
- **Rule 26/37/38 — is a number or contract string defined elsewhere?** `BULK_MAX`, the module width,
  the page size. Import them; never retype them.
- **Rule 78 — mutation-test every load-bearing assertion.** Name the defect it catches, break exactly
  that, confirm the failure lands in the expected place, revert with `git checkout --`, and check
  `git status` before committing.
- **Rules 61/76 — there is no cheap proxy for "React has hydrated."** Task 7 depends on this.

**Battery commands** (the e2e suite is ~16.5 min and does not fit one foreground run — see HANDOVER §0
item 7):

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/lib/code128.ts` | create | Pure Code 128-B encoder. Module widths only; knows nothing about mm, SVG or assets. |
| `src/lib/code128.test.ts` | create | Hand-verified vectors, charset bounds, the `11n + 35` identity. |
| `src/lib/label-geometry.ts` | create | Pure sheet geometry: mm constants, pagination into 12-up pages, fit-to-width module sizing. |
| `src/lib/label-geometry.test.ts` | create | Pagination boundaries, module fit, the scan-quality floor. |
| `src/components/inventory/label-sheet.tsx` | create | Server Component: the 3×4 grid, inline SVG barcodes, calibration ruler. |
| `src/app/(app)/inventory/labels/page.tsx` | create | Role guard, `?ids=` parse, three refusals, fetch, render. |
| `src/components/ui/print-button.tsx` | create (move) | Moved from `src/components/employees/print-button.tsx`. |
| `src/components/employees/print-button.tsx` | delete | Two importers updated. |
| `src/lib/workspaces.ts` | modify | New `PATH_RULES` entry for `/inventory/labels`, **before** the general `/inventory` rule. |
| `src/components/inventory/bulk-drawer.tsx` | modify | "Print labels" link; and the stale "CSV" wording. |
| `src/lib/scan.ts` | create | Pure `matchScan(buffer, items)` → four-way verdict. |
| `src/lib/scan.test.ts` | create | Every verdict, normalisation, blank input. |
| `src/components/offboarding/scan-provider.tsx` | create | Client: keystroke buffer, focus guard, context, verdict banner. |
| `src/components/offboarding/item-decision.tsx` | modify | Subscribes to scan context; preselects, scrolls, focuses, highlights. Gains the `aria-describedby` wiring. |
| `src/app/(app)/offboarding/[employeeId]/page.tsx` | modify | Wraps the collect-step cards in `ScanProvider`. |
| `src/components/ui/card.tsx` | modify | `CardHeader` `h3` → `h2`. |
| `src/components/ui/segmented-control.tsx` | modify | Optional `aria-describedby` / `aria-invalid`. |
| `e2e/labels.spec.ts` | create | Label route: render, refusals, role gate. |
| `e2e/scanner.spec.ts` | create | Scan preselect and all three refusals. |
| `e2e/axe-sweep.spec.ts` | create | Every route × its role; fails serious/critical, counts moderates. |
| `README.md` | modify | The deployment document. |

---

### Task 1: The Code 128-B encoder (TDD)

> ### AMENDED AFTER REVIEW — the mutation table below MISSED THE MUTATION THAT MATTERS, plus six smaller findings.
> Task 1 shipped as `c9fb99f` and both reviews passed it on spec, but the quality review then
> **demonstrated a live mutant that leaves all 8 tests green**: weighting the checksum from the right
> (`sum += values[i] * (values.length - i)`) coincides exactly with the correct weighting for the
> one-character `"A"` fixture, and for `BR-LT-0148` it yields checksum 8 instead of 17 — invisible to a
> run-count assertion and to a module sum that is **145 for any checksum value**, because every Code 128
> pattern sums to 11 modules by construction. Weighting from the wrong end is one of the two classic
> Code 128 checksum bugs; every printed label would carry a bad check digit and no test could see it.
>
> **A-1 (fix): assert the checksum group for the real tag.** Add to the real-tag test:
> `expect(mods.slice(-13, -7)).toEqual([1, 2, 3, 2, 2, 1]);` — checksum value 17, hand-computed from the
> symbology alone (`104 + 34*1 + 50*2 + 13*3 + 44*4 + 52*5 + 13*6 + 16*7 + 17*8 + 20*9 + 24*10 = 1459`;
> `1459 % 103 = 17`; `PATTERNS[17] = "123221"`). Negative indices deliberately: STOP is always the last
> 7 runs, so `-13..-7` is the checksum group whatever the tag's length. **Add this mutation to the table
> below.** Asserting the whole 79-element array instead would assert the implementation against itself
> and prove far less.
>
> **A-2 (correction to my own justification):** that assertion does **not** pin the ten `PATTERNS` rows
> the tag's characters use. The checksum is computed from character *values* (`code - 32`) and their
> weights, never from those rows. It pins the ten value mappings, the weight sequence across ten
> positions, the mod-103 reduction, and `PATTERNS[17]`. Do not overstate it.
>
> **A-3 (fix): the test name overstates.** "encodes a real asset tag to the measured width" reads as
> encoding correctness while asserting two scalars invariant under every checksum value. With A-1 added
> the name becomes honest; without A-1 it should say "sizes", not "encodes".
>
> **A-4 (fix): `code128ModuleCount` and `code128Modules` disagree about their domain.**
> `code128Modules("")` throws, but `code128ModuleCount(0)` returns 35, `(-1)` returns 24 and `(1.5)`
> returns 51.5. Task 2 divides `LABEL_USABLE_MM` by the result and then blesses it as `encodable`, so an
> empty tag would pass the geometry and throw in the encoder — the checklist's own "a rule and its
> surface that only partly agree". Guard `charCount` to an integer >= 1.
>
> **A-5 (fix): make the charset test assert the range it names.** It checks two endpoints. Loop
> `c = 32..126`, asserting each single-character symbol is 25 runs summing to 46. That exercises
> `PATTERNS` rows 0-95 plus each checksum row — **96 of 107 rows** — turning a one-time hand
> verification of the table into a property a future typo cannot survive.
>
> **A-6 (fix): the out-of-charset message is unreadable for invisible characters.** A TAB renders as
> `"<tab>" cannot be encoded`. Interpolate the code point as well, and make the empty-string message say
> "Code 128-B" like its sibling.
>
> **A-7 (note, no change): the second test is a strict subset of the first.** `slice(12, 18)` on `"A"`
> is contained in the whole-array assertion above it, so it kills no mutant the first test misses. Keep
> it as documentation of where the checksum lives; do not count it as coverage.
>
> **A-8 (note for Task 3): both throw paths are unreachable from the label route** — every write path
> validates `/^BR-[A-Z]{2}-\d{4}$/` (`inventory/actions.ts:147`, `import-assets.ts:366`). **But no DB
> CHECK constraint enforces it**, so that is an application invariant rather than a guarantee. State the
> reasoning in Task 3 rather than leaving the page looking under-defended, and note the blast radius: a
> throw inside a Server Component rendering up to 200 labels **500s the entire sheet** rather than
> dropping one barcode. Task 3's renderer must treat an unencodable tag the same soft way it treats a
> too-fine one.
>
> **A-9 (note): this repo is CRLF.** A mutation applied with `\n`-based patterns can silently fail to
> apply, and a mutation that did not apply looks exactly like a passing suite. Assert the file actually
> changed before trusting a mutation result. This bit the spec reviewer once already.

**Files:**
- Create: `src/lib/code128.ts`
- Test: `src/lib/code128.test.ts`

**Background you need.** Code 128-B encodes each character as 6 alternating bar/space runs whose widths
sum to 11 modules. A symbol is `START B` (11 modules) + one group per character + a modulo-103 checksum
group (11) + `STOP` (13 modules, 7 runs). So a symbol is exactly **`11n + 35` modules** and
**`6n + 19` runs** for an n-character string. The vectors below were produced by a working encoder and
then verified by hand against the symbology tables — trust them over your own arithmetic.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/code128.test.ts
import { describe, expect, it } from "vitest";
import { CODE128_FIXED_MODULES, CODE128_MODULES_PER_CHAR, code128Modules, code128ModuleCount } from "./code128";

describe("code128Modules", () => {
  // Hand-verified against the symbology: START B (211214) + 'A' (111323)
  // + checksum 34 (131123) + STOP (2331112).
  it("encodes a single character exactly", () => {
    expect(code128Modules("A")).toEqual([
      2, 1, 1, 2, 1, 4, 1, 1, 1, 3, 2, 3, 1, 3, 1, 1, 2, 3, 2, 3, 3, 1, 1, 1, 2,
    ]);
  });

  it("puts the checksum before STOP, and it is modulo 103", () => {
    // checksum for "A" = (104 + 33*1) % 103 = 34 -> pattern "131123"
    expect(code128Modules("A").slice(12, 18)).toEqual([1, 3, 1, 1, 2, 3]);
  });

  it("encodes a real asset tag to the measured width", () => {
    const mods = code128Modules("BR-LT-0148");
    expect(mods).toHaveLength(6 * 10 + 19);
    expect(mods.reduce((a, b) => a + b, 0)).toBe(145);
  });

  it("always ends with STOP", () => {
    expect(code128Modules("BR-LT-0148").slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
    expect(code128Modules("A").slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  // The identity the label geometry depends on. If this drifts, labels overflow.
  it("costs 11n + 35 modules", () => {
    for (const n of [1, 5, 10, 20]) {
      const s = "A".repeat(n);
      expect(code128Modules(s).reduce((a, b) => a + b, 0)).toBe(
        CODE128_MODULES_PER_CHAR * n + CODE128_FIXED_MODULES,
      );
      expect(code128ModuleCount(n)).toBe(CODE128_MODULES_PER_CHAR * n + CODE128_FIXED_MODULES);
    }
  });

  it("accepts the whole printable ASCII range Code 128-B covers", () => {
    expect(() => code128Modules(" ")).not.toThrow();   // 32, the first
    expect(() => code128Modules("~")).not.toThrow();   // 126, the last
  });

  // Refuse rather than silently mis-encode: an out-of-charset character would
  // index past the pattern table and emit a symbol no scanner can read.
  it("refuses characters outside Code 128-B", () => {
    expect(() => code128Modules("café")).toThrow(/cannot be encoded/i);
    expect(() => code128Modules("tab\there")).toThrow(/cannot be encoded/i);
  });

  it("refuses an empty string rather than emitting a bodyless symbol", () => {
    expect(() => code128Modules("")).toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/code128.test.ts`
Expected: FAIL — `Failed to resolve import "./code128"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/code128.ts
/**
 * Code 128-B encoder, hand-rolled on purpose.
 *
 * A library would be untestable in any useful sense here, and any npm install
 * on Windows regenerates package-lock.json without the Linux optional-dep
 * trees and breaks the Alpine production image (HANDOVER §7). This is ~60
 * lines of pure logic a node-environment vitest can reach directly, which is
 * the structural lesson §6a states three times over.
 *
 * Returns MODULE WIDTHS, alternating bar-first: [bar, space, bar, space, ...].
 * It deliberately knows nothing about millimetres, SVG or assets — `labels.ts`
 * owns the physical geometry and `label-sheet.tsx` owns the rendering.
 */

/** 107 symbol patterns, index = symbol value. Each is 6 runs except STOP (7). */
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
] as const;

const START_B = 104;
const STOP = 106;

/** Every character group is 11 modules wide; START + checksum + STOP total 35. */
export const CODE128_MODULES_PER_CHAR = 11;
export const CODE128_FIXED_MODULES = 35;

/** Module count for an n-character string, without encoding it. */
export function code128ModuleCount(charCount: number): number {
  return CODE128_MODULES_PER_CHAR * charCount + CODE128_FIXED_MODULES;
}

export function code128Modules(text: string): number[] {
  if (text.length === 0) throw new Error("Cannot encode an empty string as Code 128.");
  const values: number[] = [START_B];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Code 128-B covers ASCII 32..126. Anything else would index past the
    // pattern table and emit a symbol that scans as garbage or not at all.
    if (code < 32 || code > 126) {
      throw new Error(`"${ch}" cannot be encoded in Code 128-B (only ASCII 32-126).`);
    }
    values.push(code - 32);
  }
  // Weighted modulo-103 checksum: START counts once, then position 1, 2, ...
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);
  return values.flatMap((v) => PATTERNS[v].split("").map(Number));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/code128.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-test the assertions (rule 78)**

Make each edit, run the suite, confirm a test fails, then `git checkout -- src/lib/code128.ts`.

| Mutation | Must fail |
|---|---|
| `sum % 103` → `sum % 100` | the checksum test |
| `values[i] * i` → `values[i] * (i + 1)` | the checksum test |
| `code - 32` → `code - 31` | the single-character test |
| drop `values.push(STOP)` | the STOP test **and** the `11n + 35` test |
| `code > 126` → `code > 255` | the out-of-charset test |

If any mutation leaves the suite green, the corresponding assertion is inert — fix the test, not the
table. Confirm `git status` is clean before committing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/code128.ts src/lib/code128.test.ts
git commit -m "feat(labels): a hand-rolled Code 128-B encoder, verified against the symbology"
```

---

### Task 2: Sheet geometry and pagination (TDD)

**Files:**
- Create: `src/lib/label-geometry.ts`
- Test: `src/lib/label-geometry.test.ts`

**The decision this task encodes, with its rationale corrected.** An earlier draft justified
fit-to-width as avoiding an 11-character cliff. **That argument is moot**: `TAG_SHAPE`
(`/^BR-[A-Z]{2}-\d{4}$/`) fixes every tag at exactly **10** characters on both write paths, so a fixed
0.33 mm module would always fit and the shrink branch is unreachable through the application.

Two better reasons to keep it anyway, and be honest that these are the reasons. First, **no database
CHECK constraint enforces the tag format** — it is an application invariant, so a longer tag is
unproducible but not impossible. Second, and decisively, *some* width check is needed regardless: with
no check at all a 13-character tag renders 57.9 mm into a 53.3 mm cell and silently overflows the
die-cut. Fit-to-width is barely more code than refuse-if-too-wide and degrades gracefully instead.

**So the shrink and floor branches are DEFENSIVE, not routine.** Their tests reach them only through
inputs (`"A".repeat(16)`, `"A".repeat(40)`) that no storable tag can be. Say so in the module's own
comment, so a later reader does not mistake unreachable branches for live ones.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/label-geometry.test.ts
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
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/label-geometry.test.ts`
Expected: FAIL — cannot resolve `./label-geometry`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/label-geometry.ts
import { code128ModuleCount } from "./code128";

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
  /** Module width to render at, in mm. */
  moduleMm: number;
  /** Total symbol width in mm at that module. */
  widthMm: number;
  /** False when `moduleMm` fell below MIN_MODULE_MM — render no barcode. */
  encodable: boolean;
}

/**
 * Fit-to-width rather than a fixed module: at a fixed 0.33mm the usable width
 * caps a tag at 11 characters, one more than the 10-character BR-XX-0000
 * format, which is a cliff rather than headroom.
 */
export function barcodeFit(tag: string): BarcodeFit {
  const modules = code128ModuleCount(tag.length);
  const moduleMm = Math.min(PREFERRED_MODULE_MM, LABEL_USABLE_MM / modules);
  return { moduleMm, widthMm: modules * moduleMm, encodable: moduleMm >= MIN_MODULE_MM };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/label-geometry.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation-test (rule 78)**

| Mutation | Must fail |
|---|---|
| `i += LABELS_PER_PAGE` → `i += LABELS_PER_PAGE - 1` | the 12/13 boundary test |
| `Math.min` → `Math.max` in `barcodeFit` | "never exceeds the usable width" |
| `moduleMm >= MIN_MODULE_MM` → `> 0` | the omit-below-floor test |
| `LABEL_PADDING_MM = 5` → `0` | the width-within-usable test (it changes `LABEL_USABLE_MM`) |

- [ ] **Step 6: Commit**

```bash
git add src/lib/label-geometry.ts src/lib/label-geometry.test.ts
git commit -m "feat(labels): sheet geometry, pagination, and a module width computed to fit"
```

---

### Task 3: The label sheet component, the print route, and the PrintButton move

**Files:**
- Create: `src/components/inventory/label-sheet.tsx`
- Create: `src/app/(app)/inventory/labels/page.tsx`
- Create: `src/components/ui/print-button.tsx`
- Delete: `src/components/employees/print-button.tsx`
- Modify: `src/app/(app)/offboarding/[employeeId]/report/page.tsx` (import path)
- Modify: `src/app/(app)/employees/[id]/form/page.tsx` (import path)

- [ ] **Step 1: Move `PrintButton`**

Create `src/components/ui/print-button.tsx` with the file's exact current contents:

```tsx
"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="primary" className="print:hidden" onClick={() => window.print()}>
      Print
    </Button>
  );
}
```

Delete `src/components/employees/print-button.tsx` and update both importers from
`@/components/employees/print-button` to `@/components/ui/print-button`. Behaviour is unchanged; this
is a generic `window.print()` button with three callers in three different domains, and
`components/employees/` was already the wrong home for two of them.

- [ ] **Step 2: Verify the move broke nothing**

```bash
npx tsc --noEmit && npm run lint
```
Expected: both clean. `grep -rn "employees/print-button" src` returns nothing.

- [ ] **Step 3: Write the label sheet component**

```tsx
// src/components/inventory/label-sheet.tsx
import { code128Modules } from "@/lib/code128";
import {
  CALIBRATION_MM, LABEL_CELL_MM, LABEL_COLUMNS, LABEL_PADDING_MM, LABEL_USABLE_MM,
  PAGE_MARGIN_MM, PAGE_MM, barcodeFit, labelPages,
} from "@/lib/label-geometry";

export interface LabelRow {
  tag: string;
  model: string;
}

/**
 * A Server Component: there is nothing interactive on a sheet of stickers.
 * Light-theme-only and absolute mm throughout, matching the two print surfaces
 * that already exist (the farewell report and the accountability form) —
 * these are printed artifacts, not screens.
 */
function Barcode({ tag }: { tag: string }) {
  const fit = barcodeFit(tag);
  if (!fit.encodable) {
    // An unscannable code is worse than none: the sticker would look finished.
    return (
      <span style={{ fontSize: "2.4mm", color: "#B42318", fontFamily: "monospace" }}>
        tag too long to encode
      </span>
    );
  }
  const widths = code128Modules(tag);
  let x = 0;
  const bars: React.ReactElement[] = [];
  widths.forEach((w, i) => {
    const width = w * fit.moduleMm;
    if (i % 2 === 0) {
      bars.push(<rect key={i} x={x} y={0} width={width} height={9} fill="#000" />);
    }
    x += width;
  });
  return (
    <svg
      width={`${fit.widthMm}mm`}
      height="9mm"
      viewBox={`0 0 ${fit.widthMm} 9`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode ${tag}`}
      shapeRendering="crispEdges"
    >
      {bars}
    </svg>
  );
}

export function LabelSheet({ rows }: { rows: LabelRow[] }) {
  const byTag = new Map(rows.map((r) => [r.tag, r]));
  return (
    <div className="label-sheets">
      {labelPages(rows.map((r) => r.tag)).map((page, p) => (
        <div
          key={p}
          className="label-page"
          style={{
            width: `${PAGE_MM.width}mm`,
            height: `${PAGE_MM.height}mm`,
            padding: `${PAGE_MARGIN_MM}mm`,
            display: "grid",
            gridTemplateColumns: `repeat(${LABEL_COLUMNS}, ${LABEL_CELL_MM.width}mm)`,
            gridAutoRows: `${LABEL_CELL_MM.height}mm`,
            background: "#fff",
            color: "#101828",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          {page.map((tag) => {
            const row = byTag.get(tag)!;
            return (
              <div
                key={tag}
                style={{
                  padding: `${LABEL_PADDING_MM}mm`,
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  overflow: "hidden",
                  border: "0.2mm dashed #C4CAD4",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1.5mm", minWidth: 0 }}>
                  <span style={{ background: "#101828", color: "#fff", fontFamily: "monospace", fontSize: "2.6mm", padding: "0.6mm 1mm", flex: "none" }}>
                    BR
                  </span>
                  <span style={{ fontSize: "2.6mm", color: "#667085", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.model}
                  </span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "4.6mm", fontWeight: 700, letterSpacing: "0.02em" }}>
                  {tag}
                </div>
                <div style={{ width: `${LABEL_USABLE_MM}mm` }}>
                  <Barcode tag={tag} />
                </div>
              </div>
            );
          })}
          {/* The only thing that can catch a browser printing at 96%.
              ABSOLUTELY POSITIONED, inside the page's own bottom margin --
              NOT a grid row: 4 rows x 69.25mm + 20mm padding is exactly
              297mm, so a fifth row would push this onto a second sheet and
              a ruler on a different sheet proves nothing about this one. */}
          <div style={{ position: "absolute", left: `${PAGE_MARGIN_MM}mm`, bottom: "2.5mm", display: "flex", alignItems: "center", gap: "2mm", fontSize: "2.4mm", color: "#667085" }}>
            <span style={{ display: "block", width: `${CALIBRATION_MM}mm`, height: "1.5mm", background: "#101828" }} />
            <span>
              this bar is exactly {CALIBRATION_MM}mm &mdash; measure it. If it is short, the print
              dialog is scaling: set Scale 100% and Margins None.
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Why the ruler is absolutely positioned rather than a grid row.** Four rows of 69.25 mm plus the
20 mm of page padding is exactly 297 mm — A4 is full. A fifth grid row would push the ruler onto a
second sheet, and a ruler on a different sheet proves nothing about the sheet the labels are on. It
lives in the page's own bottom margin instead, which is empty by construction.

`LABEL_COLUMNS` is imported for the grid template; `PAGE_MARGIN_MM` for the ruler's left offset. If
your editor reports either as unused, you have mis-transcribed the block — both are used.

- [ ] **Step 4: Write the print route**

```tsx
// src/app/(app)/inventory/labels/page.tsx
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PageHeader } from "@/components/ui/page-header";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { PrintButton } from "@/components/ui/print-button";
import { LabelSheet } from "@/components/inventory/label-sheet";
import { BULK_MAX } from "@/lib/inventory-list";
import { labelPages } from "@/lib/label-geometry";

export default async function LabelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // A SET, not a floor — matching both importers. requireRole("it_staff")
  // alone would lock out admin, the role that runs this app.
  await requireRole("admin", "it_staff");
  const raw = (await searchParams).ids;
  const idsParam = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))];

  // Refuse, never slice (the defect §8 records for the export route's ?ids=).
  if (ids.length > BULK_MAX) {
    return (
      <>
        <PageHeader title="Print labels" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Labels" }]} />
        <Banner tone="fault" title={`That selection is ${ids.length} assets, over the ${BULK_MAX}-asset label cap. Narrow the selection and try again. Nothing was printed.`} />
      </>
    );
  }

  const assets = ids.length
    ? await prisma.asset.findMany({ where: { id: { in: ids } }, select: { tag: true, model: true }, orderBy: { tag: "asc" } })
    : [];

  if (assets.length === 0) {
    return (
      <>
        <PageHeader title="Print labels" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Labels" }]} />
        <Banner tone="attention" title="Nothing to print">
          Pick assets on the inventory list first — select rows, then choose Print labels from Bulk
          actions. A label sheet is built from a selection, never from the whole fleet.
        </Banner>
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }

  const rows = assets.map((a) => ({ tag: a.tag, model: a.model }));
  const missing = ids.length - assets.length;
  const sheets = labelPages(rows.map((r) => r.tag)).length;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Print labels"
          breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Labels" }]}
          actions={<PrintButton />}
        />
        <div className="flex flex-col gap-2 pb-4">
          <p className="font-mono text-[11px] text-fg-muted">
            {rows.length} label{rows.length === 1 ? "" : "s"} · {sheets} sheet{sheets === 1 ? "" : "s"}
          </p>
          {/* A stale selection must not silently print fewer stickers than the
              operator counted. */}
          {missing > 0 && (
            <Banner tone="attention" title={`${missing} selected asset${missing === 1 ? "" : "s"} no longer exist${missing === 1 ? "s" : ""} and ${missing === 1 ? "was" : "were"} skipped.`} />
          )}
          <Banner tone="neutral" title="Before you print">
            Set <span className="font-mono">Scale: 100%</span> and{" "}
            <span className="font-mono">Margins: None</span> in the print dialog. Then measure the
            100mm bar on the sheet — if it is short, the browser scaled the page and the stickers will
            not line up.
          </Banner>
        </div>
      </div>
      <LabelSheet rows={rows} />
    </>
  );
}
```

- [ ] **Step 5: Add the print CSS**

In `src/app/globals.css`, append:

```css
/* Asset label sheet. Absolute mm and no page margin, because the grid carries
   its own — otherwise the browser's margin doubles up and the 3x4 grid stops
   matching the die-cut. */
@page {
  size: A4;
  margin: 0;
}

@media print {
  .label-page {
    break-after: page;
  }
  .label-page:last-child {
    break-after: auto;
  }
}
```

- [ ] **Step 6: Verify it renders**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: all clean, and `/inventory/labels` appears in the build's route list.

- [ ] **Step 7: Commit**

```bash
git add src/lib src/components src/app
git commit -m "feat(labels): the 3x4 A4 label sheet and its print route"
```

---

### Task 4: The role gate, the entry point, and the e2e

**Files:**
- Modify: `src/lib/workspaces.ts`
- Modify: `src/lib/workspaces.test.ts`
- Modify: `src/components/inventory/bulk-drawer.tsx`
- Create: `e2e/labels.spec.ts`

- [ ] **Step 1: Add the PATH_RULES entry, with its unit test**

⚠️ **This is the trap.** `/inventory` is granted to the `it`, `purchasing` **and** `finance`
workspaces. Without a dedicated rule ahead of it, a finance user can print asset labels. Both import
routes hit this exact defect (E-7 / W-1). Place the new rule immediately beside
`/inventory/import`'s, which is already correct:

```ts
  // Same shape and same reason as /inventory/import's rule directly above:
  // this MUST precede the general /inventory rule (first-match-wins), because
  // that rule admits purchasing and finance, and a label sheet is an IT
  // artifact. Asserted in workspaces.test.ts and in e2e/labels.spec.ts.
  { test: /^\/inventory\/labels(\/|$)/, workspaces: ["it"], roles: ["admin", "it_staff"] },
```

Add to `src/lib/workspaces.test.ts`:

```ts
it("labels are IT-only, and the rule precedes the general /inventory grant", () => {
  expect(canAccess("/inventory/labels", "finance_staff")).toBe(false);
  expect(canAccess("/inventory/labels", "purchasing_staff")).toBe(false);
  expect(canAccess("/inventory/labels", "viewer")).toBe(false);
  expect(canAccess("/inventory/labels", "it_staff")).toBe(true);
  expect(canAccess("/inventory/labels", "admin")).toBe(true);
});
```

**Check the real helper name and signature before writing this** — read
`src/lib/workspaces.test.ts` and copy the idiom the existing route-rule tests use rather than assuming
`canAccess`. If the export is named differently, use the real name and amend this plan.

- [ ] **Step 2: Run the unit test**

Run: `npx vitest run src/lib/workspaces.test.ts`
Expected: PASS.

- [ ] **Step 3: Add the entry point and fix the stale wording**

In `src/components/inventory/bulk-drawer.tsx`, the existing export link says "Export this selection as
**CSV**". That route has served xlsx since Phase 9 Task 3 — user-facing prose claiming what the code
does not do (§6a rules 16 / 35). Change the label to "Export this selection as a spreadsheet", and add
the labels link beneath it:

```tsx
        {/* Labels come from an explicit selection only: "all matching" would
            make one click a 17-sheet print job, and labelling a whole filtered
            fleet is not a real intent. Absent, not disabled, when there is no
            selection — the house rule for affordances that cannot act. */}
        {!allMatching && selectedIds.length > 0 && (
          <a
            href={`/inventory/labels?ids=${selectedIds.join(",")}`}
            className="text-xs text-accent hover:underline"
          >
            Print labels for {selectedIds.length} selected
          </a>
        )}
```

- [ ] **Step 4: Write the e2e spec**

```ts
// e2e/labels.spec.ts
import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { BULK_MAX } from "@/lib/inventory-list";
import { SEED_PASSWORD } from "../prisma/fixtures";

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("label sheet", () => {
  test("renders one barcode per selected asset, with the calibration bar", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0148");
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 30_000 });
    const id = page.url().split("/").pop()!;

    await page.goto(`/inventory/labels?ids=${id}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    // The barcode is a real <svg role="img"> named after its tag — asserted by
    // ROLE, so a sticker that renders no code fails rather than passing on the
    // tag text alone.
    await expect(page.getByRole("img", { name: "Barcode BR-LT-0148" })).toBeVisible();
    await expect(page.getByText("1 label · 1 sheet")).toBeVisible();
    await expect(page.getByText(/exactly 100mm — measure it/)).toBeVisible();
  });

  test("an oversized selection is refused, and prints nothing", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `id${i}`).join(",");
    await page.goto(`/inventory/labels?ids=${ids}`);
    await expect(page.getByText(new RegExp(`over the ${BULK_MAX}-asset label cap`))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("img", { name: /^Barcode / })).toHaveCount(0);
  });

  test("ids that match nothing say so instead of printing a blank sheet", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/labels?ids=nope1,nope2");
    await expect(page.getByText("Nothing to print")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Back to inventory" })).toBeVisible();
  });

  // The E-7 trap, asserted rather than assumed: the general /inventory rule
  // admits both of these workspaces.
  test("finance and viewer cannot reach the label sheet at all", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/inventory/labels?ids=whatever");
    await expect(page).not.toHaveURL(/\/inventory\/labels/, { timeout: 30_000 });

    await login(page, "viewer@thebackroomop.com");
    await page.goto("/inventory/labels?ids=whatever");
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
  });
});
```

- [ ] **Step 5: Run it green**

```bash
npm run db:seed && npx playwright test e2e/labels.spec.ts --workers=1
```
Foreground, long timeout. Never background a Playwright run (§7).

- [ ] **Step 6: Mutation-test the two load-bearing assertions (rule 78)**

| Mutation | Must fail |
|---|---|
| Move the `/inventory/labels` rule *after* the general `/inventory` rule | the finance/viewer test **and** the unit test |
| `if (ids.length > BULK_MAX)` → `ids = ids.slice(0, BULK_MAX)` | the oversized-selection test |

The first is the whole point of the task. If it does not fail, the rule is in the wrong place or the
test is checking the wrong thing.

- [ ] **Step 7: Commit**

```bash
git add src/lib src/components e2e
git commit -m "feat(labels): IT-only route rule, the bulk-drawer entry, and the e2e"
```

---

### Task 5: The scan verdict (TDD)

**Files:**
- Create: `src/lib/scan.ts`
- Test: `src/lib/scan.test.ts`

**Why this is a separate task from the component.** Three Phase 9 defects were pure logic living where
vitest could not reach it (`resolveAssetRefs`, `assetDiff`, `hasDiverged`), each found only by review.
The scan verdict is a decision over a list and a string. It belongs in `src/lib`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/scan.test.ts
import { describe, expect, it } from "vitest";
import { matchScan, type ScanItem } from "./scan";

const ITEMS: ScanItem[] = [
  { assetId: "a1", tag: "BR-LT-0166", decided: false, blockedBy: null },
  { assetId: "a2", tag: "BR-PH-0312", decided: true, blockedBy: null },
  { assetId: "a3", tag: "BR-HS-0510", decided: false, blockedBy: "APR-2039" },
];

describe("matchScan", () => {
  it("matches a held, undecided, unblocked item", () => {
    expect(matchScan("BR-LT-0166", ITEMS)).toEqual({ kind: "match", assetId: "a1", tag: "BR-LT-0166" });
  });

  // A scanner may emit lower case, and the operator may leave a space.
  it("normalises case and surrounding whitespace", () => {
    expect(matchScan("  br-lt-0166 ", ITEMS)).toEqual({ kind: "match", assetId: "a1", tag: "BR-LT-0166" });
  });

  it("reports a tag this employee does not hold, and echoes what was scanned", () => {
    expect(matchScan("BR-ZZ-9999", ITEMS)).toEqual({ kind: "unknown", value: "BR-ZZ-9999" });
  });

  it("reports an item that already has a decision rather than re-opening it", () => {
    expect(matchScan("BR-PH-0312", ITEMS)).toEqual({ kind: "already-decided", tag: "BR-PH-0312" });
  });

  // The verdict the brief never mentions and a seed-based test would miss:
  // preselecting here would stage exactly what decideItem refuses.
  it("reports an item blocked by a prior approval, naming the blocker", () => {
    expect(matchScan("BR-HS-0510", ITEMS)).toEqual({ kind: "blocked", tag: "BR-HS-0510", refNo: "APR-2039" });
  });

  it("ignores an empty or whitespace-only buffer", () => {
    expect(matchScan("", ITEMS)).toEqual({ kind: "ignored" });
    expect(matchScan("   ", ITEMS)).toEqual({ kind: "ignored" });
  });

  // Decided beats blocked: a decided item is settled, and telling the operator
  // to go resolve an approval they no longer need to resolve is wrong.
  it("prefers already-decided over blocked when an item is both", () => {
    const both: ScanItem[] = [{ assetId: "x", tag: "BR-LT-0001", decided: true, blockedBy: "APR-1" }];
    expect(matchScan("BR-LT-0001", both)).toEqual({ kind: "already-decided", tag: "BR-LT-0001" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: FAIL — cannot resolve `./scan`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/scan.ts
import { tagKey } from "./import-assets";

/**
 * The offboarding wizard's scan rule. Pure, and deliberately outside the
 * component: three Phase 9 defects were pure logic sitting where vitest could
 * not reach it, each found only by review.
 *
 * `ScanItem` is the minimal STRUCTURAL shape this rule reads — never the
 * wizard's own `WizardItem`, so the query and this rule can change
 * independently.
 */
export interface ScanItem {
  assetId: string;
  tag: string;
  decided: boolean;
  /** refNo of a prior approval holding this asset's one open slot, or null. */
  blockedBy: string | null;
}

export type ScanVerdict =
  | { kind: "match"; assetId: string; tag: string }
  | { kind: "unknown"; value: string }
  | { kind: "already-decided"; tag: string }
  | { kind: "blocked"; tag: string; refNo: string }
  | { kind: "ignored" };

export function matchScan(buffer: string, items: readonly ScanItem[]): ScanVerdict {
  // tagKey is the app's own trim+upper-case rule, shared rather than
  // re-implemented: four hand-written twins of existing rules were removed in
  // Phase 9 and every one of them had drifted.
  const key = tagKey(buffer).trim();
  if (key === "") return { kind: "ignored" };

  const item = items.find((i) => tagKey(i.tag) === key);
  if (!item) return { kind: "unknown", value: key };
  // Decided beats blocked: the item is settled, and sending the operator to
  // resolve an approval they no longer need to resolve would be wrong.
  if (item.decided) return { kind: "already-decided", tag: item.tag };
  if (item.blockedBy) return { kind: "blocked", tag: item.tag, refNo: item.blockedBy };
  return { kind: "match", assetId: item.assetId, tag: item.tag };
}
```

**Check `tagKey` before relying on it.** It is `cellText(raw).toUpperCase()` in
`src/lib/import-assets.ts` and `cellText` already trims — verify that, and if it does, drop the extra
`.trim()` and amend this plan rather than leaving a redundant call that implies `cellText` does not.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-test (rule 78)**

| Mutation | Must fail |
|---|---|
| swap the `decided` and `blockedBy` checks | the "prefers already-decided" test |
| `tagKey(i.tag) === key` → `i.tag === key` | the normalisation test |
| drop the `key === ""` guard | the empty-buffer test |
| `if (!item)` → `if (false)` | the unknown-tag test |

- [ ] **Step 6: Commit**

```bash
git add src/lib/scan.ts src/lib/scan.test.ts
git commit -m "feat(scan): the offboarding scan verdict, pure and four-way"
```

---

### Task 6: Wire the scanner into the wizard

**Files:**
- Create: `src/components/offboarding/scan-provider.tsx`
- Modify: `src/components/offboarding/item-decision.tsx`
- Modify: `src/app/(app)/offboarding/[employeeId]/page.tsx`

- [ ] **Step 1: Write the provider**

```tsx
// src/components/offboarding/scan-provider.tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { matchScan, type ScanItem, type ScanVerdict } from "@/lib/scan";

/**
 * A USB barcode scanner is a keyboard: it types the payload fast and presses
 * Enter. So this is keystroke buffering, not hardware work.
 *
 * `nonce` increments on every accepted scan so scanning the SAME tag twice
 * re-triggers — without it, re-scanning an item after changing your mind would
 * be inert, which reads as a broken scanner.
 *
 * Nothing here writes. A scan stages a decision; Confirm files it.
 */
interface ScanState {
  tag: string | null;
  nonce: number;
}

const ScanCtx = createContext<ScanState>({ tag: null, nonce: 0 });

export function useScan(): ScanState {
  return useContext(ScanCtx);
}

/** Characters this far apart are a human typing, not a scanner. */
const BUFFER_IDLE_MS = 400;

export function ScanProvider({ items, children }: { items: ScanItem[]; children: React.ReactNode }) {
  const [state, setState] = useState<ScanState>({ tag: null, nonce: 0 });
  const [verdict, setVerdict] = useState<ScanVerdict | null>(null);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    const raw = buffer.current;
    buffer.current = "";
    const v = matchScan(raw, items);
    if (v.kind === "ignored") return;
    setVerdict(v);
    if (v.kind === "match") setState((s) => ({ tag: v.tag, nonce: s.nonce + 1 }));
  }, [items]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // The bug most likely to ship here: without this guard, typing a Reason
      // is captured as a scan and the textarea's own keystrokes vanish into
      // the buffer.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      if (e.key === "Enter") {
        if (buffer.current !== "") { e.preventDefault(); flush(); }
        return;
      }
      if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
      buffer.current += e.key;
      if (timer.current) clearTimeout(timer.current);
      // A partial scan must not poison the next one.
      timer.current = setTimeout(() => { buffer.current = ""; }, BUFFER_IDLE_MS * 4);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);

  return (
    <ScanCtx.Provider value={state}>
      <div className="flex flex-col gap-4">
        <Banner tone="neutral" title="Scanning works here">
          Point a USB scanner at an asset tag and this page will jump to that item and preselect
          Returned. It does not confirm anything — you still click Confirm, so a mis-scan costs
          nothing.
        </Banner>
        {/* Rule 10: every verdict the rule can return is rendered, not just
            the happy one. `aria-live` because a scanner user is looking at the
            box, not the screen. */}
        <div aria-live="polite">
          {verdict?.kind === "unknown" && (
            <Banner tone="fault" title={`${verdict.value} is not one of this person's items.`}>
              Check you scanned the right sticker — this asset is not in their name.
            </Banner>
          )}
          {verdict?.kind === "already-decided" && (
            <Banner tone="attention" title={`${verdict.tag} is already decided.`}>
              Its request has been filed. Nothing further is needed for that item.
            </Banner>
          )}
          {verdict?.kind === "blocked" && (
            <Banner tone="attention" title={`${verdict.tag} is held by ${verdict.refNo}.`}>
              Resolve that request first — this item cannot be decided until it clears.
            </Banner>
          )}
        </div>
        {children}
      </div>
    </ScanCtx.Provider>
  );
}
```

- [ ] **Step 2: React to a scan in `ItemDecision`**

Add to `src/components/offboarding/item-decision.tsx`, inside the component:

```tsx
  const rootRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [scanned, setScanned] = useState(false);
  const scan = useScan();

  // Acts only on this card's own tag. `nonce` is in the dependency list so
  // scanning the same tag twice re-triggers.
  useEffect(() => {
    if (scan.tag !== tag) return;
    setOutcome("RETURNED");
    setScanned(true);
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    confirmRef.current?.focus();
  }, [scan.tag, scan.nonce, tag]);
```

Put `ref={rootRef}` on the existing `role="group"` div and add the highlight, and `ref={confirmRef}` on
the Confirm button:

```tsx
    <div
      ref={rootRef}
      role="group"
      aria-label={`Decide ${tag}`}
      className={
        "flex flex-col gap-2 rounded-(--radius-card) transition-shadow " +
        (scanned ? "outline-2 outline-offset-4 outline-accent" : "")
      }
    >
```

Import `useEffect`, `useRef` from react and `useScan` from `./scan-provider`.

- [ ] **Step 3: Wrap the collect step**

In `src/app/(app)/offboarding/[employeeId]/page.tsx`, wrap the `step === "collect"` branch's card list
in `ScanProvider`, passing plain data:

```tsx
        <ScanProvider
          items={items.filter((i) => i.held).map((i) => ({
            assetId: i.assetId,
            tag: i.tag,
            decided: !!i.decision,
            blockedBy: i.blockedBy?.refNo ?? null,
          }))}
        >
          {/* the existing EmptyState / card-list JSX, unchanged */}
        </ScanProvider>
```

⚠️ **Plain DATA across the Server→Client boundary, never a function.** A Server Component can only
pass a function to a Client Component when it is itself a `"use server"` action; passing an ordinary
function fails at render, and `tsc`, `lint` and `build` all pass on it (§6a rule 66 — Phase 9 Task 12
shipped exactly this). The already-rendered cards go through as `children`, which is fine.

The provider replaces the collect step's outer `<div className="flex flex-col gap-4">` — it renders one
itself, so do not nest a second.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components src/app
git commit -m "feat(scan): a scan preselects Returned in the offboarding wizard, and writes nothing"
```

---

### Task 7: Scanner e2e

**Files:**
- Create: `e2e/scanner.spec.ts`

⚠️ **The listener binds on hydration**, so a test that types immediately after navigating passes or
fails on compile warmth. §6a rules 61 and 76: rule 61's *stated* fix (waiting for a field's initial
value) is not a hydration signal at all, because the server renders that same value. Reuse
`waitForHydration` from `e2e/it-core.spec.ts` — copy the helper, probing **the element being
interacted with**, never its ancestor.

- [ ] **Step 1: Write the spec**

```ts
// e2e/scanner.spec.ts
import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { SEED_PASSWORD } from "../prisma/fixtures";

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** See e2e/it-core.spec.ts and §6a rule 76 for why this is the only reliable
 * hydration signal: three cheaper proxies all pass before React is ready. */
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** A USB scanner types the payload and presses Enter. Typed on the BODY, not
 * into a field — which is exactly what the listener's focus guard must allow. */
async function scan(page: Page, tag: string) {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.type(tag, { delay: 12 });
  await page.keyboard.press("Enter");
}

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

async function openCollect(page: Page) {
  await page.goto("/offboarding");
  await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
  await expect(page).toHaveURL(/\/offboarding\/[^/]+$/, { timeout: 30_000 });
  await page.getByRole("list", { name: "Offboarding steps" }).getByRole("link", { name: /Collect items/ }).click();
  await expect(page.getByText("Scanning works here")).toBeVisible({ timeout: 30_000 });
}

test.describe.serial("offboarding scanner", () => {
  test("a scan preselects Returned on the matching item and writes nothing", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);

    const card = page.getByRole("group", { name: "Decide BR-LT-0166" });
    await waitForHydration(card.getByRole("radiogroup"));
    await scan(page, "BR-LT-0166");

    // Preselected, not confirmed: the radio is checked and no approval exists.
    await expect(card.getByRole("radio", { name: "Returned" })).toBeChecked();
    await expect(page.getByText(/APR-\d+ created/)).toHaveCount(0);
    await expect(page.getByRole("row", { name: /BR-LT-0166/ })).toHaveCount(0);
  });

  test("a lower-case scan still matches", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-PH-0312" });
    await waitForHydration(card.getByRole("radiogroup"));
    await scan(page, "br-ph-0312");
    await expect(card.getByRole("radio", { name: "Returned" })).toBeChecked();
  });

  test("an unknown tag is refused by name", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    await waitForHydration(page.getByRole("group", { name: /^Decide / }).first().getByRole("radiogroup"));
    await scan(page, "BR-ZZ-9999");
    await expect(page.getByText("BR-ZZ-9999 is not one of this person's items.")).toBeVisible();
  });

  // The bug most likely to ship: the listener must not eat keystrokes meant
  // for the Reason box.
  test("typing a Reason is not captured as a scan", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-HS-0510" });
    const reason = card.getByLabel(/Reason/);
    await waitForHydration(reason);
    await reason.fill("BR-LT-0166");
    await expect(reason).toHaveValue("BR-LT-0166");
    // The other card must NOT have reacted to those keystrokes.
    await expect(
      page.getByRole("group", { name: "Decide BR-LT-0166" }).getByRole("radio", { name: "Returned" }),
    ).not.toBeChecked();
  });

  test("scanning an already-decided item says so instead of re-opening it", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-HS-0510" });
    await waitForHydration(card.getByRole("radiogroup"));
    await card.getByRole("radiogroup").getByText("Returned").click();
    await card.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByText(/APR-\d+ created — BR-HS-0510/)).toBeVisible({ timeout: 30_000 });

    await scan(page, "BR-HS-0510");
    await expect(page.getByText("BR-HS-0510 is already decided.")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run it green**

```bash
npm run db:seed && npx playwright test e2e/scanner.spec.ts --workers=1
```

- [ ] **Step 3: Mutation-test (rule 78)**

| Mutation | Must fail |
|---|---|
| delete the `INPUT`/`TEXTAREA` focus guard | "typing a Reason is not captured as a scan" |
| `setState({ tag: v.tag, nonce: s.nonce + 1 })` → `nonce: s.nonce` | the second scan of a session (add a re-scan assertion if it does not) |
| render only the `unknown` banner | the already-decided test |

- [ ] **Step 4: Commit**

```bash
git add e2e/scanner.spec.ts
git commit -m "test(e2e): the scanner, including the keystrokes it must not steal"
```

---

### Task 8: The two known moderate axe violations

**Files:**
- Modify: `src/components/ui/card.tsx`
- Modify: `src/components/ui/segmented-control.tsx`
- Modify: `src/components/offboarding/item-decision.tsx`

- [ ] **Step 1: Fix `heading-order`**

`PageHeader` renders `<h1>`; `CardHeader` renders `<h3>`, so every page combining them skips `<h2>`.
One line, in one component, inherited by 15 files:

```tsx
      <h2 className="text-[15px] font-semibold leading-tight text-fg">{title}</h2>
```

Keep the class list byte-identical — this is a semantics fix, not a visual one. Then check for pages
that render a real `<h2>` of their own and would now collide:

```bash
grep -rn "<h2" src/app src/components
```

- [ ] **Step 2: Give `SegmentedControl` the two ARIA props**

Add to the props type and spread them onto the `role="radiogroup"` div:

```tsx
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
```
```tsx
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
```
```tsx
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid || undefined}
```

Both **optional**: of the four call sites, only the offboarding decision card has an error to announce
(`asset-form.tsx`'s initial-status control, `loadout-view.tsx`'s view toggle and the kitchen sink have
no error state), so three call sites are unchanged. `aria-invalid={ariaInvalid || undefined}` because
`aria-invalid="false"` and an absent attribute are not the same thing to every screen reader.

- [ ] **Step 3: Wire the one call site that has an error**

In `item-decision.tsx` the control sits **outside** a `FormField`, with a bare
`<FormError>{fieldErrors.outcome}</FormError>` beneath it — so the error has no id to point at. Give it
one:

```tsx
  const outcomeErrorId = "outcome-error-" + assetId;
```
```tsx
        <SegmentedControl
          aria-label={`Outcome for ${tag}`}
          aria-describedby={fieldErrors.outcome ? outcomeErrorId : undefined}
          aria-invalid={!!fieldErrors.outcome}
          options={OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
          value={outcome}
          onChange={setOutcome}
        />
```
```tsx
      <FormError id={outcomeErrorId}>{fieldErrors.outcome}</FormError>
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run test
```

- [ ] **Step 5: Commit**

```bash
git add src/components
git commit -m "fix(a11y): CardHeader is an h2, and SegmentedControl announces its error"
```

---

### Task 9: The axe sweep

**Files:**
- Create: `e2e/axe-sweep.spec.ts`

- [ ] **Step 1: Write the sweep**

Build the route table from the real app, not from memory: `find src/app -name page.tsx` and give each
route the lowest-privilege role that can reach it. Resolve dynamic-route ids from the seed **by
business key** — never a raw cuid, because ids change on every reseed.

```ts
// e2e/axe-sweep.spec.ts
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 10's axe pass. The point is COVERAGE, not severity: §6a rule 62's
 * defect was a design token failing on ~24 usages while the suite stayed
 * green, because one spec scanned /employees/[id] and never the list. A green
 * suite bounds what has been checked, not what is true.
 *
 * Fails on serious/critical. Moderates are COUNTED and printed, not failed —
 * the number across ~38 never-scanned routes was unknown when this was
 * written, and committing to fix an uncounted set is how a polish phase stops
 * being polish. Record the final counts in HANDOVER §8.
 */
const db = new PrismaClient();
const moderates = new Map<string, number>();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
  const rows = [...moderates.entries()].sort((a, b) => b[1] - a[1]);
  console.log("\n=== moderate/minor axe violations by rule (not failed) ===");
  if (rows.length === 0) console.log("  none");
  for (const [rule, count] of rows) console.log(`  ${count.toString().padStart(4)}  ${rule}`);
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function scanRoute(page: Page, path: string) {
  await page.goto(path);
  // §6a rule 79, measured three times: Button variant="primary" reports a
  // phantom SERIOUS 4.29 contrast when axe samples it mid-transition or with
  // the pointer resting on it, and passes at rest. Without these two lines
  // this sweep chases a violation that does not exist.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);

  const results = await new AxeBuilder({ page }).analyze();
  for (const v of results.violations) {
    if (v.impact === "serious" || v.impact === "critical") continue;
    moderates.set(v.id, (moderates.get(v.id) ?? 0) + v.nodes.length);
  }
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`), `axe on ${path}`).toEqual([]);
}

// One test per role, sweeping that role's routes, so a failure names the role.
const ADMIN_ROUTES = [
  "/", "/inventory", "/inventory/new", "/inventory/import", "/inventory/activity",
  "/employees", "/employees/import", "/employees/activity",
  "/approvals", "/audit", "/offboarding", "/reservations",
  "/admin/users", "/admin/flags", "/admin/webhooks", "/admin/asset-categories",
  "/admin/asset-types", "/admin/departments", "/admin/equipment-policies",
  "/purchases", "/purchases/new", "/purchases/activity",
  "/finance/assets", "/finance/activity",
];

test.describe("axe sweep", () => {
  test("every admin-reachable static route", async ({ page }) => {
    test.setTimeout(600_000);
    await login(page, "admin@thebackroomop.com");
    for (const path of ADMIN_ROUTES) await scanRoute(page, path);
  });

  test("dynamic routes, resolved from the seed by business key", async ({ page }) => {
    test.setTimeout(600_000);
    await login(page, "admin@thebackroomop.com");
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    const employee = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    const approval = await db.approval.findFirstOrThrow({ orderBy: { refNo: "asc" } });
    const pr = await db.purchaseRequest.findFirstOrThrow({ orderBy: { refNo: "asc" } });

    for (const path of [
      `/inventory/${asset.id}`, `/inventory/${asset.id}/edit`, `/inventory/${asset.id}/history`,
      `/inventory/${asset.id}/timeline`, `/inventory/${asset.id}/documents`,
      `/inventory/${asset.id}/secrets`, `/inventory/${asset.id}/reservations`,
      `/inventory/labels?ids=${asset.id}`,
      `/employees/${employee.id}`, `/employees/${employee.id}/edit`, `/employees/${employee.id}/form`,
      `/offboarding/${employee.id}`, `/offboarding/${employee.id}?step=collect`,
      `/offboarding/${employee.id}/report`,
      `/approvals/${approval.id}`, `/purchases/${pr.id}`,
    ]) await scanRoute(page, path);
  });

  test("the viewer's own view of the shared routes", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, "viewer@thebackroomop.com");
    for (const path of ["/", "/inventory", "/employees", "/approvals", "/audit"]) {
      await scanRoute(page, path);
    }
  });
});
```

- [ ] **Step 2: Run it and read the moderate report**

```bash
npm run db:seed && npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```

Expected: PASS, plus a printed moderate table. **If a serious/critical violation appears on a route no
spec previously scanned, that is the point of the task** — fix it, and note in the commit that it was
previously unchecked rather than newly broken (§6a rule 62).

- [ ] **Step 3: Verify the sweep can actually fail**

Temporarily add `<img src="/x.png" />` (no `alt`) to `src/app/(app)/inventory/page.tsx`, re-run the
first sweep test, and confirm it fails on `image-alt`. Revert with `git checkout --`. A sweep that
cannot fail is worse than no sweep, because it reads as proof.

- [ ] **Step 4: Commit**

```bash
git add e2e/axe-sweep.spec.ts
git commit -m "test(e2e): sweep every route with axe, and count what sits below the bar"
```

---

### Task 10: The deployment README, proven from a clean state

**Files:**
- Modify: `README.md`

**This is a verification task, not a writing task.** HANDOVER §6 predicts it slips precisely because
nothing forces prose to be true. Every command in the document gets executed once.

- [ ] **Step 1: Write the README**

Sections, in this order: what the system is (two paragraphs) · prerequisites (Docker Desktop, Node ≥22,
npm ≥11) · **dev quickstart** · **production deploy** · secrets · migrations · the worker · seeded
accounts · troubleshooting · what does not work.

Facts that must be in it, each already true and currently scattered:

- `cp .env.example .env`, then generate each secret. `AUTH_SECRET` and `SECRET_ENCRYPTION_KEY` are
  `openssl rand -base64 24` and a 32-byte base64 key respectively — **read `.env.example`'s own
  comments and copy what they say** rather than restating from memory.
- Dev: `docker compose up -d db` → `npx prisma migrate deploy` → `npm run db:seed` → `npm run dev`.
- Prod: `docker compose --profile prod up -d` — brings up `db`, `migrate` (runs `prisma migrate deploy`
  and exits) and `web`. The db binds **127.0.0.1 only**, deliberately.
- The worker is the compose `worker` service in prod, `npm run worker` locally. Approvals sit in
  `APPROVED` forever without it.
- Migrations are hand-written additive SQL directories, then `npx prisma migrate deploy`.
  **`prisma migrate reset` is blocked and unnecessary**; `npm run db:seed` is the sanctioned reset.
- Seeded accounts and their roles, pointing at `SEED_PASSWORD` in `prisma/fixtures.ts`. **State that
  it is `admin123`, that it is 8 characters where signup requires 10, and that it must be changed
  before the app is reachable from anywhere but localhost.**
- The npm-on-Windows hazard, with the exact command:
  `docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only"`.
- Troubleshooting: **"Docker Desktop is not running"** (`failed to connect to the docker API at
  npipe:////./pipe/dockerDesktopLinuxEngine` — it needs an interactive session and elevation, so it
  cannot be started from a terminal), port 5432 already in use, and a stale `.next` after switching
  between `npm run dev` and `npm run build`.
- **Entra SSO does not work.** `src/server/auth/index.ts` registers the provider when three env vars
  are set, but there is no `signIn` callback mapping an Entra profile to a `User`, so a successful
  Entra login arrives with no role. Say so plainly; listing the env vars without this is an
  instruction to break the deployment.

- [ ] **Step 2: Prove it from a clean state**

```bash
cd "$(mktemp -d)" && git clone "<path-to-this-repo>" app && cd app
```

Then follow the README exactly as written — `.env` from `.env.example` with freshly generated secrets,
`docker compose --profile prod build`, `up -d`, confirm `migrate` exited 0, seed, open the app, sign
in. Use a **different compose project name** (`docker compose -p inv-readme-test …`) so this cannot
touch the working database. Tear down with `docker compose -p inv-readme-test down -v`.

**Anything that does not work gets fixed in the README**, not footnoted. Record in the commit message
what you actually ran and what you had to correct.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: a deployment README that has actually been run"
```

---

### Task 11: Full battery and close-out

- [ ] **Step 1: The battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
docker compose --profile prod build
```

Then the e2e suite **in parts** — it was ~16.5 min over 9 files before this phase and Phase 10 adds
three more, so re-balance the split and write down what you used:

```bash
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/scanner.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```

⚠️ **Check the test counts.** A run that hits `--global-timeout` prints "N did not run" and its tail
reads like a pass.

⚠️ **Adding spec files re-times the suite.** Phase 9's Task 13 inserted one file and tipped three
latent races in `it-core.spec.ts` plus one in `auth-shell.spec.ts`, all of which passed standalone.
`labels.spec.ts` and `scanner.spec.ts` both sort before `it-core`. Expect to re-run the files that
follow them alphabetically, and fix any failure with **headroom, never a weaker assertion**.

- [ ] **Step 2: Amend this plan to the shipped code**

Every task whose code deviated gets an `AMENDED` banner saying what and why. Phase 8 did this for all
fourteen of its tasks and Phase 9 for all fourteen of its; expect several here.

- [ ] **Step 3: Update `docs/HANDOVER.md`**

Header (phases done, real battery numbers, push state as it actually is). §0 — this is the **last
planned phase**, so §0 becomes "what to do when there is no next phase": the push decision, the
deferred list, and how to pick up maintenance. §4 gains a Phase 10 paragraph. §5 leaves nothing.
§6a gains this phase's rules. §7 gains the re-balanced e2e split and any new gotchas. §8 gains the
moderate axe counts the sweep printed, and any print-alignment finding from the test print.

- [ ] **Step 4: The one thing no test can do**

Print a real sheet and measure the 100mm bar with a tape measure. Record the result in §8 — including
which browser and which print settings — and if it is short, record that the PDF escape hatch (spec §5)
is now justified rather than speculative.

- [ ] **Step 5: Finish the branch**

`superpowers:finishing-a-development-branch`. **Merging and pushing are the user's decisions** —
present the options and wait. `main` is ~136 commits ahead of `origin/main` and has been unpushed since
2026-08-19, deliberately.
