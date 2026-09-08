import { z } from "zod";
import type { VendorContractStatus } from "@prisma/client";

export const VENDOR_CONTRACT_STATUSES = ["NONE", "ACTIVE", "EXPIRED", "SUSPENDED"] as const satisfies readonly VendorContractStatus[];
export const CONTRACT_STATUS_LABEL: Record<VendorContractStatus, string> = {
  NONE: "No contract", ACTIVE: "Active", EXPIRED: "Expired", SUSPENDED: "Suspended",
};

// The same date shape the register page uses: a malformed string is a field
// error at the picker, never an Invalid Date reaching Prisma.
const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);
const text = (max: number) => z.string().trim().max(max).optional().default("");

export const supplierSchema = z.object({
  name: z.string().trim().min(1, "Name the supplier").max(120),
  registeredName: text(160),
  category: text(60),
  contactPerson: text(120),
  phone: text(40),
  email: z.union([z.literal(""), z.string().trim().email("That is not an email address")]).optional().default(""),
  address: text(400),
  registrationNo: text(60),
  contractStatus: z.enum(VENDOR_CONTRACT_STATUSES),
  contractStart: dateStr.optional().default(""),
  contractEnd: dateStr.optional().default(""),
  contractTerms: text(2000),
  notes: text(2000),
}).superRefine((d, ctx) => {
  if (d.contractStart && d.contractEnd && d.contractEnd < d.contractStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contractEnd"], message: "End date is before the start" });
  }
});
export type SupplierInput = z.infer<typeof supplierSchema>;

const toDate = (s: string) => (s ? new Date(`${s}T00:00:00Z`) : null);
const orNull = (s: string) => (s ? s : null);

/** Prisma-ready columns. The caller adds `archivedAt`/`locked` handling itself. */
export function toSupplierData(d: SupplierInput) {
  return {
    name: d.name,
    registeredName: orNull(d.registeredName), category: orNull(d.category), contactPerson: orNull(d.contactPerson),
    phone: orNull(d.phone), email: orNull(d.email), address: orNull(d.address), registrationNo: orNull(d.registrationNo),
    contractStatus: d.contractStatus, contractStart: toDate(d.contractStart), contractEnd: toDate(d.contractEnd),
    contractTerms: orNull(d.contractTerms), notes: orNull(d.notes),
  };
}
