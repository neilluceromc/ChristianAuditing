import { z } from "zod";

/** Spec §6.1: a pending action waits 10 minutes for its Confirm. */
export const PENDING_TTL_MS = 10 * 60_000;
/** Spec §6.4: Undo shows on the result card for 60 s. */
export const UNDO_WINDOW_MS = 60_000;

/** The refusals Confirm and Undo give, verbatim (spec §6, plan Task 3). */
export const CRIS_ALREADY_DONE = "That's already done.";
export const CRIS_EXPIRED = "That expired — ask me again.";
export const CRIS_CHANGED_SINCE = "Something changed since — reverse it from the record instead.";

/** When the result card's Undo stops showing. */
export function undoUntil(usedAt: Date): Date {
  return new Date(usedAt.getTime() + UNDO_WINDOW_MS);
}

/**
 * Spec §6.4: Undo is offered only for a confirmed action, within 60 s of its Confirm, not already undone, and
 * while nothing else has touched its assets since.
 */
export function undoEligible(p: { usedAt: Date | null; undoneAt: Date | null }, touchedSince: boolean, now: Date): boolean {
  if (!p.usedAt || p.undoneAt || touchedSince) return false;
  const age = now.getTime() - p.usedAt.getTime();
  return age >= 0 && age <= UNDO_WINDOW_MS;
}

const iso = z.string().nullable();

/** One asset's state just before the Confirm wrote it — what an Undo puts back. Dates are ISO strings. */
const beforeSchema = z.object({
  status: z.string(),
  assigneeId: z.string().nullable(),
  loanDueAt: iso,
  returnedAt: iso,
  defectiveSince: iso,
  repairEndedAt: iso,
});

const resultRefSchema = z.object({
  employeeId: z.string().min(1),
  /** The audit entries the Confirm itself wrote on these assets — never counted as "touched since". */
  auditIds: z.array(z.string()),
  /** The hold the Confirm fulfilled, if any — an Undo sets it back to ACTIVE. */
  holdId: z.string().nullable(),
  assets: z.array(z.object({
    id: z.string().min(1),
    /** "gets": the spare the person received; "returns": the item a replace took back. */
    role: z.enum(["gets", "returns"]),
    /** The status the Confirm left it on — an Undo refuses when it reads anything else. */
    afterStatus: z.string(),
    before: beforeSchema,
  })).min(1),
});

/** What a confirmed pending action keeps in `resultRef` so its Undo can reverse exactly that change. */
export type ResultRef = z.infer<typeof resultRefSchema>;
export type AssetBefore = z.infer<typeof beforeSchema>;

export function parseResultRef(value: string | null | undefined): ResultRef | null {
  if (!value) return null;
  let json: unknown;
  try { json = JSON.parse(value); } catch { return null; }
  const parsed = resultRefSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
