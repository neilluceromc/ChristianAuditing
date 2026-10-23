import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { E2E_BASE_URL } from "../playwright.config";
import { login, submitSignIn } from "./fixtures/login";

// Phase 27, Task 6: the reference-name cases at the foot of this file read and
// restore rows directly, so this file gains the client every other spec that
// touches the database already carries.
const db = new PrismaClient();

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-nav.spec.ts:88-97 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

// Spec files share one database and run alphabetically — each reseeds so no file
// inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

/**
 * Users & access (Task 5): rewritten for the new page. Roles change through the details panel's radio cards and its
 * Save bar, accounts turn off through the "Account active" switch and its inline confirm, and the permanent admin's
 * panel offers nothing that would be refused. The old table's comboboxes, Disable buttons, "is already" toasts and
 * "Change your own role?" dialog are gone (the setUserRole action with them). The flows themselves are
 * e2e/access-management.spec.ts; this keeps what this file always proved, on the new controls.
 */
async function openUserPanel(page: Page, name: string) {
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Users & access", level: 1 })).toBeVisible({ timeout: 20_000 });
  const row = page.locator("tr[data-user-row]").filter({ hasText: name });
  await waitForHydration(row);
  await row.click();
  const panel = page.getByRole("complementary", { name: `${name}'s details` });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}

test.describe.serial("users & access", () => {
  test.beforeEach(async ({ page }) => {
    // Side by side (1180 px and wider): the details sit beside the list as a complementary region.
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("the permanent admin is locked before the click, not on save", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    // First hit of this route in the suite — give the cold JIT compile headroom.
    await expect(page.getByRole("heading", { name: "Users & access", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    const permanent = page.locator("tr[data-user-row]").filter({ hasText: "System Admin" });
    await expect(permanent).toContainText("Permanent");
    const panel = await openUserPanel(page, "System Admin");
    // The reason is in the panel, and the affordances are ABSENT or disabled: nothing is refused on save.
    await expect(panel.getByRole("paragraph").filter({ hasText: "The permanent admin's account can only be changed by its owner." }))
      .toBeVisible();
    for (const radio of await panel.getByRole("radio").all()) await expect(radio).toBeDisabled();
    await expect(panel.getByRole("switch", { name: "Account active" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Reset password…" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Edit name and email" })).toHaveCount(0);
  });

  test("an ordinary role change is audited by name", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    const panel = await openUserPanel(page, "V. Cruz");
    await panel.getByRole("radio", { name: /^IT staff/ }).check();
    await panel.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("V. Cruz is now IT staff · signed out")).toBeVisible({ timeout: 20_000 });

    await page.goto("/audit");
    const row = page.getByRole("row", { name: /role-change/ }).first();
    // entityLabels must resolve a user id to a NAME, not a truncated cuid.
    await expect(row).toContainText("V. Cruz");
  });

  test("turning an account off blocks sign-in", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    const panel = await openUserPanel(page, "V. Cruz");
    await panel.getByRole("switch", { name: "Account active" }).click();
    await panel.getByRole("button", { name: "Turn off account", exact: true }).click();
    await expect(page.getByText("V. Cruz's account is off · signed out")).toBeVisible({ timeout: 20_000 });

    await page.goto("/logout");
    await submitSignIn(page, "viewer@thebackroomop.com");
    // Still on /login: a turned-off account is refused, with the same words as a wrong password.
    await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription(
      /Wrong email or password — or the account is disabled\./,
      { timeout: 20_000 },
    );
    await expect(page).toHaveURL(/\/login/);
  });

  test("an unchanged draft offers no Save and writes no audit entry", async ({ page }) => {
    // The old table's no-op path ("is already IT staff") is gone: Save shows only while a field differs. Proven
    // against the one place a written audit entry would show up, the /audit page's rows for V. Cruz.
    await login(page, "admin@thebackroomop.com");
    await page.goto("/audit?entity=user");
    const before = await page.getByRole("row", { name: /V\. Cruz/ }).count();

    const panel = await openUserPanel(page, "V. Cruz");
    const bar = panel.getByRole("region", { name: "Unsaved changes" });
    await expect(bar).toHaveCount(0);
    // V. Cruz is IT staff (two tests ago): pick another role, then the same one back.
    await panel.getByRole("radio", { name: /^Finance staff/ }).check();
    await expect(bar).toBeVisible();
    await panel.getByRole("radio", { name: /^IT staff/ }).check();
    await expect(bar).toHaveCount(0);

    await page.goto("/audit?entity=user");
    await expect(page.getByRole("row", { name: /V\. Cruz/ })).toHaveCount(before);
  });

  test("a self role change is warned about before it happens, and signs the actor out", async ({ page }) => {
    // The seeded `admin@` account is the permanent admin, whose panel is locked, so it cannot exercise this path.
    // Promote `it@` to admin first, then act as that ordinary admin for the self-change.
    await login(page, "admin@thebackroomop.com");
    let panel = await openUserPanel(page, "J. Sarmiento");
    await panel.getByRole("radio", { name: /^Admin/ }).check();
    await panel.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("J. Sarmiento is now Admin · signed out")).toBeVisible({ timeout: 20_000 });

    await login(page, "it@thebackroomop.com");
    panel = await openUserPanel(page, "J. Sarmiento");
    await panel.getByRole("radio", { name: /^IT staff/ }).check();
    // The warning is inline, under the role cards, before Save.
    await expect(panel.getByText("You're changing your own role — you'll be signed out and will need to sign back in as IT staff."))
      .toBeVisible();
    await panel.getByRole("region", { name: "Unsaved changes" }).getByRole("button", { name: "Save", exact: true }).click();

    // The refresh re-runs requireUser, which finds the JWT's frozen role no longer matches the DB and sends the
    // document to /logout — the one path where a change to your own account ends your own session.
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await submitSignIn(page, "it@thebackroomop.com");
    // Finance follow-up (spec §7.1): every sign-in lands on Home.
    await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 20_000 });
  });
});

