import { z } from "zod";
import { PREFIX_SHAPE } from "./stock-code";

// The same date shape supplier-schema.ts uses: a malformed string is a field
// error at the picker, never an Invalid Date reaching Prisma.
const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

// UTC, matching how the app writes dates — never the local calendar day.
const todayStr = () => new Date().toISOString().slice(0, 10);

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
}).superRefine((d, ctx) => {
  if (d.occurredAt && d.occurredAt > todayStr()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occurredAt"], message: "That date is in the future" });
  }
});
export type ReceiptInput = z.infer<typeof receiptSchema>;

export const issueSchema = z.object({
  itemId: z.string().min(1, "Pick an item"),
  quantity: z.number().int().min(1, "At least one"),
  departmentId: z.string().min(1, "Pick the department"),
  employeeId: z.string().optional().default(""),
  reason: z.string().trim().max(200).optional().default(""),
});
export type IssueInput = z.infer<typeof issueSchema>;

export const adjustSchema = z.object({
  itemId: z.string().min(1),
  mode: z.enum(["delta", "set"]),
  quantity: z.number().int(),
  reason: z.string().trim().min(3, "Say why").max(200),
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
});
export type StocktakeOpenInput = z.infer<typeof stocktakeOpenSchema>;

export const countSchema = z.object({
  lineId: z.string().min(1),
  countedQty: z.number().int().min(0, "Counts are zero or more"),
});
export type CountInput = z.infer<typeof countSchema>;
