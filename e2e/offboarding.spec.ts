import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

const db = new PrismaClient();

// Copied from e2e/admin.spec.ts (itself from e2e/it-nav.spec.ts:88-97) — house rule: never import
// helpers across spec files.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login, which keeps this
  // helper safe to call again mid-file to switch users.
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
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
test.afterAll(async () => {
  await db.$disconnect();
});

// Hoisted to module scope: the "server gate" describe below reuses gotoStep,
// and a function declared inside a different test.describe callback is out of
// scope there (each describe body is its own closure at collection time).
async function openWizard(page: Page) {
  await page.goto("/offboarding");
  await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: /^Collect \d+ items?$/ }).click();
  // Headroom, not a weaker assertion (HANDOVER §7). This is the FIRST hit of
  // the dynamic /offboarding/[employeeId] route in the whole suite, and this
  // file runs seventh of eight — so the click has to cover a cold compile on a
  // dev server that has already been compiling for six-odd minutes. It began
  // failing reproducibly in the full run (twice), while passing 14/14 in
  // isolation, once Phase 9 added three more route handlers for the server to
  // get through first. Awaiting the URL separately from the heading is what
  // makes a real failure here say which half broke, instead of blaming the
  // heading for a navigation that never happened — the same fix Phase 8's
  // Task 3 applied to the "Task 1 payoff" test in this file (`bf23284`).
  await expect(page).toHaveURL(/\/offboarding\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Dennis Ong", level: 1 })).toBeVisible({ timeout: 20_000 });
}

// The page header carries its own "Farewell report" link (to the printable
// sheet), so step navigation must always go through the step bar.
async function gotoStep(page: Page, label: RegExp) {
  await page.getByRole("list", { name: "Offboarding steps" }).getByRole("link", { name: label }).click();
}

test.describe("offboarding queue", () => {
  test("lists the leaver with what is still out, and the Worklist's LEAVE row opens the wizard", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await expectNoSeriousAxe(page);

    const row = page.getByRole("row", { name: /Dennis Ong/ });
    await expect(row).toContainText("EMP-0090");
    await expect(row).toContainText("Operations");
    await expect(row).toContainText("0 of 3 decided");
    await expect(row).toContainText("overdue by 2 d");

    // Phase 15: Home's Worklist caps "Approvals & leavers" at 2 rows, and the
    // seed's breached SLA (APR-2040) plus the EXECUTION_FAILED retry
    // (APR-2025) already fill it — Dennis's leaver row is the section's
    // third, reached through the uncapped /inventory/work page instead.
    await page.goto("/inventory/work");
    const leave = page.locator("li").filter({ hasText: "Dennis Ong is leaving" });
    await expect(leave).toContainText("3 items still out");
    // Phase 32: the leaver row's link reads offboardingNext's label and lands on that step.
    await expect(leave.getByRole("link", { name: "Collect 3 items" })).toHaveAttribute(
      "href",
      /\/offboarding\/[a-z0-9]+\?step=collect/i,
    );
  });
});

