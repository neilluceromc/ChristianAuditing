import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { readUpload } from "@/server/storage";
import { fileResponse } from "@/server/uploads";

/**
 * Spec §3: unlike the asset document route this mirrors, there is no class
 * check here — any authenticated user may download a supplier document, so
 * requireUser() (redirects an unauthenticated caller) is the whole gate.
 * `?inline=1` shows a PDF, PNG or JPG in place (`fileResponse`); anything else still downloads.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  await requireUser();
  const { id, docId } = await ctx.params;
  const doc = await prisma.vendorDocument.findUnique({ where: { id: docId } });
  if (!doc) return new Response("Not found", { status: 404 });
  if (doc.vendorId !== id) return new Response("Not found", { status: 404 });

  const bytes = await readUpload(doc.path);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return fileResponse(bytes, doc.fileName, req);
}
