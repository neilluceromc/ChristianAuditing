import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; docId: string }> },
) {
  await requireUser();
  const { id, docId } = await ctx.params;
  const doc = await prisma.assetDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.assetId !== id) return new Response("Not found", { status: 404 });

  const root = path.resolve(process.cwd(), "uploads");
  const abs = path.resolve(root, doc.path);
  if (!abs.startsWith(root + path.sep)) return new Response("Not found", { status: 404 }); // traversal guard

  const bytes = await readFile(abs).catch(() => null);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": TYPES[path.extname(doc.fileName).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": `attachment; filename="${doc.fileName.replaceAll('"', "")}"`,
    },
  });
}
