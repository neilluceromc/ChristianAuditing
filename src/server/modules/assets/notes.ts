"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser, requireUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";
import { canSeeClass } from "@/lib/asset-class";
import { canPostAnywhere, canPostOnAsset, checkNoteBody, threadNotes, type AssetNoteThread } from "@/lib/asset-notes";

/*
 * Phase 47 (Task 6, spec §4.2a, §4.3): the shared asset notes. Read on canSeeClass; every write checks canSeeClass
 * AND canPostOnAsset on the server, writes its audit entry (source "web") in the same transaction, and revalidates
 * the Finance asset page and the Inventory record. A note is never edited or deleted: the only update stamps or
 * clears resolvedAt / resolvedById on a thread.
 */

function revalidateAsset(assetId: string) {
  revalidatePath(`/finance/assets/${assetId}`);
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath(`/inventory/${assetId}/notes`);
}

/** Post a thread, or (with parentId) a reply to a thread on the same asset. One level only. */
export async function postNote(input: { assetId: string; body: string; parentId?: string | null }): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canPostAnywhere(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const assetId = String(input?.assetId ?? "");
  const parentId = input?.parentId ? String(input.parentId) : null;
  if (!assetId) return conflict("Missing asset.");
  const checked = checkNoteBody(input?.body);
  if (!checked.ok) return validationError({ body: checked.error });

  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, cls: true } });
  if (!asset) return conflict("That asset no longer exists.");
  if (!canSeeClass(user.role, asset.cls) || !canPostOnAsset(user.role, asset.cls)) return forbidden();

  if (parentId) {
    const parent = await prisma.assetNote.findUnique({ where: { id: parentId }, select: { id: true, assetId: true, parentId: true } });
    if (!parent || parent.assetId !== assetId) return conflict("That note no longer exists.");
    if (parent.parentId !== null) return conflict("Reply to the thread, not to a reply.");
  }

  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.assetNote.create({
      data: { assetId, parentId, authorId: user.id, authorLabel: user.name, body: checked.body },
      select: { id: true },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: assetId,
      action: parentId ? "note.replied" : "note.posted",
      // the text, as the employee notes keep it; "note" is a hidden history field, and the body is not a reason
      diff: { note: { from: null, to: checked.body } },
      source: "web", reason: null,
    });
    return created.id;
  });
  revalidateAsset(assetId);
  return ok({ id });
}

/** Mark a thread resolved, or reopen it. Replies cannot be resolved. Already in that state: nothing is written. */
export async function setNoteResolved(input: { noteId: string; resolved: boolean }): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canPostAnywhere(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const noteId = String(input?.noteId ?? "");
  const resolved = input?.resolved === true;
  const note = noteId
    ? await prisma.assetNote.findUnique({
      where: { id: noteId },
      select: { id: true, assetId: true, parentId: true, resolvedAt: true, asset: { select: { cls: true } } },
    })
    : null;
  if (!note) return conflict("That note no longer exists.");
  if (!canSeeClass(user.role, note.asset.cls) || !canPostOnAsset(user.role, note.asset.cls)) return forbidden();
  if (note.parentId !== null) return conflict("Only a thread can be resolved.");
  if ((note.resolvedAt !== null) === resolved) return ok(null);

  const changed = await prisma.$transaction(async (tx) => {
    // the state is part of the where, so two people resolving at once write one stamp and one audit entry
    const res = resolved
      ? await tx.assetNote.updateMany({
        where: { id: note.id, parentId: null, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedById: user.id },
      })
      : await tx.assetNote.updateMany({
        where: { id: note.id, parentId: null, resolvedAt: { not: null } },
        data: { resolvedAt: null, resolvedById: null },
      });
    if (res.count === 0) return false;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: note.assetId,
      action: resolved ? "note.resolved" : "note.reopened",
      diff: { note: { from: resolved ? "open" : "resolved", to: resolved ? "resolved" : "open" } },
      source: "web", reason: null,
    });
    return true;
  });
  if (changed) revalidateAsset(note.assetId);
  return ok(null);
}

/** The asset's threads with their replies, for anyone who can see the asset's class; [] otherwise. */
export async function assetNotes(assetId: string): Promise<AssetNoteThread[]> {
  const user = await requireUser();
  const asset = await prisma.asset.findUnique({ where: { id: String(assetId ?? "") }, select: { cls: true } });
  if (!asset || !canSeeClass(user.role, asset.cls)) return [];
  const rows = await prisma.assetNote.findMany({
    where: { assetId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, parentId: true, authorId: true, authorLabel: true, body: true, createdAt: true,
      resolvedAt: true, resolvedById: true, author: { select: { role: true } },
    },
  });
  const resolverIds = [...new Set(rows.flatMap((r) => (r.resolvedById ? [r.resolvedById] : [])))];
  const resolvers = resolverIds.length
    ? await prisma.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, name: true } })
    : [];
  return threadNotes(
    rows.map(({ author, ...r }) => ({ ...r, authorRole: author?.role ?? null })),
    Object.fromEntries(resolvers.map((u) => [u.id, u.name])),
  );
}
