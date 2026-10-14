/** Phase 34 (spec §4.5): money, the live total, and the warranty date. The total is never stored. */
export function moneyToCentavos(text: string): number | null | "bad" {
  const cleaned = text.replace(/₱|PHP|,|\s/gi, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return "bad";
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function purchaseTotal(unitCentavos: number | null, qty: number, feeCentavos: number | null): number {
  return (unitCentavos ?? 0) * qty + (feeCentavos ?? 0);
}

export function formatPeso(centavos: number): string {
  return "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function centavosToDecimalString(c: number): string {
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

export const WARRANTY_LENGTHS = [0, 6, 12, 24, 36] as const;

export function warrantyUntilFrom(purchasedISO: string, months: number): string {
  if (!purchasedISO || !months) return "";
  const [y, m, d] = purchasedISO.split("-").map(Number);
  const targetMonth = m - 1 + months;
  const ty = y + Math.floor(targetMonth / 12);
  const tm = ((targetMonth % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const WARRANTY_COVERED_BY = ["manufacturer", "vendor", "both"] as const;
export const WARRANTY_COVERED_BY_LABEL: Record<(typeof WARRANTY_COVERED_BY)[number], string> = {
  manufacturer: "Manufacturer", vendor: "Vendor", both: "Both",
};
