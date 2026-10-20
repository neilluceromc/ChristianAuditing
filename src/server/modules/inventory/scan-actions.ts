"use server";

import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { canSeeClass } from "@/lib/asset-class";
import { TAG_SHAPE } from "@/lib/tag-key";

/**
 * Task 6 review I1 (spec §7.2): the USB scanner contract from the search box. Enter asks this for an exact tag and,
 * on a hit, the toolbar pushes the record (`inventorySearchSubmit`) — no same-page `?go=1` navigation, so the
 * stuck-navigation fallback can never reload the page for it, and Back returns to the list.
 *
 * The same lookup as `exactTagMatch`: findUnique on the trimmed, upper-cased tag, NEVER an insensitive equals (ILIKE
 * wildcard hazard), and deliberately not scoped to the class the list is showing (a label read off the object opens
 * the object, whichever view the box was on). Guarded like the list instead: a signed-in person, and only an asset of
 * a class the role may see — anything else answers null, so the box just filters.
 */
export async function findExactTag(q: unknown): Promise<{ id: string } | null> {
  if (typeof q !== "string") return null;
  const tag = q.trim().toUpperCase();
  if (!TAG_SHAPE.test(tag)) return null;
  const user = await actionUser();
  if (!user) return null;
  const rate = await checkRate(user.id, "check"); // a read, on its own budget like the other live checks
  if (!rate.allowed) return null;
  const hit = await prisma.asset.findUnique({ where: { tag }, select: { id: true, cls: true } });
  return hit && canSeeClass(user.role, hit.cls) ? { id: hit.id } : null;
}