// The wizard is a lifecycle: these run in order and depend on each other.
test.describe.serial("the 4-step wizard", () => {
  test("step 1 reviews holdings; every step stays reachable while items are undecided", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    // Phase 32: the queue's row action now reads offboardingNext and lands on
    // Collect (Dennis has undecided items) rather than the bare wizard root —
    // this test is specifically about the Review step's own content.
    await gotoStep(page, /Review holdings/);
    await expectNoSeriousAxe(page);

    // Operations has no equipment policy — the step must still be useful.
    await expect(page.getByText("No equipment policy applies to this person")).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByRole("row", { name: new RegExp(tag) })).toBeVisible();
    }

    // Phase 32: every step is a link, reachable regardless of undecided items.
    const steps = page.getByRole("list", { name: "Offboarding steps" });
    await expect(steps.getByRole("link")).toHaveCount(4);
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

  test("each decision applies at once, and Continue unblocks only when none are undecided", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openWizard(page);
    await gotoStep(page, /Collect items/);

    // Undecided is not the same as returned: the button is disabled, and it says why.
    await expect(page.getByRole("button", { name: /Continue to Accounts/ })).toBeDisabled();
    await expect(page.getByText(/3 items undecided/)).toBeVisible();

    // Phase 15: Dennis's three items are all IT class, so IT confirming a
    // decision applies it immediately (decideItem, offboarding/actions.ts) —
    // the toast reads "<tag> → <STATUS>", never "APR-… created — <tag>" (that
    // wording survives only for a Purchasing asset's own queued path).
    const decide = async (tag: string, outcome: string, reason: string) => {
      const card = page.getByRole("group", { name: `Decide ${tag}` });
      await card.getByRole("radiogroup", { name: new RegExp(`Outcome for ${tag}`) }).getByText(outcome).click();
      if (reason) await card.getByLabel(/Reason/).fill(reason);
      await card.getByRole("button", { name: "Confirm decision" }).click();
      await expect(page.getByText(new RegExp(`${tag} → `))).toBeVisible();
    };

    await decide("BR-PH-0312", "Missing", "never handed back — investigation open");
    await decide("BR-LT-0166", "Defective", "screen cracked in transit");
    await decide("BR-HS-0510", "Returned", "");

    // A direct IT decision takes the item out of their name at once (each toast above named its landing status),
    // so the step counts all three decided and has nothing left to collect.
    await expect(page.getByText("3 of 3 decided", { exact: true })).toBeVisible();
    await expect(page.getByText("Nothing left to collect", { exact: true })).toBeVisible();
    // Two identical "Continue to Accounts & M365" links render at once (a
    // mobile/desktop action-bar duplicate) — .first() disambiguates without
    // weakening the assertion.
    await expect(page.getByRole("link", { name: /Continue to Accounts/ }).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Offboarding steps" }).getByRole("link")).toHaveCount(4);

    // The write actually happened — not just the wizard's own optimistic copy.
    const [phone, laptop, headset] = await Promise.all([
      db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0312" } }),
      db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0166" } }),
      db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0510" } }),
    ]);
    expect(phone.status).toBe("MISSING");
    expect(phone.assigneeId).toBeNull();
    expect(laptop.status).toBe("DEFECTIVE");
    expect(laptop.assigneeId).toBeNull();
    // RETURNED lands an IT device on its default status (SPARE) with
    // returnedAt set — "back, not checked" (spec §4.1) — not a plain clean
    // return with nothing left to triage.
    expect(headset.status).toBe("SPARE");
    expect(headset.assigneeId).toBeNull();
    expect(headset.returnedAt).not.toBeNull();
    for (const a of [phone, laptop, headset]) {
      const approval = await db.approval.findFirstOrThrow({ where: { assetId: a.id, type: "lifecycle_return" } });
      expect(approval.state).toBe("EXECUTED");
    }
  });

  test("step 3 closes the account; completion is refused until it does", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Close account" }).click();
    await gotoStep(page, /Accounts & M365/);

    await page.getByLabel(/Microsoft 365 account status/).selectOption("inactive");
    await page.getByRole("button", { name: /Save account status/ }).click();
    await expect(page.getByRole("button", { name: "✓ Saved" })).toBeVisible();
  });

  test("step 4 totals the outcomes and completing flips the person to OFFBOARDED", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Complete" }).click();
    // Phase 32: the last step reads "Finish" (its id stays "report").
    await gotoStep(page, /Finish/);

    // returned ₱5,500 + defective ₱48,000 back in the fleet; ₱18,000 lost.
    await expect(page.getByText("₱53,500")).toBeVisible();
    // the phone cost repeats in the table below — the Stat tile is the first
    await expect(page.getByText("₱18,000").first()).toBeVisible();

    await page.getByRole("button", { name: "Complete offboarding" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("Success: Dennis Ong is now Offboarded", { exact: true })).toBeVisible();

    // Peak-End (spec §4.4): completing lands on the success card, not a silent
    // refresh — Dennis is the only seeded leaver, so there is no next leaver.
    await expect(page.getByRole("heading", { name: /Dennis Ong offboarded · 3 decisions · / })).toBeVisible();
    await expect(page.getByRole("link", { name: "Print farewell report" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Queue clear" })).toBeVisible();

    // The queue is empty and the wizard still reads as the record of what happened.
    await page.goto("/offboarding");
    await expect(page.getByText("No one is leaving")).toBeVisible();
  });

  test("the printable farewell report names every outcome and the value recovered", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // Phase 20 spec §5: leavers hidden by default — Dennis is OFFBOARDED now,
    // so the directory needs the "Show leavers" toggle to surface him.
    await page.goto("/employees?q=Dennis&leavers=1");
    await page.getByRole("link", { name: /Dennis Ong/ }).click();
    // A next/link push is client-side routing, not a full navigation — reading
    // page.url() straight after click() can race it, so wait for the URL to
    // actually land on the employee record first.
    await page.waitForURL(/\/employees\/[a-z0-9]+$/i);
    const url = page.url();
    await page.goto(`/offboarding/${url.split("/").pop()}/report`);

    // Phase 32: the printed H1 drops "Offboarding" (the page's own breadcrumb
    // already says that) and reads "Backroom IT — Farewell report".
    await expect(page.getByRole("heading", { name: "Backroom IT — Farewell report", exact: true })).toBeVisible();
    // EMP-0090 also repeats in the sheet's footer line, so scope to the first match.
    await expect(page.getByText("EMP-0090").first()).toBeVisible();
    for (const tag of ["BR-LT-0166", "BR-PH-0312", "BR-HS-0510"]) {
      await expect(page.getByText(tag)).toBeVisible();
    }
    await expect(page.getByText("never handed back — investigation open")).toBeVisible();
  });

  test("a MISSING decision executes to MISSING immediately, with nothing left in the queue (the Task 1 payoff)", async ({ page }) => {
    // Phase 15: the decision above already applied — there is no PENDING
    // approval left to claim and approve for BR-PH-0312 (the old flow this
    // test used to drive), so the payoff is asserted directly against the
    // asset and the approval record rather than through the queue and the
    // worker. Before Task 1, a MISSING return died as EXECUTION_FAILED; now
    // it lands the asset on MISSING in the same transaction as the decision.
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0312" } });
    expect(asset.status).toBe("MISSING");
    expect(asset.assigneeId).toBeNull();
    const approval = await db.approval.findFirstOrThrow({
      where: { assetId: asset.id, type: "lifecycle_return" },
      orderBy: { createdAt: "desc" },
    });
    expect(approval.state).toBe("EXECUTED");
    expect(await db.approval.count({ where: { assetId: asset.id, state: { in: ["PENDING", "CLAIMED", "APPROVED"] } } })).toBe(0);

    await login(page, "admin@thebackroomop.com");
    await page.goto(`/inventory/${asset.id}`);
    // Scoped to main: since Phase 42 the nav's Inventory link opens a "Missing" view on record pages too, and
    // `.first()` would otherwise settle for it.
    await expect(page.getByRole("main").getByText("Missing", { exact: true }).first()).toBeVisible();
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
    //
    // Phase 15: IT's return is now direct — filing it through the UI (the
    // employee record's − affordance) would execute at once and leave
    // nothing "held" behind, so there is no longer a UI path that produces a
    // real PENDING lifecycle_return the way this test needs. The legacy row
    // is manufactured through Prisma instead, exactly the way
    // e2e/scanner.spec.ts manufactures its own blocked-verdict fixture. Not
    // the laptop slot: BR-LT-0148 already carries the seeded APR-2039
    // (CLAIMED), which owns that asset's one open-approval slot — the
    // monitor (BR-MN-0902) has none, so it's the one free to carry a fresh
    // legacy return.
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const monitor = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0902" } });
    const itStaff = await db.user.findFirstOrThrow({ where: { email: "it@thebackroomop.com" } });
    const refNo = "APR-OFFTEST-BLOCK-1";
    await db.approval.create({
      data: {
        refNo,
        type: "lifecycle_return",
        state: "PENDING",
        payload: { from: { assigneeId: marites.id }, to: { assigneeId: null, status: "SPARE" }, reason: "routine swap, pre-offboarding" },
        slaAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        requestedById: itStaff.id,
        assetId: monitor.id,
        employeeId: marites.id,
      },
    });

    await login(page, "it@thebackroomop.com");

    // now mark her offboarding — the anchor lands AFTER that approval
    // Phase 40: Edit no longer starts an offboarding — its "Start offboarding…" link opens the dialog, which lands
    // in the wizard (the navigation below is the confirmation the server action finished).
    await page.goto(`/employees/${marites.id}/edit`);
    await page.getByRole("button", { name: "Start offboarding…" }).click();
    await page.getByRole("dialog", { name: /^Start offboarding / }).getByRole("button", { name: "Start", exact: true }).click();
    await page.waitForURL(/\/offboarding\//);

    await page.goto("/offboarding");
    await page.getByRole("row", { name: /Marites Bautista/ }).getByRole("link", { name: /^Collect \d+ items?$/ }).click();
    await gotoStep(page, /Collect items/);

    // the item names its blocker instead of offering a control or claiming a decision.
    // BR-LT-0148 (the seeded APR-2039) is blocked too, alongside BR-MN-0902 —
    // both are genuinely held, so both refNos must appear.
    await expect(page.getByText(`is held by ${refNo}`)).toBeVisible();
    await expect(page.getByText(/is held by APR-2039/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue to Accounts/ })).toBeDisabled();
  });
});

