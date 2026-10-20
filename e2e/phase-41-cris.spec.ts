import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { Prisma, PrismaClient, type AssetStatus } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 41 (spec §4, §6, §10): Cris, the in-app assistant, against the scripted fake model (`CRIS_MODEL=fake`,
 * set on the webServer in playwright.config.ts). People and items are named by employee no. and tag; the
 * fixtures below are created here, after the reseed, so the spare pool the pick list reads is known:
 * page one of the pool (by tag) is BR-HS-0502, BR-LT-9421, BR-LT-9422 — BR-LT-0181 is queued (APR-2041) and
 * BR-MN-0910 is held for Nina, so neither is pickable.
 *
 * Every case starts from no Cris chats and no rate events for the two users it signs in as (beforeEach), and
 * puts back in `finally` the assets, prefs and flag it changed.
 */

const db = new PrismaClient();
const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

const HOLDER = { no: "EMP-0411", name: "Teodora Villanueva" };
const OTHER = { no: "EMP-0412", name: "Bayani Aquino" };
const YSABEL_C = { no: "EMP-0413", name: "Ysabel Cortez" };
const YSABEL_N = { no: "EMP-0414", name: "Ysabel Navarro" };
const PEOPLE = [HOLDER, OTHER, YSABEL_C, YSABEL_N];
/** The laptop the holder gives back, Ysabel Cortez's laptop, and the two spares. */
const OLD = "BR-LT-9411";
const YSABEL_LT = "BR-LT-9413";
const SPARE1 = "BR-LT-9421";
const SPARE2 = "BR-LT-9422";

/**
 * cris-placement.ts (updated 2026-10-18): the mascot (the dock) is 64 px and sits 20 px in from its side and 20 px up;
 * only its centred 44 px glass body takes clicks. The box is 3 px in from the mascot's side and dips 10 px into it.
 */
const MASCOT = 64;
const HIT = 44;
const INSET = 20;
const CORNER_BOTTOM = 20;
const BOX_IN = 3;
const BOX_DIP = 10;

/** Spec §9, verbatim. */
const LIMIT_TEXT = "That's all my questions for today — the limit resets at midnight";
/** The first reply can wait on a dev-server compile of the actions. */
const SLOW = { timeout: 30_000 };

let itUserId = "";
let adminUserId = "";
const ids: Record<string, string> = {};
const people: Record<string, string> = {};

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  itUserId = (await db.user.findUniqueOrThrow({ where: { email: IT } })).id;
  adminUserId = (await db.user.findUniqueOrThrow({ where: { email: ADMIN } })).id;
  const ops = await db.department.findFirstOrThrow({ where: { name: "Operations" } });
  for (const p of PEOPLE) {
    const e = await db.employee.create({
      data: { employeeNo: p.no, name: p.name, title: "Agent", departmentId: ops.id, joinedAt: new Date(Date.now() - 200 * 86_400_000) },
    });
    people[p.no] = e.id;
  }
  const laptop = await db.assetCategory.findUniqueOrThrow({ where: { name: "Laptop" } });
  const standard = await db.assetType.findFirstOrThrow({ where: { name: "Standard", categoryId: laptop.id } });
  const make = (tag: string, model: string, status: AssetStatus, assigneeId: string | null) =>
    db.asset.create({
      data: {
        tag, model, categoryId: laptop.id, typeId: standard.id, cls: "IT", status, assigneeId,
        serial: `SN-${tag}`, cost: 52_000, purchasedAt: new Date(Date.now() - 90 * 86_400_000),
        warrantyUntil: new Date(Date.now() + 600 * 86_400_000), itVerifiedAt: new Date(), labelPrintedAt: new Date(),
      },
    });
  ids[OLD] = (await make(OLD, "Dell Latitude 5440", "DEPLOYED", people[HOLDER.no])).id;
  ids[YSABEL_LT] = (await make(YSABEL_LT, "Dell Latitude 5440", "DEPLOYED", people[YSABEL_C.no])).id;
  ids[SPARE1] = (await make(SPARE1, "ThinkPad T14 Gen 5", "SPARE", null)).id;
  ids[SPARE2] = (await make(SPARE2, "ThinkPad T14 Gen 5", "SPARE", null)).id;
});

test.beforeEach(async () => {
  // A fresh box for every case: no open chat (messages cascade), so today's question count starts at 0 too,
  // and no rate events, so ten questions a minute across the file never trips the limit.
  await db.crisConversation.deleteMany({ where: { userId: { in: [itUserId, adminUserId] } } });
  await db.rateEvent.deleteMany({ where: { userId: { in: [itUserId, adminUserId] } } });
});

test.afterAll(async () => {
  // The next spec's reseed truncates all of this; removed here too so nothing leans on that. Cris's direct
  // changes left EXECUTED approvals on the fixtures, which restrict deleting them.
  const assetIds = Object.values(ids);
  const personIds = Object.values(people);
  await db.approval.deleteMany({ where: { OR: [{ assetId: { in: assetIds } }, { employeeId: { in: personIds } }] } });
  await db.asset.deleteMany({ where: { id: { in: assetIds } } });
  await db.employee.deleteMany({ where: { id: { in: personIds } } });
  await db.crisPendingAction.deleteMany({ where: { userId: { in: [itUserId, adminUserId] } } });
  await db.$disconnect();
});

