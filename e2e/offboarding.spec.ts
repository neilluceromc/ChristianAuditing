import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login, which keeps this
  // helper safe to call again mid-file to switch users.
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

// Seeded fixtures this file depends on (prisma/seed.ts):
//   Dennis Ong EMP-0090 is the only OFFBOARDING employee and holds exactly three
//   items: BR-LT-0166 (laptop ₱48,000), BR-PH-0312 (phone ₱18,000),
//   BR-HS-0510 (headset ₱5,500). His M365 reads `offboarding`.
//   Repairs: BR-LT-0090 beyond-repair (₱34,000 quote on a ₱55,000 unit, 44 d down) ·
//   BR-LT-0118 / BR-MN-0731 / BR-DK-0033 at-vendor · BR-LT-0122 / BR-KB-0402
//   to-assess · BR-MN-0911 returned-ok (SPARE, keeps its defectiveSince).
//   Holds: BR-MN-0910 ACTIVE for Nina Robles, plus one FULFILLED, one RELEASED,
//   one EXPIRED. One policy: "Finance standard", 6 slots, 5 required.
// Never reference raw cuids — the DB is reseeded and ids change every time.

// Spec files share one database and run in alphabetical order, so each file
// reseeds rather than inheriting another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

// Hoisted to module scope: the "server gate" describe below reuses gotoStep,
// and a function declared inside a different test.describe callback is out of
// scope there (each describe body is its own closure at collection time).
async function openWizard(page: Page) {
  await page.goto("/offboarding");
  await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
  await expect(page.getByRole("heading", { name: "Dennis Ong", level: 1 })).toBeVisible();
}

// The page header carries its own "Farewell report" link (to the printable
// sheet), so step navigation must always go through the step bar.
async function gotoStep(page: Page, label: RegExp) {
  await page.getByRole("list", { name: "Offboarding steps" }).getByRole("link", { name: label }).click();
}

test.describe("offboarding queue", () => {
  test("lists the leaver with what is still out, and Home's LEAVE row opens the wizard", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await expectNoSeriousAxe(page);

    const row = page.getByRole("row", { name: /Dennis Ong/ });
    await expect(row).toContainText("EMP-0090");
    await expect(row).toContainText("Operations");
    await expect(row).toContainText("0 of 3");
    await expect(row).toContainText("3 to go");

    await page.goto("/");
    const leave = page.locator("li").filter({ hasText: "Dennis Ong is leaving" });
    await expect(leave).toContainText("3 items still out");
    await expect(leave.getByRole("link", { name: "Collect equipment" })).toHaveAttribute(
      "href",
      /\/offboarding\/[a-z0-9]+/i,
    );
  });
});

