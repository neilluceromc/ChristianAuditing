/**
 * Every ID, serial, date, count and enum renders in mono with tabular-nums
 * (handover typography) — these helpers produce the strings; the mono styling
 * is the caller's. Timezone pinned to Asia/Manila (the business), so server
 * and tests agree regardless of host TZ.
 */
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Manila",
});

const moneyFmt = new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", maximumFractionDigits: 0,
});

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila",
});

export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dateFmt.format(typeof value === "string" ? new Date(value) : value);
}

export function fmtDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  // en-GB renders "16 Aug 2026, 09:41" — the comma reads as table noise
  return dateTimeFmt.format(typeof value === "string" ? new Date(value) : value).replace(",", "");
}

export function fmtMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return moneyFmt.format(Number(value));
}

const DAY_MS = 86_400_000;

export function fmtRelativeDays(value: Date | string, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const days = Math.round((d.getTime() - now.getTime()) / DAY_MS);
  if (days === 0) return "today";
  return days < 0 ? `${-days} d ago` : `in ${days} d`;
}
