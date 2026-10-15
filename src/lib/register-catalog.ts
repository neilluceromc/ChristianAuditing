import type { AssetClass, AssetStatus } from "@prisma/client";
import { CLASS_EXAMPLE } from "./asset-class";

/** Phase 34 (spec §2.1, §4.1). */
export type CategoryIconName =
  | "laptop" | "workstation" | "monitor" | "headset" | "mouse" | "keyboard" | "webcam" | "hub" | "dock" | "ups" | "license" | "bag"
  | "other" | "inventory";

export const IT_CATEGORY_ORDER = [
  "Laptop", "Workstation (PC)", "Monitor", "Headset", "Mouse", "Keyboard", "Webcam", "UPS", "Windows License", "Laptop Bag", "Other",
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
  keyboard: "keyboard", webcam: "webcam", "type c hub": "hub", "docking station": "dock", ups: "ups",
  "windows license": "license", "laptop bag": "bag", other: "other",
};
export function categoryIcon(name: string): CategoryIconName {
  return ICONS[name.toLowerCase()] ?? "inventory";
}

const NOUNS: Record<string, [string, string]> = {
  "workstation (pc)": ["workstation", "workstations"], mouse: ["mouse", "mice"], "type c hub": ["Type C hub", "Type C hubs"],
  other: ["item", "items"], ups: ["UPS", "UPS units"], "windows license": ["Windows license", "Windows licenses"], furniture: ["piece of furniture", "pieces of furniture"], "pantry equipment": ["pantry item", "pantry items"],
};
export function categoryNoun(name: string, n: number): string {
  const pair = NOUNS[name.toLowerCase()];
  if (pair) return n === 1 ? pair[0] : pair[1];
  const lower = name.toLowerCase();
  return n === 1 ? lower : `${lower}s`;
}

export const STOCK_STATUS: Record<AssetClass, AssetStatus> = { IT: "SPARE", PURCHASING: "STORED" };

/** The Model box's example, per IT card; categories added later in Admin get a plain "Model name". */
const MODEL_EXAMPLES: Record<string, string> = {
  laptop: "ThinkPad T14 Gen 4", "workstation (pc)": "Dell OptiPlex 7010", monitor: "Dell P2422H", headset: "Jabra Evolve2 40",
  mouse: "Logitech M331", keyboard: "Logitech MX Keys", webcam: "Logitech C920", ups: "APC Back-UPS 650",
  "windows license": "Windows 11 Pro", "laptop bag": "Targus 15.6\" Backpack", other: "Samsung A54",
};
export function categoryModelExample(name: string | null | undefined, cls: AssetClass): string {
  if (cls !== "IT") return CLASS_EXAMPLE[cls].model;
  return (name && MODEL_EXAMPLES[name.toLowerCase()]) || "Model name";
}

/** What the serial box asks for: a Windows licence carries its licence / COA number; its product key goes in Secrets. */
export function categorySerialCopy(name: string | null | undefined): { label: string; hint: string } {
  if (name?.toLowerCase() === "windows license") {
    return {
      label: "Licence / COA no.",
      hint: "Required. The licence or COA sticker number. Add the product key on the record's Secrets after registering.",
    };
  }
  return { label: "Serial number", hint: "Required. It’s on the box label or the sticker under the device." };
}
