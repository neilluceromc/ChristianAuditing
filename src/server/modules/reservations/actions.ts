"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { openApprovalForAsset } from "@/server/modules/approvals/create";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { isAssignable } from "@/lib/asset-class";
import { dayFromISO } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";
import { minHoldExpiry } from "@/lib/holds";
import { reasonOptional } from "@/lib/reason";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

/** Every surface that shows a hold (spec §4.1). */
function revalidateHold(assetId: string, employeeId: string) {
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath(`/inventory/${assetId}/reservations`);
  revalidatePath("/inventory");
  revalidatePath("/reservations");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/");
}

const reserveSchema = z.object({
  assetId: z.string().min(1), employeeId: z.string().min(1), expiresAt: dateStr, reason: reasonOptional(),
});

/** Phase 26 (spec §4.1): promise an IT spare to a person. Direct, audited on the asset, no approval. */
export async function reserveAsset(input: unknown): Promise<ActionResult<{ id: string; tag: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reserveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const today = localDateISO(new Date());
  if (d.expiresAt < minHoldExpiry(today)) return validationError({ expiresAt: "Pick today or later" });

  let out: { id: string; tag: string } | null = null;
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
      if (!asset) return conflict("That asset no longer exists.");
      if (asset.cls !== "IT") return conflict("Holds are for IT spares.");
      if (!isAssignable(asset)) return conflict(`${asset.tag} is not a spare.`);
      const held = await tx.reservation.findFirst({ where: { assetId: asset.id, state: "ACTIVE" }, include: { employee: { select: { employeeNo: true } } } });
      if (held) return conflict(`${asset.tag} is already held for ${held.employee.employeeNo} — release that hold first.`);
      if (await openApprovalForAsset(tx, asset.id)) return conflict(`${asset.tag} has an open request — decide it first.`);
      const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "ACTIVE") return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — slots are frozen.`);

      const expiresAt = dayFromISO(d.expiresAt);
      const reason = d.reason || null;
      const created = await tx.reservation.create({
        data: { assetId: asset.id, employeeId: employee.id, state: "ACTIVE", reason, expiresAt },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "reservation.placed",
        diff: {
          hold: { from: null, to: employee.employeeNo },
          expiresAt: { from: null, to: expiresAt },
          ...(reason ? { reason: { from: null, to: reason } } : {}),
        },
      });
      out = { id: created.id, tag: asset.tag };
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index Reservation_one_active_hold_per_asset (migration
    // 20260814090100) turns a concurrent-reserve race into a constraint
    // violation: both transactions passed the findFirst above and one INSERT
    // lost. Say it in the pre-check's words — re-read from the winner's row —
    // instead of letting the throw escape the action.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const [asset, winner] = await Promise.all([
        prisma.asset.findUnique({ where: { id: d.assetId }, select: { tag: true } }),
        prisma.reservation.findFirst({ where: { assetId: d.assetId, state: "ACTIVE" }, select: { employee: { select: { employeeNo: true } } } }),
      ]);
      const tag = asset?.tag ?? "That asset";
      return conflict(winner
        ? `${tag} is already held for ${winner.employee.employeeNo} — release that hold first.`
        : `${tag} is already held — release that hold first.`);
    }
    throw err;
  }
  revalidateHold(d.assetId, d.employeeId);
  return ok(out!);
}

const releaseSchema = z.object({ reservationId: z.string().min(1), reason: reasonOptional() });

/** Phase 26 (spec §4.1): let a hold go. `updateMany` on the ACTIVE predicate so a sweep or a fulfilment that won the race is reported, not overwritten. */
export async function releaseHold(input: unknown): Promise<ActionResult<{ id: string; tag: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { id: string; tag: string; assetId: string; employeeId: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const hold = await tx.reservation.findUnique({
      where: { id: d.reservationId },
      include: { asset: { select: { id: true, tag: true } }, employee: { select: { id: true, employeeNo: true } } },
    });
    if (!hold) return conflict("That hold no longer exists.");
    if (hold.state !== "ACTIVE") return conflict("That hold is already closed.");
    const r = await tx.reservation.updateMany({ where: { id: hold.id, state: "ACTIVE" }, data: { state: "RELEASED", resolvedAt: now } });
    if (r.count === 0) return conflict("That hold is already closed.");
    const reason = d.reason || null;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: hold.asset.id,
      action: "reservation.released",
      diff: { hold: { from: hold.employee.employeeNo, to: null }, ...(reason ? { reason: { from: null, to: reason } } : {}) },
    });
    out = { id: hold.id, tag: hold.asset.tag, assetId: hold.asset.id, employeeId: hold.employee.id };
    return null;
  });
  if (failure) return failure;
  revalidateHold(out!.assetId, out!.employeeId);
  return ok({ id: out!.id, tag: out!.tag });
}
