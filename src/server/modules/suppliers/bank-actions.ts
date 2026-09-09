"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { canManageSuppliers, canRevealBank } from "@/lib/supplier-access";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";

const isP2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const idSchema = z.object({ id: z.string().min(1) });

const addSchema = z.object({
  vendorId: z.string().min(1),
  label: z.string().trim().min(1, "Name this account (e.g. BDO main)").max(60),
  bankName: z.string().trim().min(1, "Name the bank").max(120),
  accountName: z.string().trim().min(1, "Name the account holder").max(160),
  accountNumber: z.string().trim().min(4, "Enter the account number").max(60),
});

/** The audit diff carries the bank + label only — never the account number. */
export async function addBankAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const vendor = await prisma.vendor.findUnique({ where: { id: d.vendorId } });
  if (!vendor) return conflict("That supplier no longer exists.");

  const existing = await prisma.vendorBankAccount.findUnique({
    where: { vendorId_label: { vendorId: d.vendorId, label: d.label } },
  });
  if (existing) return validationError({ label: "That label already exists on this supplier" });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.vendorBankAccount.create({
        data: {
          vendorId: d.vendorId, label: d.label, bankName: d.bankName, accountName: d.accountName,
          accountLast4: d.accountNumber.slice(-4),
          ciphertext: encryptSecret(d.accountNumber, `${d.vendorId}:${d.label}`),
          createdById: user.id,
        },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: d.vendorId,
        action: "supplier.bank.added",
        diff: { account: { from: null, to: `${d.bankName} · ${d.label}` } },
      });
      return row;
    });
    revalidatePath(`/purchases/suppliers/${d.vendorId}`);
    return ok({ id: created.id });
  } catch (e) {
    if (isP2002(e)) return validationError({ label: "That label already exists on this supplier" });
    throw e;
  }
}

/** Spec decision 9 — the one delete in this phase. */
export async function removeBankAccount(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const row = await prisma.vendorBankAccount.findUnique({ where: { id } });
  if (!row) return conflict("That bank account no longer exists.");

  await prisma.$transaction(async (tx) => {
    await tx.vendorBankAccount.delete({ where: { id } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: row.vendorId,
      action: "supplier.bank.removed",
      diff: { label: { from: row.label, to: null } },
    });
  });
  revalidatePath(`/purchases/suppliers/${row.vendorId}`);
  return ok(null);
}

/**
 * Ruling R2 (binding over the brief's prose): decrypt FIRST, inside the
 * try/catch. A decrypt failure returns `conflict(...)` and writes NO audit
 * entry. Only a successful decrypt writes `supplier.bank.revealed` — one
 * audit row per actual reveal, never one for a failed attempt. No
 * revalidate: the revealed value is client state that lives until the page
 * is left (spec §4.2) — there is no timer, and nothing server-rendered
 * changes.
 */
export async function revealBankAccount(input: unknown): Promise<ActionResult<{ accountNumber: string; label: string }>> {
  const user = await actionUser();
  if (!user || !canRevealBank(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const row = await prisma.vendorBankAccount.findUnique({ where: { id } });
  if (!row) return conflict("That bank account no longer exists.");

  let accountNumber: string;
  try {
    accountNumber = decryptSecret(row.ciphertext, `${row.vendorId}:${row.label}`);
  } catch {
    return conflict("Could not decrypt this account — the encryption key may have changed");
  }

  await writeAudit(prisma, {
    actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: row.vendorId,
    action: "supplier.bank.revealed",
    diff: { label: { from: null, to: row.label } },
  });

  return ok({ accountNumber, label: row.label });
}