test.describe("repairs — a saved view, not an enum", () => {
  test("the named URL adds Stage and Down; chips move between stages, including the one outside DEFECTIVE", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    // The toolbar's saved view (scoped: the Phase 42 nav has a "Repairs" view too).
    await page.getByRole("main").getByRole("link", { name: "Repairs" }).click();
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
    await expect(returned).toContainText("Spare");
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
    // The point: the hold moved nothing. The Active tab no longer carries a status
    // column (spec §5.2, plan P-12); the hint under the tabs states the same fact.
    await expect(page.getByText("Held spares still read Spare · place holds from a record or a profile", { exact: true })).toBeVisible();

    // The page's own tab (scoped: the Phase 42 nav's Reservations link opens a "Closed" view too).
    await page.getByRole("main").getByRole("link", { name: /Closed/ }).click();
    await expect(page).toHaveURL(/state=CLOSED/);
    // Scoped to the table, so no page copy outside it can ever match. The
    // Closed column keeps the lowercase "expired …" / "released …" beside the
    // State column's "Expired" / "Released".
    const closedTable = page.getByRole("table");
    await expect(closedTable.getByText(/expired/)).toBeVisible();
    await expect(closedTable.getByText(/released/)).toBeVisible();

    // ...and the inventory list marks the held spare without restating its status
    await page.goto("/inventory?status=SPARE");
    const row = page.getByRole("row", { name: /BR-MN-0910/ });
    await expect(row).toContainText("HOLD");
    await expect(row).toContainText("for Nina Robles");
    await expect(row).toContainText("Spare");
  });
});

