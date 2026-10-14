import type { AssetClass, AssetStatus } from "@prisma/client";

/** Phase 34 (spec §2.1, §4.1). */
export type CategoryIconName = "laptop" | "workstation" | "monitor" | "headset" | "mouse" | "hub" | "dock" | "bag" | "other" | "inventory";

export const IT_CATEGORY_ORDER = [
  "Laptop", "Workstation (PC)", "Monitor", "Headset", "Mouse", "Type C Hub", "Docking Station", "Laptop Bag", "Other",
] as const;

const HIDDEN = new Set(["uncategorised"]);

export function orderCategories<T extends { name: string; cls: AssetClass }>(cats: T[]): T[] {
  const visible = cats.filter((c) => !HIDDEN.has(c.name.toLowerCase()));
  const rank = (c: T) => {
    if (c.cls !== "IT") return 1000;
    const i = (IT_CATEGORY_ORDER as readonly string[]).indexOf(c.name);
    return i === -1 ? 500 : i;
  };
  return [...visible].sort((a, b) => (a.cls === b.cls ? 0 : a.cls === "IT" ? -1 : 1) || rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const ICONS: Record<string, CategoryIconName> = {
  laptop: "laptop", "workstation (pc)": "workstation", monitor: "monitor", headset: "headset", mouse: "mouse",
  "type c hub": "hub", "docking station": "dock", "laptop bag": "bag", other: "other",
};
export function categoryIcon(name: string): CategoryIconName {
  return ICONS[name.toLowerCase()] ?? "inventory";
}

const NOUNS: Record<string, [string, string]> = {
  "workstation (pc)": ["workstation", "workstations"], mouse: ["mouse", "mice"], "type c hub": ["Type C hub", "Type C hubs"],
  other: ["item", "items"], furniture: ["piece of furniture", "pieces of furniture"], "pantry equipment": ["pantry item", "pantry items"],
};
export function categoryNoun(name: string, n: number): string {
  const pair = NOUNS[name.toLowerCase()];
  if (pair) return n === 1 ? pair[0] : pair[1];
  const lower = name.toLowerCase();
  return n === 1 ? lower : `${lower}s`;
}

export const STOCK_STATUS: Record<AssetClass, AssetStatus> = { IT: "SPARE", PURCHASING: "STORED" };
