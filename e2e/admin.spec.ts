import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";

async function login(page: Page, email: string) {
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

// Spec files share one database and run alphabetically — each reseeds so no file
// inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe.serial("users & roles", () => {
  test("the permanent admin is locked before the click, not on save", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    // First hit of this route in the suite — give the cold JIT compile headroom.
    await expect(page.getByRole("heading", { name: "Users & roles" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    const permanent = page.getByRole("row", { name: /System Admin/ });
    await expect(permanent).toContainText("LOCKED");
    await expect(permanent).toContainText("permanent");
    // The affordance is ABSENT, which is the whole point of the card.
    await expect(permanent.getByRole("combobox")).toHaveCount(0);
    await expect(permanent.getByRole("button", { name: /Disable/ })).toHaveCount(0);
    // The full reason lives in the caption BELOW the table, not squeezed into
    // a 170px cell (user-table.tsx's own comment on permanentLockCaption).
    await expect(page.getByText(/permanent admin account/)).toBeVisible();
  });

  test("an ordinary role change is audited by name", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    await page.getByRole("combobox", { name: "Role for V. Cruz" }).selectOption("it_staff");
    await expect(page.getByText(/V. Cruz is now IT staff/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/audit");
    const row = page.getByRole("row", { name: /role-change/ }).first();
    // entityLabels must resolve a user id to a NAME, not a truncated cuid.
    await expect(row).toContainText("V. Cruz");
  });

  test("disabling a user blocks sign-in", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    await page.getByRole("row", { name: /V. Cruz/ }).getByRole("button", { name: "Disable" }).click();
    await expect(page.getByText(/V. Cruz is disabled/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/logout");
    await page.getByLabel(/Email/).fill("viewer@thebackroomop.com");
    await page.getByLabel(/Password/).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Still on /login: authorize() refuses a disabled user.
    await expect(page).toHaveURL(/\/login/);
  });

  test("the no-op save writes no audit entry", async ({ page }) => {
    // `changed: false` is a claim about the action with no unit-test coverage
    // for this exact path (the pure rules are covered in admin-users.test.ts;
    // setUserRole is thin wiring over them) — proven here against the one
    // place a written audit entry would actually show up, rather than
    // trusting the "already ..." toast wording alone. Counting the /audit
    // page's own rows (filtered to entity=user, matching V. Cruz by name)
    // avoids reaching around the app into the database from the spec, and
    // the audit list is a faithful, unfiltered projection of AuditEntry for
    // this query — there's no narrower or more direct way to see the same
    // fact through the UI.
    await login(page, "admin@thebackroomop.com");
    await page.goto("/audit?entity=user");
    const before = await page.getByRole("row", { name: /V\. Cruz/ }).count();

    await page.goto("/admin/users");
    // V. Cruz is already `it_staff` (set two tests ago) — re-selecting the
    // same option still fires Playwright's change event, which is exactly
    // the "re-select an existing role" the no-op path needs to exercise.
    await page.getByRole("combobox", { name: "Role for V. Cruz" }).selectOption("it_staff");
    await expect(page.getByText(/V\. Cruz is already IT staff/)).toBeVisible({ timeout: 20_000 });

    await page.goto("/audit?entity=user");
    await expect(page.getByRole("row", { name: /V\. Cruz/ })).toHaveCount(before);
  });

  test("a self role change is warned about before it happens, and signs the actor out", async ({ page }) => {
    // The seeded `admin@` account is the permanent admin — roleChange refuses
    // ANY change to it outright, so it cannot exercise this path. Promote
    // `it@` to admin first (itself a setUserRole call worth asserting), then
    // act as that ordinary admin for the self-change.
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users");
    await page.getByRole("combobox", { name: "Role for J. Sarmiento" }).selectOption("admin");
    await expect(page.getByText(/J\. Sarmiento is now Admin/)).toBeVisible({ timeout: 20_000 });

    await login(page, "it@thebackroomop.com");
    await page.goto("/admin/users");
    await page.getByRole("combobox", { name: "Role for J. Sarmiento" }).selectOption("it_staff");

    const dialog = page.getByRole("dialog", { name: "Change your own role?" });
    await expect(dialog).toContainText("IT staff");
    await dialog.getByRole("button", { name: "Change role" }).click();

    // No toast survives this click: router.refresh() re-runs requireUser,
    // which finds the JWT's frozen role no longer matches the DB and
    // redirects the document to /logout — the one path in this phase where a
    // mutation ends the actor's own session.
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await page.getByLabel(/Email/).fill("it@thebackroomop.com");
    await page.getByLabel(/Password/).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/inventory/, { timeout: 20_000 });
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
    // all; and adminHome's "What is switched on" list (src/components/home/
    // admin-home.tsx) reads only the flag's `enabled` boolean via
    // flagEnabled, never its value. Nothing later in this file, or in any
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
      { name: "br.dept", value: "admin", url: "http://localhost:3000" },
    ]);
    await page.goto("/");
    await expect(page.getByText("Who can get in")).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    await expect(page.getByText("What is switched on")).toBeVisible();
    await expect(page.getByText("unavailable")).toBeVisible();
    // The IT Home's sections must NOT be here — that was the bug.
    await expect(page.getByText("Your shift")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fleet", level: 3 })).toHaveCount(0);
  });
});
