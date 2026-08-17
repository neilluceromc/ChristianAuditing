import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login — going there
  // directly (rather than /login) keeps this helper safe to call a second
  // time mid-test to switch users (see auth-shell.spec.ts / approvals-audit.spec.ts).
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Seeded fixtures this file depends on (see prisma/seed.ts), all
// @thebackroomop.com / ChangeMe123!:
//   admin@ (admin) · it@ (J. Sarmiento, it_staff) · purchasing@ (A. Reyes,
//   purchasing_staff) · finance@ (L. Domingo, finance_staff) · viewer@ (viewer)
//   PR-0201 DRAFT — 1 unit, untouched by this file (used for the viewer check)
//   PR-0198 SUBMITTED — the bounce-back: 2 units, thread SUBMIT -> IT_REVIEW
//     -> REQUEST_INFO ("Unit 02: quote exceeds standing rate…")
//   PR-0195 IT_REVIEWED — 1 APPROVED unit ("Wireless headsets")
//   PR-0188 COMPLETED · PR-0183 CANCELLED — untouched by this file
// Rows never reference raw cuids: the DB can be reseeded between runs and ids
// are cuids that change on every seed.

// Spec files share one database and run in alphabetical order — each file
// reseeds so no file inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("purchases — ?state= tab contract & sidebar", () => {
  test("tabs write ?state=; the sidebar's By status links share the same highlight", async ({ page }) => {
    // The sidebar only renders at the lg: breakpoint.
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");

    const main = page.locator("main");
    const sidebar = page.getByRole("navigation", { name: "Workspace" });

    // fresh seed: exactly one SUBMITTED request (PR-0198)
    await expect(main.getByRole("link", { name: /^Awaiting IT/ })).toContainText("1");

    await main.getByRole("link", { name: /^Awaiting IT/ }).click();
    await expect(page).toHaveURL(/state=SUBMITTED/);
    await expect(main.getByRole("link", { name: /^Awaiting IT/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PR-0198/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PR-0201/ })).toHaveCount(0); // DRAFT, not SUBMITTED

    // The sidebar's "By status" link targets the identical ?state= contract
    // and lands on the same tab — both light up together.
    await sidebar.getByRole("link", { name: "Awaiting finance" }).click();
    await expect(page).toHaveURL(/state=IT_REVIEWED/);
    await expect(sidebar.getByRole("link", { name: "Awaiting finance" })).toHaveAttribute("aria-current", "page");
    await expect(main.getByRole("link", { name: /^Awaiting finance/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PR-0195/ })).toBeVisible();
  });
});

test.describe("purchases — list dwell line", () => {
  test("PR-0198's row reads back from finance", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await expect(page.getByRole("row", { name: /PR-0198/ })).toContainText("back from finance");
  });
});

test.describe("purchases — empty states", () => {
  test("a filter matching nothing offers Clear filters back to /purchases", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases?q=zzz-no-such-request-zzz");
    await expect(page.getByText("No request matches this filter")).toBeVisible();

    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/purchases$/);
    await expect(page.getByRole("row", { name: /PR-0198/ })).toBeVisible(); // back to the full list
  });
});

