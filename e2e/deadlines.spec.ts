import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDate, localDateISO } from "@/lib/format";
import { addDays, dayFromISO, defaultOffboardingDue, defaultStocktakeDue } from "@/lib/deadlines";

/**
 * Phase 23, Task 8 — the Parkinson sweep's completion dates (spec §9.2, 8
 * cases). Tasks 1-7 built everything this file drives: `Employee
 * .offboardingDueAt` and `Stocktake.dueAt` (migration 24), the pure rules in
 * `src/lib/deadlines.ts`, the `DuePill`, the "Complete offboarding by" and
 * "Close by" fields with their server floors, the offboarding list's Due
 * column and facet, the wizard and stocktake headers, the farewell report's
 * Completion line, the worklist's `leaverRow`, and Purchasing Home's
 * "Stocktakes past close-by" tile.
 *
 * Cases run `serial` — three of them share state on purpose:
 *   - case 2 edits Dennis's own due date, so it runs after case 1 (which
 *     reads the seeded one) and RESTORES the seeded value through Prisma in
 *     its `finally`, so cases 3 and 6 still see "2 d overdue". The audit row
 *     case 2 checks is append-only and survives that restore.
 *   - case 3 flips Leo Tan to OFFBOARDING through the form and back to
 *     ACTIVE, through the form on the happy path and unconditionally through
 *     Prisma in its `finally` — a mid-case failure must not leave a second
 *     leaver behind for cases 4-8 or for the next spec file.
 *   - case 5 backdates the stocktake case 4 opened and then CANCELS it (plan
 *     P-7), restoring the seed's "no OPEN stocktake" invariant; the only way
 *     to reach an overdue stocktake without waiting a day.
 *
 * Every expected date is derived from `@/lib/format` + `@/lib/deadlines` and
 * from the database — no date literal appears anywhere below, because the
 * seed dates move with the clock on every reseed.
 *
 * Controller ruling R3: both date inputs carry a `min` attribute, so a past
 * date is stopped by the browser's own constraint validation and the form
 * never submits. The SERVER floors ("Pick today or later" / "Pick tomorrow
 * or later") are what spec §7 guards, so cases 2 and 4 remove that attribute
 * before submitting and assert the server's message.
 *
 * Seeded facts this file leans on (prisma/seed.ts): Dennis Ong (EMP-0090) is
 * the only OFFBOARDING employee, holds three IT assets, and his
 * `offboardingDueAt` is two days ago — the one overdue leaver. Leo Tan
 * (EMP-0095) is ACTIVE with one IT asset on a temporary assignment. ST-0001
 * is POSTED and the seed opens no stocktake at all.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.$disconnect();
});

// Copied from e2e/stock-lots.spec.ts:50-56 (itself copied from
// e2e/stock.spec.ts) — house rule: never import helpers across spec files,
// since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/stock-lots.spec.ts:59-67. Probed on the element about to be
// interacted with, since hydration walks parent-to-child and a hydrated
// <form> does not yet imply a hydrated <input> inside it (the Phase 22 lesson
// that `fill` can fire before React wires the handler).
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

// The mouse-move-then-settle step is copied from e2e/stock-reports.spec.ts:56-61
// — it guards against a phantom SERIOUS contrast violation measured on a
// freshly-mounted Button variant="primary" mid-transition. PROMOTED_RULES and
// the AXE_DETAIL tail print are copied from e2e/axe-sweep.spec.ts:50-79: these
// four rules fail regardless of impact (their root causes are fixed and their
// tails verified zero — see the approvals-oversight spec §7), everything else
// below serious is counted, not failed.
const PROMOTED_RULES = new Set<string>([
  "empty-table-header",
  "page-has-heading-one",
  "heading-order",
  "landmark-unique",
]);

async function expectNoSeriousAxe(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  const bad: string[] = [];
  for (const v of results.violations) {
    if (v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id)) {
      bad.push(`${v.id} (${v.impact}) x${v.nodes.length}`);
    } else if (process.env.AXE_DETAIL === "1") {
      for (const node of v.nodes) console.log(`${label} · ${v.id} · ${v.impact} · ${node.target.join(" ")}`);
    }
  }
  expect(bad, `axe on ${label}`).toEqual([]);
}

const IT = "it@thebackroomop.com"; // e2e/offboarding-v2.spec.ts's own login
const PURCHASING = "purchasing@thebackroomop.com"; // e2e/stock-lots.spec.ts's own login

const dennis = () => db.employee.findFirstOrThrow({ where: { employeeNo: "EMP-0090" } });
const leo = () => db.employee.findFirstOrThrow({ where: { employeeNo: "EMP-0095" } });

/**
 * `PageHeader` renders `<h1>` and its badge side by side inside one flex div
 * (page-header.tsx) — the h1's own parent is therefore exactly "the header
 * line", tight enough that a pill elsewhere on the page can never satisfy the
 * assertion. Same one-level-up shape e2e/stock-reports.spec.ts's
 * `reportSection` uses for its `<h2>`.
 */
