"use server";

import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { ROLE_WORKSPACES } from "@/lib/workspaces";
import {
  cleanUiPatch, parseUiPrefs, UI_PREF_COOKIE_OPTIONS, UI_PREFS_KEY, uiPrefCookies, type UiPrefs,
} from "@/lib/ui-prefs";

/*
 * Phase 47 spec §5.4: settings follow the person. Not audited and not rate-limited: a preference, like
 * saveCrisPrefs, and a theme click must never spend the person's mutation budget. Signed out, both do nothing
 * (actionUser, never a redirect mid-click).
 */

/** A workspace the role can't open (the role changed since it was saved) reads as none: the role's first. */
function forRole(p: UiPrefs, role: Role): UiPrefs {
  return p.workspace && !ROLE_WORKSPACES[role].includes(p.workspace) ? { ...p, workspace: null } : p;
}

async function storedPrefs(userId: string): Promise<UiPrefs> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: UI_PREFS_KEY } },
    select: { value: true },
  });
  return parseUiPrefs(row?.value);
}

/**
 * One toggle's change (theme, density, sidebar, Home focus, workspace), merged over what the person has stored.
 * Bad fields are dropped, never reset to defaults. The toggle has already written its cookie for the next paint.
 */
export async function saveUiPref(patch: Partial<UiPrefs>): Promise<UiPrefs | null> {
  const user = await actionUser();
  if (!user) return null;
  const clean = cleanUiPatch(patch);
  // switchWorkspace checks the role before it saves; a workspace the role can't open is dropped here too.
  if (clean.workspace && !ROLE_WORKSPACES[user.role].includes(clean.workspace)) delete clean.workspace;
  const value = forRole({ ...(await storedPrefs(user.id)), ...clean }, user.role);
  await prisma.userPreference.upsert({
    where: { userId_key: { userId: user.id, key: UI_PREFS_KEY } },
    update: { value },
    create: { userId: user.id, key: UI_PREFS_KEY, value },
  });
  return value;
}

/**
 * Review Focus #4: the browser's settings cookies belong to someone else (or no one). Rewrites all six from the
 * signed-in person's `ui:prefs`, or the defaults when they have none, and stamps `br.uid` with their id. An empty
 * workspace deletes `br.dept`, so the layout falls back to the role's first workspace.
 */
export async function restoreUiPrefs(): Promise<UiPrefs | null> {
  const user = await actionUser();
  if (!user) return null;
  const prefs = forRole(await storedPrefs(user.id), user.role);
  const jar = await cookies();
  for (const { name, value } of uiPrefCookies(prefs, user.id)) {
    if (value === "") jar.delete(name);
    else jar.set(name, value, UI_PREF_COOKIE_OPTIONS);
  }
  return prefs;
}