test.describe("purchases — bounce-back centrepiece (PR-0198)", () => {
  test("banner names finance, quotes the reason, shows the honest transition and the loop; thread is oldest-first", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("heading", { name: "PR-0198" })).toBeVisible();

    // scoped past Next.js's own (empty, always-present) role="alert" route
    // announcer — see the identical note in auth-shell.spec.ts.
    const banner = page.getByRole("alert").filter({ hasText: "sent this back" });
    await expect(banner).toContainText("Finance sent this back — L. Domingo");
    await expect(banner).toContainText("Unit 02: quote exceeds standing rate — attach vendor quote.");
    await expect(banner).toContainText("IT_REVIEWED → SUBMITTED · nothing was cleared");
    await expect(banner.getByRole("link", { name: "Jump to unit 02" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Reply in thread" })).toBeVisible();

    const stepper = page.getByRole("list", { name: "Request progress" });
    await expect(stepper).toContainText("NOW · 2nd time");
    await expect(stepper).toContainText("← sent back");

    // The three-party thread renders oldest-first: SUBMIT (purchasing) -> IT_REVIEW (IT) -> REQUEST_INFO (finance).
    const notes = page.locator("#thread").getByRole("listitem");
    await expect(notes).toHaveCount(3);
    await expect(notes.nth(0)).toContainText("A. Reyes");
    await expect(notes.nth(0)).toContainText("SUBMITTED");
    await expect(notes.nth(1)).toContainText("J. Sarmiento");
    await expect(notes.nth(1)).toContainText("IT REVIEW");
    await expect(notes.nth(2)).toContainText("L. Domingo");
    await expect(notes.nth(2)).toContainText("SENT BACK");
  });
});

// Runs here, before the IT/finance serial block below mutates PR-0198, so
// "the bounced one" scanned for a11y is still actually bounced back.
test.describe("purchases — axe", () => {
  test("list, new, the bounced detail page, activity — no serious/critical violations", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases");
    await expectNoSeriousAxe(page);

    await page.goto("/purchases/new");
    await expectNoSeriousAxe(page);

    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("heading", { name: "PR-0198" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.goto("/purchases/activity");
    await expectNoSeriousAxe(page);
  });
});

test.describe("purchases — drafting, autosave, submit", () => {
  test("fill a line, autosave saves it, centavos survive the Decimal(12,2) round trip, then submit", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/new");

    await page.getByLabel("Line 1 description").fill("Wireless mice");
    await page.getByLabel("Line 1 quantity").fill("3");
    await page.getByLabel("Line 1 unit price").fill("18500.50");

    await expect(page.getByText(/DRAFT · SAVED \d{2}:\d{2}/)).toBeVisible({ timeout: 10_000 });

    // Scoped by visible text (PR-####), not just an "/purchases/" href prefix
    // — the sidebar's "Register purchase" link (/purchases/new) also matches
    // that prefix and would otherwise win as the first DOM match.
    const refLink = page.getByRole("link", { name: /^PR-\d{4}$/ });
    const refNo = (await refLink.textContent())?.trim();
    const href = await refLink.getAttribute("href");
    const id = href?.replace("/purchases/", "");
    expect(id).toBeTruthy();

    // Reload through the DRAFT edit form: its price input is populated
    // straight from what Postgres holds, so if the centavos survived the
    // Decimal(12,2) round trip they show up here as exactly "18500.5" — not
    // "18500" (truncated) and not "18500.4999…" (float drift).
    await page.goto(`/purchases/${id}/edit`);
    await expect(page.getByLabel("Line 1 unit price")).toHaveValue("18500.5");

    await page.getByRole("button", { name: "Submit for IT review" }).click();
    await page.waitForURL(new RegExp(`/purchases/${id}$`));
    await expect(page.getByRole("heading", { name: refNo })).toBeVisible();
    await expect(page.locator("main header").first()).toContainText("SUBMITTED");
  });
});

test.describe("purchases — unpriced line refused", () => {
  test("submitting with an unpriced line is refused client-side", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/purchases/new");

    await page.getByLabel("Line 1 description").fill("Docking stations");
    // price deliberately left blank
    await page.getByRole("button", { name: "Submit for IT review" }).click();

    await expect(
      page.getByText("Every line needs a price — IT review sharpens specs, it doesn't invent budgets."),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/purchases\/new$/); // never left the form
  });
});

