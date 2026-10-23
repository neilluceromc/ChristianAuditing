"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { PEOPLE_LIMIT } from "@/lib/people-search";
import { groupLabel } from "@/lib/admin-users";
import type { ComboOption } from "@/components/patterns/entity-combobox";

const querySchema = z.string().trim().min(1).max(60);

/**
 * Users & access (spec §4.4): the employee record picker (Add user, the panel's Change, Approve sign-up). ACTIVE
 * employees with no account yet (one account per employee), matching the typed text by name or employee no., at most
 * PEOPLE_LIMIT, by name. Admin only. Each option reads "EMP-1042 · Finance" (or "· Client: Acme") under the name.
 */
export async function searchLinkableEmployees(q: unknown): Promise<ActionResult<ComboOption[]>> {
  const user = await actionRole("admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "check"); // a live search writes nothing: the check budget, as searchPeople
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = querySchema.safeParse(q);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const text = parsed.data;
  const rows = await prisma.employee.findMany({
    where: {
      employment: "ACTIVE",
      user: { is: null },
      OR: [
        { name: { contains: text, mode: "insensitive" } },
        { employeeNo: { contains: text, mode: "insensitive" } },
      ],
    },
    orderBy: [{ name: "asc" }, { employeeNo: "asc" }],
    take: PEOPLE_LIMIT,
    select: { id: true, name: true, employeeNo: true, department: { select: { name: true, kind: true } } },
  });
  return ok(rows.map((e) => ({ value: e.id, label: e.name, sub: `${e.employeeNo} · ${groupLabel(e.department)}` })));
}
