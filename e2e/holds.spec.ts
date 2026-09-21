import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { addDays, dayFromISO } from "@/lib/deadlines";
import { fmtDate, localDateISO } from "@/lib/format";
import { defaultHoldExpiry } from "@/lib/holds";

/**
 * Phase 26 (spec §7) — holds that work, and the repair end date. Eleven cases,
 * each with its own fixture and a `finally` that puts the database back
 * (reservations deleted by id, or by this test's own `createdAt` window when
 * the UI created the row and the test failed before reading it back):
 *   1  reserve from the asset record — dialog defaults, audit sentence, the
 *      HOLD marker on the list, and the spare leaving the Replace picker.
 *   2  reserve from an empty profile slot (the ⋯ menu's "Reserve a spare…").
 *   3  a held record hides Reserve, shows the banner, and REFUSES an assign to
 *      anyone but the holder — while Assign itself stays (canAssign unchanged).
 *   4  the expiry floor: yesterday is refused and writes nothing.
 *   5  release from the record banner.
 *   6  release from the profile's holding area and from /reservations.
 *   7  assigning the holder FULFILS the hold rather than leaving it live.
 *   8  the hourly sweep, through the operator's own `npm run worker:once`.
 *   9  /reservations parity: search, the Employee facet, the Expires sort, the
 *      row click, and a viewer with no Release.
 *   10 backfill honesty: a closed repair with no recorded end says so.
 *   11 the repair end stamp: DEFECTIVE → SPARE → DEFECTIVE round trip.
 *
 * Case 10 runs BEFORE case 11 deliberately (file order): 11 stamps
 * BR-MN-0911's `repairEndedAt`, which is exactly the null 10 asserts on.
 *
 * Seeded fixtures this file depends on, read off the seeded database rather
 * than assumed from the brief (prisma/seed.ts):
 *   BR-HS-0502 (Headset, SPARE, history row RELEASED), BR-PH-0301 (Phone,
 *   SPARE, history row EXPIRED — already closed, so the sweep in case 8 never
 *   counts it), BR-MN-0911 (Monitor, SPARE, the RETURNED OK fixture:
 *   `defectiveSince` −70 d with `repairEndedAt` null, history row FULFILLED),
 *   BR-MN-0910 (Monitor, SPARE, ACTIVE hold for EMP-0097 expiring +7 d),
 *   BR-LT-0201 (MacBook Air M3, DEPLOYED to EMP-0099, no open approval — the
 *   one asset whose Replace picker e2e/it-gaps.spec.ts already reads),
 *   BR-LT-0181 (Laptop, SPARE, carries the PENDING APR-2041).
 *   Nina Robles EMP-0097 (Analyst/Finance → the only seeded EquipmentPolicy,
 *   "Finance standard"; holds nothing, so her monitor/dock/headset/phone slots
 *   are all empty — plan P-6, which is why case 2 is hers and not Carlo
 *   Dizon's: he resolves to no policy at all and has no slot grid).
 *   Paolo Santos EMP-0071 (IT, ACTIVE) is the "anyone else" of case 3.
 *
 * Two deviations from the task brief's letter, both recorded rather than
 * quietly dropped:
 *   - cases 1 and 5 assert the hold's audit SENTENCE on `/inventory/activity`,
 *     not on the asset's own `/inventory/<id>/timeline`. The timeline renders
 *     `actorLabel — action · N fields` (timeline/page.tsx) and never calls
 *     `auditSentence`; `/inventory/activity` is the surface that does. Both are
 *     asserted: the timeline for the `reservation.placed` / `.released` point,
 *     the activity feed for the sentence the brief pinned.
 *   - case 8's `npm run worker:once` also drains whatever jobs are PENDING,
 *     which after a reseed is the seeded EXECUTE_APPROVAL for APR-2035 (an
 *     approval with no asset — it terminalises as EXECUTION_FAILED) plus the
 *     DELIVER_WEBHOOK job case 7's assign emitted. Neither touches a fixture
 *     any case here reads, and `beforeAll` reseeds before the file runs again.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-gaps.spec.ts:34-58 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

const assetOf = (tag: string) => db.asset.findUniqueOrThrow({ where: { tag } });
const employeeOf = (employeeNo: string) => db.employee.findUniqueOrThrow({ where: { employeeNo } });

/**
 * A cell by its column HEADING rather than by a hardcoded index: the inventory
 * table's leading cells (the bulk checkbox, the status dot) and the user's own
 * column preferences both shift the offsets, while `<th>` and `<td>` stay
 * one-to-one. The arrows a sorted header renders are `aria-hidden` glyphs in
 * the same span, so they are stripped before comparing.
 */