// Copied from e2e/phase-40.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Phase 47 (spec §5.4): the first page after a sign-in rewrites the settings cookies from the person's saved prefs
  // (UiPrefsSync → restoreUiPrefs, stamping br.uid) and refreshes; wait for it, so the next step never races that refresh.
  const { id } = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, select: { id: true } });
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(id);
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
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

// ── Cris helpers ────────────────────────────────────────────────────────────

/** The mascot while the box is closed (its name grows "— n new replies" and the drag hint on wide screens). */
const closedMascot = (page: Page) => page.getByRole("button", { name: /^Chat with Cris/ });
const dock = (page: Page) => page.locator(".cris-dock");
const orb = (page: Page) => page.locator("button.cris-mascot .cris-orb");
const tuckButton = (page: Page) => page.getByRole("button", { name: "Tuck Cris away", exact: true });
const tab = (page: Page) => page.getByRole("button", { name: /^Bring Cris back/ });
const boxOf = (page: Page) => page.getByRole("dialog", { name: "Chat with Cris" });
const logOf = (box: Locator) => box.getByRole("log");
const composer = (box: Locator) => box.getByRole("textbox", { name: "Your message" });
/** The newest spare pick list (older ones stay as a record, disabled). */
const lastSpares = (box: Locator) => logOf(box).getByRole("group", { name: "Pick a spare" }).last();
/** The newest Confirm card. */
const lastConfirm = (box: Locator) => logOf(box).locator(".cris-msg", { hasText: "Check before you confirm" }).last();

/** Opens the box from the mascot on the current page. */
async function openBox(page: Page): Promise<Locator> {
  const mascot = closedMascot(page);
  await waitForHydration(mascot);
  await mascot.click();
  const box = boxOf(page);
  await expect(box).toBeVisible();
  return box;
}

/** Types a message and sends it with Enter. */
async function send(box: Locator, text: string) {
  const field = composer(box);
  await field.fill(text);
  await field.press("Enter");
}

/** "Replace {holder}'s laptop": the fake finds them, reads their items and lists the spares, then waits. */
async function startReplace(page: Page): Promise<Locator> {
  await page.goto("/");
  const box = await openBox(page);
  await send(box, `Replace ${HOLDER.name}'s laptop`);
  await expect(logOf(box)).toContainText(`Pick a spare for ${HOLDER.name}, or scan its label.`, SLOW);
  await expect(lastSpares(box).getByRole("radio", { name: new RegExp(SPARE1) })).toBeVisible();
  return box;
}

/** Picks a spare from the newest list ("Use {tag}") and waits for the Confirm card. */
async function pickSpare(box: Locator, tag: string) {
  await lastSpares(box).getByRole("radio", { name: new RegExp(tag) }).check();
  await box.getByRole("button", { name: `Use ${tag}` }).click();
  await expect(lastConfirm(box)).toContainText(tag, SLOW);
  await expect(box.getByRole("button", { name: "Confirm replacement" })).toBeVisible();
}

const ASSET_STATE = {
  id: true, status: true, assigneeId: true, returnedAt: true, loanDueAt: true, defectiveSince: true, repairEndedAt: true,
} as const;
type AssetState = Prisma.AssetGetPayload<{ select: typeof ASSET_STATE }>;

async function snapshot(tags: string[]): Promise<AssetState[]> {
  return db.asset.findMany({ where: { id: { in: tags.map((t) => ids[t]) } }, select: ASSET_STATE });
}
/** Puts the assets back exactly as snapshotted (a straight DB write: no audit, nothing for Undo to see). */
async function restore(rows: AssetState[]) {
  for (const { id, ...state } of rows) await db.asset.update({ where: { id }, data: state });
}

const prefsKey = (userId: string) => ({ userId_key: { userId, key: "cris:prefs" } });
async function savedPrefs(userId: string) {
  return db.userPreference.findUnique({ where: prefsKey(userId) });
}
async function restorePrefs(userId: string, row: Awaited<ReturnType<typeof savedPrefs>>) {
  if (row) await db.userPreference.update({ where: prefsKey(userId), data: { value: row.value as Prisma.InputJsonValue } });
  else await db.userPreference.deleteMany({ where: { userId, key: "cris:prefs" } });
}
async function prefsSide(userId: string): Promise<unknown> {
  return ((await savedPrefs(userId))?.value as { side?: unknown } | undefined)?.side;
}
async function prefsTucked(userId: string): Promise<unknown> {
  return ((await savedPrefs(userId))?.value as { tucked?: unknown } | undefined)?.tucked;
}
/** #main's bottom padding: its own 24 px, plus 88 px while the mascot shows (cris-widget.css). */
async function mainPaddingBottom(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.getElementById("main")!).paddingBottom);
}

/** Drags the closed mascot by its centre to (x, y) with real pointer moves; returns where the pointer let go. */
async function dragMascotTo(page: Page, x: number, y: number) {
  const mascot = closedMascot(page);
  await waitForHydration(mascot);
  const from = (await mascot.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 14 });
  await page.mouse.up();
}

async function boxOn(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not on screen");
  return b;
}

