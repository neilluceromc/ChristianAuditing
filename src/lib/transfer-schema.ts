import { z } from "zod";
import { localDateISO } from "./format";
import { reasonOptional } from "./reason";

// The same shape `employees/actions.ts`'s own `dateStr` uses: a malformed
// string is a field error at the picker, never an Invalid Date reaching
// Prisma. Required (not the `""`-union `stock-schema.ts` carries) — the
// Effective date field always has a value, defaulted to today by the dialog.
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

// "Today" is the Asia/Manila calendar date, the same clock every date the app
// prints uses (`fmtDate`). The UTC date this used to read was yesterday for a
// Manila user between 00:00 and 08:00, so the dialog's default date and this
// check disagreed with the header line the transfer then rendered (Phase 20
// review M-5; caught by the Phase 21 final battery running at 01:00 Manila).
const todayStr = () => localDateISO(new Date());

/**
 * Phase 20 (spec §3). `toDepartmentId` differing from the employee's CURRENT
 * department ("Already in this department") is deliberately NOT checked
 * here: this schema never sees the current record, only the submitted
 * shape — that comparison is `transferEmployee`'s own job, against the row
 * it just read.
 */
export const transferSchema = z.object({
  employeeId: z.string().min(1),
  toDepartmentId: z.string().min(1, "Pick a department"),
  toTitle: z.string().trim().min(2, "Give a title").max(120),
  effectiveAt: dateStr,
  reason: reasonOptional({ max: 300 }).default(""),
}).superRefine((d, ctx) => {
  if (d.effectiveAt > todayStr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveAt"], message: "That date is in the future" });
  }
});

export type TransferInput = z.infer<typeof transferSchema>;

/**
 * The Transfers card / employee-page "Transferred from X on Y" line's own
 * window (spec §3): the newest transfer's `effectiveAt` within the last 90
 * days. One named constant so the UI and any future rule agree on "recent".
 */
export const TRANSFER_RECENT_DAYS = 90;

/** Inclusive at the boundary — a transfer effective exactly 90 days ago (the
 * seeded EMP-0099 fixture) still reads as recent. */
export function isRecentTransfer(effectiveAt: Date, now: Date = new Date()): boolean {
  const days = (now.getTime() - effectiveAt.getTime()) / 86_400_000;
  // `effectiveAt` is a calendar date stored as UTC midnight; a transfer
  // recorded today before 08:00 Manila therefore sits up to eight hours
  // AHEAD of `now` (its Manila date is already tomorrow in UTC terms) and
  // must still read as recent — hence the one-day grace below zero. Anything
  // further ahead is a genuinely future date the schema never accepts.
  return days >= -1 && days <= TRANSFER_RECENT_DAYS;
}
