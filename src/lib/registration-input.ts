import { z } from "zod";
import { REGISTRATION_FIELD_KEYS } from "./registration";

/** Phase 35 (spec §3.3-3.4): Finance's send-back, the department's reply, Finance's approval. */
const text = z.string().trim().min(3, "Say a little more — at least 3 characters").max(500, "500 characters at most");

export const sendBackSchema = z.object({
  id: z.string().min(1),
  fields: z.array(z.enum(REGISTRATION_FIELD_KEYS)).min(1, "Tick at least one thing that's wrong")
    .refine((f) => new Set(f).size === f.length, "Each item once"),
  note: z.union([z.literal(""), text]).optional(),
}).refine((v) => !v.fields.includes("other") || !!v.note, { message: "Explain “Other” in the note", path: ["note"] });

export const resubmitSchema = z.object({ id: z.string().min(1), reply: z.union([z.literal(""), text]).optional() });

export const approveSchema = z.object({ id: z.string().min(1), notCapitalised: z.boolean().optional() });
