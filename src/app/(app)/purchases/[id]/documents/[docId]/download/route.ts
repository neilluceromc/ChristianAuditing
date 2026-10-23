import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { readUpload } from "@/server/storage";
import { fileResponse } from "@/server/uploads";

/**
 * Mirrors the supplier document route (spec §3): no class check here — any
 * authenticated user may download a request document, so requireUser()
 * (redirects an unauthenticated caller) is the whole gate. `?inline=1` sends
 * `Content-Disposition: inline` for a PDF, PNG or JPG, as the asset document
 * route does; anything else still downloads.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  await requireUser();
  const { id, docId } = await ctx.params;
  const doc = await prisma.requestDocument.findUnique({ where: { id: docId } });
  if (!doc) return new Response("Not found", { status: 404 });
  if (doc.orderId !== id) return new Response("Not found", { status: 404 });

  const bytes = await readUpload(doc.path);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return fileResponse(bytes, doc.fileName, req);
}
