import { prisma } from "@/server/db/client";

/** Account settings (spec §4.5): the read-only facts beyond the session's own row — who created it, which employee. */
export async function accountFacts(userId: string): Promise<{
  createdByName: string | null;
  employee: { name: string; employeeNo: string } | null;
}> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdBy: { select: { name: true } },
      employee: { select: { name: true, employeeNo: true } },
    },
  });
  return { createdByName: row?.createdBy?.name ?? null, employee: row?.employee ?? null };
}
