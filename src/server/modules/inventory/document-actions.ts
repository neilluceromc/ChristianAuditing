"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, type ActionResult,
} from "@/server/action-result";

const ALLOWED: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = ["receipt", "accountability-form", "photo", "other"] as const;

/**
 * Files land on the local uploads/ volume (single-machine deploy, no object
 * storage); the row stores a RELATIVE posix path + sha256 checksum. The
 * filename is sanitized to a safe charset — the original name survives only
 * as display text.
 */
export async function uploadDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const assetId = String(formData.get("assetId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const file = formData.get("file");
  if (!assetId) return conflict("Missing asset.");
  if (!(KINDS as readonly string[]).includes(kind)) return validationError({ kind: "Pick a document kind" });
  if (!(file instanceof File) || file.size === 0) return validationError({ file: "Pick a file first" });
  if (file.size > MAX_BYTES) return validationError({ file: "Too big — the cap is 10 MB" });

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED[ext] || (file.type && file.type !== ALLOWED[ext])) {
    return validationError({ file: `That type isn't allowed. Accepted: PDF, PNG, JPG.` });
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) return conflict("That asset no longer exists.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const safeName = path.basename(file.name).replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const relPath = path.posix.join("assets", assetId, `${Date.now()}-${safeName}`);
  await mkdir(path.join(process.cwd(), "uploads", "assets", assetId), { recursive: true });
  await writeFile(path.join(process.cwd(), "uploads", relPath), bytes);

  const doc = await prisma.$transaction(async (tx) => {
    const created = await tx.assetDocument.create({
      data: {
        assetId, kind,
        fileName: path.basename(file.name),
        path: relPath, checksum,
        uploadedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: assetId,
      action: "document.uploaded",
      diff: { document: { from: null, to: created.fileName } },
    });
    return created;
  });
  revalidatePath(`/inventory/${assetId}/documents`);
  return ok({ id: doc.id });
}

/** Accountability forms scan back in and get flagged SIGNED. */
export async function markDocumentSigned(input: { docId: string }): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const doc = await prisma.assetDocument.findUnique({ where: { id: String(input.docId ?? "") } });
  if (!doc) return conflict("That document no longer exists.");
  if (doc.signed) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.assetDocument.update({ where: { id: doc.id }, data: { signed: true } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: doc.assetId,
      action: "document.signed",
      diff: { [doc.fileName]: { from: "unsigned", to: "SIGNED" } },
    });
  });
  revalidatePath(`/inventory/${doc.assetId}/documents`);
  return ok(null);
}
