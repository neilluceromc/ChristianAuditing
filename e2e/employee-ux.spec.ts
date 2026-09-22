import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { dayFromISO } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";

/**
 * Phase 29, Task 7 — the employee area after the Laws of UX pass (spec §4–§6),
 * nine cases, each independent: its own fixtures, no serial dependency, and a
 * `finally` that puts back every MUTABLE field it changed, so a failure in one
 * never cascades into the next.
 *   1 (§4.4/§4.6) a filled tile IS its menu's trigger — Replace…/Return…/Open
 *     record, a Return dialog that names tag, model AND holder, Enter reopens
 *     the menu from the keyboard and Escape hands focus back to the tile.
 *   2 (§4.4, plan P-8) the tag inside a tile is text, not a link: "Open record"
 *     in the menu is the route to the asset.
 *   3 (§4.1) a leaver's header: the due pill on the badge, "Open the
 *     offboarding wizard" as the one primary, Edit still beside it, and a More
 *     menu with no Transfer…/Start offboarding… in it.
 *   4 (§4.1, plan P-6) the state-chosen primary drives the grid — "Assign kit"
 *     on a day-one hire opens the first Fill dialog; one assignment later the
 *     same button reads "Fill N gaps" and focuses the first gap tile.
 *   5 (§4.4, ruling R8) the hold sitting on an empty tile says so, and "Assign
 *     reserved" fulfils it in one click.
 *   6 (§6, plan P-4) the list's Loadout column sorts: most required gaps
 *     first, "no policy" last; the count states the leaver it is hiding.
 *   7 (§6) the department name is a search term, and the search clears.
 *   8 (§5) the New form: Name focused, the live number check (next free /
 *     already taken), the policy preview, ONE same-name refusal, and "Create
 *     and add another" keeping the department and the URL.
 *   9 (ruling R2) a viewer's tiles are inert — groups, not buttons, and no
 *     header actions at all.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), read off the seed
 * rather than assumed from the brief:
 *   Marites Bautista EMP-0042 — Finance/Accountant, so "Finance standard"
 *     (laptop/monitor/dock/headset/phone required, second monitor optional)
 *     applies. Holds BR-LT-0148 (Dell Latitude 5420, the laptop slot),
 *     BR-MN-0902, BR-DK-0071 and BR-PH-0287 (TEMPORARY). APR-2039 names
 *     BR-LT-0148 but carries NO employeeId, so the profile's `openApprovals`
 *     (employee-scoped) never sees it and the laptop tile is not "pending" —
 *     which is why case 1 gets the full Replace/Return/Open menu there.
 *   Nina Robles EMP-0097 — Finance/Analyst, joined 10 days ago, holds
 *     NOTHING: the "Assign kit" fixture. One ACTIVE reservation (BR-MN-0910,
 *     LG 27UL500) and one PENDING lifecycle_assign (APR-2041, on BR-LT-0181,
 *     which therefore cannot be picked from her Fill dialogs).
 *   BR-PH-0301 — the only SPARE phone, and its one reservation is EXPIRED, so
 *     it is the spare case 4 can assign without touching case 5's hold.
 *   Dennis Ong EMP-0090 — the one OFFBOARDING row, two days overdue.
 *   Faith Mercado EMP-0093 — the one OFFBOARDED row, i.e. the ONE hidden
 *     leaver the list count names.
 *   Carlo Dizon EMP-0099 — Operations/Team Lead, and the highest EMP-#### in
 *     the seed, so "Next free" reads EMP-0100 and he is the same-name fixture.
 *
 * `AuditEntry` is append-only at the database (a trigger refuses deletes), so
 * no case here deletes an audit row: each restores the MUTABLE state it
 * touched instead, and `beforeAll` reseeds anyway.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-nav.spec.ts:59-65 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-nav.spec.ts:68-73.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-nav.spec.ts:76-84.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

// Copied from e2e/it-nav.spec.ts:96-110: one facet dropdown's option counts,
// keyed by the label the operator reads. The trigger is found by its
// `aria-haspopup="dialog"`, not by role+name, because a sortable table header
// on the same page is also a `<button>` whose name can start with the facet's
// own word.
async function facetCounts(page: Page, facet: string): Promise<Record<string, string>> {
  const trigger = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: facet });
  await waitForHydration(trigger);
  await trigger.click();
  const dropdown = page.getByRole("dialog", { name: `Filter by ${facet}` });
  const options = dropdown.locator("label");
  await expect(options.first()).toBeVisible();
  const counts: Record<string, string> = {};
  for (let i = 0; i < (await options.count()); i += 1) {
    const spans = options.nth(i).locator("span");
    counts[(await spans.first().innerText()).trim()] = (await spans.last().innerText()).trim();
  }
  await page.keyboard.press("Escape");
  await expect(dropdown).toBeHidden();
  return counts;
}

/** The seed's own day-precision floor (prisma/seed.ts) — case 5 rebuilds a hold with exactly that shape. */
const dayFloor = (d: Date) => dayFromISO(localDateISO(d));

