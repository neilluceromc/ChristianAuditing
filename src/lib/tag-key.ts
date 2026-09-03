/**
 * The three shared key rules used to match a sheet cell (or a scanner
 * payload) against stored data. Each is used on BOTH sides of a lookup — the
 * map built from the database and the value that consults it — so a change
 * to any of them that is not symmetric turns a match into a silent CREATE and
 * a P2002 at write time.
 *
 * Deliberately dependency-free (no imports): this module sits under both
 * `import-assets.ts` (873 lines of sheet-header matching, row planning and
 * block-cause vocabulary — server-side import machinery) and `scan.ts` (a
 * client-bundled offboarding-wizard rule), and neither needs to drag the
 * other along to get these three lines. `import-assets.ts` re-exports all
 * three so every caller that already imports them from there keeps working
 * unedited.
 */

/**
 * Not one of the "three" the module's own name promises — but `cellText`
 * cannot be moved without it, and `import-assets.ts`'s `parseDateCell` /
 * `parseCostCell` need this exact rule too. Exporting it here rather than
 * leaving a second copy behind is the same anti-twin reasoning as the three
 * functions below — and it is not hypothetical: `import-employees.ts` held a
 * byte-identical private copy until it was folded onto this one export, so
 * this comment's claim is actually true rather than aspirational.
 */
export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * A raw cell → trimmed text, blank/null/undefined all reading as "".
 * Exported so a caller outside the import feature's own row loop — the
 * dry-run action building its tag/serial lookup arrays BEFORE headers are
 * field-mapped, or the offboarding scan rule reading a scanner buffer —
 * shares this exact rule instead of hand-rolling a twin (round 2: found
 * drifting from this one in argument order, not behaviour, which is exactly
 * how two copies of one rule quietly stop agreeing).
 */
export function cellText(raw: unknown): string {
  return isBlank(raw) ? "" : String(raw).trim();
}

/**
 * Shared identity for every NAME-keyed lookup (category, type, vendor,
 * employee) — trims, lower-cases, AND collapses internal whitespace runs to
 * one space (R-4, round 2). `trim()` alone strips a SURROUNDING U+00A0 (it's
 * in the spec's WhiteSpace production, so padding was never the problem);
 * an INTERNAL non-breaking space is not touched by `trim()` or
 * `toLowerCase()` — and "Ramon Cruz" pasted from Outlook or a web page into
 * Excel, carrying one, is a routine artefact, not an edge case. Left
 * un-collapsed, that cell blocked as `unknown-assignee` naming a value that
 * was letter-for-letter an employee already in the system, with no visible
 * difference — the worst kind of silent failure, because the offered fix
 * ("Leave as spare") reads as the natural response to a genuinely unknown
 * name. `\s` in a JS RegExp matches U+00A0 (and the rest of Unicode's space
 * separators), so collapsing on that class handles it with no NBSP-specific
 * case. Used on BOTH sides of every lookup this module makes — the map
 * BUILT from the database (`buildAssetRefs`, `resolve.ts`) and the sheet
 * value that CONSULTS it (`planAssetRows`, `import-assets.ts`) — doing it on
 * only one side would just trade the old key-shape mismatch for a new one.
 */
export function refKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The tag lookup key, shared the same way and for the same reason. A tag is
 * trimmed and UPPER-CASED because `createSchema` stores it that way
 * (`actions.ts:147`, `.trim().toUpperCase()`) and every tag in the database
 * is upper-case — while Postgres's unique index is case-sensitive, so a
 * lower-cased sheet tag that misses the map does not error, it plans a CREATE
 * and produces a SECOND record for one physical machine.
 *
 * This existed as two hand-written copies — one keying the `IN` query in
 * `resolve.ts`, one keying the lookup in `planAssetRows` — which is the exact
 * hazard `refKey` and `cellText` were extracted to remove, one level down.
 * Two copies of a key rule agree until the day they don't, and the failure is
 * silent on both sides. The offboarding wizard's scan rule (`scan.ts`) is a
 * third caller for exactly the same reason: a hand-written twin there would
 * be a fourth copy of a rule that has already drifted three times.
 */
export function tagKey(raw: unknown): string {
  return cellText(raw).toUpperCase();
}

/**
 * The asset tag contract: `BR-` then two uppercase letters then four digits,
 * e.g. `BR-LT-0148`. The two letters are a human convention (mostly the
 * category, sometimes the type — see the Phase 12 spec) and this regex does
 * not care which.
 *
 * ONE definition, deliberately. It was written out separately in
 * import-assets.ts, inventory/actions.ts and inventory/queries.ts, which is
 * three chances for them to disagree about what a tag is — and the four-digit
 * group is load-bearing for tag GENERATION, which cannot exceed 9999 without
 * producing a string the other three would reject.
 */
export const TAG_SHAPE = /^BR-[A-Z]{2}-\d{4}$/;
