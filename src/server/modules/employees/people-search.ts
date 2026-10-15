"use server";

import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { PEOPLE_LIMIT, peopleQuerySchema, peopleWhere } from "@/lib/people-search";
import type { ComboOption } from "@/components/patterns/entity-combobox";

/** Phase 36 (spec §4.1): at most PEOPLE_LIMIT people matching the typed text, by name then employee no. */
export async function searchPeople(input: unknown): Promise<ActionResult<ComboOption[]>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = peopleQuerySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { q, scope, cls } = parsed.data;
  const rows = await prisma.employee.findMany({
    where: peopleWhere(q, scope, cls),
    orderBy: [{ name: "asc" }, { employeeNo: "asc" }],
    take: PEOPLE_LIMIT,
    select: { id: true, name: true, employeeNo: true },
  });
  return ok(rows.map((e) => ({ value: e.id, label: e.name, sub: e.employeeNo })));
}