const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

test.describe("Phase 29 — the employee area obeys the laws", () => {
  test("1. a filled tile opens its menu; Return… confirms with model and holder; Escape refocuses", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);
    const tile = page.getByRole("button", { name: /^laptop slot, / });
    await waitForHydration(tile);
    await tile.click();

    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Replace…" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Open record" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Return…" }).click();

    // Phase 29 (spec §4.6): tag · model · holder — "Return BR-LT-0148" alone
    // never said whose laptop was about to come off a loadout.
    await expect(page.getByRole("dialog", { name: /^Return BR-LT-\d+ · .+ from Marites Bautista\?$/ }))
      .toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Plan P-7: the tile is the Menu's trigger, so Enter on it opens the menu
    // and Escape closes it and hands focus straight back.
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(tile).toBeFocused();
    await expectNoSeriousAxe(page);
  });

  test("2. Open record from the menu lands on the asset", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });

    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);
    const tile = page.getByRole("button", { name: /^laptop slot, / });
    await waitForHydration(tile);
    // Plan P-8: the tag inside the tile is plain text now (a link nested in the
    // tile's own button is axe's nested-interactive) — this menu item is the
    // only route from the tile to the record.
    await expect(tile.getByRole("link")).toHaveCount(0);

    await tile.click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Open record" }).click();
    await page.waitForURL(`**/inventory/${laptop.id}`);
    await expect(page.getByRole("heading", { name: "BR-LT-0148", level: 1 })).toBeVisible({ timeout: 20_000 });
  });

  test("3. a leaver's header: the due pill, the wizard primary, Edit still present, no Transfer in More", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    await login(page, IT);
    await page.goto(`/employees/${dennis.id}`);

    const header = page.locator("main header").first();
    // The seed puts Dennis two days past his completion date, so the badge's
    // DuePill reads "2 d overdue" (deadlines.ts: dueStatus).
    await expect(header.getByText(/overdue|due/i)).toBeVisible();
    await expect(header.getByRole("button", { name: "Open the offboarding wizard" })).toBeVisible();
    // Decision 1: Edit is daily work and stays out of the menu, always.
    await expect(header.getByRole("link", { name: "Edit" })).toBeVisible();
    // …and there is exactly ONE primary beside it — no "Assign kit"/"Fill N
    // gaps" competing with the wizard on a frozen profile.
    await expect(header.getByRole("button", { name: /^Assign kit$|^Fill \d+ gaps?$/ })).toHaveCount(0);

    await header.getByRole("button", { name: "More actions" }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Timeline" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Export holdings" })).toBeVisible();
    // ProfileActions only offers these two for an ACTIVE person.
    await expect(page.getByRole("menuitem", { name: "Transfer…" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Start offboarding…" })).toHaveCount(0);
  });

  test("4. Nina: Assign kit on day one opens the first Fill dialog; after one assignment Fill N gaps focuses the first gap tile", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    const phone = await db.asset.findUniqueOrThrow({ where: { tag: "BR-PH-0301" } });
    try {
      await login(page, IT);
      await page.goto(`/employees/${nina.id}`);

      // profilePrimary: holds nothing, has required gaps → "Assign kit", and
      // (plan P-6) the click reaches the grid through the br:loadout event and
      // opens the FIRST empty required tile's Fill dialog.
      const assignKit = page.getByRole("button", { name: "Assign kit" });
      await waitForHydration(assignKit);
      await assignKit.click();
      const firstFill = page.getByRole("dialog", { name: /^Fill the .+ slot$/ });
      await expect(firstFill).toBeVisible();
      await firstFill.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // One real assignment, through the phone tile — the only slot whose
      // spare is neither held for Nina (BR-MN-0910, case 5's fixture) nor
      // promised by an open approval (BR-LT-0181 / APR-2041).
      const phoneTile = page.getByRole("button", { name: /^phone slot, empty, required$/ });
      await phoneTile.click();
      const fillPhone = page.getByRole("dialog", { name: "Fill the phone slot" });
      await waitForHydration(fillPhone);
      await fillPhone.getByRole("radiogroup", { name: "Pick a spare" }).getByText("BR-PH-0301").click();
      await fillPhone.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByText("BR-PH-0301 assigned to Nina Robles")).toBeVisible({ timeout: 15_000 });

      // The primary is state-chosen, so it has re-read itself: one slot filled,
      // four required gaps left.
      const fillGaps = page.getByRole("button", { name: /^Fill \d+ gaps?$/ });
      await expect(fillGaps).toBeVisible({ timeout: 15_000 });
      await expect(fillGaps).toHaveText(/^Fill 4 gaps$/);
      await waitForHydration(fillGaps);
      await fillGaps.click();
      // Focus, not just a scroll: the first EMPTY REQUIRED tile takes it.
      // Asserted on whatever tile that is, so the grid's own slot order is not
      // silently pinned here as well.
      await expect(page.locator(":focus")).toHaveAttribute("aria-label", /, empty, required$/);

      // …and back out again THROUGH THE NEW PATH, driven to submission: plan
      // P-7's filled tile IS its menu's trigger, and "Return…" behind it is the
      // only way off a loadout from this screen now. Case 1 opens that dialog
      // and cancels; this is the case that commits it, so the phase's own
      // trigger → menu → dialog → write chain is covered end to end. (The
      // `finally` below still runs: a DB restore is the idempotent safety net
      // for a run that dies before reaching here, not this assertion's job.)
      const filledPhoneTile = page.getByRole("button", { name: /^phone slot, Samsung A54, required$/ });
      await expect(filledPhoneTile).toBeVisible({ timeout: 15_000 });
      await filledPhoneTile.click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Return…" }).click();
      // Spec §4.6: the dialog names tag · model · holder, not just the tag.
      const returnPhone = page.getByRole("dialog", { name: "Return BR-PH-0301 · Samsung A54 from Nina Robles?" });
      await waitForHydration(returnPhone);
      // "Back for triage" is the default outcome (lifecycle.ts), which needs no
      // reason — filled anyway, so the audit trail says why this happened.
      await expect(returnPhone.getByLabel("What happens to it")).toHaveValue("TRIAGE");
      await returnPhone.getByLabel("Reason").fill("returned from the tile menu (e2e)");
      await returnPhone.getByRole("button", { name: "Confirm" }).click();

      await expect(page.getByText("BR-PH-0301 returned · now SPARE")).toBeVisible({ timeout: 15_000 });
      // The slot is a gap again…
      await expect(page.getByRole("button", { name: /^phone slot, .*, required$/ }))
        .toHaveAttribute("aria-label", /, empty, /, { timeout: 15_000 });
      // …and the state-chosen primary has followed it all the way back.
      await expect(page.getByRole("button", { name: "Assign kit" })).toBeVisible({ timeout: 15_000 });
      expect((await db.asset.findUniqueOrThrow({ where: { id: phone.id } })).assigneeId).toBeNull();
    } finally {
      await db.asset.update({
        where: { id: phone.id },
        data: { status: "SPARE", assigneeId: null, returnedAt: null, loanDueAt: null },
      });
    }
  });

  test("5. the reserved spare shows on its tile and Assign reserved fulfils the hold", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    const monitor = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0910" } });
    try {
      await login(page, IT);
      await page.goto(`/employees/${nina.id}`);

      // Ruling R8: the hold is consumed by the FIRST empty tile of its type —
      // the required "monitor", never also "second monitor".
      const monitorTile = page.getByRole("button", { name: /^monitor slot, empty, required$/ });
      await waitForHydration(monitorTile);
      await expect(monitorTile).toContainText("reserved · BR-MN-0910");
      await expect(page.getByRole("button", { name: /^second monitor slot,/ })).not.toContainText("reserved ·");
      // The batch affordance states the same count the grid shows.
      await expect(page.getByRole("button", { name: "Assign all 1 reserved" })).toBeVisible();

      // Scoped to the tile's own wrapper: "Assign reserved" is a SIBLING of the
      // tile button (a button inside a button is axe's nested-interactive), and
      // more than one tile can carry one.
      await monitorTile.locator("..").getByRole("button", { name: "Assign reserved" }).click();
      await expect(page.getByText("BR-MN-0910 assigned to Nina Robles")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /^monitor slot, LG 27UL500, required$/ }))
        .toBeVisible({ timeout: 15_000 });

      // commitLifecycle settles the hold the assignment answers.
      const hold = await db.reservation.findFirstOrThrow({ where: { assetId: monitor.id, employeeId: nina.id } });
      expect(hold.state).toBe("FULFILLED");
    } finally {
      await db.asset.update({
        where: { id: monitor.id },
        data: { status: "SPARE", assigneeId: null, returnedAt: null, loanDueAt: null },
      });
      // Back to the seed's own shape (prisma/seed.ts: `expiresAt: dayFloor(day(7))`).
      await db.reservation.updateMany({
        where: { assetId: monitor.id, employeeId: nina.id },
        data: { state: "ACTIVE", resolvedAt: null, expiresAt: dayFloor(new Date(Date.now() + 7 * 86_400_000)) },
      });
    }
  });

  test("6. the list sorted by Loadout puts gaps first and no policy last; the count states the hidden leaver", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    // Faith Mercado (EMP-0093) is the seed's one OFFBOARDED row, hidden by
    // default — the count now says so instead of quietly under-reporting.
    await expect(page.getByText(/^\d+ people · 1 leaver hidden$/)).toBeVisible();

    const loadout = page.getByRole("button", { name: "Loadout" });
    await waitForHydration(loadout);
    await loadout.click();
    // toggleSort keeps the old primary as a tiebreak: sort=loadout,name.
    await expect(page).toHaveURL(/sort=loadout/);

    // Third column (Employee · Department · Loadout · Items · …).
    const cells = await page.locator("tbody tr td:nth-child(3)").allInnerTexts();
    const firstNoPolicy = cells.findIndex((c) => c.trim() === "no policy");
    const lastMissing = cells.map((c) => /missing/.test(c)).lastIndexOf(true);
    // orderByLoadout, ascending: most required gaps first, `null` (no policy)
    // last whichever way the column is pointed.
    expect(lastMissing).toBeLessThan(firstNoPolicy < 0 ? cells.length : firstNoPolicy);
    expect(/^\d+ missing$/.test(cells[0].trim()) || cells[0].trim() === "complete").toBe(true);
  });

  test("7. search clears and matches a department", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    // The Department facet's own count is what "the department name is a
    // search term" has to reproduce — read it rather than hard-coding 3.
    const counts = await facetCounts(page, "Department");
    const financeCount = Number(counts["Finance"]);
    expect(financeCount).toBeGreaterThan(0);

    const search = page.getByLabel("Search employees");
    await waitForHydration(search);
    await search.fill("Finance");
    await search.press("Enter");
    await page.waitForURL(/q=Finance/);

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(financeCount);
    const departments = await page.locator("tbody tr td:nth-child(2)").allInnerTexts();
    expect(departments.map((d) => d.trim())).toEqual(Array(financeCount).fill("Finance"));

    // The × inside the field: the search comes off without retyping the URL.
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/employees$/);
    await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(0);
  });

  test("8. the New form: Name focused, the live number check, Next free, the policy preview, one same-name refusal, Create and add another", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });
    try {
      await login(page, IT);
      await page.goto("/employees/new");

      const name = page.getByLabel(/^Name\b/);
      await waitForHydration(name);
      // autoFocus only takes effect at hydration, so this is asserted BEFORE
      // any fill moves the caret somewhere else.
      await expect(name).toBeFocused();

      // Empty number → the next free one, suggested and never prefilled.
      // EMP-0099 (Carlo Dizon) is the seed's highest.
      const number = page.getByLabel(/^Employee number\b/);
      await expect(page.getByText(/^Next free: EMP-0100/)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Use it" }).click();
      await expect(number).toHaveValue("EMP-0100");

      // Non-empty number → the debounced taken check, with the number as typed
      // and a link to whoever holds it. The two states never show at once.
      await number.fill("EMP-0042");
      await expect(page.getByText(/^EMP-0042 is already/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("link", { name: "Marites Bautista" }))
        .toHaveAttribute("href", `/employees/${marites.id}`);
      await expect(page.getByText(/^Next free:/)).toHaveCount(0);
      await number.fill("EMP-9301");
      await expect(page.getByText(/is already/)).toHaveCount(0, { timeout: 15_000 });

      // The policy preview under Title: silent until the check resolves, then
      // one line or the other, never both. No department yet → no match.
      await page.getByLabel(/^Title\b/).fill("Accountant");
      await expect(page.getByText("no policy matches this title yet")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel(/^Department\b/).selectOption({ label: "Finance" });
      // "Finance standard" is a DEPARTMENT policy with six slots, so the line
      // says which way it matched.
      await expect(page.getByText("matches Finance standard · 6 slots (department)")).toBeVisible({ timeout: 15_000 });

      // The same-name nudge fires on name + department together: Carlo Dizon is
      // Operations, so it only lights up once the department moves there.
      await name.fill("Carlo Dizon");
      await page.getByLabel(/^Department\b/).selectOption({ label: "Operations" });
      const banner = page.getByText(`Another Carlo Dizon exists in Operations (${carlo.employeeNo})`);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      // Ruling R3: the number in the banner's title is a link to the match.
      await expect(page.getByRole("link", { name: carlo.employeeNo })).toHaveAttribute("href", `/employees/${carlo.id}`);

      // Plan P-3: the server's refusal is ONE sentence, in that banner, above
      // the checkbox it names — never a second copy under Name.
      await page.getByRole("button", { name: "Create employee" }).click();
      const refusal = page.getByText(/tick 'This is a different person'/);
      await expect(refusal).toBeVisible({ timeout: 15_000 });
      await expect(refusal).toHaveCount(1);
      await expect(page).toHaveURL(/\/employees\/new$/);
      expect(await db.employee.count({ where: { employeeNo: "EMP-9301" } })).toBe(0);

      // Ticked, and through "Create and add another": a toast, the fields
      // cleared except Department, focus back on Name, and the URL unmoved.
      await page.getByRole("checkbox", { name: "This is a different person" }).check();
      const operations = await page.getByLabel(/^Department\b/).inputValue();
      await page.getByRole("button", { name: "Create and add another" }).click();
      await expect(page.getByText("Added Carlo Dizon")).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/employees\/new$/);
      await expect(name).toHaveValue("");
      await expect(number).toHaveValue("");
      await expect(page.getByLabel(/^Department\b/)).toHaveValue(operations);
      await expect(name).toBeFocused();
      const first = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9301" } });
      expect(first.name).toBe("Carlo Dizon");

      // …and the other submit still lands on the new profile.
      await name.fill("Ux Probe Two");
      await page.getByLabel(/^Title\b/).fill("Tester");
      await number.fill("EMP-9302");
      await page.getByRole("button", { name: "Create employee" }).click();
      await page.waitForURL(/\/employees\/[^/?]+\?created=1$/);
      const second = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9302" } });
      await expect(page).toHaveURL(new RegExp(`/employees/${second.id}\\?created=1$`));
      await expect(page.getByText("Ux Probe Two added · EMP-9302")).toBeVisible();
    } finally {
      // The audit rows these creates wrote stay (append-only); the employees go.
      await db.employee.deleteMany({ where: { employeeNo: { in: ["EMP-9301", "EMP-9302"] } } });
    }
  });

  test("9. a viewer's tiles are inert", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, VIEWER);
    await page.goto(`/employees/${marites.id}`);

    // Ruling R2: the inert branch is the VIEWER — the tile is a <div
    // role="group"> carrying the same accessible name, with no menu behind it…
    await expect(page.getByRole("group", { name: /^laptop slot,/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /slot,/ })).toHaveCount(0);
    // …and no ⋯ beside it.
    await expect(page.getByRole("button", { name: /^Actions for the/ })).toHaveCount(0);
    // ProfileActions renders nothing at all for a viewer.
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    await expectNoSeriousAxe(page);
  });
});
