"use server";

import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { PEOPLE_LIMIT, assigneeQuerySchema, peopleQuerySchema, peopleWhere } from "@/lib/people-search";
import { INVENTORY_LIST_CONFIG, buildAssetWhere, parsePurchaseYear } from "@/lib/inventory-list";
import { canSeeClass } from "@/lib/asset-class";
import { parseListState } from "@/lib/url-state";
import type { ComboOption } from "@/components/patterns/entity-combobox";

/** Phase 36 (spec ยง4.1): at most PEOPLE_LIMIT people matching the typed text, by name then employee no. */
export async function searchPeople(input: unknown): Promise<ActionResult<ComboOption[]>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "check"); // a live check writes nothing: its own 240/min budget, not the write budget
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

/**
 * Phase 36 (spec ง4.3): the Assigned filter's search. People holding an asset of the class (leavers included)
 * matching the typed text, each with how many assets they hold under the list's OTHER filters
 * (buildAssetWhere without `assignee`) — the same count rule as every facet.
 */
export async function searchAssignees(input: unknown): Promise<ActionResult<Array<{ value: string; label: string; sub: string; count: number }>>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assigneeQuerySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { q, cls, listQS } = parsed.data;
  if (!canSeeClass(user.role, cls)) return forbidden();
  const params = new URLSearchParams(listQS);
  const state = parseListState(params, INVENTORY_LIST_CONFIG);
  const purchaseYear = parsePurchaseYear(params.get("purchaseYear"));
  const people = await prisma.employee.findMany({
    where: peopleWhere(q, "assignees", cls),
    orderBy: [{ name: "asc" }, { employeeNo: "asc" }],
    take: PEOPLE_LIMIT,
    select: { id: true, name: true, employeeNo: true },
  });
  const counts = people.length
    ? await prisma.asset.groupBy({
        by: ["assigneeId"],
        where: {
          AND: [
            buildAssetWhere({ ...state, filters: { ...state.filters, assignee: [] } }, purchaseYear, cls),
            { assigneeId: { in: people.map((p) => p.id) } },
          ],
        },
        _count: true,
      })
    : [];
  return ok(people.map((e) => ({
    value: e.id, label: e.name, sub: e.employeeNo,
    count: counts.find((g) => g.assigneeId === e.id)?._count ?? 0,
  })));
}
