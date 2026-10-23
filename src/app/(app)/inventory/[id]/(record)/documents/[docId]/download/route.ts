import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { readUpload } from "@/server/storage";
import { canSeeClass } from "@/lib/asset-class";
import { fileResponse } from "@/server/uploads";

/**
 * Phase 47 (spec §4.4): `?inline=1` sends `Content-Disposition: inline` so the asset page can preview a PDF in an
 * iframe or an image in an <img> — for exactly the PREVIEWABLE types (PDF, PNG, JPG; `fileResponse`); anything
 * else still downloads.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  const user = await requireUser();
  const { id, docId } = await ctx.params;
  const doc = await prisma.assetDocument.findUnique({
    where: { id: docId },
    include: { asset: { select: { cls: true } } },
  });
  if (!doc || doc.assetId !== id) return new Response("Not found", { status: 404 });
  if (!canSeeClass(user.role, doc.asset.cls)) return new Response("Not found", { status: 404 });

  const bytes = await readUpload(doc.path);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return fileResponse(bytes, doc.fileName, req);
}
