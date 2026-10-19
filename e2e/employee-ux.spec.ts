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
 *   1 (§4.4/§4.6) a filled tile's ⋯ ("More for {label}") offers Replace…/
 *     Return…/Open record, a Return dialog that names tag, model AND holder,
 *     Enter reopens the menu from the keyboard and Escape hands focus back.
 *   2 (Phase 37 §4.3) the tag inside a tile is a link to the record, and
 *     "Open record" in the menu lands there too.
 *   3 (§4.1) a leaver's header: the due pill on the badge, "Open the
 *     offboarding wizard" as the one primary, Edit still beside it, and a More
 *     menu with no Transfer…/Start offboarding… in it.
 *   4 (§4.1, plan P-6) the state-chosen primary drives the grid — "Assign kit"
 *     on a day-one hire opens the first Fill dialog; one assignment later the
 *     same button reads "Fill N gaps" and focuses the first gap tile's Fill.
 *   5 (§4.4, ruling R8) the hold sitting on an empty tile says so, and "Assign
 *     reserved" fulfils it in one click.
 *   6 (§6, plan P-4) the list's Loadout column sorts: most required gaps
 *     first, "no policy" last; the count states the leaver it is hiding.
 *   7 (§6) the department name is a search term, and the search clears.
 *   8 (§5) the New form: Name focused, the live number check (next free /
 *     already taken), the policy preview, ONE same-name refusal, and "Create
 *     and add another" keeping the department and the URL.
 *   9 (ruling R2) a viewer's tiles carry no actions — no ⋯, no Fill, no
 *     header actions — though the read-only side panel still opens.
 *  10 (Phase 37 §4.3/§4.4) equal tiles, "Monitor" / "Monitor 2", and the side
 *     panel: the Laptop tile opens it, Escape closes it back onto the tile,
 *     and `?item=` reopens it after a reload.
 *  11 (Phase 37 §4.7) Add a slot asks the category, then the type, names the
 *     slot itself ("Shows as"), and a second Monitor is numbered "Monitor 2".
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), read off the seed
 * rather than assumed from the brief:
 *   Marites Bautista EMP-0042 — Finance/Accountant, so "Finance standard"
 *     (Laptop/Monitor/Docking Station/Headset/Phone required, a second
 *     Monitor optional — the tiles read "Monitor" and "Monitor 2") applies. Holds BR-LT-0148 (Dell Latitude 5420, the laptop slot),
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
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
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

/**
 * Phase 37 (spec §5): Add employee is three steps — Next past Details, wait for Equipment to load its
 * lines, Next again to Check & create. Copied per file (house rule: no helpers across spec files).
 */
async function toCheckAndCreate(page: Page) {
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.click();
  await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem").filter({ hasText: "Equipment" }))
    .toHaveAttribute("aria-current", "step", { timeout: 15_000 });
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click();
  await expect(page.getByRole("button", { name: "Create employee" })).toBeVisible({ timeout: 15_000 });
}

