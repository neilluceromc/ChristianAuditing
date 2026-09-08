import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { contentDisposition, UPLOAD_TYPES } from "@/server/uploads";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; ackId: string }> },
) {
  await requireUser();
  const { id, ackId } = await ctx.params;
  const row = await prisma.acknowledgement.findUnique({ where: { id: ackId } });
  if (!row || row.employeeId !== id) return new Response("Not found", { status: 404 });

  const root = path.resolve(process.cwd(), "uploads");
  const abs = path.resolve(root, row.path);
  if (!abs.startsWith(root + path.sep)) return new Response("Not found", { status: 404 }); // traversal guard

  const bytes = await readFile(abs).catch(() => null);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": UPLOAD_TYPES[path.extname(row.fileName).toLowerCase()] ?? "application/octet-stream",
      "content-disposition": contentDisposition(row.fileName),
    },
  });
}
