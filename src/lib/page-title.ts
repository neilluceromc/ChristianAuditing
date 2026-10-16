/** The product name every browser tab ends with, and the root layout's fallback title. */
export const APP_NAME = "Backroom IT";

/**
 * Spec §5: every page's title reads "{Page} · Backroom IT" — e.g. "Inventory ·
 * Backroom IT", "BR-LT-0148 · Backroom IT", "Marites Bautista · Backroom IT".
 * Several parts join most-specific first ("History · BR-LT-0148 · Backroom
 * IT"); blank or missing parts drop out, so a record whose name could not be
 * read still gets a sane tab title instead of " · Backroom IT".
 */
export function pageTitle(...parts: Array<string | null | undefined>): string {
  const named = parts.map((p) => p?.trim() ?? "").filter((p) => p.length > 0);
  return [...named, APP_NAME].join(" · ");
}