test.describe("feature flags", () => {
  test("the SSO flag cannot be switched on, and says why", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/flags");
    await expect(page.getByRole("heading", { name: "Feature flags" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    // exact:true — the page's own explanatory banner ALSO uses the word
    // "UNAVAILABLE" in a sentence ("A flag marked UNAVAILABLE is one whose
    // feature isn't finished..."), so an unscoped substring match is a
    // strict-mode violation once both that paragraph and the chip exist.
    await expect(page.getByText("UNAVAILABLE", { exact: true })).toBeVisible();
    await expect(page.getByText(/no role attached/)).toBeVisible();
    await expect(page.getByRole("switch", { name: /Microsoft 365 sign-in/ })).toBeDisabled();
  });

  test("the domain value is normalised and refuses an address", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/flags");
    await expect(page.getByRole("heading", { name: "Feature flags" })).toBeVisible({ timeout: 20_000 });
    const field = page.getByRole("textbox", { name: /Value for Signup domain restriction/ });
    // The input is controlled — `draft` in flag-rows.tsx is seeded from
    // `row.value` on mount. Typing before hydration attaches gets silently
    // overwritten the moment React takes over (same race class as HANDOVER
    // §7's "✓ Saved" flash), and a fill() that lands in that window is lost
    // with no error — the next assertion would just see the pre-hydration
    // value and could pass for the wrong reason.
    //
    // Asserting the seeded value does NOT prove hydration has run, which is
    // what the first version of this guard assumed: the server-rendered HTML
    // already carries `value="thebackroomop.com"`, so that assertion passes
    // against the pre-hydration DOM. It is kept only as a cheap "the field
    // exists and is populated" check.
    await expect(field).toHaveValue("thebackroomop.com", { timeout: 20_000 });

    // So the fill is RETRIED until it sticks. `fill` writes the DOM; if React
    // hydrates afterwards it rebinds the input to `draft[row.key]` and the
    // typing is gone (§6a rule 61). There is no reliable "hydration finished"
    // signal to await on this page, and the previous shape — fill once, then
    // assert — correctly turned the lost keystroke into a failure but left the
    // test failing whenever it lost the race, which it now does regularly on a
    // dev server ten minutes into a full run. Retrying is headroom, not a
    // weaker assertion: the value must still end up in the field, and a fill
    // that can never stick still fails.
    await expect(async () => {
      await field.fill("someone@thebackroomop.com");
      await expect(field).toHaveValue("someone@thebackroomop.com");
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Just the domain, not a full address/)).toBeVisible({ timeout: 20_000 });

    // Not a same-domain case change: the seed stores allowed_domain's value as
    // exactly "thebackroomop.com" already, and setFlagValue treats a save that
    // normalises to the value already on the row as a no-op ("changed: false"
    // — see setFlagValue in flag-actions.ts). Re-typing the SAME domain in a
    // different case would silently hit that no-op branch and toast "is
    // already set to that value", not "updated" — the wrong assertion for
    // what this test is actually checking. A genuinely different domain,
    // still mixed-case, is what a real update AND normalisation both need.
    await field.fill("EXAMPLE.ORG");
    await expect(field).toHaveValue("EXAMPLE.ORG");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/Signup domain restriction updated/)).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(field).toHaveValue("example.org");

    // Deliberately left at "example.org" — not restored to
    // "thebackroomop.com" — for the rest of this file. Safe for two reasons:
    // authorize() (src/server/auth/actions.ts), the credentials path every
    // login() call in this file goes through, never reads allowed_domain at
    // all; and the Admin Overview's "Flags on" tile (adminOverview in
    // src/server/modules/home/overview.ts) reads only each flag's `enabled`
    // boolean, never its value. Nothing later in this file, or in any
    // later spec file (each one reseeds), depends on this value.
  });
});

