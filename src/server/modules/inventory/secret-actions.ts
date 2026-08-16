"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const addSchema = z.object({
  assetId: z.string().min(1),
  label: z.string().trim().min(1, "Name the credential").max(60),
  value: z.string().min(1, "Nothing to store").max(500),
});

/** Plaintext exists only in transit; the row stores AES-256-GCM ciphertext. The audit diff carries the LABEL only. */
export async function addSecret(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: d.assetId } });
  if (!asset) return conflict("That asset no longer exists.");
  const existing = await prisma.assetSecret.findUnique({
    where: { assetId_label: { assetId: d.assetId, label: d.label } },
  });
  if (existing) return validationError({ label: "That label already exists on this asset" });

  const secret = await prisma.$transaction(async (tx) => {
    const created = await tx.assetSecret.create({
      data: { assetId: d.assetId, label: d.label, ciphertext: encryptSecret(d.value, `${d.assetId}:${d.label}`) },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: d.assetId,
      action: "secret.created",
      diff: { label: { from: null, to: d.label } },
    });
    return created;
  });
  revalidatePath(`/inventory/${d.assetId}/secrets`);
  return ok({ id: secret.id });
}

const revealSchema = z.object({
  assetId: z.string().min(1),
  secretId: z.string().min(1),
});

/**
 * Entry criterion #4: reveal is a deliberate, logged action. Its own role
 * guard (path gating alone would let a viewer in — viewer is IT-workspace),
 * rate-limited, and every call writes SECRET_READ before the plaintext
 * leaves the server. No revalidate — the 30 s auto-hide is client state.
 */
export async function revealSecret(
  input: unknown,
): Promise<ActionResult<{ value: string; label: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = revealSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const secret = await prisma.assetSecret.findUnique({ where: { id: d.secretId } });
  if (!secret || secret.assetId !== d.assetId) return conflict("That secret no longer exists.");

  await writeAudit(prisma, {
    actorId: user.id, actorLabel: user.name,
    entityType: "asset", entityId: secret.assetId,
    action: "SECRET_READ",
    diff: { label: { from: null, to: secret.label } },
  });

  return ok({ value: decryptSecret(secret.ciphertext, `${secret.assetId}:${secret.label}`), label: secret.label });
}
