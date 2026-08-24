import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { IDS_CAP, idsRefusalText } from "@/lib/export-columns";
import { IMPORT_ROW_CAP, rowCapRefusal } from "@/lib/import-vocabulary";

/**
 * Phase 9, Task 13. Covers both halves of the feature — four export routes
 * and two import wizards — plus the two assertions this phase cannot make
 * anywhere else:
 *
 *  - the farewell sheet matched against the printed report WITH ROWS IN IT
 *    (Task 5 could only ever verify that equality at zero, and an equality
 *    that holds at zero is not evidence);
 *  - a filtered export matched against its own screen, the only possible
 *    guard on the bug Task 4 shipped and fixed, because the cut those two
 *    routes make happens in memory after the SQL `where`.
 *
 * Both hit Prisma, so neither is unit-testable. If this file does not assert
 * them, nothing does.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts):
 *   25 assets, NO serials at all (`count(serial)` is 0) — which is why the
 *   duplicate-serial case is built by the importer itself rather than taken
 *   from the seed. BR-LT-0148 is DEPLOYED to Marites Bautista (EMP-0042,
 *   ACTIVE). Dennis Ong EMP-0090 is the only OFFBOARDING employee and holds
 *   exactly three items. Categories: Laptop, Monitor, Phone, Dock, Headset,
 *   Peripheral, Uncategorised. Departments: IT, Finance, Sales, HR,
 *   Operations. 10 employees, 3 of whom have policy gaps.
 * Never reference raw cuids — the DB is reseeded and ids change every time.
 */

/**
 * Read directly, for the three things no screen in this app renders:
 * `Asset.updatedAt` (the whole point of the clean-re-upload guarantee),
 * `Employee.offboardingAt` (scope decision 15's stamp), and the audit row
 * count as a DELTA rather than an absolute (HANDOVER §7: that table carries
 * drift from earlier verification runs). Also how the divergence test moves
 * the world between Validate and Import.
 */
const db = new PrismaClient();

// Spec files share one database and run alphabetically — each reseeds so no
// file inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Task 13, T-3: the pointer park and the settle are MEASURED, not defensive
 * boilerplate. `Button variant="primary"` reports a *serious* 4.29 contrast
 * when axe samples it mid-transition or with the cursor resting on it
 * (`#fdfefe` on `#487cb6`); at rest `--accent` is `#2563a8` and passes. Task
 * 11's review hit this twice and this is the fix that worked. Do not remove
 * either line without re-running an axe scan on a page whose primary button
 * sits under wherever the last click left the mouse.
 */
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

const fixture = (name: string) => `e2e/fixtures/${name}`;

/**
 * The file input carries a real `<label for>` ("Spreadsheet (.xlsx)"), so this
 * locator is a rule rather than a CSS guess — asserted rather than trusted by
 * the page-load test below.
 */
async function pick(page: Page, file: string) {
  await page.getByLabel(/Spreadsheet/).setInputFiles(fixture(file));
}

/** "Validate" on the first run, "Validate again" after a verdict exists. */
async function validate(page: Page) {
  await page.getByRole("button", { name: /^Validate/ }).click();
}

/** `aria-valuenow`/`aria-valuemax` on the wizard's own ProgressBar — a
 * stronger read than the counts line beside it, because the bar is what an
 * operator actually looks at and `role="progressbar"` publishes the numbers. */
async function bar(page: Page, label: string): Promise<{ now: number; max: number }> {
  const el = page.getByRole("progressbar", { name: label });
  await expect(el).toBeVisible({ timeout: 30_000 });
  return {
    now: Number(await el.getAttribute("aria-valuenow")),
    max: Number(await el.getAttribute("aria-valuemax")),
  };
}

/** The count the toolbar prints — "29 assets", "10 people", "41 entries". */
async function screenCount(page: Page, unit: RegExp): Promise<number> {
  const el = page.getByText(unit);
  await expect(el).toBeVisible({ timeout: 30_000 });
  return Number((await el.innerText()).split(" ")[0]);
}

const ASSETS = /^\d+ assets?$/;
const PEOPLE = /^\d+ (?:people|person)$/;
const ENTRIES = /^\d+ (?:entries|entry)$/;

