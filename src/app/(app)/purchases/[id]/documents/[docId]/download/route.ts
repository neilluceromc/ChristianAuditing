import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { contentDisposition, UPLOAD_TYPES } from "@/server/uploads";

/**
 * Mirrors the supplier document route (spec §3): no class check here — any
 * authenticated user may download a request document, so requireUser()
 * (redirects an unauthenticated caller) is the whole gate.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  await requireUser();
  const { id, docId } = await ctx.params;
  const doc = await prisma.requestDocument.findUnique({ where: { id: docId } });
  if (!doc) return new Response("Not found", { status: 404 });
  if (doc.requestId !== id) return new Response("Not found", { status: 404 });

  const root = path.resolve(process.cwd(), "uploads");
  const abs = path.resolve(root, doc.path);
  if (!abs.startsWith(root + path.sep)) return new Response("Not found", { status: 404 }); // traversal guard

  const bytes = await readFile(abs).catch(() => null);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": UPLOAD_TYPES[path.extname(doc.fileName).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": contentDisposition(doc.fileName),
    },
  });
}
