/**
 * The product name every browser tab ends with, and the root layout's fallback title. Phase 47 spec §5.3 (owner,
 * 2026-10-21): "CRIS". Printed company documents (the accountability form, the farewell report, the asset labels)
 * keep "Backroom IT" and the BR mark; they don't read this.
 */
export const APP_NAME = "CRIS";

/**
 * Every page's title reads "{Page} · CRIS" — e.g. "Inventory · CRIS", "BR-LT-0148 · CRIS", "Marites Bautista · CRIS".
 * Several parts join most-specific first ("History · BR-LT-0148 · CRIS"); blank or missing parts drop out, so a
 * record whose name could not be read still gets a sane tab title instead of " · CRIS".
 */
export function pageTitle(...parts: Array<string | null | undefined>): string {
  const named = parts.map((p) => p?.trim() ?? "").filter((p) => p.length > 0);
  return [...named, APP_NAME].join(" · ");
}
