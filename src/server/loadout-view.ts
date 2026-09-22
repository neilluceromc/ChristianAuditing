import { prisma } from "./db/client";

/** Phase 29 (spec §4.8): the Slots/Table choice, per user — read beside `saveLoadoutView` (preferences.ts), not itself a "use server" action. */
export async function loadoutViewFor(userId: string): Promise<"slots" | "table"> {
  const row = await prisma.userPreference.findUnique({ where: { userId_key: { userId, key: "view:loadout" } }, select: { value: true } });
  return row?.value === "table" ? "table" : "slots";
}