test.describe("equipment policies", () => {
  // Phase 37 (spec §3.3): one list per department or client, edited as Category / Type lines and saved
  // whole; the audit entry carries the slot lists before and after.
  test("Finance's list shows required vs optional lines, a line can be added, and the audit records both lists", async ({ page }) => {
    const finance = await db.department.findFirstOrThrow({ where: { name: "Finance" } });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/admin/equipment-policies?tab=internal&group=${finance.id}`);
    await expectNoSeriousAxe(page);

    await expect(page.getByRole("heading", { name: "Finance", level: 2 })).toBeVisible();
    await expect(page.getByText("Internal department", { exact: true })).toBeVisible();
    const editor = page.getByRole("region", { name: "What their staff should have" });
    await expect(editor.getByLabel(/^Line \d+ kind$/)).toHaveCount(6);
    await expect(editor.getByLabel("Line 1 kind", { exact: true }).locator("option:checked")).toHaveText("Laptop");
    await expect(editor.getByLabel("Line 1 needed")).toBeChecked();
    // the seed's sixth line is the optional second monitor
    await expect(editor.getByLabel("Line 6 kind", { exact: true }).locator("option:checked")).toHaveText("Monitor");
    await expect(editor.getByLabel("Line 6 needed")).not.toBeChecked();

    const add = editor.getByRole("button", { name: "+ Add slot" });
    await waitForHydration(add);
    await add.click();
    await expect(editor.getByLabel(/^Line \d+ kind$/)).toHaveCount(7);
    await editor.getByLabel("Line 7 kind", { exact: true }).selectOption({ label: "Webcam" });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator('[aria-live="polite"]')).toContainText("Saved", { timeout: 10_000 });
    // the refreshed page replaces the editor (Save idle and disabled) before this test leaves it
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await expect(save).not.toHaveAttribute("aria-busy", "true", { timeout: 15_000 });
    await expect(save).toBeDisabled();
    await expect(editor.getByLabel(/^Line \d+ kind$/)).toHaveCount(7);

    await page.goto("/audit");
    // entityLabels resolves an equipment-policy id to the policy NAME with a link back to the policies
    // page. The `slots` key — what carries both lists — is checked on the stored row.
    const auditRow = page.getByRole("row", { name: /equipment policy/i }).first();
    await expect(auditRow).toContainText("Finance standard");
    await expect(auditRow).toContainText(/Policy saved|saved Finance standard's equipment list/);
    const policy = await db.equipmentPolicy.findFirstOrThrow({ where: { name: "Finance standard" } });
    const entry = await db.auditEntry.findFirstOrThrow({
      where: { entityType: "equipment-policy", entityId: policy.id, action: "policy.saved" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const slots = (entry.diff as { slots?: { from: string[]; to: string[] } }).slots;
    expect(slots?.from).toHaveLength(6);
    expect(slots?.to).toHaveLength(7);
  });

  test("viewer sees the policies read-only — no line controls, no Save", async ({ page }) => {
    const finance = await db.department.findFirstOrThrow({ where: { name: "Finance" } });
    await login(page, "viewer@thebackroomop.com");
    await page.goto(`/admin/equipment-policies?tab=internal&group=${finance.id}`);
    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    // A viewer's mutating affordances are ABSENT, not disabled: the lines read as text.
    const editor = page.getByRole("region", { name: "What their staff should have" });
    await expect(editor.getByRole("cell", { name: "Laptop", exact: true }).first()).toBeVisible();
    await expect(page.getByLabel(/^Line \d+ kind$/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Add slot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /More for .*policy/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start empty" })).toHaveCount(0);
  });
});
