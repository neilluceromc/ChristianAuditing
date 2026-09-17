import { z } from "zod";
import { PREFIX_SHAPE } from "./stock-code";
import { reasonOptional, reasonRequired } from "./reason";

// The same date shape supplier-schema.ts uses: a malformed string is a field
// error at the picker, never an Invalid Date reaching Prisma.
const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

// UTC, matching how the app writes dates — never the local calendar day.
// Exported so movement-actions.ts (Task 3) imports this instead of writing
// another copy — this file already carries the one this app trusts, wired
// into receiptSchema's own "not after today" check below.
export const todayStr = () => new Date().toISOString().slice(0, 10);

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Name the category").max(60),
  prefix: z.string().trim().toUpperCase().regex(PREFIX_SHAPE, "Two or three letters, e.g. OS"),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const itemSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  name: z.string().trim().min(1, "Name the item").max(120),
  unit: z.string().trim().min(1, "Give the base unit").max(20),
  packSize: z.number().int().min(2, "A pack holds at least 2").nullable(),
  reorderLevel: z.number().int().min(0),
  notes: z.string().trim().max(2000).optional().default(""),
});
export type ItemInput = z.infer<typeof itemSchema>;

export const receiptSchema = z.object({
  itemId: z.string().min(1, "Pick an item"),
  quantity: z.number().int().min(1, "At least one"),
  packs: z.number().int().min(1).nullable().optional(),
  supplierId: z.string().optional().default(""),
  lotDate: dateStr,
  reference: z.string().trim().max(60).optional().default(""),
  unitCost: z.number().min(0).max(99_999_999.99).multipleOf(0.01, "Two decimals at most").nullable(),
  occurredAt: dateStr,
  // Spec §4.3/§6.5: optional, after Lot date on the form. Blank means "no
  // expiry" — most items never expire — never "expires immediately".
  expiresAt: dateStr.optional().default(""),
}).superRefine((d, ctx) => {
  if (d.occurredAt && d.occurredAt > todayStr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occurredAt"], message: "That date is in the future" });
  }
  // Both sides are plain `YYYY-MM-DD` strings, so lexicographic `<` is
  // chronological order — the same trick `todayStr()`'s own comparison
  // above relies on.
  if (d.expiresAt && d.lotDate && d.expiresAt < d.lotDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["expiresAt"], message: "Expires cannot be before the lot date" });
  }
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

/**
 * Spec §4.3. `quantity` is left optional here — the default is "the lot's
 * remaining", which only the server knows (the schema never sees a lot) —
 * so `writeOffLot` (movement-actions.ts, Task 5) resolves the omitted case
 * itself, under the item lock, before this schema's own `min(1)` even
 * matters (a resolved default is always >= 1 because a closed lot is never
 * offered for write-off in the first place).
 */
export const writeOffSchema = z.object({
  lotId: z.string().min(1, "Pick a lot"),
  quantity: z.number().int().min(1, "At least one").optional(),
  reason: reasonRequired({ min: 3, max: 200, message: "Say why" }),
});
export type WriteOffInput = z.infer<typeof writeOffSchema>;

/** Spec §4.3/§5.2: `setLotCost` refuses when the lot's `unitCost` is already set — this schema only shapes the new value. */
export const setLotCostSchema = z.object({
  lotId: z.string().min(1, "Pick a lot"),
  unitCost: z.number().min(0).max(99_999_999.99).multipleOf(0.01, "Two decimals at most"),
});
export type SetLotCostInput = z.infer<typeof setLotCostSchema>;

/** Spec §2.3/§4.3: the three kinds a `StockLotDocument` can be tagged with — same set `document-actions.ts`'s `uploadLotDocument` validates against. */
export const LOT_DOCUMENT_KINDS = ["delivery-receipt", "invoice", "other"] as const;
export type LotDocumentKind = (typeof LOT_DOCUMENT_KINDS)[number];

export const issueSchema = z.object({
  itemId: z.string().min(1, "Pick an item"),
  quantity: z.number().int().min(1, "At least one"),
  departmentId: z.string().min(1, "Pick the department"),
  employeeId: z.string().optional().default(""),
  reason: reasonOptional({ max: 200 }).default(""),
});
export type IssueInput = z.infer<typeof issueSchema>;

export const adjustSchema = z.object({
  itemId: z.string().min(1),
  mode: z.enum(["delta", "set"]),
  quantity: z.number().int(),
  reason: reasonRequired({ min: 3, max: 200, message: "Say why" }),
}).superRefine((d, ctx) => {
  if (d.mode === "delta" && d.quantity === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "A change of zero changes nothing" });
  }
  if (d.mode === "set" && d.quantity < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["quantity"], message: "A balance cannot be negative" });
  }
});
export type AdjustInput = z.infer<typeof adjustSchema>;

// "all" is the literal categoryId meaning every category.
export const stocktakeOpenSchema = z.object({
  categoryId: z.string().min(1),
  note: z.string().trim().max(500).optional().default(""),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker"),
});
export type StocktakeOpenInput = z.infer<typeof stocktakeOpenSchema>;

export const countSchema = z.object({
  lineId: z.string().min(1),
  countedQty: z.number().int().min(0, "Counts are zero or more"),
});
export type CountInput = z.infer<typeof countSchema>;