test.describe("webhooks", () => {
  test("a new endpoint shows its secret exactly once", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    const url = page.getByRole("textbox", { name: "New endpoint URL" });
    // Same controlled-input race as the flags domain field: NewEndpointCard's
    // `url` state starts at "" on mount, so proving that starting value
    // first is what stands between hydration silently eating a fill() and a
    // failure that actually says so.
    await expect(url).toHaveValue("");
    await url.fill("https://example.test/hook");
    await expect(url).toHaveValue("https://example.test/hook");
    await page.getByRole("checkbox", { name: /New endpoint: An approval finished executing/ }).check();
    await page.getByRole("button", { name: "Create endpoint" }).click();

    await expect(page.getByText(/Copy this signing secret now/)).toBeVisible({ timeout: 20_000 });
    // Reload: the secret is gone for good, which is the design.
    await page.reload();
    await expect(page.getByText(/Copy this signing secret now/)).toHaveCount(0);
  });

  test("an endpoint with no events is refused where the operator is looking", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks");
    await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible({ timeout: 20_000 });
    const url = page.getByRole("textbox", { name: "New endpoint URL" });
    await expect(url).toHaveValue("");
    await url.fill("https://example.test/none");
    await expect(url).toHaveValue("https://example.test/none");
    await page.getByRole("button", { name: "Create endpoint" }).click();
    await expect(page.getByText(/Pick at least one event/)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("delivery attempts", () => {
  test("every chip the seed can produce renders, and replay only offers live endpoints", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks/deliveries");
    await expect(page.getByRole("heading", { name: "Delivery attempts" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    // Scoped to the table: "DELIVERED" is also a substring of the "Delivered"
    // TAB link's own text, and Playwright's getByText is a case-insensitive
    // substring match by default — unscoped, .first() could grab the tab.
    const table = page.getByRole("table");
    await expect(table.getByText("DEAD · 5/5").first()).toBeVisible();
    await expect(table.getByText("RETRYING · 2/5")).toBeVisible();
    await expect(table.getByText("DELIVERED").first()).toBeVisible();
    await expect(table.getByText("500 Internal Server Error")).toBeVisible();

    // One, not two: the other dead row belongs to the DISABLED endpoint.
    await expect(page.getByRole("button", { name: /Replay 1 dead-lettered/ })).toBeVisible();

    await page.getByRole("link", { name: "Dead-lettered" }).click();
    await expect(page).toHaveURL(/state=DEAD/);
    await expect(page.getByRole("row", { name: /erp-bridge/ }).getByRole("button", { name: "Replay" }))
      .toHaveCount(0);
  });

  test("a replayed delivery loses its Replay control, not just its click", async ({ page }) => {
    // The draft this spec started from expected clicking Replay a SECOND time
    // on the queued row to surface "already queued". That control never
    // renders in the first place: Task 13 (the plan's amended §6a rule 56)
    // established that a delivery holding a live DELIVER_WEBHOOK job must not
    // offer a Replay button at all, because Job_one_live_deliver_per_delivery
    // guarantees the click would P2002. listDeliveries folds that fact into
    // `replayable` via replayBlockedReason's `alreadyQueued` check, so the
    // real guarantee here is refusal by ABSENCE of the control — the "already
    // queued" conflict message still exists in replayDelivery for the genuine
    // race, but there is no click path left in the UI that reaches it.
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks/deliveries?state=DEAD");
    const table = page.getByRole("table");
    const live = table.getByRole("row", { name: /hooks\.thebackroomop\.com/ });
    await live.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByText(/Queued for another attempt/)).toBeVisible({ timeout: 20_000 });

    // The partial unique index plus the absent control are what make a
    // second replay impossible — not a refusal the operator has to trigger.
    await page.goto("/admin/webhooks/deliveries?state=PENDING");
    const queued = page.locator("tbody tr", { hasText: "hooks.thebackroomop.com" }).filter({ hasText: "QUEUED" });
    await expect(queued).toHaveCount(1);
    await expect(queued.getByRole("button", { name: "Replay" })).toHaveCount(0);
  });
});

test.describe("admin home", () => {
  test("the body matches its own sidebar", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    // The admin role holds four workspaces; br.dept selects which one Home renders.
    await page.context().addCookies([
      { name: "br.dept", value: "admin", url: E2E_BASE_URL },
    ]);
    await page.goto("/");
    // Phase 46 (spec §3.2): the Admin Overview — its own six tiles and panels.
    await expect(page.locator('[data-kpi="admin.activeUsers"]')).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    await expect(page.locator("[data-kpis] > [data-kpi]")).toHaveCount(6);
    for (const heading of ["Needs you", "Direct changes per day", "Webhook deliveries · 7 days", "Accounts by role"]) {
      await expect(page.getByRole("heading", { name: heading, level: 2 }), heading).toBeVisible();
    }
    // What is switched on: "x of y", and this build's unavailable flag named in the hint.
    await expect(page.locator('[data-kpi="flags.on"] [data-kpi-value]')).toHaveText(/^\d+ of \d+$/);
    await expect(page.locator('[data-kpi="flags.on"]')).toContainText("unavailable in this build");
    // The IT Home's sections must NOT be here — that was the bug.
    await expect(page.locator('[data-kpi="it.spare"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fleet by status", level: 2 })).toHaveCount(0);
  });
});

/**
 * Phase 27 (spec §4.2, Task 6): reference names are unique whatever the case.
 * The create template is e2e/it-core.spec.ts's "reference data" test, the
 * rename-with-cleanup template e2e/it-nav.spec.ts case 13 — neither lived in
 * this file before. A refused create writes nothing, so only the rename case
 * needs a `finally`; the rename's own audit row stays (append-only, R3).
 *
 * The error slot is matched as `p[role="alert"]`, not `getByRole("alert")`:
 * Next.js renders its own always-present, always-empty
 * `<div role="alert" id="__next-route-announcer__">` on every page, so the
 * role alone is ambiguous. Both error slots in play here — ref-table.tsx's
 * inline paragraph and `FormError` — are `<p role="alert">`.
 */
test.describe("reference names are unique whatever the case (Phase 27)", () => {
  test("a category that differs only by case is refused, naming the existing row", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    const input = page.getByLabel("New category name");
    await waitForHydration(input);
    await input.fill("laptop");
    await input.press("Enter");
    await expect(page.locator('p[role="alert"]')).toHaveText('That name is already taken by "Laptop"', { timeout: 10_000 });
    // NOT `getByRole("row", { name: /^laptop/ })`: the refused text is still
    // sitting in the add row's own `<input>`, and an input's VALUE counts
    // towards its row's accessible name — that locator matches the form row
    // whether or not anything was written. The refusal writes nothing, and the
    // table is what proves it:
    expect(await db.assetCategory.count({ where: { name: "laptop" } })).toBe(0);
  });

  test("renaming a row to its own name in another case is a rename, not a clash", async ({ page }) => {
    const headset = await db.assetCategory.findFirstOrThrow({ where: { name: "Headset" } });
    try {
      await login(page, "admin@thebackroomop.com");
      await page.goto("/admin/asset-categories");
      const actions = page.getByRole("button", { name: "Actions for Headset" });
      await waitForHydration(actions);
      await actions.click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      // The rename input only exists once the menu item has opened it; Enter is
      // ref-table.tsx's save gesture (blur cancels).
      const input = page.getByLabel("Rename Headset");
      await input.fill("HEADSET");
      await input.press("Enter");
      await expect(page.getByText("HEADSET", { exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
      await db.assetCategory.update({ where: { id: headset.id }, data: { name: "Headset" } });
    }
  });

  // Phase 37 (spec 2.2): the Departments & clients page. Rows created here are removed in `finally`;
  // their audit entries stay (R3).
  test("an internal department: clash, add, rename, archive, restore", async ({ page }) => {
    const stamp = Date.now();
    const name = `E2E Dept ${stamp}`;
    const renamed = `${name} B`;
    try {
      await login(page, "admin@thebackroomop.com");
      await page.goto("/admin/departments");
      const tab = page.getByRole("tab", { name: /Internal departments/ });
      await waitForHydration(tab);
      await tab.click();
      await page.getByRole("button", { name: "+ Add department" }).click();
      const input = page.getByLabel("Name for the new department");

      // the clash is case-insensitive and across both kinds; Add stays disabled
      await input.fill("hr");
      await expect(page.locator('p[role="alert"]')).toHaveText("A department or client with that name already exists");
      await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();

      await input.fill(name);
      await expect(page.getByText("Next: set up its equipment policy")).toBeVisible();
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toContainText("Internal department", { timeout: 10_000 });

      await page.getByRole("button", { name: `Rename ${name}` }).click();
      const rename = page.getByLabel(`New name for ${name}`);
      await rename.fill(renamed);
      await rename.press("Enter");
      await expect(page.getByRole("row").filter({ hasText: renamed })).toBeVisible({ timeout: 10_000 });

      // archive: leaves Active, shows under Archived
      await page.getByRole("button", { name: `Archive ${renamed}` }).click();
      await expect(page.getByRole("row").filter({ hasText: renamed })).toHaveCount(0, { timeout: 10_000 });
      await page.getByRole("button", { name: /^Archived/ }).click();
      await expect(page.getByRole("row").filter({ hasText: renamed })).toContainText("Archived ");

      // restore
      await page.getByRole("button", { name: `Restore ${renamed}` }).click();
      await expect(page.getByRole("row").filter({ hasText: renamed })).toHaveCount(0, { timeout: 10_000 });
      await page.getByRole("button", { name: /^Active/ }).click();
      await expect(page.getByRole("row").filter({ hasText: renamed })).toContainText("Internal department");
    } finally {
      await db.department.deleteMany({ where: { name: { in: [name, renamed] } } });
    }
  });

  test("a client starts with no policy and links to set one up", async ({ page }) => {
    const name = `E2E Client ${Date.now()}`;
    try {
      await login(page, "admin@thebackroomop.com");
      await page.goto("/admin/departments");
      const add = page.getByRole("button", { name: "+ Add client" });
      await waitForHydration(add);
      await add.click();
      await page.getByLabel("Name for the new client").fill(name);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toContainText("Client account", { timeout: 10_000 });
      await expect(row).toContainText("No policy");
      await expect(row.getByRole("link", { name: /Set one up/ })).toHaveAttribute("href", /group=/);
    } finally {
      await db.department.deleteMany({ where: { name } });
    }
  });
});
