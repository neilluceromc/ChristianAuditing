import { z } from "zod";

/** PO form redesign (migration 39): the units the line's combobox offers. Stored as free text, so others are allowed. */
export const PO_UNITS = ["pc", "box", "set", "pack", "roll", "m", "unit"] as const;

/** A PO line's unit: trimmed, 1–12 characters, `pc` when not given. */
export const unitSchema = z
  .string()
  .trim()
  .min(1, "Give a unit")
  .max(12, "Keep the unit to 12 characters or fewer")
  .default("pc");
