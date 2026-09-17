import { fmtDate, localDateISO } from "./format";

export const OFFBOARDING_DUE_WORKING_DAYS = 5;
export const STOCKTAKE_DUE_DAYS = 3;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD → the app's day-precision UTC-midnight Date (asset-diff.ts toDay convention). */
export function dayFromISO(iso: string): Date { return new Date(`${iso}T00:00:00.000Z`); }
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = dayFromISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d);
}
/** Mon–Fri only, no holiday list (spec §1 Out): step a day at a time, count the step when it lands on a weekday. */
export function addWorkingDays(iso: string, n: number): string {
  const d = dayFromISO(iso);
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return toISO(d);
}
export const defaultOffboardingDue = (todayISO: string) => addWorkingDays(todayISO, OFFBOARDING_DUE_WORKING_DAYS);
export const defaultStocktakeDue = (todayISO: string) => addDays(todayISO, STOCKTAKE_DUE_DAYS);
export const minOffboardingDue = (todayISO: string) => todayISO;
export const minStocktakeDue = (todayISO: string) => addDays(todayISO, 1);

export interface DueStatus { days: number; text: string; tone: "neutral" | "accent"; overdue: boolean }
/** Calendar days from today to the due day, both on the Asia/Manila calendar. */
export function daysUntil(dueAt: Date, todayISO: string): number {
  return Math.round((dayFromISO(localDateISO(dueAt)).getTime() - dayFromISO(todayISO).getTime()) / DAY_MS);
}
export function dueStatus(dueAt: Date, todayISO: string): DueStatus {
  const days = daysUntil(dueAt, todayISO);
  const text = days < 0 ? `${-days} d overdue` : days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} d`;
  return { days, text, tone: days <= 0 ? "accent" : "neutral", overdue: days < 0 };
}
export function isPastDue(dueAt: Date, todayISO: string): boolean { return localDateISO(dueAt) < todayISO; }
/** The farewell report's one line (spec §6.3). */
export function offboardingCompletionText(dueAt: Date | null, completedAt: Date | null, todayISO: string): string {
  if (!dueAt) return "No completion date set";
  const due = `(due ${fmtDate(dueAt)})`;
  if (completedAt) {
    const late = -daysUntil(dueAt, localDateISO(completedAt));
    return late <= 0 ? `Completed on time ${due}` : `Completed ${late} d late ${due}`;
  }
  return `Still open · ${dueStatus(dueAt, todayISO).text} ${due}`;
}
