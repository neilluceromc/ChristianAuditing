/**
 * The one sign-in helper every spec uses (Task 10, the Cris login redesign).
 *
 * Until the redesign each spec carried its own copy (house rule: never import helpers across spec files, since each
 * file reseeds independently), and all 59 copies walked the old stepped card. Sign-in is now one form, so the steps
 * live here, once: this module holds no data and reseeds nothing, so sharing it keeps every spec independent.
 *
 * Prisma is imported before the seed fixtures on purpose: it loads the environment, so SEED_PASSWORD reads the same
 * value prisma/seed.ts wrote.
 */
import { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { SEED_PASSWORD } from "../../prisma/fixtures";

let db: PrismaClient | undefined;

/**
 * On the sign-in form: wait until the card has hydrated (it sets data-login-ready, so a click can't race hydration),
 * fill Work email and Password, and press Log in. Does not wait for the outcome.
 */
export async function submitSignIn(page: Page, email: string, password: string = SEED_PASSWORD) {
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

/**
 * Sign in as a seeded account. /logout first: it clears any session and lands on /login, so the helper is safe to
 * call again mid-test to switch users (visiting /login while signed in just bounces to Home).
 */
export async function login(page: Page, email: string) {
  await page.goto("/logout");
  await submitSignIn(page, email);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await waitForPrefsSync(page, email);
}

/**
 * Phase 47 (spec §5.4): the first page after a sign-in rewrites the settings cookies from the person's saved prefs
 * (UiPrefsSync → restoreUiPrefs, stamping br.uid) and refreshes. Wait for it, so the next step never races that
 * refresh and a cookie a spec seeds next is not overwritten.
 */
export async function waitForPrefsSync(page: Page, email: string) {
  db ??= new PrismaClient();
  const { id } = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, select: { id: true } });
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(id);
}
