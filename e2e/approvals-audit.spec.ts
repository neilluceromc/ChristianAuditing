import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login (see
  // src/app/logout/route.ts) — going there directly, rather than /login,
  // keeps this helper safe to call a second time mid-test to switch users.
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

/**
 * Keyboard contract lives on the focusable queue wrapper (role="group",
 * queue-table.tsx). Focus it first, then dispatch real key presses — this
 * mirrors how a keyboard-only approver actually clears the queue, rather
 * than calling the server actions directly.
 */
async function pressInQueue(page: Page, ...keys: string[]) {
  const group = page.getByRole("group", { name: /Approval queue/ });
  await group.focus();
  for (const key of keys) await group.press(key);
}

// Seeded refNos this file depends on (see prisma/seed.ts):
//   APR-2041 PENDING NORMAL   — lifecycle.assign BR-LT-0181 -> Nina Robles (EMP-0097)
//   APR-2040 PENDING URGENT   — overdue, lifecycle.return (Dennis Ong)
//   APR-2039 CLAIMED (admin@) — lifecycle.change-status on BR-LT-0148
//   APR-2035 APPROVED         — malformed payload, queued Job (worker demo of EXECUTION_FAILED)
//   APR-2025 EXECUTION_FAILED — seeded verbatim workerError
//   APR-2031 EXECUTED / APR-2028 REJECTED — terminal, untouched by this file
// Rows never reference raw ids: the DB can be reseeded by a background
// process between runs, and ids are cuids that change on every seed.

// Spec files share one database and run in alphabetical order — each file
// reseeds so no file inherits another's mutations (approvals-audit deploys
// BR-LT-0181 and drains the badge, which broke auth-shell/it-core).
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("approvals — tabs & URL contract", () => {
  test("?tab= round-trips; fresh-seed counts render", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    const tabsNav = page.getByRole("navigation", { name: "Queue tabs" });

    await expect(tabsNav.getByRole("link", { name: "Open" })).toHaveAttribute("aria-current", "page");
    await expect(tabsNav.getByRole("link", { name: "Open" })).toContainText("3");
    await expect(tabsNav.getByRole("link", { name: "Mine" })).toContainText("0");
    await expect(tabsNav.getByRole("link", { name: "Unclaimed" })).toContainText("2");
    await expect(tabsNav.getByRole("link", { name: "Failed" })).toContainText("1");
    await expect(tabsNav.getByRole("link", { name: "Closed" })).toContainText("2");

    await tabsNav.getByRole("link", { name: "Unclaimed" }).click();
    await expect(page).toHaveURL(/tab=unclaimed/);
    await expect(tabsNav.getByRole("link", { name: "Unclaimed" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /APR-2041/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /APR-2039/ })).toHaveCount(0); // CLAIMED, not unclaimed

    await page.goto("/approvals?tab=closed");
    await expect(tabsNav.getByRole("link", { name: "Closed" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /APR-2031/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /APR-2028/ })).toBeVisible();
  });
});

test.describe("approvals — finance read-only", () => {
  test("finance@ sees the queue read-only: no keyboard hint, no Claim on a PENDING detail", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/approvals");
    await expect(page.getByText("READ-ONLY · FINANCE STAFF")).toBeVisible();
    await expect(page.getByRole("group", { name: /Approval queue/ })).toBeVisible();
    await expect(page.getByText("J/K move")).toHaveCount(0);

    await page.getByRole("link", { name: "APR-2041" }).click();
    // Headroom, and the URL awaited separately from the heading (§7). This is
    // the FIRST hit of /approvals/[id] in the suite, so the click covers a cold
    // compile; it began failing as "the heading never arrived" once Phase 9's
    // added routes pushed the full run from 7.5 to 10 minutes. Splitting the
    // two assertions is what makes a real failure say which half broke rather
    // than blaming the heading for a navigation that never happened.
    await expect(page).toHaveURL(/\/approvals\/[^/]+$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "APR-2041" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
  });
});

