import { z } from "zod";
import { BULK_MAX } from "./inventory-list";
import { reasonOptional } from "./reason";
import { dateStr, todayStr } from "./transfer-schema";

/**
 * Phase 45 (spec §3.4): Transfer… from the Employees bulk bar. All or nothing — `bulkTransferEmployees` checks
 * every person with `checkBulkTransfer` first and writes nothing if anyone can't move. Each person keeps their own
 * title, so the input has no title; `note` is stored as each transfer row's reason, as the single transfer does.
 */
export const bulkTransferSchema = z.object({
  // A huge payload is refused before the dedupe (twice the cap leaves room for repeats; the exact cap is the
  // action's `bulkCountMessage`). Repeated ids then collapse, so a person is never transferred twice in one go.
  ids: z.array(z.string().min(1)).max(BULK_MAX * 2, `Pick no more than ${BULK_MAX} people`)
    .transform((ids) => [...new Set(ids)]),
  toDepartmentId: z.string().min(1, "Pick a department"),
  effectiveAt: dateStr,
  note: reasonOptional({ max: 300 }).default(""),
}).superRefine((d, ctx) => {
  if (d.effectiveAt > todayStr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveAt"], message: "That date is in the future" });
  }
});

export type BulkTransferInput = z.input<typeof bulkTransferSchema>;

export interface BlockedPerson { id: string; name: string; reason: string }

export type BulkTransferCheck =
  | { ok: true }
  | { ok: false; blocked: BlockedPerson[]; message?: string };

/**
 * The selection-size refusal on its own (`null` when the count is fine), so the action can refuse an oversized
 * request before it reads anyone.
 */
export function bulkCountMessage(count: number, max: number): string | null {
  if (count === 0) return "Pick at least one person";
  if (count > max) return `Pick no more than ${max} people`;
  return null;
}

/**
 * Who can't move, and why — one reason per person, in the order given. A missing or archived destination blocks
 * everyone; otherwise a leaver reads "Has left" and someone already there "Already works for this group".
 */
export function checkBulkTransfer(
  people: { id: string; name: string; departmentId: string; employment: string }[],
  dest: { id: string; archivedAt: Date | null } | null,
  max: number,
): BulkTransferCheck {
  const message = bulkCountMessage(people.length, max);
  if (message) return { ok: false, blocked: [], message };

  const reasonFor = (p: (typeof people)[number]): string | null => {
    if (!dest) return "Unknown group";
    if (dest.archivedAt) return "That group is archived";
    if (p.employment === "OFFBOARDED") return "Has left";
    if (p.departmentId === dest.id) return "Already works for this group";
    return null;
  };
  const blocked: BlockedPerson[] = [];
  for (const p of people) {
    const reason = reasonFor(p);
    if (reason) blocked.push({ id: p.id, name: p.name, reason });
  }
  return blocked.length ? { ok: false, blocked } : { ok: true };
}

/** "1 person" / "N people" — the dialog title, the toast and the blocked banner. */
export const peopleCount = (n: number) => (n === 1 ? "1 person" : `${n.toLocaleString("en-US")} people`);
