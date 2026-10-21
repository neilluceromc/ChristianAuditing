import path from "node:path";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { readUpload } from "@/server/storage";
import { contentDisposition, UPLOAD_TYPES } from "@/server/uploads";

/** The types a browser may show in place (Task 6: Finance's group review previews the PO's PDFs and images). */
const INLINE = new Set([".pdf", ".png", ".jpg", ".jpeg"]);

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

  const ext = path.extname(doc.fileName).toLowerCase();
  const inline = INLINE.has(ext) && new URL(req.url).searchParams.get("inline") === "1";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": UPLOAD_TYPES[ext] ?? "application/octet-stream",
      "content-disposition": contentDisposition(doc.fileName, inline ? "inline" : "attachment"),
      "x-content-type-options": "nosniff",
    },
  });
}