// The lifecycle thread: state mutations depend on the order these tests run
// in, so this is ONE serial block (order-dependent state per the task brief).
test.describe.serial("approvals lifecycle — it@", () => {
  test("APR-2041 detail before claim: Claim/Reject/Escalate visible, Approve absent", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    await page.getByRole("link", { name: "APR-2041" }).click();
    await expect(page.getByRole("heading", { name: "APR-2041" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Escalate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("escalate APR-2041 from the queue keyboard — priority pill HIGH", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    // Open tab orders by slaAt ascending: APR-2040 (overdue) · APR-2039 (in
    // 24h) · APR-2041 (in 2d) — two "j" presses from the default focus (row 0)
    // lands on APR-2041.
    await pressInQueue(page, "j", "j", "e");
    const row = page.getByRole("row", { name: /APR-2041/ });
    await expect(row).toContainText("HIGH");
    await expect(row).toContainText("PENDING");
  });

  test("keyboard claim + approve: c claims (owner J. Sarmiento), a approves (row leaves, badge decrements)", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    const sidebarBadge = page.locator('nav[aria-label="Workspace"] a[href="/approvals"] span[aria-label*="open approval"]');
    await expect(sidebarBadge).toHaveText("3");

    await pressInQueue(page, "j", "j", "c");
    await expect(page.getByText("APR-2041 claimed")).toBeVisible();
    // claim pulses the row (700ms) then router.refresh()s — the toContainText
    // assertion above already waited long enough for the refreshed owner cell.
    await expect(page.getByRole("row", { name: /APR-2041/ })).toContainText("J. Sarmiento");

    await pressInQueue(page, "a");
    await expect(page.getByText("APR-2041 approved")).toBeVisible();
    await expect(page.getByRole("row", { name: /APR-2041/ })).toHaveCount(0);
    await expect(sidebarBadge).toHaveText("2");
  });

  test("worker executes: APR-2041 -> EXECUTED, /inventory redirect + history, APR-2035 -> EXECUTION_FAILED", async ({ page }) => {
    execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });

    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals?tab=closed");
    await expect(page.getByRole("row", { name: /APR-2041/ })).toContainText("EXECUTED");

    await page.goto("/inventory?q=BR-LT-0181");
    // Scanner-contract redirect settles asynchronously — see the identical
    // comment in e2e/it-core.spec.ts's secrets test.
    await page.waitForURL(/\/inventory\/[^/?]+$/);
    const header = page.locator("main header").first();
    await expect(header).toContainText("DEPLOYED");
    await expect(page.getByText("held by Nina Robles")).toBeVisible();

    await page.goto(`${page.url()}/history`);
    // One row per changed field (status, assignee) for the worker's single audit entry.
    await expect(page.getByRole("row", { name: /lifecycle\.assign executed/ })).toHaveCount(2);

    await page.goto("/approvals?tab=failed");
    const tabsNav = page.getByRole("navigation", { name: "Queue tabs" });
    await expect(tabsNav.getByRole("link", { name: "Failed" })).toContainText("2");
    await expect(page.getByRole("row", { name: /APR-2035/ })).toContainText("EXECUTION_FAILED");
  });

  test("APR-2025 failed card shows the verbatim worker error + Retry/Reject", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals?tab=failed");
    await page.getByRole("link", { name: "APR-2025" }).click();
    await expect(page.getByRole("heading", { name: "APR-2025" })).toBeVisible();
    await expect(
      page.getByText("Execution guard: target employee EMP-0093 is OFFBOARDED — assignment refused"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("reject APR-2040 via the queue r dialog — lands in Closed as REJECTED", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    // APR-2040 is the most-overdue row — default focus (row 0) is already it.
    await pressInQueue(page, "r");
    const dialog = page.getByRole("dialog", { name: "Reject APR-2040?" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason").fill("e2e: duplicate offboarding return request");
    await dialog.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText("APR-2040 rejected")).toBeVisible();

    await page.goto("/approvals?tab=closed");
    await expect(page.getByRole("row", { name: /APR-2040/ })).toContainText("REJECTED");
  });
});

test.describe("audit log", () => {
  test("rows render; entity facet filters; zero checkboxes/buttons in the table; q narrows", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/audit");
    const table = page.locator("table");
    await expect(page.getByRole("link", { name: "BR-LT-0148" }).first()).toBeVisible();
    // The audit log's absence of interaction IS the design (README 3g) — the
    // only clickable things in a row are entity links. The Entity facet
    // button and its Apply/Clear controls live in the toolbar, outside <table>.
    await expect(table.getByRole("checkbox")).toHaveCount(0);
    await expect(table.getByRole("button")).toHaveCount(0);

    await page.getByRole("button", { name: "Entity" }).click();
    await page.getByRole("dialog", { name: "Filter by Entity" }).getByLabel("Approval").check();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/entity=approval/);
    await expect(page.getByRole("link", { name: /entity: Approval/i })).toBeVisible();
    await expect(table.getByText("ASSET", { exact: true })).toHaveCount(0);

    await page.goto("/audit");
    await page.getByLabel("Search audit log").fill("SECRET_READ");
    await page.getByLabel("Search audit log").press("Enter");
    await expect(page).toHaveURL(/q=SECRET_READ/);
    await expect(page.getByText("1 entry")).toBeVisible();
    await expect(page.getByRole("row", { name: /SECRET_READ/ })).toBeVisible();
  });
});

test.describe("activity feeds", () => {
  test("/inventory/activity shows the worker's executed sentence; no domain pill", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/activity");
    const feed = page.locator("ol");
    await expect(feed.getByText("worker lifecycle.assign executed BR-LT-0181")).toBeVisible();
    // domain pill only ever renders on cross-domain feeds (Home, Phase 6) —
    // a scoped feed like this one never sets `domain`, so neither word appears.
    await expect(feed).not.toContainText(/\basset\b/i);
    await expect(feed).not.toContainText(/\bemployee\b/i);
  });

  test("/employees/activity renders", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees/activity");
    await expect(page.getByRole("heading", { name: "Employee activity" })).toBeVisible();
  });
});

test.describe("axe", () => {
  test("approvals queue, one detail page, audit, inventory activity — no serious/critical violations", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    await expectNoSeriousAxe(page);

    // APR-2039 is untouched by the lifecycle thread above — a stable pick
    // for a detail-page scan regardless of this file's run order.
    await page.getByRole("link", { name: "APR-2039" }).click();
    await expectNoSeriousAxe(page);

    await page.goto("/audit");
    await expectNoSeriousAxe(page);

    await page.goto("/inventory/activity");
    await expectNoSeriousAxe(page);
  });
});
