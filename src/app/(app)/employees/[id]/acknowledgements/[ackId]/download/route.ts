import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { readUpload } from "@/server/storage";
import { fileResponse } from "@/server/uploads";

/** The signed form's file. `?inline=1` shows a PDF, PNG or JPG in place (`fileResponse`); anything else still downloads. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; ackId: string }> },
) {
  await requireUser();
  const { id, ackId } = await ctx.params;
  const row = await prisma.acknowledgement.findUnique({ where: { id: ackId } });
  if (!row || row.employeeId !== id) return new Response("Not found", { status: 404 });

  const bytes = await readUpload(row.path);
  if (!bytes) return new Response("File missing from the uploads volume", { status: 404 });

  return fileResponse(bytes, row.fileName, req);
}
