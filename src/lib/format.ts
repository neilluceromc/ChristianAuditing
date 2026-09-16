/**
 * Every ID, serial, date, count and enum renders in mono with tabular-nums
 * (handover typography) — these helpers produce the strings; the mono styling
 * is the caller's. Timezone pinned to Asia/Manila (the business), so server
 * and tests agree regardless of host TZ.
 */
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Manila",
});

// en-CA renders YYYY-MM-DD — the `<input type="date">` value shape.
const isoDateFmt = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Manila",
});

/**
 * The Asia/Manila calendar date of `now` as `YYYY-MM-DD` — what a date picker
 * should default to and what "today" means to a rule that refuses future
 * dates. `toISOString().slice(0, 10)` gives the UTC date instead, which is
 * yesterday for a Manila user between 00:00 and 08:00 local.
 */
export function localDateISO(now: Date = new Date()): string {
  return isoDateFmt.format(now);
}

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

/**
 * Phase 22 (facts-tasks-4-7.md "Exports and reports"): `fmtMoney` rounds to
 * whole pesos, which is right for balances but wrong for a lot's unit cost —
 * ₱0.90 and ₱9.25 both round to "₱1" / "₱9" under `fmtMoney`. Two decimals,
 * always.
 */
const moneyExactFmt = new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function fmtMoneyExact(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return moneyExactFmt.format(Number(value));
}

const DAY_MS = 86_400_000;

export function fmtRelativeDays(value: Date | string, now: Date = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const days = Math.round((d.getTime() - now.getTime()) / DAY_MS);
  if (days === 0) return "today";
  return days < 0 ? `${-days} d ago` : `in ${days} d`;
}