async function assetTotal(page: Page): Promise<number> {
  await page.goto("/inventory");
  return screenCount(page, ASSETS);
}

/**
 * Data rows in a downloaded sheet — the header row `toXlsxBuffer` always
 * writes is subtracted here, once, so no caller has to remember it. Fetched
 * through `page.request`, which shares the page's session cookie, rather than
 * a download event: only the filename assertion needs the download itself.
 */
async function exportRowCount(page: Page, url: string): Promise<number> {
  const res = await page.request.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
  return grid.length - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// The cheapest test in the file, and deliberately first. Task 12's review
// found a `"use client"` component handed a plain function as a prop —
// `tsc`, `lint` and `build` all pass on that and it crashes only at render
// (§6a rule 66). Two navigations asserting an <h1> and zero `pageerror`s is
// the whole guard, and it catches that class in seconds.
// ─────────────────────────────────────────────────────────────────────────────
test.describe("both import pages render at all", () => {
  test("each wizard mounts with no page error, and the file input has a real label", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await login(page, "admin@thebackroomop.com");
    for (const [href, title] of [
      ["/inventory/import", "Import assets"],
      ["/employees/import", "Import employees"],
    ] as const) {
      await page.goto(href);
      // First hit of each route in this file — cold JIT compile headroom.
      await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible({ timeout: 30_000 });
      // The locator every upload below depends on. Asserted, not assumed.
      await expect(page.getByLabel(/Spreadsheet/)).toBeVisible();
      await expect(page.getByRole("list", { name: "Import steps" })).toContainText("Upload");
    }
    expect(errors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The asset importer. Serial: these steps share database state.
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial("the asset import wizard", () => {
  test("the page says, before anything is uploaded, that Validate writes nothing", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/import");
    await expect(page.getByRole("heading", { name: "Import assets", level: 1 })).toBeVisible({ timeout: 30_000 });

    // The two claims the design card leads with. Both are load-bearing: the
    // dry run is the reason an operator is willing to click Validate at all,
    // and partial import is the reason a blocked row isn't a dead end.
    await expect(page.getByText(/Validate is a dry run/)).toBeVisible();
    await expect(page.getByText(/writes nothing until you choose Import/)).toBeVisible();
    await expect(page.getByText(/A blocked row never blocks the rest of the file/)).toBeVisible();

    await expectNoSeriousAxe(page);
  });

  test("a clean file reports 3 creates and writes nothing", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    const before = await assetTotal(page);

    await page.goto("/inventory/import");
    await pick(page, "assets-clean.xlsx");
    await validate(page);

    expect(await bar(page, "Rows that would import")).toEqual({ now: 3, max: 3 });
    await expect(page.getByText("3 new · 0 updates · 0 blocked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import 3 rows" })).toBeVisible();
    // The stepper must not claim "Results" for a preview (Task 11 round two).
    await expect(page.getByRole("list", { name: "Import steps" })).toContainText("Preview");
    await expect(page.getByRole("list", { name: "Import steps" })).not.toContainText("Results");

    // The dry run's whole promise, checked rather than read off the banner.
    expect(await assetTotal(page)).toBe(before);
  });

  test("applying it creates 3 assets and 3 import-create rows the audit log can name", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    const before = await assetTotal(page);
    const auditBefore = await db.auditEntry.count({ where: { action: "import-create" } });

    await page.goto("/inventory/import");
    await pick(page, "assets-clean.xlsx");
    await validate(page);
    await page.getByRole("button", { name: "Import 3 rows" }).click();

    expect(await bar(page, "Rows written or already matching")).toEqual({ now: 3, max: 3 });
    await expect(page.getByText("3 new · 0 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible();
    // R-1: the approved counts stay beside the actuals.
    await expect(page.getByText("approved 3 new · 0 updates · 0 blocked")).toBeVisible();
    await expect(page.getByRole("list", { name: "Import steps" })).toContainText("Results");

    expect(await assetTotal(page)).toBe(before + 3);
    for (const tag of ["BR-LT-9001", "BR-MN-9002", "BR-HS-9003"]) {
      await page.goto(`/inventory?q=${tag}`);
      // The scanner contract redirects an exact tag match straight to the record.
      await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    }

    expect(await db.auditEntry.count({ where: { action: "import-create" } })).toBe(auditBefore + 3);
    // …and /audit can NAME the rows an import wrote, rather than showing a
    // truncated cuid (§6a rule 20: `entityLabels` and `AUDIT_ENTITY_TYPES`
    // are two separate places, and "asset" has to be in both).
    await page.goto("/audit?q=import-create");
    expect(await screenCount(page, ENTRIES)).toBe(auditBefore + 3);
    await expect(page.getByRole("row", { name: /BR-LT-9001/ })).toBeVisible();
  });

  test("a mixed file reports every verdict, groups blocked rows biggest-first, and words ignored apart from unrecognised", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/import");
    await pick(page, "assets-mixed.xlsx");
    await validate(page);

    // 2 create + 1 update out of 6 rows; 3 blocked across two causes.
    expect(await bar(page, "Rows that would import")).toEqual({ now: 3, max: 6 });
    await expect(page.getByText("2 new · 1 updates · 3 blocked")).toBeVisible();

    // Biggest-first, and it must be an ORDER assertion — two visible cards
    // prove grouping happened but not that the bigger one leads.
    const causes = page.getByText(/^(?:Status not recognised|Category doesn't exist)$/);
    await expect(causes).toHaveText(["Status not recognised", "Category doesn't exist"]);
    // Anchored, so these match the group's own count span and not the "rows
    // 6, 7" line under it.
    await expect(page.getByText(/^2 rows$/)).toBeVisible();
    await expect(page.getByText(/^1 row$/)).toBeVisible();

    // A `link` fix goes where an admin can actually act (scope decision 12
    // refuses to create taxonomy as a side effect of an upload), and a
    // `reupload` fix is the wizard's own restart, not a link to nowhere.
    await expect(page.getByRole("link", { name: /Create category/ })).toHaveAttribute(
      "href",
      "/admin/asset-categories",
    );
    await expect(page.getByRole("button", { name: "Fix the file" })).toBeVisible();

    // T-7: the split a careless refactor flips. "RMA ref" is this app's own
    // export column with no import field, and must NOT be reported the way a
    // typo is; "Aset tag" is a real typo of an accepted spelling and must.
    await expect(page.getByText(/Not imported:/)).toContainText("RMA ref");
    await expect(page.getByText(/check for a typo in the header/)).toContainText("Aset tag");
    await expect(page.getByText(/check for a typo in the header/)).not.toContainText("RMA ref");
  });

  test("a duplicate serial blocks, and 'Update those assets instead' re-plans it without writing", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");

    // T-1: the seed has no serials at all, so the colliding state is built by
    // the importer itself — which makes the collision one the running code
    // created, and is the first time `AssetRefs.bySerial` and
    // `treatDuplicateSerialAsUpdate` are exercised against real data.
    await page.goto("/inventory/import");
    await pick(page, "assets-serial-new.xlsx");
    await validate(page);
    await page.getByRole("button", { name: "Import 1 rows" }).click();
    await expect(page.getByText("1 new · 0 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 30_000,
    });

    const before = await assetTotal(page);

    await page.goto("/inventory/import");
    await pick(page, "assets-serial-clash.xlsx");
    await validate(page);
    await expect(page.getByText("0 new · 0 updates · 1 blocked")).toBeVisible();
    await expect(page.getByText("Duplicate serial")).toBeVisible();
    // Nothing to import, so the Import button is ABSENT, not disabled.
    await expect(page.getByRole("button", { name: /^Import \d+ rows$/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Update those assets instead" }).click();

    // The row moves from blocked to update, and the chip records the decision
    // now riding on the next write — removably, which is V-6's whole point.
    await expect(page.getByText("0 new · 1 updates · 0 blocked")).toBeVisible({ timeout: 30_000 });
    expect(await bar(page, "Rows that would import")).toEqual({ now: 1, max: 1 });
    await expect(page.getByText("Applied to this plan:")).toBeVisible();
    // The chip's "×" is aria-hidden and its real affordance is an sr-only
    // "Remove", so the accessible name is the label plus that word — which is
    // also what distinguishes the removable chip from the fix BUTTON that
    // shares its label.
    await expect(page.getByRole("button", { name: /Update those assets instead\s+Remove/ })).toBeVisible();

    // A re-plan is still a dry run: the option changed the verdict, not the fleet.
    expect(await assetTotal(page)).toBe(before);
  });

  test("an oversized file is refused by the row cap and imports nothing", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    const before = await assetTotal(page);

    await page.goto("/inventory/import");
    await pick(page, "assets-oversized.xlsx");
    await validate(page);

    // The sentence comes from `rowCapRefusal`, never retyped here — a literal
    // would keep passing after the cap moved and the screen started lying
    // (§6a rules 26/37/38).
    //
    // Matched by TEXT, not by `getByRole("alert")`: Next renders its own
    // permanently-mounted, normally-empty `#__next-route-announcer__` with
    // `role="alert"`, so an alert role query on any page in this app resolves
    // to two elements and dies of strict mode before it ever sees the banner.
    await expect(page.getByText(rowCapRefusal(IMPORT_ROW_CAP + 1))).toBeVisible({ timeout: 60_000 });
    // No verdict at all: the file was refused before a single row was examined.
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    expect(await assetTotal(page)).toBe(before);
  });

  test("a header-only sheet says so instead of showing a full green bar", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory/import");
    await pick(page, "assets-empty.xlsx");
    await validate(page);

    // V-5: `(0/0)*100` is NaN, every browser discards a NaN width, and the
    // accent div defaults to full — the most confident-looking element on a
    // page reporting nothing. There must be no bar here at all.
    await expect(page.getByText("Nothing to import")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Import/ })).toHaveCount(0);
  });

  test("re-uploading an unedited export writes nothing at all — no audit row, no updatedAt", async ({ page }) => {
    // T-4, the flagship case. Three throwaway harnesses have shown this and
    // all three were deleted, so until now nothing in the repository asserted
    // it. It is the workflow the feature exists for, and it is what Task 10's
    // A-3/A-4 and the day-precision fix exist to protect.
    test.setTimeout(180_000);
    await login(page, "admin@thebackroomop.com");

    const stampsBefore = await db.asset.findMany({ orderBy: { tag: "asc" }, select: { tag: true, updatedAt: true } });
    const auditBefore = await db.auditEntry.count();

    // The app's own export, unedited, straight back in — handed to
    // `setInputFiles` as an in-memory payload, so the bytes the browser
    // uploads are the exact bytes the route served, with no temp file in
    // between to go stale or get half-written.
    const res = await page.request.get("/inventory/export");
    expect(res.status()).toBe(200);
    const body = Buffer.from(await res.body());

    await page.goto("/inventory/import");
    await page.getByLabel(/Spreadsheet/).setInputFiles({
      name: "assets-round-trip.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: body,
    });
    await validate(page);

    const preview = await bar(page, "Rows that would import");
    expect(preview.now).toBe(stampsBefore.length);
    expect(preview.max).toBe(stampsBefore.length);
    await expect(page.getByText(`0 new · ${stampsBefore.length} updates · 0 blocked`)).toBeVisible();

    await page.getByRole("button", { name: `Import ${stampsBefore.length} rows` }).click();

    // "already matched" is the headline of this outcome, not a detail folded
    // away: "Imported 0 new and 0 updated" would read as a failure when the
    // import did exactly the right thing.
    await expect(
      page.getByText(`0 new · 0 updated · ${stampsBefore.length} already matched · 0 blocked · 0 failed`),
    ).toBeVisible({ timeout: 90_000 });
    // The plan said "update" and the outcome said "already matched" — those
    // differ by exactly the `unchanged` bucket, which is precisely why
    // `hasDiverged` reconstructs the sum instead of comparing created+updated.
    await expect(page.getByText("The outcome differs from what Validate showed")).toHaveCount(0);

    expect(await db.auditEntry.count()).toBe(auditBefore);
    expect(await db.asset.findMany({ orderBy: { tag: "asc" }, select: { tag: true, updatedAt: true } })).toEqual(
      stampsBefore,
    );
  });

  test("the world moving between Validate and Import is reported, not papered over", async ({ page }) => {
    // T-5: the divergence DECISION is a unit test (`hasDiverged`); this is its
    // RENDER, and the only place the third leg — the world actually moving
    // mid-flight — is exercised at all.
    test.setTimeout(120_000);
    await login(page, "admin@thebackroomop.com");

    await page.goto("/inventory/import");
    await pick(page, "assets-divergence.xlsx");
    await validate(page);
    await expect(page.getByText("2 new · 0 updates · 0 blocked")).toBeVisible({ timeout: 30_000 });

    // Someone else creates one of the two tags this file planned to CREATE.
    // The re-plan inside Apply will match it and write an UPDATE instead —
    // the composition swap the count sums alone are blind to.
    const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop" } });
    await db.asset.create({
      data: { tag: "BR-LT-9301", model: "Latitude 7450 (created behind your back)", categoryId: laptop.id, status: "SPARE" },
    });

    await page.getByRole("button", { name: "Import 2 rows" }).click();

    await expect(page.getByText("1 new · 1 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("The outcome differs from what Validate showed")).toBeVisible();
    // V-1: with no currently-blocked rows there are no groups to point at, so
    // the banner must not promise any "below".
    await expect(page.getByText(/None of the rows that differ are blocked right now/)).toBeVisible();
    await expect(page.getByText(/grouped below/)).toHaveCount(0);
    // The approved counts stay on screen beside the actuals — a predicate can
    // be blind to a composition swap; two numbers side by side cannot.
    await expect(page.getByText("approved 2 new · 0 updates · 0 blocked")).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("import — the role gate is on the route, not the button", () => {
  test("a viewer can reach neither importer, and is offered neither", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");

    // PATH_RULES gates both with `roles: ["admin", "it_staff"]`. Asserted
    // rather than assumed: the general /employees rule carries no `roles` key,
    // so /employees/import needs its own entry ahead of it (Task 12, E-7) —
    // the identical live gap Task 11 closed for assets.
    await page.goto("/inventory/import");
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);

    await page.goto("/employees/import");
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
    await page.goto("/employees");
    await expect(page.getByRole("link", { name: "Import" })).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The employee importer, and scope decision 15 — the rule that keeps a
// spreadsheet from being the surface that starts or unwinds an offboarding.
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial("the employee import wizard", () => {
  test("a clean file creates people end to end, and lists them", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "admin@thebackroomop.com");
    await page.goto("/employees");
    const before = await screenCount(page, PEOPLE);

    await page.goto("/employees/import");
    await pick(page, "employees-clean.xlsx");
    await validate(page);
    expect(await bar(page, "Rows that would import")).toEqual({ now: 2, max: 2 });

    // The employee wizard's own known-unimported answer, not the asset one:
    // "M365" is a synced status this importer deliberately cannot set and
    // "Items held" is computed, not stored (Task 12, E-8).
    await expect(page.getByText(/Not imported:/)).toContainText("M365");
    await expect(page.getByText(/Not imported:/)).toContainText("Items held");
    await expect(page.getByText(/check for a typo in the header/)).toHaveCount(0);

    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(page.getByText("2 new · 0 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 60_000,
    });

    await page.goto("/employees");
    expect(await screenCount(page, PEOPLE)).toBe(before + 2);
    await page.goto("/employees?q=Imelda");
    await expect(page.getByRole("row", { name: /EMP-9001/ })).toContainText("Financial Analyst");

    // /audit must be able to name an imported employee, the same way it names
    // an imported asset (§6a rule 20 — two separate registries).
    await page.goto("/audit?q=import-create");
    await expect(page.getByRole("row", { name: /Imelda Navarro/ })).toBeVisible({ timeout: 30_000 });
  });

  test("an update whose Employment disagrees BLOCKS, and the option applies the rest without moving it", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "admin@thebackroomop.com");
    await page.goto("/employees/import");
    await pick(page, "employees-employment-clash.xlsx");
    await validate(page);

    // Scope decision 15: EMP-0042 is ACTIVE and the sheet says OFFBOARDING.
    // A spreadsheet must not be the surface that starts an offboarding — the
    // farewell report's whole window hangs off `offboardingAt`.
    await expect(page.getByText("0 new · 0 updates · 1 blocked")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Employment would move outside the offboarding flow")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import \d+ rows$/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Keep the current employment" }).click();
    await expect(page.getByText("0 new · 1 updates · 0 blocked")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Import 1 rows" }).click();
    await expect(page.getByText("0 new · 1 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 60_000,
    });

    // The row's OTHER columns landed; employment did not move, and neither
    // did the anchor that bounds an offboarding window.
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    expect(marites.title).toBe("Senior Accountant");
    expect(marites.employment).toBe("ACTIVE");
    expect(marites.offboardingAt).toBeNull();

    await page.goto("/employees?q=Marites");
    const row = page.getByRole("row", { name: /EMP-0042/ });
    await expect(row).toContainText("Senior Accountant");
    await expect(row).toContainText("ACTIVE");
  });

  test("a CREATE may set employment straight, and stamps the offboarding anchor with it", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "admin@thebackroomop.com");
    await page.goto("/employees/import");
    await pick(page, "employees-offboarding-create.xlsx");
    await validate(page);
    await expect(page.getByText("1 new · 0 updates · 0 blocked")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Import 1 rows" }).click();
    await expect(page.getByText("1 new · 0 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 60_000,
    });

    // Scope decision 15's other half: an import may SET a lifecycle field on
    // create (a backfill legitimately enters people already mid-offboarding),
    // and `offboardingAt` is stamped by the same three-branch rule
    // `updateEmployee` maintains — never left for a caller to forget. No
    // screen renders that column, which is why this reads the record.
    const created = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9003" } });
    expect(created.employment).toBe("OFFBOARDING");
    expect(created.offboardingAt).not.toBeNull();

    // …and the offboarding queue picks them up, which is what the stamp is for.
    await page.goto("/offboarding");
    await expect(page.getByRole("row", { name: /Dolores Panganiban/ })).toBeVisible({ timeout: 30_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
test.describe("export", () => {
  test("the assets export downloads a dated .xlsx", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export" }).click(),
    ]);
    // `exportFilename` strips the prefix to [A-Za-z0-9_-] and appends the
    // date — sortable, and unambiguous in a downloads folder.
    expect(download.suggestedFilename()).toMatch(/^assets-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test("an oversized ?ids= selection is refused, not silently sliced", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    // The refusal precedes the query, so the ids need not exist. Built from
    // IDS_CAP rather than a literal 501, and compared against the module's
    // own sentence rather than a retyped one.
    const ids = Array.from({ length: IDS_CAP + 1 }, (_, i) => `id${i}`).join(",");
    const res = await page.request.get(`/inventory/export?ids=${ids}`);
    expect(res.status()).toBe(413);
    expect(await res.text()).toBe(idsRefusalText(IDS_CAP + 1));
  });

  test("the year chips carry counts, and narrow the list and the export together", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/inventory");
    const unfiltered = await screenCount(page, ASSETS);

    // The chips exist so an operator can escape the export cap refusal, which
    // points at them by name — a chip that doesn't say how many rows it leaves
    // is not an answer to that refusal.
    // Located by href rather than by accessible name: the label and the count
    // are adjacent INLINE nodes, so `innerText` may or may not put whitespace
    // between them ("2026 5" vs "20265") and a name-based regex would be a
    // coin flip. The count lives in its own span, which is unambiguous. The
    // `\d{4}` filter skips the "No date" chip, which the imports above bring
    // into existence.
    const chip = page.locator('a[href*="purchaseYear="]').filter({ hasText: /^\d{4}/ }).first();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    const chipCount = Number((await chip.locator("span").innerText()).trim());
    expect(chipCount).toBeGreaterThan(0);

    await chip.click();
    await expect(page).toHaveURL(/purchaseYear=\d{4}/, { timeout: 30_000 });
    expect(await screenCount(page, ASSETS)).toBe(chipCount);
    expect(chipCount).toBeLessThan(unfiltered);

    // Same query string to the route the page's own Export link builds.
    const qs = new URL(page.url()).search;
    expect(await exportRowCount(page, `/inventory/export${qs}`)).toBe(chipCount);
  });

  test("a filtered export matches its own screen — employees by policy gaps, inventory by repair stage", async ({ page }) => {
    // Item 12, and the ONLY possible guard on the bug Task 4 shipped and
    // fixed: both cuts happen IN MEMORY after the SQL `where`
    // (`filteredEmployees` needs loadout resolution per employee;
    // `repairStageIds`' beyond-repair compares repairQuote against cost), so
    // an export built from the `where` alone returns the CANDIDATE set — ten
    // rows against a screen showing three. Neither helper is unit-testable:
    // both hit Prisma.
    test.setTimeout(120_000);
    await login(page, "admin@thebackroomop.com");

    await page.goto("/employees");
    const allPeople = await screenCount(page, PEOPLE);
    await page.getByRole("link", { name: "Policy gaps only" }).click();
    await expect(page).toHaveURL(/gaps=1/, { timeout: 30_000 });
    const gapsPeople = await screenCount(page, PEOPLE);
    expect(gapsPeople).toBeGreaterThan(0);
    expect(gapsPeople).toBeLessThan(allPeople);
    expect(await exportRowCount(page, `/employees/export${new URL(page.url()).search}`)).toBe(gapsPeople);
    // The candidate set is what a `where`-only export would have returned, so
    // an equality that happened to hold at the full roster would prove nothing.
    expect(await exportRowCount(page, "/employees/export")).toBe(allPeople);

    await page.goto("/inventory");
    const allAssets = await screenCount(page, ASSETS);
    await page.getByRole("link", { name: "Repairs" }).click();
    await expect(page).toHaveURL(/status=DEFECTIVE/, { timeout: 30_000 });
    await page.getByRole("link", { name: "AT VENDOR" }).click();
    await expect(page).toHaveURL(/stage=at-vendor/, { timeout: 30_000 });
    const staged = await screenCount(page, ASSETS);
    expect(staged).toBeGreaterThan(0);
    expect(staged).toBeLessThan(allAssets);
    expect(await exportRowCount(page, `/inventory/export${new URL(page.url()).search}`)).toBe(staged);
  });

  test("the audit export honours the filter the screen is showing", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/audit?q=import-create");
    const shown = await screenCount(page, ENTRIES);
    expect(shown).toBeGreaterThan(0);
    expect(await exportRowCount(page, "/audit/export?q=import-create")).toBe(shown);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Item 11. Task 5 could only verify this equality at ZERO, because the seeded
// database has no decided lifecycle returns — and an equality that holds at
// zero is not evidence (§6a rule 65). Driving three real decisions first is
// what makes reusing `decidedItems` across the page and the sheet mean
// anything.
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial("the farewell sheet matches the printed report", () => {
  test("three decisions land in both the printable report and the .xlsx", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "it@thebackroomop.com");

    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
    await expect(page).toHaveURL(/\/offboarding\/[^/]+$/, { timeout: 30_000 });
    await page.getByRole("list", { name: "Offboarding steps" }).getByRole("link", { name: /Collect items/ }).click();

    // The same steps `e2e/offboarding.spec.ts` drives — one decision per
    // interesting outcome, so the sheet has to carry three distinct ones.
    const decide = async (tag: string, outcome: string, reason: string) => {
      const card = page.getByRole("group", { name: `Decide ${tag}` });
      await card.getByRole("radiogroup", { name: new RegExp(`Outcome for ${tag}`) }).getByText(outcome).click();
      if (reason) await card.getByLabel(/Reason/).fill(reason);
      await card.getByRole("button", { name: "Confirm decision" }).click();
      await expect(page.getByText(new RegExp(`APR-\\d+ created — ${tag}`))).toBeVisible({ timeout: 30_000 });
    };
    await decide("BR-PH-0312", "Missing", "never handed back — investigation open");
    await decide("BR-LT-0166", "Defective", "screen cracked in transit");
    await decide("BR-HS-0510", "Returned", "");

    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    await page.goto(`/offboarding/${dennis.id}/report`);
    await expect(page.getByText("Offboarding farewell report")).toBeVisible({ timeout: 30_000 });

    // What the PAGE prints — `decidedItems(data.items)`, one <tr> each.
    const printed = await page.locator("tbody tr").count();
    expect(printed).toBe(3);

    // …and what the SHEET carries, from the same `decidedItems`. The equality
    // is only worth anything because both sides are now non-zero.
    expect(await exportRowCount(page, `/offboarding/${dennis.id}/report/export`)).toBe(printed);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export sheet" }).click(),
    ]);
    // The prefix is built from `employeeNo`, which no schema constrains — the
    // filename is safe because `exportFilename` sanitises it, not because the
    // caller remembered to.
    expect(download.suggestedFilename()).toMatch(/^farewell-EMP-0090-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