function headerLine(page: Page): Locator {
  return page.getByRole("heading", { level: 1 }).first().locator("xpath=..");
}

/** The date inputs' `min` is a browser-level floor (R3) — remove it to reach the server's. */
async function dropMin(input: Locator) {
  await input.evaluate((el) => el.removeAttribute("min"));
}

/** Case 4 opens the stocktake and records both; case 5 backdates, reads and cancels it. */
let stocktakeId = "";
let stocktakeRefNo = "";

test.describe.serial("deadlines", () => {
  test("1. the offboarding list shows Dennis's due date and pill, the Due facet keeps/drops him, and his wizard header repeats it", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /offboarding and the dynamic wizard route in this file
    const d = await dennis();
    expect(d.offboardingDueAt).not.toBeNull();
    const dueText = fmtDate(d.offboardingDueAt);

    await login(page, IT);
    await page.goto("/offboarding");
    const row = page.getByRole("row", { name: /Dennis Ong/ });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(dueText);
    await expect(row).toContainText("2 d overdue");

    // The facet is URL state (parseListState, OFFBOARDING_LIST_CONFIG) — the
    // dropdown writes exactly this.
    await page.goto("/offboarding?due=overdue");
    await expect(page.getByRole("row", { name: /Dennis Ong/ })).toContainText("2 d overdue");

    await page.goto("/offboarding?due=on-track");
    await expect(page.getByRole("row", { name: /Dennis Ong/ })).toHaveCount(0);
    await expect(page.getByText("No one matches these filters")).toBeVisible();

    await page.goto(`/offboarding/${d.id}`);
    await expect(page.getByRole("heading", { name: "Dennis Ong", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(headerLine(page)).toContainText(dueText);
    await expect(headerLine(page)).toContainText("2 d overdue");
  });

  test("2. the edit form shows the stored date, the server refuses yesterday, and a saved change lands in the audit log", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /employees/[id]/edit and /audit in this file
    const d = await dennis();
    const seeded = d.offboardingDueAt!;
    const today = localDateISO(new Date());

    try {
      await login(page, IT);
      await page.goto(`/employees/${d.id}/edit`);
      const due = page.getByLabel("Complete offboarding by");
      await waitForHydration(due);
      await expect(due).toHaveValue(localDateISO(seeded));

      // R3: past dates never reach the server through the browser's own
      // constraint validation, so drop `min` and assert the server floor.
      await dropMin(due);
      await due.fill(addDays(today, -1));
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Pick today or later", { exact: true })).toBeVisible({ timeout: 30_000 });

      const moved = addDays(today, 3);
      await due.fill(moved);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => localDateISO((await dennis()).offboardingDueAt!), { timeout: 15_000 })
        .toBe(moved);

      // The employee record's own history surface is the audit log — see this
      // file's report for why the brief's /employees/<id>/history is not a
      // route in this app. `/audit`'s Fields column is `Object.keys(diff)`.
      await page.goto("/audit?entity=employee");
      const entry = page.getByRole("row", { name: /Dennis Ong/ }).first();
      await expect(entry).toBeVisible({ timeout: 20_000 });
      await expect(entry).toContainText("offboardingDueAt");
      await expect(entry).toContainText("update");
    } finally {
      // Cases 3 and 6 read the seeded "2 d overdue"; the audit row above is
      // append-only and is unaffected by putting the date back.
      await db.employee.update({ where: { id: d.id }, data: { offboardingDueAt: seeded } });
    }
  });

  test("3. the worklist carries the due text and orders the overdue leaver above a fresh one", async ({ page }) => {
    test.setTimeout(90_000); // two form saves plus three worklist renders
    const d = await dennis();
    const l = await leo();
    const today = localDateISO(new Date());

    try {
      await login(page, IT);
      // P-5: the uncapped worklist page, not Home — Home shows two rows per
      // section, so a leaver can legitimately be cut off there.
      await page.goto("/inventory/work");
      const queue = page.locator("section#queue");
      await expect(queue).toBeVisible({ timeout: 20_000 });
      const dennisRow = queue.getByRole("listitem").filter({ hasText: "Dennis Ong is leaving" });
      await expect(dennisRow).toContainText("2 d overdue");
      await expect(dennisRow).toContainText(d.employeeNo);

      await page.goto(`/employees/${l.id}/edit`);
      const employment = page.getByLabel("Employment");
      await waitForHydration(employment);
      await employment.selectOption("OFFBOARDING");
      // Spec §6.2: switching to OFFBOARDING prefills the default, visibly.
      await expect(page.getByLabel("Complete offboarding by")).toHaveValue(defaultOffboardingDue(today));
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible({ timeout: 30_000 });

      await page.goto("/inventory/work");
      await expect(queue).toBeVisible({ timeout: 20_000 });
      const titles = await queue.getByRole("listitem").allTextContents();
      const dennisAt = titles.findIndex((t) => t.includes("Dennis Ong is leaving"));
      const leoAt = titles.findIndex((t) => t.includes("Leo Tan is leaving"));
      expect(dennisAt, "Dennis's leaver row is on the worklist").toBeGreaterThanOrEqual(0);
      expect(leoAt, "Leo's leaver row is on the worklist").toBeGreaterThanOrEqual(0);
      expect(dennisAt, "the overdue leaver sorts above the fresh one").toBeLessThan(leoAt);

      // Flip back through the form as well, so the ACTIVE branch (which
      // clears the date, spec §6.2) is exercised, not just undone.
      await page.goto(`/employees/${l.id}/edit`);
      const employmentAgain = page.getByLabel("Employment");
      await waitForHydration(employmentAgain);
      await employmentAgain.selectOption("ACTIVE");
      await expect(page.getByLabel("Complete offboarding by")).toHaveCount(0);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible({ timeout: 30_000 });
    } finally {
      // Unconditional: a mid-case failure must not leave a second leaver
      // behind for cases 4-8, or for the next spec file to trip over.
      await db.employee.update({
        where: { id: l.id },
        data: { employment: "ACTIVE", offboardingAt: null, offboardingDueAt: null },
      });
    }
  });

  test("4. the open-stocktake form defaults Close by to three days out, refuses today, and the opened stocktake wears the pill", async ({
    page,
  }) => {
    test.setTimeout(90_000); // first hit of /stock/stocktakes/new, /stock/stocktakes/[id] and the list
    const today = localDateISO(new Date());
    const expected = defaultStocktakeDue(today);

    await login(page, PURCHASING);
    await page.goto("/stock/stocktakes/new");
    const closeBy = page.getByLabel("Close by");
    await waitForHydration(closeBy);
    await expect(closeBy).toHaveValue(expected);

    // R3 again: `min` is tomorrow, so today never reaches openStocktake
    // through the browser. Drop it and assert the server's own floor.
    await dropMin(closeBy);
    await closeBy.fill(today);
    await page.getByRole("button", { name: "Open stocktake" }).click();
    await expect(page.getByText("Pick tomorrow or later", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await db.stocktake.count({ where: { state: "OPEN" } })).toBe(0);

    await closeBy.fill(expected);
    await page.getByRole("button", { name: "Open stocktake" }).click();
    // A bare regexp would match the form's own /stock/stocktakes/new and read
    // "new" as the id — the predicate excludes the page we started on.
    await page.waitForURL(
      (url) => /^\/stock\/stocktakes\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"),
      { timeout: 30_000 },
    );
    // P-7: the id comes from where the form landed, never from a guess.
    stocktakeId = new URL(page.url()).pathname.split("/").pop()!;
    const st = await db.stocktake.findUniqueOrThrow({ where: { id: stocktakeId } });
    expect(st.state).toBe("OPEN");
    expect(localDateISO(st.dueAt)).toBe(expected);
    stocktakeRefNo = st.refNo;

    await expect(headerLine(page)).toContainText("OPEN");
    await expect(headerLine(page)).toContainText(fmtDate(dayFromISO(expected)));
    await expect(headerLine(page)).toContainText("due in 3 d");

    await page.goto("/stock/stocktakes");
    const row = page.getByRole("row", { name: new RegExp(stocktakeRefNo) });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText(fmtDate(dayFromISO(expected)));
    await expect(row).toContainText("due in 3 d");
  });

  test("5. backdating that stocktake lights the Purchasing tile and turns the list pill overdue", async ({ page }) => {
    test.setTimeout(60_000);
    const today = localDateISO(new Date());
    expect(stocktakeId, "case 4 opened a stocktake").not.toBe("");

    try {
      // P-7: the only way to reach an overdue stocktake without waiting a day.
      await db.stocktake.update({ where: { id: stocktakeId }, data: { dueAt: dayFromISO(addDays(today, -1)) } });
      expect(await db.stocktake.count({ where: { state: "OPEN" } })).toBe(1);

      await login(page, PURCHASING);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Your requests", level: 2 })).toBeVisible({ timeout: 20_000 });
      // Same Stat-tile shape e2e/stock-reports.spec.ts:323 uses: the label
      // span's parent is the tile, whose only link is the value.
      const tile = page.getByText("Stocktakes past close-by", { exact: true }).locator("xpath=..");
      await expect(tile.getByRole("link")).toHaveText("1");
      await expect(tile.getByRole("link")).toHaveAttribute("href", "/stock/stocktakes");

      await page.goto("/stock/stocktakes");
      const row = page.getByRole("row", { name: new RegExp(stocktakeRefNo) });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText(fmtDate(dayFromISO(addDays(today, -1))));
      await expect(row).toContainText("1 d overdue");
    } finally {
      // P-7: no OPEN stocktake outlives this case (the seed opens none).
      await db.stocktake.update({ where: { id: stocktakeId }, data: { state: "CANCELLED" } });
    }
  });

  test("6. the farewell report states the completion line for an open, overdue offboarding", async ({ page }) => {
    test.setTimeout(60_000); // first hit of the report route in this file
    const d = await dennis();

    await login(page, IT);
    await page.goto(`/offboarding/${d.id}/report`);
    // Phase 32: the printed H1 reads "Backroom IT — Farewell report" (no "Offboarding").
    await expect(page.getByText("Farewell report").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`Still open · 2 d overdue (due ${fmtDate(d.offboardingDueAt)})`, { exact: true }))
      .toBeVisible();
  });

  test("7. the new-employee form starts with no department chosen and the server names the refusal", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /employees/new in this file
    await login(page, IT);
    await page.goto("/employees/new");

    const department = page.getByLabel("Department");
    await waitForHydration(department);
    await expect(department).toHaveValue("");
    await expect(department.locator("option:checked")).toHaveText("Choose a department");
    // P-9: the Joined default is Manila's today, not UTC's.
    await expect(page.getByLabel("Joined")).toHaveValue(localDateISO(new Date()));

    await page.getByLabel("Employee number").fill("EMP-E2E-DUE");
    await page.getByLabel("Name").fill("Deadline Probe");
    await page.getByLabel("Title").fill("Probe");
    await page.getByRole("button", { name: "Create employee" }).click();

    await expect(page.getByText("Pick a department", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/employees\/new$/);
    expect(await db.employee.count({ where: { employeeNo: "EMP-E2E-DUE" } })).toBe(0);
  });

  test("8. no serious, critical or promoted axe violations on the four routes this phase changed", async ({ page }) => {
    test.setTimeout(90_000); // four full-page scans, each with its own settle wait
    const d = await dennis();

    await login(page, IT);
    await page.goto("/offboarding");
    await expect(page.getByRole("heading", { name: "Offboarding", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page, "/offboarding");

    await page.goto(`/employees/${d.id}/edit`);
    await waitForHydration(page.getByLabel("Employment"));
    await expectNoSeriousAxe(page, "/employees/[id]/edit");

    await login(page, PURCHASING);
    await page.goto("/stock/stocktakes");
    await expect(page.getByRole("heading", { name: "Stocktakes", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page, "/stock/stocktakes");

    await page.goto("/stock/stocktakes/new");
    await waitForHydration(page.getByLabel("Close by"));
    await expectNoSeriousAxe(page, "/stock/stocktakes/new");
  });

  test("9. an already-overdue leaver's form saves an unrelated edit and leaves the past date alone", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    // Ruling R8's regression guard. Dennis is 2 d overdue, so before the fix
    // the form's `min` (= today) made the STORED value fail native constraint
    // validation and the browser silently refused to submit — every edit of
    // every field on this page was dead — and with `min` stripped the server's
    // unconditional floor refused the same unchanged date. The date is neither
    // touched nor re-picked here: only the Title changes, exactly as an
    // operator fixing a typo would. `min` is deliberately NOT dropped (unlike
    // case 2), because the browser's own validation is half of what regressed.
    const d = await dennis();
    const seededDue = d.offboardingDueAt!;
    const seededTitle = d.title;
    const newTitle = `${seededTitle} (R8)`;

    try {
      await login(page, IT);
      await page.goto(`/employees/${d.id}/edit`);
      const title = page.getByLabel("Title");
      await waitForHydration(title);
      const due = page.getByLabel("Complete offboarding by");
      await expect(due).toHaveValue(localDateISO(seededDue));
      // The floor moved down to the stored value, so the field is valid as it
      // stands — this is the assertion that pins the fix, not just its effect.
      await expect(due).toHaveAttribute("min", localDateISO(seededDue));
      expect(await due.evaluate((el: HTMLInputElement) => el.validity.rangeUnderflow)).toBe(false);

      await title.fill(newTitle);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible({ timeout: 30_000 });

      const after = await dennis();
      expect(after.title).toBe(newTitle);
      // Unchanged in the DB, to the millisecond: the past date was accepted as
      // a re-send, not floored, not normalised, not quietly moved to today.
      expect(after.offboardingDueAt!.toISOString()).toBe(seededDue.toISOString());
      // And no phantom date diff in the audit row for this update (Minor 4 —
      // the seed now stores the column at UTC midnight, so `diffOf` sees it
      // unchanged).
      const entry = await db.auditEntry.findFirstOrThrow({
        where: { entityType: "employee", entityId: d.id, action: "update" },
        orderBy: { createdAt: "desc" },
      });
      expect(Object.keys(entry.diff as Record<string, unknown>)).toEqual(["title"]);
    } finally {
      await db.employee.update({ where: { id: d.id }, data: { title: seededTitle, offboardingDueAt: seededDue } });
    }
  });
});
