import { fmtMoneyExact } from "./format";

/**
 * PO form redesign (spec §3, migration 39): the seven totals Purchasing types off the sales invoice. They are
 * typed, never computed; these checks only say whether they add up (stored as `totalsConsistent`, never blocking).
 * Pure — runs in the browser as you type and again on the server when you save.
 */
export const TOTAL_KEYS = ["totalSales", "lessVat", "netOfVat", "discount", "amountDue", "addVat", "totalAmountDue"] as const;
export type TotalKey = (typeof TOTAL_KEYS)[number];

export const TOTAL_LABEL: Record<TotalKey, string> = {
  totalSales: "Total sales (VAT inclusive)",
  lessVat: "Less: VAT",
  netOfVat: "Amount net of VAT",
  discount: "Less: discount",
  amountDue: "Amount due",
  addVat: "Add: VAT",
  totalAmountDue: "Total amount due",
};

const NUMBER = /^-?(\d+\.?\d*|\.\d+)$/;

/** "₱9,100.00" → 9100. Commas, the peso sign and spaces are stripped; blank gives null, anything else NaN. */
export function parseMoney(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = v.replace(/[,₱\s]/g, "");
  if (s === "") return null;
  return NUMBER.test(s) ? Number(s) : Number.NaN;
}

/** Whole centavos, so ₱0.10 + ₱0.20 is exactly ₱0.30. */
const cents = (n: number) => Math.round(n * 100);

/** Σ qty × unit price. A blank or unreadable quantity or price counts as 0. */
export function itemsTotal(lines: { qty: number | string; unitPrice: number | string | null }[]): number {
  let sum = 0;
  for (const l of lines) {
    const qty = parseMoney(l.qty);
    const price = parseMoney(l.unitPrice);
    if (qty === null || price === null || !Number.isFinite(qty) || !Number.isFinite(price)) continue;
    sum += cents(qty * price);
  }
  return sum / 100;
}

const present = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** Off by more than ±₱0.01. */
const off = (typed: number, expected: number) => Math.abs(cents(typed) - cents(expected)) > 1;

/**
 * The four checks (spec §3), each attached to the key it checks. A check whose inputs are blank is skipped, and a
 * blank discount counts as 0. `ok` also needs a total amount due, and every typed total to be a number.
 */
export function checkTotals(
  items: number,
  t: Partial<Record<TotalKey, number | null>>,
): { ok: boolean; problems: Partial<Record<TotalKey, string>> } {
  const problems: Partial<Record<TotalKey, string>> = {};
  const { totalSales, lessVat, netOfVat, amountDue, addVat, totalAmountDue } = t;
  const discount = t.discount ?? 0;

  if (present(totalSales) && off(totalSales, items)) {
    problems.totalSales = `Items add up to ${fmtMoneyExact(items)}.`;
  }
  if (present(totalSales) && present(lessVat) && present(netOfVat) && off(netOfVat, totalSales - lessVat)) {
    problems.netOfVat = `Total sales − VAT = ${fmtMoneyExact(totalSales - lessVat)}.`;
  }
  if (present(netOfVat) && present(discount) && present(amountDue) && off(amountDue, netOfVat - discount)) {
    problems.amountDue = `Net − discount = ${fmtMoneyExact(netOfVat - discount)}.`;
  }
  if (present(amountDue) && present(addVat) && present(totalAmountDue) && off(totalAmountDue, amountDue + addVat)) {
    problems.totalAmountDue = `Amount due + VAT = ${fmtMoneyExact(amountDue + addVat)}.`;
  }

  const allNumbers = TOTAL_KEYS.every((k) => t[k] === null || t[k] === undefined || Number.isFinite(t[k]));
  const ok = Object.keys(problems).length === 0 && present(totalAmountDue) && allNumbers;
  return { ok, problems };
}
