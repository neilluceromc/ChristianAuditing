import type { AssetClass, Prisma } from "@prisma/client";
import { LOAN_DUE_SOON_DAYS } from "./worklist";

/** Phase 30 (spec §6.3): the one reason a row still owes someone something. */
export type AttentionKind = "back" | "overdue" | "no-due-date" | "due-soon" | "queued" | "awaiting-check";
export interface Attention { kind: AttentionKind; label: string; severity: number }
export interface AttentionInput {
  cls: AssetClass;
  status: string;
  returnedAt: Date | null;
  loanDueAt: Date | null;
  pendingRef: string | null;
  itVerifiedAt: Date | null;
}

const DAY_MS = 86_400_000;
// The same states approvals/create.ts calls OPEN_APPROVAL_STATES — repeated here because src/lib cannot import src/server.
const OPEN_STATES = ["PENDING", "CLAIMED", "APPROVED"] as const;

/** Worst first, in the reading order of spec §6.3 (plan P-10); the loan arithmetic is worklist.ts loanRow's. */
export function attentionOf(a: AttentionInput, now: Date): Attention | null {
  if (a.returnedAt) return { kind: "back", label: "back, not checked", severity: 6000 };
  if (a.status === "TEMPORARY") {
    if (a.loanDueAt === null) return { kind: "no-due-date", label: "no due date", severity: 4000 };
    const overdue = Math.floor((now.getTime() - a.loanDueAt.getTime()) / DAY_MS);
    if (overdue > 0) return { kind: "overdue", label: `overdue by ${overdue} d`, severity: 5000 + overdue };
    const until = -overdue;
    if (until <= LOAN_DUE_SOON_DAYS) return { kind: "due-soon", label: `due in ${until} d`, severity: 3000 + (LOAN_DUE_SOON_DAYS - until) };
  }
  if (a.pendingRef) return { kind: "queued", label: `queued ${a.pendingRef}`, severity: 2000 };
  if (a.cls === "IT" && a.itVerifiedAt === null) return { kind: "awaiting-check", label: "awaiting IT check", severity: 1000 };
  return null;
}

/** asc = most severe first; desc = least severe first; quiet rows last either way; ties by tag then id. */
export function orderByAttention<T extends { attention: Attention | null; tag: string; id: string }>(rows: T[], dir: "asc" | "desc"): T[] {
  const sign = dir === "asc" ? -1 : 1;
  return [...rows].sort((x, y) => {
    if (!x.attention || !y.attention) {
      if (!x.attention && !y.attention) return x.tag.localeCompare(y.tag) || x.id.localeCompare(y.id);
      return x.attention ? -1 : 1;
    }
    return sign * (x.attention.severity - y.attention.severity) || x.tag.localeCompare(y.tag) || x.id.localeCompare(y.id);
  });
}

/** The count line's predicate — true exactly when attentionOf returns a reason (the loan edge is due ≤ now + 7 d). */
export function attentionWhere(now: Date): Prisma.AssetWhereInput {
  return {
    OR: [
      { returnedAt: { not: null } },
      { status: "TEMPORARY", loanDueAt: null },
      { status: "TEMPORARY", loanDueAt: { lte: new Date(now.getTime() + LOAN_DUE_SOON_DAYS * DAY_MS) } },
      { approvals: { some: { state: { in: [...OPEN_STATES] } } } },
      { cls: "IT", itVerifiedAt: null },
    ],
  };
}