test.describe.serial("phase 41 — Cris", () => {
  test("1. IT sees the mascot; a viewer does not", async ({ page }) => {
    await login(page, IT);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Chat with Cris (drag, or use the arrow keys, to move)", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(dock(page)).toHaveCount(1);

    await login(page, VIEWER);
    await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
    await expect(closedMascot(page)).toHaveCount(0);
    await expect(dock(page)).toHaveCount(0);
  });

  test("2. \"Check {person}'s items\" lists their tags and a profile link", async ({ page }) => {
    test.setTimeout(90_000);
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    await login(page, IT);
    await page.goto("/");
    const box = await openBox(page);
    await expect(box).toContainText("what do you need?");
    await expect(composer(box)).toBeFocused();

    await send(box, "Check Marites Bautista's items");
    const log = logOf(box);
    await expect(log).toContainText("Marites Bautista has 4 items:", SLOW);
    for (const tag of ["BR-DK-0071", "BR-LT-0148", "BR-MN-0902", "BR-PH-0287"]) {
      await expect(log.getByRole("link", { name: tag, exact: true })).toBeVisible();
    }
    const profile = log.getByRole("link", { name: "Open Marites's profile →" });
    await expect(profile).toHaveAttribute("href", `/employees/${marites.id}`);
    await expect(box).toContainText("EMP-0042 · Finance");
  });

  test("3. an ambiguous first name asks which person, and the pick shows their items", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/");
    const box = await openBox(page);
    await send(box, "Check Ysabel's items");
    const log = logOf(box);
    await expect(log).toContainText("Which one do you mean? Pick from the list.", SLOW);
    const cortez = log.getByRole("button", { name: new RegExp(`${YSABEL_C.name}.*${YSABEL_C.no}`) });
    await expect(cortez).toBeVisible();
    await expect(log.getByRole("button", { name: new RegExp(`${YSABEL_N.name}.*${YSABEL_N.no}`) })).toBeVisible();

    await cortez.click();
    await expect(log).toContainText(`${YSABEL_C.name} has 1 item: ${YSABEL_LT}`, SLOW);
    await expect(log.getByRole("link", { name: YSABEL_LT, exact: true })).toBeVisible();
    await expect(log.getByRole("link", { name: "Open Ysabel's profile →" })).toHaveAttribute("href", `/employees/${people[YSABEL_C.no]}`);
    // the list was answered: it no longer takes a pick
    await expect(cortez).toBeDisabled();
  });

  test("4. replace with a pick, then Confirm: the record shows the new holder, and History says via Cris", async ({ page }) => {
    test.setTimeout(150_000);
    const before = await snapshot([OLD, SPARE1]);
    try {
      await login(page, IT);
      const box = await startReplace(page);
      await pickSpare(box, SPARE1);
      const card = lastConfirm(box);
      await expect(card).toContainText(HOLDER.name);
      await expect(card).toContainText(`${OLD} → Triage`);
      await expect(card).toContainText(`SN SN-${SPARE1}`);

      await box.getByRole("button", { name: "Confirm replacement" }).click();
      const log = logOf(box);
      await expect(log).toContainText("Replaced.", SLOW);
      await expect(log).toContainText(`${HOLDER.name} has ${SPARE1} now; ${OLD} is back for triage.`);
      await expect(box.getByRole("button", { name: "Confirm replacement" })).toHaveCount(0);

      const spare = await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE1] } });
      expect(spare.assigneeId).toBe(people[HOLDER.no]);
      expect((await db.asset.findUniqueOrThrow({ where: { id: ids[OLD] } })).assigneeId).toBeNull();

      // The record names the new holder.
      await page.goto(`/inventory/${ids[SPARE1]}`);
      await expect(page.getByRole("main").locator("p", { hasText: "held by" })).toContainText(HOLDER.name, { timeout: 20_000 });
      // The timeline's sentence ends "(via Cris)"; History has a Via row reading Cris.
      await page.goto(`/inventory/${ids[SPARE1]}/timeline`);
      await expect(page.getByRole("main")).toContainText("(via Cris)", { timeout: 20_000 });
      await page.goto(`/inventory/${ids[SPARE1]}/history`);
      const via = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Via", exact: true }) }).first();
      await expect(via).toContainText("Cris", { timeout: 20_000 });
      // the audit row itself: under the person's name, with the one extra diff key
      const audit = await db.auditEntry.findFirstOrThrow({
        where: { entityType: "asset", entityId: ids[SPARE1], action: "lifecycle.replace" }, orderBy: { createdAt: "desc" },
      });
      expect(audit.actorId).toBe(itUserId);
      expect((audit.diff as { via?: unknown }).via).toEqual({ from: null, to: "Cris" });
    } finally {
      await restore(before);
    }
  });

  test("5. Undo within 60 s restores both items", async ({ page }) => {
    test.setTimeout(120_000);
    const before = await snapshot([OLD, SPARE1]);
    try {
      await login(page, IT);
      const box = await startReplace(page);
      await pickSpare(box, SPARE1);
      await box.getByRole("button", { name: "Confirm replacement" }).click();
      const log = logOf(box);
      await expect(log).toContainText("Replaced.", SLOW);
      expect((await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE1] } })).assigneeId).toBe(people[HOLDER.no]);

      const undo = box.getByRole("button", { name: "Undo" });
      await expect(undo).toBeVisible();
      await undo.click();
      await expect(log).toContainText(`Undone — ${HOLDER.name} has ${OLD} again, and ${SPARE1} is back in spares.`, SLOW);
      await expect(undo).toHaveCount(0);
      await expect(orb(page)).toHaveClass(/\bm-sad\b/);

      // HARD: the old holder is back, with the status it had; the new item is a Spare again, straight onto the shelf.
      const old = await db.asset.findUniqueOrThrow({ where: { id: ids[OLD] } });
      expect(old.assigneeId).toBe(people[HOLDER.no]);
      expect(old.status).toBe("DEPLOYED");
      expect(old.returnedAt).toBeNull();
      const spare = await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE1] } });
      expect(spare.status).toBe("SPARE");
      expect(spare.assigneeId).toBeNull();
      expect(spare.returnedAt).toBeNull();
      const undone = await db.crisPendingAction.findFirstOrThrow({ where: { userId: itUserId }, orderBy: { createdAt: "desc" } });
      expect(undone.undoneAt).not.toBeNull();

      await page.goto(`/inventory/${ids[OLD]}`);
      await expect(page.getByRole("main").locator("p", { hasText: "held by" })).toContainText(HOLDER.name, { timeout: 20_000 });
    } finally {
      await restore(before);
    }
  });

  test("6. a second Confirm of the same card says \"That's already done.\"", async ({ page }) => {
    test.setTimeout(150_000);
    const before = await snapshot([OLD, SPARE1]);
    const second = await page.context().newPage();
    try {
      await login(page, IT);
      const box = await startReplace(page);
      await pickSpare(box, SPARE1);

      // A fresh page opens the same chat, with the same Confirm card still live.
      await second.goto("/");
      const box2 = await openBox(second);
      await expect(box2.getByRole("button", { name: "Confirm replacement" })).toBeVisible(SLOW);

      // cases 4 and 5 replaced this spare too: count from here
      const replaceWhere = { entityType: "asset", entityId: ids[SPARE1], action: "lifecycle.replace" };
      const prior = await db.auditEntry.count({ where: replaceWhere });
      await box.getByRole("button", { name: "Confirm replacement" }).click();
      await expect(logOf(box)).toContainText("Replaced.", SLOW);

      await box2.getByRole("button", { name: "Confirm replacement" }).click();
      await expect(logOf(box2)).toContainText("That's already done.", SLOW);
      await expect(box2.getByRole("button", { name: "Confirm replacement" })).toHaveCount(0);

      // One change, recorded once.
      expect(await db.auditEntry.count({ where: replaceWhere })).toBe(prior + 1);
      expect((await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE1] } })).assigneeId).toBe(people[HOLDER.no]);
    } finally {
      await second.close();
      await restore(before);
    }
  });

  test("7. the spare is taken before Confirm: the action's refusal shows, spares are offered again, Cris is frustrated", async ({ page }) => {
    test.setTimeout(120_000);
    const before = await snapshot([OLD, SPARE1, SPARE2]);
    try {
      await login(page, IT);
      const box = await startReplace(page);
      await pickSpare(box, SPARE1);

      // Someone else gets the spare meanwhile.
      await db.asset.update({ where: { id: ids[SPARE1] }, data: { status: "DEPLOYED", assigneeId: people[OTHER.no] } });

      await box.getByRole("button", { name: "Confirm replacement" }).click();
      const log = logOf(box);
      // the lifecycle action's own words (planReplace)
      await expect(log).toContainText(`${SPARE1} is Deployed, not a spare.`, SLOW);
      const offered = lastSpares(box);
      await expect(offered.getByRole("radio", { name: new RegExp(SPARE2) })).toBeVisible();
      await expect(offered.getByRole("radio", { name: new RegExp(SPARE1) })).toHaveCount(0);
      await expect(box.getByRole("button", { name: "Confirm replacement" })).toHaveCount(0);
      await expect(orb(page)).toHaveClass(/\bm-cross\b/);

      // Nothing moved: the claim was rolled back with the refusal.
      expect((await db.asset.findUniqueOrThrow({ where: { id: ids[OLD] } })).assigneeId).toBe(people[HOLDER.no]);
      expect((await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE1] } })).assigneeId).toBe(people[OTHER.no]);
      const pending = await db.crisPendingAction.findFirstOrThrow({ where: { userId: itUserId }, orderBy: { createdAt: "desc" } });
      expect(pending.usedAt).toBeNull();
    } finally {
      await restore(before);
    }
  });

  test("8. Change lists the spares again, and a typed exact tag counts as the pick", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    const box = await startReplace(page);
    await pickSpare(box, SPARE1);

    await box.getByRole("button", { name: "Change", exact: true }).click();
    const log = logOf(box);
    await expect(log).toContainText("Pick a different spare, or scan its label.", SLOW);
    await expect(lastSpares(box).getByRole("radio", { name: new RegExp(SPARE2) })).toBeEnabled();
    // the first card is a record now
    await expect(box.getByRole("button", { name: "Confirm replacement" })).toHaveCount(0);

    await expect(composer(box)).toHaveAttribute("placeholder", "Type or scan a tag…");
    await send(box, SPARE2);
    await expect(lastConfirm(box)).toContainText(SPARE2, SLOW);
    await expect(box.getByRole("button", { name: "Confirm replacement" })).toBeVisible();
    // the server took the typed tag as the person's pick: the stored proposal names that spare
    const pending = await db.crisPendingAction.findFirstOrThrow({ where: { userId: itUserId }, orderBy: { createdAt: "desc" } });
    expect((pending.input as { newAssetId?: string }).newAssetId).toBe(ids[SPARE2]);
    expect(pending.usedAt).toBeNull();
    // never confirmed: nothing to put back
    expect((await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE2] } })).status).toBe("SPARE");
  });

  test("9. with a daily limit of 1, the second question gets the limit message", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN);
    await page.goto("/");
    await waitForHydration(closedMascot(page));
    // the page load made the flag row (ensureCrisFlag) if nothing had yet
    const flag = await db.featureFlag.findUniqueOrThrow({ where: { key: "cris" } });
    const value = (flag.value && typeof flag.value === "object" && !Array.isArray(flag.value) ? flag.value : {}) as Prisma.JsonObject;
    try {
      await db.featureFlag.update({ where: { key: "cris" }, data: { value: { ...value, dailyLimit: 1 } } });
      await page.reload();
      const box = await openBox(page);
      await expect(box).toContainText("1 question left today");

      await send(box, "Who has BR-LT-0148?");
      const log = logOf(box);
      await expect(log).toContainText("BR-LT-0148 is with Marites Bautista (EMP-0042).", SLOW);
      await expect(box).toContainText("0 questions left today");

      await send(box, "Who has BR-LT-0201?");
      await expect(log).toContainText(LIMIT_TEXT, SLOW);
      await expect(orb(page)).toHaveClass(/\bm-sad\b/);
      // refused before any model call: the second question was never saved
      expect(await db.crisMessage.count({ where: { role: "user", conversation: { userId: adminUserId } } })).toBe(1);
    } finally {
      await db.featureFlag.update({ where: { key: "cris" }, data: { value: (flag.value as Prisma.InputJsonValue | null) ?? Prisma.JsonNull } });
    }
  });

  test("10. drag the mascot left: it snaps left, stays there after a reload, and the box opens beside it", async ({ page }) => {
    test.setTimeout(90_000);
    const prefsBefore = await savedPrefs(itUserId);
    try {
      await login(page, IT);
      await page.goto("/");
      const vp = page.viewportSize()!;
      const dropY = vp.height - 200;
      await dragMascotTo(page, 200, dropY);

      // Glides to the left side at the height dropped (the grab point was about the centre).
      await expect.poll(async () => Math.round((await boxOn(dock(page))).x)).toBe(INSET);
      const dropped = await boxOn(dock(page));
      expect(Math.abs(dropped.y - (dropY - MASCOT / 2))).toBeLessThan(8);
      await expect.poll(() => prefsSide(itUserId), { timeout: 10_000 }).toBe("left");

      await page.reload();
      await waitForHydration(closedMascot(page));
      await expect.poll(async () => Math.round((await boxOn(dock(page))).x)).toBe(INSET);
      const after = await boxOn(dock(page));
      expect(Math.abs(after.y - dropped.y)).toBeLessThan(2);

      // In the lower half, so the box opens above it, on its left side, the pointer over its centre.
      const box = await openBox(page);
      await expect(box).toHaveClass(/\bcris-above\b/);
      await expect(box).toHaveClass(/\bcris-l\b/);
      await expect(async () => {
        const b = await boxOn(box);
        expect(Math.abs(b.x - (after.x + BOX_IN))).toBeLessThan(2);
        expect(Math.abs(b.y + b.height - (after.y + BOX_DIP))).toBeLessThan(2);
      }).toPass({ timeout: 5_000 });
      const pointer = await box.evaluate((el) => {
        const s = getComputedStyle(el, "::after");
        return { left: s.left, width: s.width, display: s.display };
      });
      expect(pointer.display).not.toBe("none");
      expect(pointer.left).toBe("21px");
      // 3 + 21 + 8 (half the 16 px pointer) = 32: the mascot's centre
      expect(BOX_IN + parseFloat(pointer.left) + parseFloat(pointer.width) / 2).toBe(MASCOT / 2);
    } finally {
      await restorePrefs(itUserId, prefsBefore);
    }
  });

  test("11. focus goes to the message box on open, and back to the mascot on Esc", async ({ page }) => {
    await login(page, IT);
    await page.goto("/");
    const box = await openBox(page);
    await expect(composer(box)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(box).toHaveCount(0);
    await expect(closedMascot(page)).toBeFocused();
    await expect(page.locator("body")).not.toBeFocused();
  });

  test("12. at phone width the box is a fixed panel across the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, IT);
    await page.goto("/");
    // no drag hint on a phone, where the mascot is fixed
    await expect(page.getByRole("button", { name: "Chat with Cris", exact: true })).toBeVisible({ timeout: 20_000 });
    const box = await openBox(page);
    expect(await box.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    expect(await box.evaluate((el) => getComputedStyle(el, "::after").display)).toBe("none");
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    await expect(async () => {
      const b = await boxOn(box);
      expect(Math.round(b.x)).toBe(12);
      expect(Math.abs(b.width - (width - 24))).toBeLessThan(2);
      // 8 px over the 56 px phone mascot, which sits 16 px up
      expect(Math.abs(b.y + b.height - (812 - 80))).toBeLessThan(2);
    }).toPass({ timeout: 5_000 });
    await expect(composer(box)).toBeFocused();
  });

  test("13. axe: the open box (with a card) and Settings › Cris", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto("/");
    const box = await openBox(page);
    await expectNoSeriousAxe(page);
    await send(box, "Check Marites Bautista's items");
    await expect(logOf(box).getByRole("link", { name: "BR-LT-0148", exact: true })).toBeVisible(SLOW);
    await expectNoSeriousAxe(page);

    await page.goto("/settings/cris");
    await expect(page.getByRole("heading", { name: "Cris", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);

    // the admin's page adds "Cris for everyone"
    await login(page, ADMIN);
    await page.goto("/settings/cris");
    await expect(page.getByRole("heading", { name: "Cris for everyone" })).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousAxe(page);
  });

  test("14. Settings › Cris \"Put Cris back in the corner\" moves a dragged mascot back", async ({ page }) => {
    test.setTimeout(90_000);
    const prefsBefore = await savedPrefs(itUserId);
    try {
      await login(page, IT);
      await page.goto("/settings/cris");
      const reset = page.getByRole("button", { name: "Put Cris back in the corner" });
      await waitForHydration(reset);
      const vp = page.viewportSize()!;
      await dragMascotTo(page, 200, 300);
      await expect.poll(async () => Math.round((await boxOn(dock(page))).x)).toBe(INSET);
      await expect.poll(() => prefsSide(itUserId), { timeout: 10_000 }).toBe("left");

      await reset.click();
      await expect(page.getByText("Cris is back in the corner").first()).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      await expect.poll(async () => Math.round((await boxOn(dock(page))).x)).toBe(width - INSET - MASCOT);
      await expect.poll(async () => Math.round((await boxOn(dock(page))).y)).toBe(vp.height - CORNER_BOTTOM - MASCOT);
      const saved = (await savedPrefs(itUserId))?.value as { side?: unknown; bottom?: unknown; tucked?: unknown };
      expect(saved.side).toBe("right");
      expect(saved.bottom).toBe(CORNER_BOTTOM);
      expect(saved.tucked).toBe(false);

      // It also brings a tucked-away Cris back. The "–" shows on keyboard focus (:focus-visible), so the mascot is
      // reached by the keyboard: focus it, step back and Tab onto it again, then Tab to the "–".
      await closedMascot(page).focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(closedMascot(page)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(tuckButton(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(tab(page)).toBeVisible();
      await expect.poll(() => prefsTucked(itUserId), { timeout: 10_000 }).toBe(true);
      await reset.click();
      await expect(closedMascot(page)).toBeVisible();
      await expect(tab(page)).toHaveCount(0);
      await expect.poll(() => prefsTucked(itUserId), { timeout: 10_000 }).toBe(false);
    } finally {
      await restorePrefs(itUserId, prefsBefore);
    }
  });

  test("15. retention: the prune removes chats untouched for 30 days and pending actions older than a day", async () => {
    const day = 86_400_000;
    const oldChat = await db.crisConversation.create({ data: { userId: itUserId, updatedAt: new Date(Date.now() - 31 * day) } });
    await db.crisMessage.create({ data: { conversationId: oldChat.id, role: "user", content: { text: "old", cards: [] }, createdAt: new Date(Date.now() - 31 * day) } });
    const freshChat = await db.crisConversation.create({ data: { userId: itUserId, updatedAt: new Date(Date.now() - 29 * day) } });
    const pendingRow = (createdAt: Date) => db.crisPendingAction.create({
      data: { userId: itUserId, conversationId: freshChat.id, kind: "assign", input: {}, card: {}, createdAt, expiresAt: new Date(createdAt.getTime() + 600_000) },
    });
    const oldPending = await pendingRow(new Date(Date.now() - 2 * day));
    const freshPending = await pendingRow(new Date(Date.now() - 2 * 3_600_000));
    try {
      // The npm script the operator runs (as e2e/it-gaps.spec.ts does), not pruneRetention() imported here.
      const out = execSync("npm run worker:prune", { timeout: 120_000, encoding: "utf8" });
      expect(out).toMatch(/\[prune\] removed \d+ Cris chats older than 30 days and \d+ Cris pending actions older than 1 day/);
      expect(await db.crisConversation.findUnique({ where: { id: oldChat.id } })).toBeNull();
      expect(await db.crisMessage.count({ where: { conversationId: oldChat.id } })).toBe(0);
      expect(await db.crisConversation.findUnique({ where: { id: freshChat.id } })).not.toBeNull();
      expect(await db.crisPendingAction.findUnique({ where: { id: oldPending.id } })).toBeNull();
      expect(await db.crisPendingAction.findUnique({ where: { id: freshPending.id } })).not.toBeNull();
    } finally {
      await db.crisPendingAction.deleteMany({ where: { id: { in: [oldPending.id, freshPending.id] } } });
      await db.crisConversation.deleteMany({ where: { id: { in: [oldChat.id, freshChat.id] } } });
    }
  });

  test("16. assign with a scan: Scanned ✓ on the card, Confirm deploys it, Undo puts it back on the shelf and the hold back", async ({ page }) => {
    test.setTimeout(150_000);
    const before = await snapshot([SPARE2]);
    // A hold for the person on the spare: the assign fulfils it, and Undo must make it ACTIVE again.
    const hold = await db.reservation.create({ data: { assetId: ids[SPARE2], employeeId: people[OTHER.no], state: "ACTIVE" } });
    try {
      await login(page, IT);
      await page.goto("/");
      const box = await openBox(page);
      await send(box, `Assign a laptop to ${OTHER.name}`);
      const log = logOf(box);
      await expect(log).toContainText(`Pick a spare for ${OTHER.name}, or scan its label.`, SLOW);
      await expect(lastSpares(box).getByRole("radio", { name: new RegExp(SPARE2) })).toBeVisible();

      // "Scan its label" opens the scan field with focus; a scanner types the tag and Enter.
      await box.getByRole("button", { name: "Scan its label" }).click();
      const scanner = box.getByRole("textbox", { name: "Scanner input" });
      await expect(scanner).toBeFocused();
      await scanner.fill(SPARE2);
      await scanner.press("Enter");

      const card = lastConfirm(box);
      await expect(card).toContainText(SPARE2, SLOW);
      await expect(card).toContainText(OTHER.name);
      await expect(card).toContainText("Scanned ✓");
      // the server stored the scanned spare as the proposal
      const pending = await db.crisPendingAction.findFirstOrThrow({ where: { userId: itUserId }, orderBy: { createdAt: "desc" } });
      expect(pending.kind).toBe("assign");
      expect(pending.input).toMatchObject({ assetId: ids[SPARE2], employeeId: people[OTHER.no] });

      await box.getByRole("button", { name: "Confirm assignment" }).click();
      await expect(log).toContainText("Assigned.", SLOW);
      await expect(log).toContainText(`${SPARE2} is with ${OTHER.name} now.`);
      await expect(box.getByRole("button", { name: "Confirm assignment" })).toHaveCount(0);
      const deployed = await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE2] } });
      expect(deployed.status).toBe("DEPLOYED");
      expect(deployed.assigneeId).toBe(people[OTHER.no]);
      expect((await db.reservation.findUniqueOrThrow({ where: { id: hold.id } })).state).toBe("FULFILLED");

      const undo = box.getByRole("button", { name: "Undo" });
      await expect(undo).toBeVisible();
      await undo.click();
      await expect(log).toContainText(`Undone — ${SPARE2} is back in spares.`, SLOW);
      await expect(undo).toHaveCount(0);

      // Straight back onto the shelf (no triage), never marked returned, and the hold is live again.
      const back = await db.asset.findUniqueOrThrow({ where: { id: ids[SPARE2] } });
      expect(back.status).toBe("SPARE");
      expect(back.assigneeId).toBeNull();
      expect(back.returnedAt).toBeNull();
      const restored = await db.reservation.findUniqueOrThrow({ where: { id: hold.id } });
      expect(restored.state).toBe("ACTIVE");
      expect(restored.resolvedAt).toBeNull();
    } finally {
      await db.reservation.deleteMany({ where: { id: hold.id } });
      await restore(before);
    }
  });

  test("17. \"Spares in stock\" lists the spares free for anyone, read-only, with Show 3 more", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto("/");
    const box = await openBox(page);
    await box.getByRole("button", { name: "Spares in stock", exact: true }).click();
    const log = logOf(box);
    // page one of the pool by tag; BR-LT-0181 (queued) and BR-MN-0910 (held for Nina) are never in stock
    await expect(log).toContainText(`Spares in stock: BR-HS-0502 (Jabra Evolve2 40), ${SPARE1}`, SLOW);
    for (const tag of ["BR-HS-0502", SPARE1, SPARE2]) await expect(log.getByRole("listitem").filter({ hasText: tag })).toHaveCount(1);
    await expect(log).not.toContainText("BR-LT-0181");
    await expect(log).not.toContainText("BR-MN-0910");
    // read-only: nothing to pick or scan, and the placeholder doesn't ask for a tag
    await expect(log.getByRole("radio")).toHaveCount(0);
    await expect(box.getByRole("button", { name: "Scan its label" })).toHaveCount(0);
    await expect(composer(box)).toHaveAttribute("placeholder", "Ask Cris anything about equipment or people…");

    const firstList = log.locator(".cris-msg", { has: page.getByRole("listitem").filter({ hasText: "BR-HS-0502" }) });
    await firstList.getByRole("button", { name: "Show 3 more" }).click();
    await expect(log.getByRole("listitem").filter({ hasText: "BR-PH-0301" })).toHaveCount(1, SLOW);
    // only the newest list offers more: the first one is a record now
    await expect(firstList.getByRole("button", { name: "Show 3 more" })).toHaveCount(0);
  });

  // ── 2026-10-18 (owner's request): a smaller Cris that never blocks the page ──

  test("18. on Register assets, the sticky bar's primary button takes a real click with Cris in the corner", async ({ page }) => {
    test.setTimeout(90_000);
    const before = await db.asset.count();
    await login(page, IT);
    await page.goto("/inventory/register");
    await waitForHydration(closedMascot(page));
    const submit = page.getByRole("button", { name: "Register 1 asset", exact: true });
    await waitForHydration(submit);
    await submit.scrollIntoViewIfNeeded();

    // The bar keeps its buttons out of Cris's corner: 84 px of padding on Cris's side, and the button ends left of Cris.
    const bar = page.locator("[data-cris-avoid]");
    expect(await bar.evaluate((el) => getComputedStyle(el).paddingRight)).toBe("84px");
    const button = await boxOn(submit);
    const cris = await boxOn(dock(page));
    expect(button.x + button.width).toBeLessThanOrEqual(cris.x);
    // #main has room at its end for the last row to scroll clear of Cris
    expect(await mainPaddingBottom(page)).toBe(`${24 + 88}px`);

    // A real mouse click: Playwright's actionability check fails if anything of Cris's intercepts it.
    await submit.click();
    // It landed: an empty form is refused with the first field's hint, and nothing was saved.
    await expect(page.getByText("Pick a category").first()).toBeVisible();
    await expect(boxOf(page)).toHaveCount(0);
    expect(await db.asset.count()).toBe(before);
  });

  test("19. tuck Cris away: a tab on the edge, kept after a reload; the tab brings the mascot back with focus", async ({ page }) => {
    test.setTimeout(90_000);
    const prefsBefore = await savedPrefs(itUserId);
    try {
      await login(page, IT);
      await page.goto("/");
      const mascot = closedMascot(page);
      await waitForHydration(mascot);

      // The "–" shows on hover at the orb's top inward corner (left, for a Cris on the right) ...
      await mascot.hover();
      await expect(tuckButton(page)).toBeVisible();
      const corner = await boxOn(tuckButton(page));
      const crisAt = await boxOn(dock(page));
      expect(corner.x).toBeLessThan(crisAt.x + MASCOT / 2);
      expect(corner.y).toBeLessThan(crisAt.y + MASCOT / 2);
      // ... hides again once the pointer leaves (after a short grace) ...
      await page.mouse.move(0, 0);
      await expect(tuckButton(page)).toBeHidden();
      // ... and, by keyboard, it is the next Tab stop after the mascot (shown on :focus-visible, not a mouse focus).
      await mascot.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(mascot).toBeFocused();
      await expect(tuckButton(page)).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(tuckButton(page)).toBeFocused();
      await page.keyboard.press("Enter");

      // Tucked: the mascot is gone, the tab is on the right edge with focus, and the corner padding is off.
      const back = tab(page);
      await expect(back).toBeVisible();
      await expect(back).toBeFocused();
      await expect(closedMascot(page)).toHaveCount(0);
      await expect(dock(page)).toHaveCount(0);
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      const t = await boxOn(back);
      expect(Math.round(t.x + t.width)).toBe(width);
      expect(Math.round(t.width)).toBe(22);
      expect(Math.round(t.height)).toBe(56);
      expect(await mainPaddingBottom(page)).toBe("24px");
      await expect.poll(() => prefsTucked(itUserId), { timeout: 10_000 }).toBe(true);

      // It stays tucked after a reload.
      await page.reload();
      await waitForHydration(tab(page));
      await expect(tab(page)).toBeVisible();
      await expect(closedMascot(page)).toHaveCount(0);

      // The tab brings the mascot back, with focus (never on body), and that is saved too.
      await tab(page).click();
      await expect(closedMascot(page)).toBeVisible();
      await expect(closedMascot(page)).toBeFocused();
      await expect(page.locator("body")).not.toBeFocused();
      await expect(tab(page)).toHaveCount(0);
      expect(await mainPaddingBottom(page)).toBe(`${24 + 88}px`);
      await expect.poll(() => prefsTucked(itUserId), { timeout: 10_000 }).toBe(false);
    } finally {
      await restorePrefs(itUserId, prefsBefore);
    }
  });

  test("20. a click on Cris's rings, just outside the glass body, reaches the page beneath; the glass still opens the box", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, IT);
    await page.goto("/");
    const mascot = closedMascot(page);
    await waitForHydration(mascot);
    const cris = await boxOn(dock(page));
    expect(Math.round(cris.width)).toBe(MASCOT);
    expect(Math.round((await boxOn(mascot)).width)).toBe(HIT);

    // A known button laid under the whole dock (Cris's z-index is 30), counting the clicks it gets.
    await page.evaluate((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.id = "under-cris";
      b.textContent = "Beneath";
      b.dataset.hits = "0";
      Object.assign(b.style, {
        position: "fixed", left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: "29",
      });
      b.addEventListener("click", () => {
        b.dataset.hits = String(Number(b.dataset.hits) + 1);
      });
      document.body.appendChild(b);
    }, cris);
    const under = page.locator("#under-cris");
    const cx = cris.x + cris.width / 2;
    const cy = cris.y + cris.height / 2;
    // The ring 28 px out from the centre (the glass is 22 px), and the glass button's square corner 19 px out each way.
    const outside = [
      { x: cx + 28, y: cy },
      { x: cx + 19, y: cy + 19 },
    ];
    for (const p of outside) {
      expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? null, p)).toBe("under-cris");
      await page.mouse.click(p.x, p.y);
    }
    await expect(under).toHaveAttribute("data-hits", "2");
    await expect(boxOf(page)).toHaveCount(0);
    await expect(mascot).toHaveAttribute("aria-expanded", "false");

    // The glass body itself still opens the box.
    await page.mouse.click(cx, cy);
    await expect(boxOf(page)).toBeVisible();
    await expect(under).toHaveAttribute("data-hits", "2");
  });
});