// Tests 7–9 hand work to each other: this one moves PR-0198 SUBMITTED ->
// IT_REVIEWED, and the "finance completes" test later in this block acts on
// that same now-IT_REVIEWED PR-0198. The "finance bounces one back" test
// operates on the independently-seeded PR-0195, but stays in this same
// serial block per the task brief so nobody parallelizes or reorders this
// three-party chain by accident.
test.describe("purchases — IT review, finance bounce-back, finance completes", () => {
  test.describe.configure({ mode: "serial" });

  test("IT edits a unit's IT slot note on PR-0198; saving does not transition; then marks it reviewed", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("heading", { name: "PR-0198" })).toBeVisible();

    // Unit 1 ("27-inch monitors") has no IT slot note yet in the seed.
    const unit1 = page.locator("#unit-1");
    await unit1.getByLabel("IT slot note").fill("Wall-mount kit needed for the 27s.");
    await unit1.getByRole("button", { name: "Save line" }).click();
    await expect(unit1).toContainText("IT: Wall-mount kit needed for the 27s.");

    // Saving a line is NOT a transition — "Mark IT-reviewed" only renders
    // while the request is still SUBMITTED, so its continued presence here
    // IS the proof the state didn't move.
    await expect(page.getByRole("button", { name: "Mark IT-reviewed" })).toBeVisible();

    await page.getByRole("button", { name: "Mark IT-reviewed" }).click();
    await expect(page.locator("main header").first()).toContainText("IT_REVIEWED");
    await expect(page.getByRole("button", { name: "Mark IT-reviewed" })).toHaveCount(0);
  });

  test("finance bounces PR-0195 back via Request more info; the already-APPROVED unit keeps its state", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0195" }).click();
    await expect(page.getByRole("heading", { name: "PR-0195" })).toBeVisible();
    await expect(page.locator("#unit-1")).toContainText("APPROVED");

    await page.getByRole("button", { name: "Request more info" }).click();
    const dialog = page.getByRole("dialog", { name: "Request more info" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason").fill("e2e: vendor quote missing for the headset batch.");
    await dialog.getByRole("button", { name: "Request more info" }).click();

    const banner = page.getByRole("alert").filter({ hasText: "sent this back" });
    await expect(banner).toContainText("Finance sent this back — L. Domingo");
    await expect(banner).toContainText("e2e: vendor quote missing for the headset batch.");
    await expect(banner).toContainText("IT_REVIEWED → SUBMITTED · nothing was cleared");

    // Nothing was cleared: the unit finance already approved stays APPROVED.
    await expect(page.locator("#unit-1")).toContainText("APPROVED");
    await expect(page.locator("main header").first()).toContainText("SUBMITTED");
  });

  test("finance completes PR-0198", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("heading", { name: "PR-0198" })).toBeVisible();
    await expect(page.locator("main header").first()).toContainText("IT_REVIEWED");

    await page.getByRole("button", { name: "Complete" }).click();
    await expect(page.locator("main header").first()).toContainText("COMPLETED");

    await page.goto("/purchases?state=COMPLETED");
    await expect(page.getByRole("row", { name: /PR-0198/ })).toBeVisible();
  });
});

test.describe("purchases — viewer is read-only", () => {
  test("no New request, no transition buttons, no comment box; READ-ONLY badge shows", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/purchases");
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("link", { name: "New request" })).toHaveCount(0);

    await page.getByRole("link", { name: "PR-0201" }).click();
    await expect(page.getByRole("heading", { name: "PR-0201" })).toBeVisible();
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();

    // RequestActions (Edit draft, every transition button) is omitted
    // entirely for a viewer — not merely disabled.
    await expect(page.locator("main header").first().getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);

    // The thread's composer is gated the same way.
    await expect(page.getByLabel("Add a comment")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post comment" })).toHaveCount(0);
  });
});

test.describe("purchases — audit trail", () => {
  test("/purchases/activity shows a purchase sentence; /audit resolves entries to PR-#### links", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/purchases/activity");
    await expect(page.getByRole("heading", { name: "Purchasing activity" })).toBeVisible();
    await expect(page.locator("ol")).toContainText(/PR-\d{4}/);

    await page.goto("/audit?entity=purchase-request");
    await expect(page).toHaveURL(/entity=purchase-request/);
    const table = page.locator("table");
    await expect(table.getByRole("link", { name: /^PR-\d{4}$/ }).first()).toBeVisible();
  });
});
