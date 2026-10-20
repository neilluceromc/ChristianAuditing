/**
 * The app's row-size setting (Phase 45 spec 4.5). The `br.density` cookie and the `data-density` attribute on
 * <html> hold one of these. Dense is an opt-in third size used by the Inventory and Employees lists; every
 * other table treats it like compact (see globals.css).
 */
export type Density = "comfortable" | "compact" | "dense";

/** Anything that is not a known size (missing cookie, a stale or hand-edited value) reads as comfortable. */
export function parseDensity(v: string | undefined): Density {
  return v === "compact" || v === "dense" ? v : "comfortable";
}

/** What the top-bar button switches to: comfortable <-> compact, and from dense back to comfortable. */
export function topbarNext(d: Density): Density {
  return d === "comfortable" ? "compact" : "comfortable";
}