test.describe("Phase 29 — the employee area obeys the laws", () => {
  test("1. a filled tile's ⋯ opens its menu; Return… confirms with model and holder; Escape refocuses", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);
    // Phase 37 (spec §4.3): the tile body opens the side panel (case 10); the ⋯ beside the label is the menu.
    const tile = page.getByRole("button", { name: "More for Laptop", exact: true });
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

    // Enter on the ⋯ opens the menu, and Escape closes it and hands focus straight back.
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
    // Phase 37 (spec §4.3): the tag is a link again — the side panel's opener is a sibling stretched over the
    // card, never the link's parent, so nothing interactive nests.
    const tile = page.getByRole("group", { name: "Laptop", exact: true });
    await expect(tile.getByRole("link", { name: "BR-LT-0148" })).toHaveAttribute("href", `/inventory/${laptop.id}`);

    const more = tile.getByRole("button", { name: "More for Laptop", exact: true });
    await waitForHydration(more);
    await more.click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Open record" }).click();
    await page.waitForURL(`**/inventory/${laptop.id}`);
    await expect(page.getByRole("heading", { name: "BR-LT-0148", level: 1 })).toBeVisible({ timeout: 20_000 });
  });

  test("3. a leaver's header: the due pill, the wizard primary, Edit still present, no Transfer in More", async ({ page }) => {
    const dennis = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    await login(page, IT);
    await page.goto(`/employees/${dennis.id}`);

    // Phase 37 (spec §4.1): the name, due pill and actions moved from the page header into the identity band.
    const header = page.getByTestId("identity-band");
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
      // Phase 37 (spec §4.3): a required gap reads "Missing" and carries its own Fill button.
      await expect(page.getByRole("group", { name: "Phone", exact: true })).toContainText("Missing");
      await page.getByRole("button", { name: "Fill the Phone slot" }).click();
      const fillPhone = page.getByRole("dialog", { name: "Fill the Phone slot" });
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
      // Focus, not just a scroll: the first EMPTY REQUIRED tile's Fill takes it.
      // Asserted on whatever tile that is, so the grid's own slot order is not
      // silently pinned here as well.
      await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Fill the .+ slot$/);

      // …and back out again through the tile's ⋯, driven to submission. Case 1
      // opens that dialog and cancels; this is the case that commits it, so the
      // ⋯ → menu → dialog → write chain is covered end to end. (The `finally`
      // below still runs: a DB restore is the idempotent safety net for a run
      // that dies before reaching here, not this assertion's job.)
      await expect(page.getByRole("button", { name: "Phone: Samsung A54 BR-PH-0301" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("group", { name: "Phone", exact: true })).toContainText("Held");
      await page.getByRole("button", { name: "More for Phone", exact: true }).click();
      await page.getByRole("menu").getByRole("menuitem", { name: "Return…" }).click();
      // Spec §4.6: the dialog names tag · model · holder, not just the tag.
      const returnPhone = page.getByRole("dialog", { name: "Return BR-PH-0301 · Samsung A54 from Nina Robles?" });
      await waitForHydration(returnPhone);
      // "Back for triage" is the default outcome (lifecycle.ts), which needs no
      // reason — filled anyway, so the audit trail says why this happened.
      await expect(returnPhone.getByLabel("What happens to it")).toHaveValue("TRIAGE");
      await returnPhone.getByLabel("Reason").fill("returned from the tile menu (e2e)");
      await returnPhone.getByRole("button", { name: "Confirm" }).click();

      await expect(page.getByText("Success: BR-PH-0301 returned · now Spare", { exact: true })).toBeVisible({ timeout: 15_000 });
      // The slot is a gap again…
      await expect(page.getByRole("group", { name: "Phone", exact: true })).toContainText("Nothing assigned", { timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Fill the Phone slot" })).toBeVisible();
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
      // the required "Monitor", never also "Monitor 2".
      const monitorTile = page.getByRole("group", { name: "Monitor", exact: true });
      await waitForHydration(monitorTile.getByRole("button", { name: "Assign reserved" }));
      await expect(monitorTile).toContainText("reserved · BR-MN-0910");
      await expect(page.getByRole("group", { name: "Monitor 2", exact: true })).not.toContainText("reserved ·");
      // The batch affordance states the same count the grid shows.
      await expect(page.getByRole("button", { name: "Assign all 1 reserved" })).toBeVisible();

      // Scoped to the tile: more than one tile can carry an "Assign reserved".
      await monitorTile.getByRole("button", { name: "Assign reserved" }).click();
      await expect(page.getByText("BR-MN-0910 assigned to Nina Robles")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "Monitor: LG 27UL500 BR-MN-0910" }))
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
    // The Works for facet's own count is what "the department name is a
    // search term" has to reproduce — read it rather than hard-coding 3.
    const counts = await facetCounts(page, "Works for");
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

    // The × inside the field: the search comes off without retyping the URL —
    // and off the BOX too. A search change is a soft navigation, so the
    // uncontrolled input kept its typed text while the list showed everyone
    // (final review I-2); the value assertion is the half that caught it.
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL(/\/employees$/);
    await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(0);
    await expect(search).toHaveValue("");
  });

  test("8. Add employee: Name focused, the prefilled number and its live check, the policy panel, one same-name refusal, Create and add another", async ({ page }) => {
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

      // Phase 37 (spec §5.2): the number is prefilled with the next free one —
      // EMP-0099 (Carlo Dizon) is the seed's highest. Emptied, the field offers
      // it again with "Use it".
      const number = page.getByLabel(/^Employee no\./);
      await expect(number).toHaveValue("EMP-0100");
      await number.fill("");
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

      // Phase 37 (spec §5.1): the right panel — nothing to show before a
      // group is picked, then the matched policy and its numbered lines.
      const panel = page.getByRole("complementary", { name: "Equipment policy" });
      await page.getByLabel(/^Title\b/).fill("Accountant");
      await expect(panel.getByText("Pick who they work for to see their equipment.")).toBeVisible();
      await page.getByLabel(/^Department\b/).selectOption({ label: "Finance" });
      await expect(panel.getByText("Finance standard", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByText("Monitor", { exact: true })).toBeVisible();
      await expect(panel.getByText("Monitor 2", { exact: true })).toBeVisible();

      // The same-name nudge fires on name + department together: Carlo Dizon is
      // Operations, so it only lights up once the department moves there.
      await name.fill("Carlo Dizon");
      await page.getByLabel(/^Department\b/).selectOption({ label: "Operations" });
      const banner = page.getByText(`Another Carlo Dizon exists in Operations (${carlo.employeeNo})`);
      await expect(banner).toBeVisible({ timeout: 15_000 });
      // Ruling R3: the number in the banner's title is a link to the match.
      await expect(page.getByRole("link", { name: carlo.employeeNo })).toHaveAttribute("href", `/employees/${carlo.id}`);

      // Plan P-3: the server's refusal is ONE sentence, in that banner, above
      // the checkbox it names — never a second copy under Name. Phase 37: it is
      // sent from step 3 and lands back on step 1, where the banner lives.
      await toCheckAndCreate(page);
      await page.getByRole("button", { name: "Create employee" }).click();
      const refusal = page.getByText(/tick 'This is a different person'/);
      await expect(refusal).toBeVisible({ timeout: 15_000 });
      await expect(refusal).toHaveCount(1);
      await expect(page).toHaveURL(/\/employees\/new$/);
      expect(await db.employee.count({ where: { employeeNo: "EMP-9301" } })).toBe(0);

      // Ticked, and through "Create and add another": a toast, back on step 1
      // with the fields cleared except Works for and Department, focus back on
      // Name, and the URL unmoved.
      await page.getByRole("checkbox", { name: "This is a different person" }).check();
      const operations = await page.getByLabel(/^Department\b/).inputValue();
      await toCheckAndCreate(page);
      await page.getByRole("button", { name: "Create and add another" }).click();
      await expect(page.getByText("Added Carlo Dizon")).toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/employees\/new$/);
      await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem").filter({ hasText: "Details" }))
        .toHaveAttribute("aria-current", "step");
      await expect(name).toHaveValue("");
      await expect(page.getByLabel(/^Department\b/)).toHaveValue(operations);
      await expect(name).toBeFocused();
      const first = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9301" } });
      expect(first.name).toBe("Carlo Dizon");

      // Final review I-3: the number is asked for again, so it has MOVED ON —
      // EMP-9301 is now the highest EMP-####, making EMP-9302 the next free,
      // prefilled. The mount-time answer (EMP-0100, read before any of these
      // creates) must not come back, or the field would hold a number the live
      // check refuses 400 ms later.
      await expect(number).toHaveValue("EMP-9302", { timeout: 15_000 });
      await expect(page.getByText(/^Next free: EMP-0100/)).toHaveCount(0);

      // …and the other submit still lands on the new profile.
      await name.fill("Ux Probe Two");
      await page.getByLabel(/^Title\b/).fill("Tester");
      await number.fill("EMP-9302");
      await toCheckAndCreate(page);
      await page.getByRole("button", { name: "Create employee" }).click();
      await page.waitForURL(/\/employees\/[^/?]+\?created=1&assigned=0$/);
      const second = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9302" } });
      await expect(page).toHaveURL(new RegExp(`/employees/${second.id}\\?created=1&assigned=0$`));
      await expect(page.getByText("Ux Probe Two added · EMP-9302")).toBeVisible();
    } finally {
      // The audit rows these creates wrote stay (append-only); the employees go.
      await db.employee.deleteMany({ where: { employeeNo: { in: ["EMP-9301", "EMP-9302"] } } });
    }
  });

  test("9. a viewer's tiles carry no actions", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, VIEWER);
    await page.goto(`/employees/${marites.id}`);

    // Ruling R2: the VIEWER gets no ⋯ and no Fill on any tile…
    const laptop = page.getByRole("group", { name: "Laptop", exact: true });
    await expect(laptop).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^More for / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Fill the / })).toHaveCount(0);
    // …but Phase 37 (spec §4.4): the side panel is read-only, so the tile body still opens it.
    await expect(laptop.getByRole("button", { name: /^Laptop: / })).toBeVisible();
    // ProfileActions renders nothing at all for a viewer.
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    await expectNoSeriousAxe(page);
  });

  test("10. side panel: equal tiles, Monitor / Monitor 2, the Laptop tile opens the panel, Escape refocuses it, ?item= reopens it", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, IT);
    await page.goto(`/employees/${marites.id}`);

    const opener = page.getByRole("button", { name: /^Laptop: / });
    await waitForHydration(opener);
    await expect(opener).toHaveAccessibleName(`Laptop: ${laptop.model} BR-LT-0148`);

    // Spec §4.3: grid-auto-rows 1fr, so every tile is the same height whatever it holds.
    const heights = await page.locator("[data-tile]").evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(1);
    expect(new Set(heights).size).toBe(1);
    // Spec §3.2: the policy's two Monitor lines are numbered in policy order.
    await expect(page.getByRole("group", { name: "Monitor", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Monitor 2", exact: true })).toBeVisible();

    await opener.click();
    const panel = page.getByRole("dialog", { name: `BR-LT-0148 · ${laptop.model}` });
    await expect(panel).toBeVisible();
    // Focus lands on the close button; the URL remembers the item.
    await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`[?&]item=${laptop.id}`));
    await expect(panel.getByRole("heading", { name: "Recent history" })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole("link", { name: "Open full record" })).toHaveAttribute("href", `/inventory/${laptop.id}`);
    // The seed's own audit row assigned BR-LT-0148 to EMP-0042 (`assignee.to` = the employee number) — the
    // heldItemPanel JSON filter finds it.
    await expect(panel.getByText("Held since", { exact: true })).toBeVisible();
    // IT is on the direct path and the laptop is not pending: the tile menu's Replace and Return are here too.
    await expect(panel.getByRole("button", { name: "Replace…" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Return…" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page).not.toHaveURL(/[?&]item=/);

    // A refresh with ?item= reopens the panel on that held item.
    await page.goto(`/employees/${marites.id}?item=${laptop.id}`);
    await expect(page.getByRole("dialog", { name: `BR-LT-0148 · ${laptop.model}` })).toBeVisible({ timeout: 20_000 });
  });

  test("11. Add a slot asks the category then the type, shows what it will be called, and numbers a second Monitor", async ({ page }) => {
    // Ramon (EMP-0051, Sales) has no policy, so every Monitor tile here is one this case adds.
    const ramon = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0051" } });
    await login(page, IT);
    try {
      await page.goto(`/employees/${ramon.id}`);
      const addButton = page.getByRole("button", { name: "Add a slot for this person…" });
      await waitForHydration(addButton);

      async function addMonitor(kind: string) {
        await addButton.click();
        const dialog = page.getByRole("dialog", { name: `Add a slot for ${ramon.name}` });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel("What").selectOption({ label: "Monitor" });
        // Monitor has two types, so the second question appears (and a category change would reset it).
        const which = dialog.getByLabel("Which kind");
        await expect(which).toBeVisible();
        await expect(which.locator("option", { hasText: "24-inch" })).toHaveCount(1);
        await expect(which.locator("option", { hasText: "27-inch" })).toHaveCount(1);
        await which.selectOption({ label: kind });
        return dialog;
      }

      const first = await addMonitor("27-inch");
      await expect(first.getByText("Shows as “Monitor”")).toBeVisible();
      await first.getByRole("button", { name: "Client requirement", exact: true }).click();
      await first.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("Monitor added for this person")).toBeVisible({ timeout: 10_000 });
      const monitor = page.getByRole("group", { name: "Monitor", exact: true });
      await expect(monitor).toBeVisible();
      await expect(monitor).toContainText("Missing");

      // The second Monitor reads "Monitor 2" in the dialog and then on the grid.
      const second = await addMonitor("24-inch");
      await expect(second.getByText("Shows as “Monitor 2”")).toBeVisible();
      await second.getByRole("button", { name: "Client requirement", exact: true }).click();
      await second.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByRole("group", { name: "Monitor 2", exact: true })).toBeVisible({ timeout: 10_000 });
    } finally {
      // The audit rows stay (append-only); the exceptions this case added go.
      await db.employeeSlotException.deleteMany({ where: { employeeId: ramon.id } });
    }
  });
});
