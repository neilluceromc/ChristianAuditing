import type { AssetClass } from "@prisma/client";

/**
 * One PO line with units left, as the register page shows it. Built on the server (po-register-model.ts) and shown by
 * the client form (po-register-form.tsx); it lives here so the server never imports from a client component
 * (final review M7).
 */
export interface PoRegisterLine {
  id: string;
  /** 1-based, as the PO page numbers its lines. */
  index: number;
  description: string;
  specs: string | null;
  /** The line's category; null on an old request's unit, whose category (and class) is picked here. */
  categoryId: string | null;
  categoryName: string | null;
  cls: AssetClass | null;
  /**
   * PO form redesign (spec §5, §5b.5): false while the line's category is IT gear Purchasing created on the PO form and
   * IT hasn't confirmed it. With nothing on the line registered yet, the card asks IT to confirm it or choose another.
   */
  categoryConfirmed: boolean;
  /** Units already registered from this line: once one is, the category is settled. */
  registered: number;
  price: string;
  remaining: number;
  progressLabel: string;
  /** Why this person can't register the line ("IT registers IT gear"), or null. */
  blocked: string | null;
}