async function cellUnder(page: Page, row: Locator, heading: string): Promise<Locator> {
  const headers = await page.locator("thead th").allTextContents();
  const index = headers.findIndex((h) => h.replace(/[↑↓]/g, "").trim() === heading);
  expect(index, `column "${heading}" on this table`).toBeGreaterThanOrEqual(0);
  return row.locator("td").nth(index);
}

/**
 * The profile's Holding area renders plain rows, not a table — the one stable
 * handle is the TagRef link (tag-ref.tsx renders a `<Link>` whose whole text is
 * the tag), and a held tag appears nowhere else on that page, since a hold does
 * NOT fill the slot it was reserved for.
 */
const holdingRow = (page: Page, tag: string) =>
  page.getByRole("link", { name: tag, exact: true }).locator("xpath=..");

test.describe("holds", () => {
  test("1. reserving a spare from its record writes the hold, marks the list, and takes it out of the Replace picker", async ({ page }) => {
    const startedAt = new Date();
    const headset = await assetOf("BR-HS-0502");
    const laptop = await assetOf("BR-LT-0201");
    const nina = await employeeOf("EMP-0097");
    const today = localDateISO(new Date());
    const expiry = defaultHoldExpiry(today);
    let holdId: string | null = null;

    try {
      await login(page, IT);
      await page.goto(`/inventory/${headset.id}`);
      await page.getByRole("button", { name: "Reserve", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Reserve BR-HS-0502" });
      await waitForHydration(dialog);

      // Spec §0 decision 1: seven calendar days unless IT picks another date.
      await expect(dialog.getByLabel("Expires")).toHaveValue(expiry);
      await dialog.getByLabel("For").fill("EMP-0097");
      await dialog.getByRole("option", { name: /EMP-0097/ }).click();
      await dialog.getByRole("group", { name: "Quick picks" })
        .getByRole("button", { name: "New hire setup", exact: true }).click();
      // "Reserve" names both the opener (outside the dialog) and the primary
      // inside it — scoping to the dialog is what keeps this unambiguous.
      await dialog.getByRole("button", { name: "Reserve", exact: true }).click();
      await expect(page.getByText(`BR-HS-0502 reserved for ${nina.name}`)).toBeVisible({ timeout: 15_000 });

      // The record: the banner, its expiry pill, and no Reserve button left.
      const banner = page.getByRole("status").filter({ hasText: "Held for" });
      await expect(banner).toContainText(`Held for ${nina.name}`);
      await expect(banner).toContainText("expires in 7 d");
      await expect(page.getByRole("button", { name: "Reserve", exact: true })).toHaveCount(0);

      const hold = await db.reservation.findFirstOrThrow({ where: { assetId: headset.id, state: "ACTIVE" } });
      holdId = hold.id;
      expect(hold.employeeId).toBe(nina.id);
      expect(hold.reason).toBe("New hire setup");
      expect(localDateISO(hold.expiresAt!)).toBe(expiry);
      // The hold moved nothing: that is the whole promise of the HOLD marker.
      expect((await db.asset.findUniqueOrThrow({ where: { id: headset.id } })).status).toBe("SPARE");

      // The asset's own timeline carries the audit POINT…
      await page.goto(`/inventory/${headset.id}/timeline`);
      await expect(page.getByText("reservation.placed").first()).toBeVisible();
      // …and the inventory activity feed carries the SENTENCE (auditSentence
      // lives there; the timeline prints the raw action — see the file header).
      await page.goto("/inventory/activity");
      await expect(page.getByText(/reserved BR-HS-0502 for EMP-0097 until/)).toBeVisible();

      await page.goto("/inventory?q=HS-0502");
      const row = page.locator("tbody tr").filter({ hasText: "BR-HS-0502" });
      await expect(row).toContainText("HOLD");
      await expect(row.getByRole("link", { name: nina.name })).toHaveAttribute("href", `/employees/${nina.id}`);
      await expect(row).toContainText("expires in 7 d");
      await expect(row).toContainText("SPARE");

      // spareOptions filters `reservations: { none: { state: "ACTIVE" } }` —
      // a promised spare must not be offered as somebody else's replacement.
      await page.goto(`/inventory/${laptop.id}`);
      await page.getByRole("button", { name: "Replace" }).click();
      const replace = page.getByRole("dialog", { name: "Replace BR-LT-0201" });
      await waitForHydration(replace);
      await replace.getByRole("combobox", { name: "Replacement" }).click();
      await expect(replace.getByRole("option", { name: /BR-HS-0502/ })).toHaveCount(0);
      await expect(replace.getByRole("option", { name: /BR-MN-0911/ })).toHaveCount(1);

      await expectNoSeriousAxe(page);
    } finally {
      // by id once known; before that, only what THIS test could have created
      await db.reservation.deleteMany({ where: holdId ? { id: holdId } : { assetId: headset.id, state: "ACTIVE", createdAt: { gte: startedAt } } });
    }
  });

  test("2. an empty policy slot reserves a spare from its ⋯ menu, and the holding area shows it", async ({ page }) => {
    const startedAt = new Date();
    const nina = await employeeOf("EMP-0097");
    const phone = await assetOf("BR-PH-0301");
    let holdId: string | null = null;

    try {
      await login(page, IT);
      await page.goto(`/employees/${nina.id}`);
      // Plan P-5: the empty tile is already the Assign affordance, so Reserve
      // is a ⋯ menu item beside it, never a second click target on the tile.
      const trigger = page.getByRole("button", { name: "Actions for the phone slot" });
      await waitForHydration(trigger);
      await trigger.click();
      await page.getByRole("menuitem", { name: "Reserve a spare…" }).click();

      const dialog = page.getByRole("dialog", { name: "Reserve a spare for the phone slot" });
      await waitForHydration(dialog);
      await dialog.getByLabel("Spare").fill("BR-PH-0301");
      await dialog.getByRole("option", { name: /BR-PH-0301/ }).click();
      await dialog.getByRole("button", { name: "Reserve", exact: true }).click();
      await expect(page.getByText("BR-PH-0301 reserved")).toBeVisible({ timeout: 15_000 });

      const row = holdingRow(page, "BR-PH-0301");
      await expect(row).toContainText("Samsung A54");
      await expect(row).toContainText("expires in 7 d");
      await expect(row.getByRole("button", { name: "Release", exact: true })).toBeVisible();

      const hold = await db.reservation.findFirstOrThrow({ where: { assetId: phone.id, state: "ACTIVE" } });
      holdId = hold.id;
      expect(hold.employeeId).toBe(nina.id);
      expect(localDateISO(hold.expiresAt!)).toBe(defaultHoldExpiry(localDateISO(new Date())));

      await expectNoSeriousAxe(page);
    } finally {
      // by id once known; before that, only what THIS test could have created
      await db.reservation.deleteMany({ where: holdId ? { id: holdId } : { assetId: phone.id, state: "ACTIVE", createdAt: { gte: startedAt } } });
    }
  });

  test("3. a held record offers no Reserve, keeps Assign, and refuses handing the spare to anyone else", async ({ page }) => {
    const monitor = await assetOf("BR-MN-0910");
    const nina = await employeeOf("EMP-0097");
    const paolo = await employeeOf("EMP-0071");

    await login(page, IT);
    await page.goto(`/inventory/${monitor.id}`);
    await expect(page.getByRole("button", { name: "Reserve", exact: true })).toHaveCount(0);
    const banner = page.getByRole("status").filter({ hasText: "Held for" });
    await expect(banner).toContainText(`Held for ${nina.name}`);
    await expect(banner).toContainText("EMP-0097");

    // Global constraint: canAssign is UNCHANGED — e2e/custody.spec.ts case 9
    // assigns this very asset to its holder, so Assign must stay reachable.
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Assign BR-MN-0910" });
    await waitForHydration(dialog);
    await expect(dialog.getByLabel("Assign to")).toHaveValue(/Nina/);
    await expect(dialog.getByText(/Held for Nina Robles — assigning to anyone else is refused/)).toBeVisible();

    await dialog.getByLabel("Assign to").fill("EMP-0071");
    await dialog.getByRole("option", { name: /EMP-0071/ }).click();
    await dialog.getByRole("button", { name: "Confirm" }).click();
    // The execution guard, humanised: it names the employee NUMBER the hold is for.
    await expect(dialog.getByText(/EMP-0097/)).toBeVisible({ timeout: 15_000 });

    const after = await db.asset.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(after.status).toBe("SPARE");
    expect(after.assigneeId).toBeNull();
    const hold = await db.reservation.findFirstOrThrow({ where: { assetId: monitor.id, state: "ACTIVE" } });
    expect(hold.employeeId).toBe(nina.id);
    expect(hold.employeeId).not.toBe(paolo.id);

    await expectNoSeriousAxe(page);
  });

  test("4. an expiry before today is refused and writes no hold", async ({ page }) => {
    const startedAt = new Date();
    const headset = await assetOf("BR-HS-0502");
    const today = localDateISO(new Date());

    try {
      await login(page, IT);
      await page.goto(`/inventory/${headset.id}`);
      await page.getByRole("button", { name: "Reserve", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Reserve BR-HS-0502" });
      await waitForHydration(dialog);

      // Person first, date second — the order case 1 and e2e/custody.spec.ts
      // both use. Driving the date picker before touching the combobox made
      // the option list unstable under Playwright's click (measured: the first
      // run of this file timed out here), and the order proves the same thing.
      await dialog.getByLabel("For").fill("EMP-0097");
      await dialog.getByRole("option", { name: /EMP-0097/ }).click();

      // `min` is the browser's courtesy, not the rule — strip it so the SERVER
      // guard (reserveAsset: "Pick today or later") is what this case proves.
      const yesterday = addDays(today, -1);
      const expires = dialog.getByLabel("Expires");
      await expires.evaluate((el) => el.removeAttribute("min"));
      await expires.fill(yesterday);
      await expect(expires).toHaveValue(yesterday);
      await dialog.getByRole("button", { name: "Reserve", exact: true }).click();

      await expect(dialog.getByText("Pick today or later")).toBeVisible({ timeout: 15_000 });
      expect(await db.reservation.count({ where: { assetId: headset.id, state: "ACTIVE" } })).toBe(0);

      await expectNoSeriousAxe(page);
    } finally {
      // the net stays, but narrowed to what THIS test could have created
      await db.reservation.deleteMany({ where: { assetId: headset.id, state: "ACTIVE", createdAt: { gte: startedAt } } });
    }
  });

  test("5. the record banner releases the hold, stamps resolvedAt and says so in the trail", async ({ page }) => {
    const headset = await assetOf("BR-HS-0502");
    const nina = await employeeOf("EMP-0097");
    const today = localDateISO(new Date());
    // Created through the client, not the UI: case 1 already owns the "reserve
    // from the record" path, and this case is about the release.
    const hold = await db.reservation.create({
      data: {
        assetId: headset.id, employeeId: nina.id, state: "ACTIVE",
        reason: "e2e — release from the record", expiresAt: dayFromISO(defaultHoldExpiry(today)),
      },
    });

    try {
      await login(page, IT);
      await page.goto(`/inventory/${headset.id}`);
      await page.getByRole("button", { name: "Release", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Release the hold on BR-HS-0502?" });
      await waitForHydration(dialog);
      await dialog.getByRole("button", { name: "Release", exact: true }).click();
      await expect(page.getByText("Hold on BR-HS-0502 released")).toBeVisible({ timeout: 15_000 });

      const row = await db.reservation.findUniqueOrThrow({ where: { id: hold.id } });
      expect(row.state).toBe("RELEASED");
      expect(row.resolvedAt).not.toBeNull();
      // Released, not deleted: the spare is free again but the asset did not move.
      expect((await db.asset.findUniqueOrThrow({ where: { id: headset.id } })).status).toBe("SPARE");
      await expect(page.getByRole("status").filter({ hasText: "Held for" })).toHaveCount(0);

      await page.goto(`/inventory/${headset.id}/timeline`);
      await expect(page.getByText("reservation.released").first()).toBeVisible();
      await page.goto("/inventory/activity");
      await expect(page.getByText(/released the hold on BR-HS-0502/)).toBeVisible();

      await expectNoSeriousAxe(page);
    } finally {
      await db.reservation.deleteMany({ where: { id: hold.id } });
    }
  });

  test("6. a hold releases from the person's holding area and from the /reservations row alike", async ({ page }) => {
    const phone = await assetOf("BR-PH-0301");
    const monitor = await assetOf("BR-MN-0911");
    const nina = await employeeOf("EMP-0097");
    const paolo = await employeeOf("EMP-0071");
    const expiresAt = dayFromISO(defaultHoldExpiry(localDateISO(new Date())));

    let ninaHold: { id: string } | null = null;
    let paoloHold: { id: string } | null = null;

    try {
      ninaHold = await db.reservation.create({
        data: { assetId: phone.id, employeeId: nina.id, state: "ACTIVE", reason: "e2e — release from the profile", expiresAt },
      });
      paoloHold = await db.reservation.create({
        data: { assetId: monitor.id, employeeId: paolo.id, state: "ACTIVE", reason: "e2e — release from the list", expiresAt },
      });
      await login(page, IT);
      // (a) the profile's holding area. Nina also holds the seeded BR-MN-0910,
      // so the Release button has to be scoped to the BR-PH-0301 row.
      await page.goto(`/employees/${nina.id}`);
      const row = holdingRow(page, "BR-PH-0301");
      await waitForHydration(row);
      await row.getByRole("button", { name: "Release", exact: true }).click();
      const profileDialog = page.getByRole("dialog", { name: "Release the hold on BR-PH-0301?" });
      await waitForHydration(profileDialog);
      await profileDialog.getByRole("button", { name: "Release", exact: true }).click();
      await expect(page.getByText("Hold on BR-PH-0301 released")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("link", { name: "BR-PH-0301", exact: true })).toHaveCount(0);

      // (b) the /reservations ACTIVE row.
      await page.goto("/reservations?state=ACTIVE");
      const listRow = page.getByRole("row", { name: /BR-MN-0911/ });
      await waitForHydration(listRow);
      await listRow.getByRole("button", { name: "Release", exact: true }).click();
      const listDialog = page.getByRole("dialog", { name: "Release the hold on BR-MN-0911?" });
      await waitForHydration(listDialog);
      await listDialog.getByRole("button", { name: "Release", exact: true }).click();
      await expect(page.getByText("Hold on BR-MN-0911 released")).toBeVisible({ timeout: 15_000 });

      expect((await db.reservation.findUniqueOrThrow({ where: { id: ninaHold.id } })).state).toBe("RELEASED");
      expect((await db.reservation.findUniqueOrThrow({ where: { id: paoloHold.id } })).state).toBe("RELEASED");
      expect((await db.reservation.findUniqueOrThrow({ where: { id: paoloHold.id } })).resolvedAt).not.toBeNull();

      await expectNoSeriousAxe(page);
    } finally {
      await db.reservation.deleteMany({ where: { id: { in: [ninaHold, paoloHold].flatMap((h) => (h ? [h.id] : [])) } } });
    }
  });

  test("7. assigning the asset to the person it is held for fulfils the hold rather than leaving it live", async ({ page }) => {
    const monitor = await assetOf("BR-MN-0910");
    const nina = await employeeOf("EMP-0097");
    const before = await db.asset.findUniqueOrThrow({
      where: { id: monitor.id },
      select: { status: true, assigneeId: true, loanDueAt: true },
    });
    const hold = await db.reservation.findFirstOrThrow({ where: { assetId: monitor.id, state: "ACTIVE" } });

    try {
      await login(page, IT);
      await page.goto(`/inventory/${monitor.id}`);
      await page.getByRole("button", { name: "Assign", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Assign BR-MN-0910" });
      await waitForHydration(dialog);
      // The holder comes preselected (spec §5.1), so Confirm alone is the
      // whole gesture — no retyping the person the hold already names.
      await expect(dialog.getByLabel("Assign to")).toHaveValue(/Nina/);
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(`BR-MN-0910 assigned to ${nina.name}`)).toBeVisible({ timeout: 15_000 });

      const settled = await db.reservation.findUniqueOrThrow({ where: { id: hold.id } });
      expect(settled.state).toBe("FULFILLED");
      expect(settled.resolvedAt).not.toBeNull();
      const after = await db.asset.findUniqueOrThrow({ where: { id: monitor.id } });
      expect(after.assigneeId).toBe(nina.id);
      expect(after.status).toBe("DEPLOYED");
      // A fulfilled hold is history, not a live claim: the banner is gone.
      await expect(page.getByRole("status").filter({ hasText: "Held for" })).toHaveCount(0);

      await expectNoSeriousAxe(page);
    } finally {
      // P-8: mutable fields only — the EXECUTED approval row and the audit
      // entries this assign wrote stay (AuditEntry is append-only, R2/R3).
      await db.asset.update({
        where: { id: monitor.id },
        data: { assigneeId: before.assigneeId, status: before.status, loanDueAt: before.loanDueAt },
      });
      await db.reservation.update({ where: { id: hold.id }, data: { state: "ACTIVE", resolvedAt: null } });
    }
  });

  test("8. the worker's hourly sweep expires a hold whose day has passed and frees the spare", async ({ page }) => {
    const headset = await assetOf("BR-HS-0502");
    const laptop = await assetOf("BR-LT-0201");
    const paolo = await employeeOf("EMP-0071");
    const hold = await db.reservation.create({
      data: {
        assetId: headset.id, employeeId: paolo.id, state: "ACTIVE",
        reason: "e2e — expiry sweep", expiresAt: dayFromISO(addDays(localDateISO(new Date()), -2)),
      },
    });

    try {
      // The npm script the operator runs, not expireHolds() imported here: this
      // case owes the whole path (tsx entry, relative worker imports, its own
      // client) and the operator-facing line spec §4.3 prescribes. The one-shot
      // also drains whatever jobs are PENDING — see the file header.
      const out = execSync("npm run worker:once", { timeout: 120_000, encoding: "utf8" });
      expect(out).toMatch(/\[worker\] expired 1 hold/);

      const row = await db.reservation.findUniqueOrThrow({ where: { id: hold.id } });
      expect(row.state).toBe("EXPIRED");
      expect(row.resolvedAt).not.toBeNull();
      // The sweep writes no audit row (global constraints) and moves no asset.
      expect((await db.asset.findUniqueOrThrow({ where: { id: headset.id } })).status).toBe("SPARE");

      await login(page, IT);
      await page.goto("/reservations?state=CLOSED");
      // BR-HS-0502 is on this tab twice now — the seeded RELEASED row and this
      // EXPIRED one — so the row is pinned by both tag and state.
      const closed = page.getByRole("row").filter({ hasText: "BR-HS-0502" }).filter({ hasText: "EXPIRED" });
      await expect(closed).toHaveCount(1);
      await expect(closed).toContainText("expired");
      await expect(closed).toContainText(paolo.name);

      // Expired means free: the spare is offerable again.
      await page.goto(`/inventory/${laptop.id}`);
      await page.getByRole("button", { name: "Replace" }).click();
      const replace = page.getByRole("dialog", { name: "Replace BR-LT-0201" });
      await waitForHydration(replace);
      await replace.getByRole("combobox", { name: "Replacement" }).click();
      await expect(replace.getByRole("option", { name: /BR-HS-0502/ })).toHaveCount(1);

      await expectNoSeriousAxe(page);
    } finally {
      await db.reservation.deleteMany({ where: { id: hold.id } });
    }
  });

  test("9. /reservations searches, facets, sorts, opens the asset and hides Release from a viewer", async ({ page }) => {
    const monitor = await assetOf("BR-MN-0910");
    const phone = await assetOf("BR-PH-0301");
    const nina = await employeeOf("EMP-0097");
    const paolo = await employeeOf("EMP-0071");

    await login(page, IT);
    // Search spans tag, model, person name and employee number (buildHoldWhere).
    await page.goto("/reservations?q=nina");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("BR-MN-0910");

    await page.goto("/reservations?state=ACTIVE");
    const employeeFacet = page.getByRole("button", { name: "Employee" });
    await waitForHydration(employeeFacet);
    await employeeFacet.click();
    const facet = page.getByRole("dialog", { name: "Filter by Employee" });
    await expect(facet.getByText(nina.name)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(facet).toHaveCount(0);

    // A second live hold makes the order observable. +3 d sorts ahead of the
    // seeded +7 d under the default (expiresAt ascending, HOLDS_LIST_CONFIG).
    const extra = await db.reservation.create({
      data: {
        assetId: phone.id, employeeId: paolo.id, state: "ACTIVE",
        reason: "e2e — sort order", expiresAt: dayFromISO(addDays(localDateISO(new Date()), 3)),
      },
    });

    try {
      await page.goto("/reservations?state=ACTIVE");
      await expect(page.locator("tbody tr").first()).toContainText("BR-PH-0301");

      // The default sort IS expiresAt ascending, so one click flips it to desc.
      const expiresHeader = page.getByRole("columnheader", { name: "Expires" }).getByRole("button");
      await waitForHydration(expiresHeader);
      await expiresHeader.click();
      await page.waitForURL(/sort=-expiresAt/);
      await expect(page.locator("tbody tr").first()).toContainText("BR-MN-0910");

      // The row opens the ASSET, not the person — "a hold never changes an
      // asset's status" is what this list exists to show.
      const row = page.getByRole("row", { name: /BR-MN-0910/ });
      await waitForHydration(row);
      await row.getByRole("cell", { name: "LG 27UL500" }).click();
      await page.waitForURL(`**/inventory/${monitor.id}`);
      await expect(page.getByRole("heading", { name: "BR-MN-0910", level: 1 })).toBeVisible();

      await login(page, VIEWER);
      await page.goto("/reservations?state=ACTIVE");
      await expect(page.getByRole("row", { name: /BR-MN-0910/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Release", exact: true })).toHaveCount(0);

      await expectNoSeriousAxe(page);
    } finally {
      await db.reservation.deleteMany({ where: { id: extra.id } });
    }
  });

  test("10. a closed repair with no recorded end says the clock stopped instead of guessing a number", async ({ page }) => {
    const monitor = await assetOf("BR-MN-0911");
    // The backfill is honest about what it cannot know (migration 25): this
    // seeded row left DEFECTIVE before the column existed, so it has no end.
    expect(monitor.repairEndedAt).toBeNull();
    expect(monitor.defectiveSince).not.toBeNull();
    expect(monitor.status).toBe("SPARE");

    await login(page, IT);
    await page.goto(`/inventory/${monitor.id}`);
    await expect(page.getByText("clock stopped")).toBeVisible();

    await page.goto("/inventory?stage=returned-ok");
    const row = page.locator("tbody tr").filter({ hasText: "BR-MN-0911" });
    await expect(row).toHaveCount(1);
    await expect(await cellUnder(page, row, "Down")).toHaveText("—");

    await expectNoSeriousAxe(page);
  });

  test("11. leaving DEFECTIVE stamps the repair end, re-entering it clears it, and the Down clock follows", async ({ page }) => {
    const monitor = await assetOf("BR-MN-0911");
    const before = await db.asset.findUniqueOrThrow({
      where: { id: monitor.id },
      select: { status: true, defectiveSince: true, repairEndedAt: true, returnedAt: true },
    });
    const today = localDateISO(new Date());

    const changeStatusTo = async (to: string, chip: string) => {
      await page.getByRole("button", { name: "Change status" }).click();
      const dialog = page.getByRole("dialog", { name: "Change status" });
      await waitForHydration(dialog);
      await dialog.getByLabel("New status").selectOption(to);
      await dialog.getByRole("group", { name: "Quick picks" }).getByRole("button", { name: chip, exact: true }).click();
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText(`BR-MN-0911 is now ${to}`)).toBeVisible({ timeout: 15_000 });
    };

    try {
      await login(page, IT);
      await page.goto(`/inventory/${monitor.id}`);

      // (a) entering DEFECTIVE starts the clock and clears any previous end.
      await changeStatusTo("DEFECTIVE", "For repair");
      await expect(page.getByText("0 d out of service")).toBeVisible();
      let asset = await db.asset.findUniqueOrThrow({ where: { id: monitor.id } });
      expect(asset.repairEndedAt).toBeNull();
      expect(localDateISO(asset.defectiveSince!)).toBe(today);

      // (b) leaving it closes the clock on a real date, not on "now forever".
      await changeStatusTo("SPARE", "Back in service");
      asset = await db.asset.findUniqueOrThrow({ where: { id: monitor.id } });
      expect(asset.repairEndedAt).not.toBeNull();
      expect(localDateISO(asset.repairEndedAt!)).toBe(today);
      await expect(page.getByText(`down 0 d, back since ${fmtDate(asset.repairEndedAt)}`)).toBeVisible();

      await page.goto("/inventory?stage=returned-ok");
      const row = page.locator("tbody tr").filter({ hasText: "BR-MN-0911" });
      await expect(await cellUnder(page, row, "Down")).toHaveText("0 d");

      // (c) a relapse reopens it — an end date must never outlive its repair.
      await page.goto(`/inventory/${monitor.id}`);
      await changeStatusTo("DEFECTIVE", "For repair");
      asset = await db.asset.findUniqueOrThrow({ where: { id: monitor.id } });
      expect(asset.repairEndedAt).toBeNull();
      await expect(page.getByText("0 d out of service")).toBeVisible();

      await expectNoSeriousAxe(page);
    } finally {
      await db.asset.update({
        where: { id: monitor.id },
        data: {
          status: before.status, defectiveSince: before.defectiveSince,
          repairEndedAt: before.repairEndedAt, returnedAt: before.returnedAt,
        },
      });
    }
  });
});
