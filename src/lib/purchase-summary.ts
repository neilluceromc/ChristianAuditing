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

/**
 * Register's warranty (Review Focus 4, ruling R12). `months` is null until a
 * length is chosen; `manual` is set while "Warranty until" holds a date typed
 * by hand, which a later purchase-date change leaves alone. Picking a length
 * is an explicit choice: it always re-derives the date and clears `manual`.
 */
export interface WarrantyState {
  months: number | null;
  until: string;
  manual: boolean;
}

/** The purchase date changed: the first date with no length chosen picks 1 yr (today's 12-month default). */
export function warrantyOnDate(s: WarrantyState, purchasedISO: string): WarrantyState {
  const months = s.months === null && purchasedISO ? 12 : s.months;
  if (s.manual || months === null) return { ...s, months };
  return { months, until: warrantyUntilFrom(purchasedISO, months), manual: false };
}

/** A length button was pressed: always re-derives (empty with no purchase date, or None) and drops a typed date. */
export function warrantyOnLength(_s: WarrantyState, purchasedISO: string, months: number): WarrantyState {
  return { months, until: warrantyUntilFrom(purchasedISO, months), manual: false };
}

/** "Warranty until" was typed in. */
export function warrantyOnTyped(s: WarrantyState, value: string): WarrantyState {
  return { ...s, until: value, manual: value !== "" };
}

export const WARRANTY_COVERED_BY = ["manufacturer", "vendor", "both"] as const;
export const WARRANTY_COVERED_BY_LABEL: Record<(typeof WARRANTY_COVERED_BY)[number], string> = {
  manufacturer: "Manufacturer", vendor: "Vendor", both: "Both",
};
