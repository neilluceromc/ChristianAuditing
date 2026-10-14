import type { AssetClass } from "@prisma/client";

/** Phase 34 (spec §4.3): IT needs a serial on every unit; Purchasing stays optional. */
export function serialRequired(cls: AssetClass): boolean {
  return cls === "IT";
}

export type SerialProblem = "required" | "duplicate" | null;

export function serialProblems(serials: readonly string[], cls: AssetClass): SerialProblem[] {
  const seen = new Set<string>();
  return serials.map((raw) => {
    const s = raw.trim().toUpperCase();
    if (!s) return serialRequired(cls) ? "required" : null;
    if (seen.has(s)) return "duplicate";
    seen.add(s);
    return null;
  });
}
