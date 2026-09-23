import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Phase 21, Task 7 — end-to-end rate-limit coverage (spec §8), 2 cases: one
 * mutation cap and one import cap, each proven with the real
 * `RateLimitNotice` (src/components/patterns/rate-limit-notice.tsx) rather
 * than a unit test on `rateDecision` alone.
 *
 * `RateEvent` rows are the fixture (src/lib/rate-limit.ts's `RATE_LIMITS`:
 * mutation 60/min, import 10/min; src/server/rate-limit.ts's `checkRate`
 * reads `{ userId, kind, at >= now - windowMs }`). Case 1 uses BR-MN-0910
 * (SPARE on a fresh seed — e2e/direct-lifecycle.spec.ts case 1 runs the same
 * flow) and the mutation cap's DEFAULT notice: `changeStatus`
 * (src/server/modules/lifecycle/actions.ts) calls
 * `checkRate(user.id)` (kind defaults to "mutation") and returns
 * `rateLimited(rate.retryAfterSec)` with no message override, so
 * `RateLimitNotice` falls back to its own hardcoded title. Case 2 uses the
 * employee importer's OWN message: `applyEmployeeImport`
 * (src/server/modules/import/employee-actions.ts:129-135) checks the
 * "import" kind (distinct from "import_plan", which guards the read-only
 * Validate step and is not exercised here) and, when blocked, returns
 *   rateLimited(rate.retryAfterSec,
 *     `You've run ${RATE_LIMITS.import.limit} imports this minute — the cap. Nothing from this file ` +
 *       "has been written.")
 * i.e. literally "You've run 10 imports this minute — the cap. Nothing from
 * this file has been written." — threaded to `RateLimitNotice`'s `message`
 * prop by the import wizard (src/components/import/import-wizard.tsx),
 * which becomes the notice's title.
 *
 * Never reference a raw cuid — the DB is reseeded and ids change every run.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.$disconnect();
});

// Copied from e2e/transfers.spec.ts — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Phase 30 (spec §4.1): the record header shows one state-chosen primary and
 * puts every other action in its ⋯ "More actions" menu. Opens that menu and
 * returns it — retried until the island has hydrated.
 */
async function openMore(page: Page) {
  const more = page.getByRole("button", { name: "More actions", exact: true });
  const menu = page.getByRole("menu");
  await expect(async () => {
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";

test.describe("rate limits", () => {
  test("1. mutation cap: 60 RateEvent rows block Change status with the default notice; clearing them and confirming again applies the change", async ({ page }) => {
    const itUser = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0910" } });
    await db.rateEvent.createMany({
      data: Array.from({ length: RATE_LIMITS.mutation.limit }, () => ({
        userId: itUser.id,
        kind: "mutation",
        at: new Date(),
      })),
    });

    await login(page, IT);
    await page.goto(`/inventory/${asset.id}`);
    // Phase 30: Change status sits in the record's More menu.
    await (await openMore(page)).getByRole("menuitem", { name: "Change status…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Change status of BR-MN-0910 · LG 27UL500" });
    await dialog.getByLabel("New status").selectOption("DEFECTIVE");
    await dialog.getByRole("button", { name: "Change status", exact: true }).click();

    await expect(dialog.getByText("You've made 60 changes this minute — the cap", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/you can retry in \d+s/)).toBeVisible();
    expect((await db.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("SPARE");

    // Clean the rows this case created before its second attempt (house
    // rule) — the dialog stays open and its selection survives a
    // rate-limited refusal (ChangeStatusDialog resets only when it opens), so
    // the same Change status click re-submits the same DEFECTIVE selection.
    await db.rateEvent.deleteMany({ where: { userId: itUser.id, kind: "mutation" } });
    await dialog.getByRole("button", { name: "Change status", exact: true }).click();

    // "Success: " is the toast's own sr-only prefix (TONE_LABEL.settled,
    // src/components/ui/toast.tsx) — part of the element's text content, so
    // the exact:true match needs it too (mirrors transfers.spec.ts's own
    // "Success: Transferred to HR" toast assertion). A generous timeout: a
    // cold dev-server compile can eat into the toast's 4s auto-dismiss
    // window on the first hit of this route in the file.
    await expect(page.getByText("Success: BR-MN-0910 is now DEFECTIVE", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect((await db.asset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe("DEFECTIVE");
  });

  test("2. import cap: 10 RateEvent rows block Apply with the importer's own message; nothing is written", async ({ page }) => {
    const adminUser = await db.user.findUniqueOrThrow({ where: { email: ADMIN } });
    await db.rateEvent.createMany({
      data: Array.from({ length: RATE_LIMITS.import.limit }, () => ({
        userId: adminUser.id,
        kind: "import",
        at: new Date(),
      })),
    });
    const before = await db.employee.count();

    await login(page, ADMIN);
    await page.goto("/employees/import");
    await page.getByLabel(/Spreadsheet/).setInputFiles("e2e/fixtures/employees-clean.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();
    // Validate uses the "import_plan" kind (60/min, untouched by this
    // fixture), so it succeeds and reaches the Import step.
    await expect(page.getByRole("button", { name: "Import 2 rows" })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Import 2 rows" }).click();

    // src/server/modules/import/employee-actions.ts:131-135, quoted verbatim
    // (RATE_LIMITS.import.limit === 10):
    //   `You've run ${RATE_LIMITS.import.limit} imports this minute — the cap. Nothing from this file ` +
    //     "has been written."
    await expect(
      page.getByText(
        "You've run 10 imports this minute — the cap. Nothing from this file has been written.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/you can retry in \d+s/)).toBeVisible();
    // No write happened: the stepper never earns "Results" (import-
    // wizard.tsx only sets that once applyOutcome exists).
    await expect(page.getByRole("list", { name: "Import steps" })).not.toContainText("Results");

    expect(await db.employee.count()).toBe(before);
  });
});