// The wizard is a lifecycle: these run in order and depend on each other.
test.describe.serial("the 4-step wizard", () => {
  test("step 1 reviews holdings; steps 3 and 4 are not reachable while items are undecided", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await expectNoSeriousAxe(page);

    // Operations has no equipment policy — the step must still be useful.
    await expect(page.getByText("No equipment policy applies to this person")).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByRole("row", { name: new RegExp(tag) })).toBeVisible();
    }

    // Only Review and Collect are links; Accounts and Farewell report are inert.
    const steps = page.getByRole("list", { name: "Offboarding steps" });
    await expect(steps.getByRole("link")).toHaveCount(2);
    await expect(steps).toContainText("Accounts & M365");
  });

  test("a Missing decision without a reason is refused by the server", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await gotoStep(page, /Collect items/);

    const phone = page.getByRole("group", { name: "Decide BR-PH-0312" });
    await phone.getByRole("radiogroup", { name: /Outcome for BR-PH-0312/ }).getByText("Missing").click();
    await phone.getByRole("button", { name: "Confirm decision" }).click();
    await expect(phone.getByText(/Missing needs a reason/)).toBeVisible();
  });

  test("each decision becomes its own approval, and Continue unblocks only when none are undecided", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await gotoStep(page, /Collect items/);

    // Undecided is not the same as returned: the button is disabled, and it says why.
    await expect(page.getByRole("button", { name: /Continue to Accounts/ })).toBeDisabled();
    await expect(page.getByText(/3 items undecided/)).toBeVisible();

    const decide = async (tag: string, outcome: string, reason: string) => {
      const card = page.getByRole("group", { name: `Decide ${tag}` });
      await card.getByRole("radiogroup", { name: new RegExp(`Outcome for ${tag}`) }).getByText(outcome).click();
      if (reason) await card.getByLabel(/Reason/).fill(reason);
      await card.getByRole("button", { name: "Confirm decision" }).click();
      await expect(page.getByText(new RegExp(`APR-\\d+ created — ${tag}`))).toBeVisible();
    };

    await decide("BR-PH-0312", "Missing", "never handed back — investigation open");
    await decide("BR-LT-0166", "Defective", "screen cracked in transit");
    await decide("BR-HS-0510", "Returned", "");

    // Every decided item now shows its request and its landing status.
    await expect(page.getByText("MISSING").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue to Accounts/ })).toBeVisible();
    await expect(page.getByRole("list", { name: "Offboarding steps" }).getByRole("link")).toHaveCount(4);
  });

  test("step 3 closes the account; completion is refused until it does", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
    await gotoStep(page, /Accounts & M365/);

    await page.getByLabel(/Microsoft 365 account status/).selectOption("inactive");
    await page.getByRole("button", { name: /Save account status/ }).click();
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
  });

  test("step 4 totals the outcomes and completing flips the person to OFFBOARDED", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
    await gotoStep(page, /Farewell report/);

    // returned ₱5,500 + defective ₱48,000 back in the fleet; ₱18,000 lost.
    await expect(page.getByText("₱53,500")).toBeVisible();
    // the phone cost repeats in the table below — the Stat tile is the first
    await expect(page.getByText("₱18,000").first()).toBeVisible();

    await page.getByRole("button", { name: "Complete offboarding" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("Dennis Ong is now OFFBOARDED")).toBeVisible();

    // The queue is empty and the wizard still reads as the record of what happened.
    await page.goto("/offboarding");
    await expect(page.getByText("Nobody is offboarding")).toBeVisible();
  });

  test("the printable farewell report names every outcome and the value recovered", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?q=Dennis");
    await page.getByRole("link", { name: /Dennis Ong/ }).click();
    // A next/link push is client-side routing, not a full navigation — reading
    // page.url() straight after click() can race it, so wait for the URL to
    // actually land on the employee record first.
    await page.waitForURL(/\/employees\/[a-z0-9]+$/i);
    const url = page.url();
    await page.goto(`/offboarding/${url.split("/").pop()}/report`);

    await expect(page.getByText("Offboarding farewell report")).toBeVisible();
    // EMP-0090 also repeats in the sheet's footer line, so scope to the first match.
    await expect(page.getByText("EMP-0090").first()).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByText(tag)).toBeVisible();
    }
    await expect(page.getByText("never handed back — investigation open")).toBeVisible();
  });

  test("a MISSING return now executes to MISSING instead of failing (the Task 1 payoff)", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/approvals");
    const row = page.getByRole("row", { name: /BR-PH-0312/ });
    // The queue's change cell must name the real target, not a hard-coded SPARE.
    await expect(row).toContainText("→ MISSING");
    await row.getByRole("link").first().click();

    // "What the system checked" must pass on a Missing return, not cross it.
    await expect(page.getByText("returns as MISSING")).toBeVisible();
    await page.getByRole("button", { name: "Claim" }).click();
    await page.getByRole("button", { name: "Approve" }).click();

    execSync("npm run worker:once", { timeout: 60_000, stdio: "inherit" });

    await page.goto("/inventory?q=BR-PH-0312");
    // the scanner contract redirects an exact tag match to the record
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 15_000 });
    await expect(page.getByText("MISSING").first()).toBeVisible();
    await expect(page.getByText("Dennis Ong")).toHaveCount(0);
  });
});

test.describe("offboarding — the server gate does not trust the wizard", () => {
  test("a return filed BEFORE the offboarding began blocks the item and refuses completion", async ({ page }) => {
    // The regression: that approval owns the asset's one open slot but decides
    // nothing in this window, so the wizard must show the item as blocked (not
    // decided, not silently skipped) and completion must refuse. An earlier
    // version counted it as decided server-side and let the offboarding finish
    // with the item still assigned to the departed employee.
    await login(page, "it@thebackroomop.com");

    // file a routine return on a held item while the employee is still ACTIVE-ish,
    // by using the employee record's − affordance BEFORE touching the wizard.
    // Not the laptop slot: BR-LT-0148 already carries the seeded APR-2039
    // (CLAIMED), which owns that asset's one open-approval slot — the monitor
    // (BR-MN-0902) has none, so it's the one free to file a fresh return on.
    await page.goto("/employees?q=Marites");
    await page.getByRole("link", { name: /Marites Bautista/ }).click();
    await page.getByRole("button", { name: /^monitor slot/ }).click();
    await page.getByLabel(/Reason/).fill("routine swap, pre-offboarding");
    await page.getByRole("button", { name: "Request return" }).click();
    await expect(page.getByText(/APR-\d+ created/)).toBeVisible();

    // now mark her offboarding — the anchor lands AFTER that approval
    await page.getByRole("link", { name: "Edit" }).click();
    await page.getByLabel(/Employment/).selectOption("OFFBOARDING");
    await page.getByRole("button", { name: /Save/ }).click();
    // Save is a React transition with no redirect (it stays on /edit and flips
    // the button to "✓ Saved") — navigating away before that lands can abort
    // the in-flight server action, so wait for confirmation first.
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();

    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Marites Bautista/ }).getByRole("link", { name: "Open wizard" }).click();
    await gotoStep(page, /Collect items/);

    // the item names its blocker instead of offering a control or claiming a decision.
    // BR-LT-0148 (the seeded APR-2039) is blocked too, alongside BR-MN-0902 —
    // both are genuinely held, so this matches more than one row.
    await expect(page.getByText(/is held by APR-\d+/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue to Accounts/ })).toBeDisabled();
  });
});

test.describe("repairs — a saved view, not an enum", () => {
  test("the named URL adds Stage and Down; chips move between stages, including the one outside DEFECTIVE", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    await page.getByRole("link", { name: "Repairs" }).click();
    await expect(page).toHaveURL(/status=DEFECTIVE&sort=defectiveSince/);

    await expect(page.getByRole("columnheader", { name: /Down/ })).toBeVisible();
    const worst = page.getByRole("row", { name: /BR-LT-0090/ });
    await expect(worst).toContainText("BEYOND REPAIR");
    await expect(worst).toContainText("44 d");

    await page.getByRole("link", { name: "AT VENDOR" }).click();
    await expect(page).toHaveURL(/stage=at-vendor/);
    for (const tag of ["BR-LT-0118", "BR-MN-0731", "BR-DK-0033"]) {
      await expect(page.getByRole("row", { name: new RegExp(tag) })).toBeVisible();
    }
    await expect(page.getByRole("row", { name: /BR-LT-0090/ })).toHaveCount(0);

    // RETURNED OK deliberately leaves status=DEFECTIVE behind.
    await page.getByRole("link", { name: "RETURNED OK" }).click();
    await expect(page).toHaveURL(/stage=returned-ok/);
    const returned = page.getByRole("row", { name: /BR-MN-0911/ });
    await expect(returned).toContainText("SPARE");
    await expect(returned).toContainText("RETURNED OK");
  });

  test("the record warns when the quote is most of a new unit", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory?q=BR-LT-0090");
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 15_000 });
    await expect(page.getByText("Repairing costs too much of a new unit")).toBeVisible();
    await expect(page.getByText(/62% of the ₱55,000/)).toBeVisible();
    await expect(page.getByText(/60% write-off line/)).toBeVisible();
  });
});

test.describe("reservations", () => {
  test("a hold never changes the asset's status, and closed holds stay distinguishable", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/reservations");
    await expectNoSeriousAxe(page);

    const active = page.getByRole("row", { name: /BR-MN-0910/ });
    await expect(active).toContainText("Nina Robles");
    await expect(active).toContainText("SPARE"); // the point: the hold moved nothing

    await page.getByRole("link", { name: /Closed/ }).click();
    await expect(page).toHaveURL(/state=CLOSED/);
    // Scoped to the table: the page's own explanatory banner ("Holds are
    // placed and released on the asset record") also contains the word
    // "released", so an unscoped getByText matches it too.
    const closedTable = page.getByRole("table");
    await expect(closedTable.getByText(/expired/)).toBeVisible();
    await expect(closedTable.getByText(/released/)).toBeVisible();

    // ...and the inventory list marks the held spare without restating its status
    await page.goto("/inventory?status=SPARE");
    const row = page.getByRole("row", { name: /BR-MN-0910/ });
    await expect(row).toContainText("HOLD");
    await expect(row).toContainText("for Nina Robles");
    await expect(row).toContainText("SPARE");
  });
});

test.describe("equipment policies", () => {
  test("chips show required vs optional, a slot can be added, and the audit records both lists", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/admin/equipment-policies");
    await expectNoSeriousAxe(page);

    await expect(page.getByRole("heading", { name: "Finance standard" })).toBeVisible();
    await expect(page.getByText("department: Finance")).toBeVisible();
    await expect(page.getByRole("button", { name: /second monitor · .* · optional/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^laptop · .* · required/ })).toBeVisible();

    await page.getByLabel(/New slot name for Finance standard/).fill("webcam");
    await page.getByRole("button", { name: "Add slot" }).click();
    await expect(page.getByText(/Slot added/)).toBeVisible();
    await expect(page.getByRole("button", { name: /webcam · .* · required/ })).toBeVisible();

    await page.goto("/audit");
    // entityLabels resolves an equipment-policy id to the policy NAME with a
    // link back to this page — without that teaching, the row reads as a
    // truncated cuid. The changed-field cell names `slots`, which is what
    // carries both lists.
    const auditRow = page.getByRole("row", { name: /equipment-policy/ }).first();
    await expect(auditRow).toContainText("Finance standard");
    await expect(auditRow).toContainText("policy.slot.added");
    await expect(auditRow).toContainText("slots");
  });

  test("viewer sees the policies read-only — no chips to click, no add row", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/admin/equipment-policies");
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add slot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Actions for Finance standard/ })).toHaveCount(0);
    // A viewer's mutating affordances are ABSENT, not disabled: the chip still
    // displays the slot, but as a span with no toggle — so it must not be a
    // button at all, and its label must drop the "click to toggle" suffix.
    await expect(page.getByRole("button", { name: /click to toggle/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^laptop · .* · required/ })).toHaveCount(0);
    await expect(page.getByText("LAPTOP").first()).toBeVisible();
  });
});
