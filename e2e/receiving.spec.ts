import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { ROLE_LANDING } from "@/lib/workspaces";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 12, Task 7 (third revision). Two surfaces: registration (Task 5 — IT
 * registers already-purchased assets with auto-numbered tags, no purchase
 * request required) and Finance review (Task 6's confirm, Task 7a's C-7
 * send-back/mark-corrected).
 *
 * Receiving (`receiveUnits`, `receivableUnits`, `outstanding`,
 * `isFullyReceived`) is GONE — C-11 deleted that orphaned code, since C-5 had
 * already replaced its only would-be UI with registration and nothing ever
 * consumed it. There is nothing left to test there; this file does not
 * reference those names.
 *
 * Registration was previously broken at every quantity: `register-form.tsx`
 * grew its serials array with `next.length = n`, which creates holes that
 * `.map` skips, so `serials.0` serialized as `undefined` and zod rejected
 * every submit. Fixed in commit 7e1c02a (`Array.from` instead of the
 * length-assignment). Tests 1-13 below are real, passing assertions against
 * the fixed form.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 * Assets are referenced by `tag`.
 *
 * Tests within each `describe` share mutable fixture state (a tag registered
 * in an earlier test is confirmed/returned in a later one) — this file must
 * run single-worker, in declaration order (the run command mandates
 * `--workers=1`; this project's playwright.config.ts does not set
 * `fullyParallel`, so declaration order already holds within one file, and
 * every block below is additionally marked `serial` to make that dependency
 * explicit rather than incidental).
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
});

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

/** The highest number currently in use by the BR-LT- prefix. Never hardcode
 * 0210/0211 — an earlier test in this very file may have registered more. */
async function highestLtNumber(): Promise<number> {
  const rows = await db.asset.findMany({ where: { tag: { startsWith: "BR-LT-" } }, select: { tag: true } });
  return rows.reduce((max, r) => Math.max(max, Number(r.tag.slice(6))), 0);
}
const ltTag = (n: number) => `BR-LT-${String(n).padStart(4, "0")}`;

// Phase 34 register helpers, copied from e2e/register-labels.spec.ts (house rule: never import across spec files).
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A card is named "{name} {N} in stock" or "{name} None yet" — anchored at both ends, since "Laptop" prefixes "Laptop Bag". */
async function pickCategory(page: Page, name: string) {
  const card = page.getByRole("button", { name: new RegExp(`^${escapeRe(name)} (\\d+ in stock|None yet)$`) });
  await waitForHydration(card);
  await card.click();
}

const modelBox = (page: Page) => page.getByRole("combobox", { name: "Model", exact: true });

/** Picks a known model from the list, else adds it as new — then a new model in a category with several types takes `type`. */
async function pickModel(page: Page, model: string, type?: string) {
  await modelBox(page).fill(model);
  await expect(page.getByRole("option").first()).toBeVisible();
  const known = page.getByRole("option", { name: model, exact: true });
  if (await known.count()) await known.first().click();
  else await page.getByRole("option", { name: new RegExp(`^\\+ Add .${escapeRe(model)}. as a new model$`) }).click();
  if (type) await page.getByRole("combobox", { name: "Type", exact: true }).selectOption({ label: type });
}

async function setQuantity(page: Page, n: number) {
  const box = page.getByRole("textbox", { name: "How many", exact: true });
  await box.fill(String(n));
  await box.blur();
  if (n > 1) await expect(page.getByRole("textbox", { name: `Serial ${n}`, exact: true })).toBeVisible();
}

let laptopCategoryId: string;
let thinkpadTypeId: string;
let financeUserId: string;

// Fixtures for the Finance-review surface (Step 2/3), created directly via
// Prisma rather than through /inventory/register: that screen is Task 5's
// surface and is already fully exercised in Step 1, and this block needs
// several assets in distinct pre-set states (returned, confirmed) that the
// registration flow itself has no reason to produce. A "ZZ" prefix keeps
// these completely out of the BR-LT- numbering Step 1/registration tests
// read the maximum of, regardless of execution order.
let assetReturn: { id: string; tag: string };
let assetShortReason: { id: string; tag: string };
let assetConfirmed: { id: string; tag: string };

// Set by the registration block's first test, read by the confirmation
// block that follows it — the same asset a user registers is the one Finance
// later reviews. Module scope because the two are separate `describe`
// blocks; declaration order (see the file header) is what makes this safe.
let tag1: string, tag2: string, tag3: string;

test.beforeAll(async () => {
  const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop" } });
  laptopCategoryId = laptop.id;
  thinkpadTypeId = (await db.assetType.findFirstOrThrow({ where: { name: "High-performance", categoryId: laptop.id } })).id;
  financeUserId = (await db.user.findUniqueOrThrow({ where: { email: "finance@thebackroomop.com" } })).id;

  // Phase 14: an IT-class asset with itVerifiedAt still null reads as
  // "awaiting IT check" (isAwaitingItCheck, src/lib/asset-class.ts), which
  // hides BOTH Confirm details and Send back to IT — the whole point of this
  // block. These fixtures stand in for Task 5's real registration screen,
  // where IT registering its own class self-checks on creation
  // (`itVerifiedAt: selfChecked ? new Date() : null`, actions.ts ~line 245),
  // so match that here rather than leaving Finance-review fixtures stuck
  // behind a check they were never meant to exercise.
  const mk = (tag: string) =>
    db.asset.create({
      data: {
        tag,
        model: "e2e fixture — Finance review",
        categoryId: laptopCategoryId,
        status: "SPARE",
        itVerifiedAt: new Date(),
      },
    });
  assetReturn = await mk("BR-ZZ-0001");
  assetShortReason = await mk("BR-ZZ-0002");
  assetConfirmed = await mk("BR-ZZ-0003");
});

test.describe("registration — the primary path", () => {
  test.describe.configure({ mode: "serial" });

  test("a batch writes exactly what it said", async ({ page }) => {
    const highest = await highestLtNumber();
    tag1 = ltTag(highest + 1);
    tag2 = ltTag(highest + 2);
    tag3 = ltTag(highest + 3);

    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/register");

    await pickCategory(page, "Laptop");
    // Phase 36: the Type is always asked, and staff type their own tags.
    await pickModel(page, "ThinkPad T14 Gen 4 (e2e batch)", "High-performance");
    await setQuantity(page, 3);
    await page.getByLabel("Tag 1", { exact: true }).fill(tag1);
    await page.getByLabel("Tag 2", { exact: true }).fill(tag2);
    await page.getByLabel("Tag 3", { exact: true }).fill(tag3);
    // Phase 34: every IT unit needs a serial.
    const stamp = `E2E-RCV-1-${Date.now()}`;
    for (const i of [1, 2, 3]) await page.getByLabel(`Serial ${i}`, { exact: true }).fill(`${stamp}-${i}`);

    await page.getByRole("button", { name: "Register 3 laptops", exact: true }).click();
    // Plan P-5: Register lands on the Labels tab with this batch ticked
    // ("3 × <model> <first> → <last>") and ready to print.
    await page.waitForURL(/\/inventory\/labels\?just=/, { timeout: 30_000 });
    await expect(page.getByRole("checkbox", { name: new RegExp(`${tag1} → ${tag3}`) })).toBeChecked();
    await expect(page.getByRole("button", { name: "Print 3 labels", exact: true })).toBeVisible();

    const assets = await db.asset.findMany({ where: { tag: { in: [tag1, tag2, tag3] } }, orderBy: { tag: "asc" } });
    expect(assets).toHaveLength(3);
    expect(assets.map((a) => a.tag)).toEqual([tag1, tag2, tag3]);
    for (const a of assets) {
      expect(a.status).toBe("SPARE");
      expect(a.categoryId).toBe(laptopCategoryId);
      expect(a.typeId).toBe(thinkpadTypeId);
      // Unconfirmed is the correct initial state — asserting it here is what
      // stops a later change quietly auto-confirming on registration.
      expect(a.financeConfirmedAt).toBeNull();
    }
  });

  test("a duplicate tag inside one batch is refused and writes NOTHING", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/register");
    const before = await db.asset.count();

    await pickCategory(page, "Laptop");
    await pickModel(page, "e2e — in-batch duplicate", "High-performance");
    await setQuantity(page, 2);
    // Serials filled, so the repeated tag is the only thing wrong.
    const stamp = `E2E-RCV-2-${Date.now()}`;
    for (const i of [1, 2]) await page.getByLabel(`Serial ${i}`, { exact: true }).fill(`${stamp}-${i}`);
    const dupeTag = `RCV${Date.now().toString(36).slice(-6).toUpperCase()}-D`;
    await page.getByLabel("Tag 1", { exact: true }).fill(dupeTag);
    await page.getByLabel("Tag 2", { exact: true }).fill(dupeTag);

    // Phase 30 (spec §5.5): said as soon as the row repeats, naming the row in
    // registerAssets' own words — and the submit is refused right here, so it
    // hands focus back to the repeated cell and the server is never asked.
    const repeat = page.getByText(`Row 2 · ${dupeTag} appears twice in this batch`);
    await expect(repeat).toBeVisible();
    await page.getByRole("button", { name: "Register 2 laptops", exact: true }).click();
    await expect(page.getByLabel("Tag 2", { exact: true })).toBeFocused();
    await expect(repeat).toHaveCount(1);

    // The absence of a success message proves nothing — only the count does.
    expect(await db.asset.count()).toBe(before);
  });

  test("a tag that already exists is refused and writes NOTHING", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/register");

    await pickCategory(page, "Laptop");
    await pickModel(page, "e2e — seeded tag collision", "High-performance");
    // Phase 36: staff type the tag, so type one that already exists.
    const taken = `RCV${Date.now().toString(36).slice(-6).toUpperCase()}-T`;
    await page.getByRole("textbox", { name: "Tag", exact: true }).fill(taken);
    await db.asset.create({
      data: { tag: taken, model: "e2e fixture — tag race", categoryId: laptopCategoryId, status: "SPARE", itVerifiedAt: new Date() },
    });
    const before = await db.asset.count();
    await page.getByRole("textbox", { name: "Serial number", exact: true }).fill(`E2E-RCV-3-${Date.now()}`);

    // Phase 30 (plan P-13, ruling R3): quantity 1 goes through createAsset,
    // whose one-pass refusal names the tag on row 1 — one line, not two.
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await expect(page.getByText(`Row 1 · ${taken} is already registered`)).toHaveCount(1, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/inventory\/register$/);

    // This guard is a database uniqueness constraint, not application logic —
    // no mutation proof is needed for it (Step 5).
    expect(await db.asset.count()).toBe(before);
  });

  test("an audit row exists per registered asset, action register", async () => {
    const assets = await db.asset.findMany({ where: { tag: { in: [tag1, tag2, tag3] } } });
    expect(assets).toHaveLength(3);
    const entries = await db.auditEntry.findMany({
      where: { entityType: "asset", action: "register", entityId: { in: assets.map((a) => a.id) } },
    });
    expect(entries).toHaveLength(3);
  });

  // The PATH_RULES ordering guard. Hitting /inventory/register itself would
  // NOT isolate this: the page also carries its own requireRole("admin",
  // "it_staff", "purchasing_staff"), which would redirect both roles to the
  // same landing even if the PATH_RULES entry were deleted or moved after the
  // general /inventory
  // rule — exactly the "either layer may be the one that refuses" trap
  // e2e/labels.spec.ts documents for the identical shape. So, like that
  // file's dedicated PATH_RULES probe, this hits a path with NO page file
  // (.../no-such-page) — only middleware can answer for that, so a misordered
  // or deleted rule shows up as a 200 with no redirect at all. This really is
  // the only test in the suite that observes the ordering. Both roles are
  // asserted — do not assume one implies the other.
  test("neither viewer nor finance_staff can reach /inventory/register", async ({ page }) => {
    for (const [email, landing] of [
      ["finance@thebackroomop.com", ROLE_LANDING.finance_staff],
      ["viewer@thebackroomop.com", ROLE_LANDING.viewer],
    ] as const) {
      await login(page, email);
      const res = await page.goto("/inventory/register/no-such-page");
      expect(res?.request().redirectedFrom()?.url()).toContain("/inventory/register/no-such-page");
      expect(new URL(res!.url()).pathname).toBe(landing);
    }
  });
});

test.describe("Finance review — confirm", () => {
  test.describe.configure({ mode: "serial" });

  test("Finance confirms and the record says so", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: tag1 } });
    await login(page, "finance@thebackroomop.com");
    // Phase 35 (plan P-9): Finance reviews on its own page. The registered batch has no cost, so the
    // approval is "Approve as not capitalised" (spec 3.4).
    await page.goto(`/finance/assets/${asset.id}`);

    const approve = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Approve as not capitalised" });
    await expect(approve).toBeVisible();
    await page.waitForTimeout(500);
    await approve.click();
    await expect(page.getByText(`${tag1} approved as not capitalised`)).toBeVisible();

    // The next record waiting on Finance opens straight away: the URL lands on /finance/assets/{next}
    // (seeded IT assets are all still waiting, so a next one always exists).
    await page.waitForURL((u) => u.pathname.startsWith("/finance/assets/") && u.pathname !== `/finance/assets/${asset.id}`);
    await page.goto(`/finance/assets/${asset.id}`);
    await expect(page.getByRole("region", { name: "Review" })).toHaveCount(0);

    const updated = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(updated.financeConfirmedAt).not.toBeNull();
    expect(updated.financeConfirmedById).toBe(financeUserId);

    const entry = await db.auditEntry.findFirst({
      where: { entityType: "asset", entityId: asset.id, action: "finance.confirm" },
    });
    expect(entry).not.toBeNull();
  });

  // A naive same-user double-click can't reach this: canConfirm is
  // `!asset.financeConfirmedAt`, so the moment an asset is confirmed the
  // Confirm/Send-back pair stops rendering at all — there is no button left
  // to double-click through the UI. The real invariant under test is the
  // state-guarded `updateMany` in confirmAssetDetails, which exists
  // precisely for a CONCURRENT confirmation landing between another actor's
  // read and write. So: open the dialog while still unconfirmed (the button
  // is still there), manufacture the concurrent confirmation directly via
  // Prisma — the same technique e2e/scanner.spec.ts and this file's own
  // fixture setup use for a state the seed/UI can't produce alone — then
  // submit the still-open dialog into that race.
  test("Confirming twice is refused", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: tag2 } });
    await login(page, "finance@thebackroomop.com");
    await page.goto(`/finance/assets/${asset.id}`);

    const review = page.getByRole("region", { name: "Review" });
    const approve = review.getByRole("button", { name: "Approve as not capitalised" });
    await expect(approve).toBeVisible();
    await page.waitForTimeout(500);

    const raceTime = new Date();
    await db.asset.update({
      where: { id: asset.id },
      data: { financeConfirmedAt: raceTime, financeConfirmedById: financeUserId },
    });

    await approve.click();
    // Phase 35: the refusal renders inside the Review box, which stays put on failure.
    await expect(review.getByText(`${tag2} was already confirmed.`)).toBeVisible();

    // A second write that merely overwrote the same field with a new
    // timestamp would pass a naive "still confirmed" assertion — compare the
    // actual value, not just its nullness.
    const updated = await db.asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(updated.financeConfirmedAt?.getTime()).toBe(raceTime.getTime());
  });

  test("it_staff cannot confirm", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: tag3 } });
    await login(page, "it@thebackroomop.com");
    // Phase 35: the review controls live only on the Finance asset page, and IT is turned away from it.
    await page.goto(`/finance/assets/${asset.id}`);
    expect(new URL(page.url()).pathname.startsWith("/finance")).toBe(false);
    await expect(page.getByRole("region", { name: "Review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Approve|Send back to IT…/ })).toHaveCount(0);
  });
});

test.describe("Finance review — send back and correct", () => {
  test.describe.configure({ mode: "serial" });

  test("Finance sends an asset back with a reason", async ({ page }) => {
    const reason = "e2e: serial number does not match the physical unit.";
    await login(page, "finance@thebackroomop.com");
    // Phase 35 (plan P-9): the checklist dialog lives on the Finance asset page. The fixture has no cost,
    // so "Cost" arrives pre-ticked.
    await page.goto(`/finance/assets/${assetReturn.id}`);

    const sendBack = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Send back to IT…" });
    await expect(sendBack).toBeVisible();
    await page.waitForTimeout(500);
    await sendBack.click();
    const dialog = page.getByRole("dialog", { name: `Send ${assetReturn.tag} back to IT` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Cost", { exact: true })).toBeChecked();
    await dialog.getByLabel("Note for IT").fill(reason);
    await dialog.getByRole("button", { name: "Send back", exact: true }).click();
    await expect(page.getByText(`${assetReturn.tag} sent back to IT`)).toBeVisible();

    // Finance's own page says what went back to whom.
    await expect(page.getByText(/Sent back to IT: Cost/)).toContainText(reason);

    const updated = await db.asset.findUniqueOrThrow({ where: { id: assetReturn.id } });
    expect(updated.financeReturnedAt).not.toBeNull();
    expect(updated.financeReturnReason).toBe(reason);
    expect(updated.financeReturnFields).toEqual(["cost"]);

    const entry = await db.auditEntry.findFirst({
      where: { entityType: "asset", entityId: assetReturn.id, action: "finance.return" },
    });
    expect(entry?.diff).toMatchObject({ financeReturn: { to: { fields: ["Cost"], note: reason } } });

    // IT reads it on the record itself, not only in the audit tab.
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${assetReturn.id}`);
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toBeVisible();
    // ...including what Finance flagged and why (restored from the pre-Phase-35 assertion).
    await expect(page.getByText("Finance flagged:")).toBeVisible();
    await expect(page.getByRole("paragraph").filter({ hasText: reason })).toBeVisible();
  });

  test("A too-short reason is refused and WRITES NOTHING", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto(`/finance/assets/${assetShortReason.id}`);

    const sendBack = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Send back to IT…" });
    await expect(sendBack).toBeVisible();
    await page.waitForTimeout(500);
    await sendBack.click();
    const dialog = page.getByRole("dialog", { name: `Send ${assetShortReason.tag} back to IT` });
    await dialog.getByLabel("Note for IT").fill("x");
    await dialog.getByRole("button", { name: "Send back", exact: true }).click();

    // A validation-kind failure keeps the dialog open with an inline field
    // error — a dialog that stays open proves nothing about the database on
    // its own, so the Prisma check below is the assertion that matters.
    await expect(page.getByText("Say a little more — at least 3 characters")).toBeVisible();
    await expect(dialog).toBeVisible();

    const updated = await db.asset.findUniqueOrThrow({ where: { id: assetShortReason.id } });
    expect(updated.financeReturnedAt).toBeNull();
  });

  test("it_staff cannot send back", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // Phase 35: the send-back control lives only on the Finance asset page, and IT is turned away from it.
    await page.goto(`/finance/assets/${assetShortReason.id}`);
    expect(new URL(page.url()).pathname.startsWith("/finance")).toBe(false);
    await expect(page.getByRole("region", { name: "Review" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send back to IT…" })).toHaveCount(0);
  });

  // Same UI-unreachability as "Confirming twice", and the same fix: canConfirm
  // gates BOTH Confirm and Send-back together, so once an asset is confirmed
  // neither button renders for Finance — there is no button left to attempt
  // a return through. Open the dialog while still unconfirmed, manufacture
  // the concurrent confirmation via Prisma, then submit into that race —
  // this is the guard that keeps the pill's three states mutually exclusive.
  test("A confirmed asset cannot be sent back", async ({ page }) => {
    const reason = "e2e: attempted return after a confirmation race.";
    await login(page, "finance@thebackroomop.com");
    await page.goto(`/finance/assets/${assetConfirmed.id}`);

    const sendBack = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Send back to IT…" });
    await expect(sendBack).toBeVisible();
    await page.waitForTimeout(500);
    await sendBack.click();
    const dialog = page.getByRole("dialog", { name: `Send ${assetConfirmed.tag} back to IT` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Note for IT").fill(reason);

    await db.asset.update({
      where: { id: assetConfirmed.id },
      data: { financeConfirmedAt: new Date(), financeConfirmedById: financeUserId },
    });

    await dialog.getByRole("button", { name: "Send back", exact: true }).click();
    // Phase 30 (F-RECORD-14): the refusal renders inside the dialog, which stays open.
    await expect(
      dialog.getByText(`${assetConfirmed.tag} is already confirmed and cannot be sent back.`),
    ).toBeVisible();

    const updated = await db.asset.findUniqueOrThrow({ where: { id: assetConfirmed.id } });
    expect(updated.financeReturnedAt).toBeNull();
    expect(updated.financeReturnReason).toBeNull();
  });

  test("IT marks it corrected, and Finance can then confirm", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${assetReturn.id}`); // returned by the first test in this block

    // Phase 30 (spec §4.1): IT is the department that must act, so the header's pill is its.
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Mark corrected" }).click();
    const resubmitDialog = page.getByRole("dialog", { name: `Mark ${assetReturn.tag} corrected?` });
    await expect(resubmitDialog).toBeVisible();
    await resubmitDialog.getByRole("button", { name: "Send to Finance" }).click();

    await expect(page.getByText(`${assetReturn.tag} sent back to Finance`)).toBeVisible();
    await expect(page.getByText("RETURNED BY FINANCE", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: "Finance sent this back" })).toHaveCount(0);
    let updated = await db.asset.findUniqueOrThrow({ where: { id: assetReturn.id } });
    // null, not merely hidden.
    expect(updated.financeReturnReason).toBeNull();
    expect(updated.financeReturnedAt).toBeNull();
    expect(updated.financeReturnedById).toBeNull();

    await login(page, "finance@thebackroomop.com");
    await page.goto(`/finance/assets/${assetReturn.id}`);
    const approve = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Approve as not capitalised" });
    await expect(approve).toBeVisible();
    await page.waitForTimeout(500);
    await approve.click();
    await expect(page.getByText(`${assetReturn.tag} approved as not capitalised`)).toBeVisible();
    await expect.poll(async () => (await db.asset.findUniqueOrThrow({ where: { id: assetReturn.id } })).financeConfirmedAt !== null).toBe(true);
    updated = await db.asset.findUniqueOrThrow({ where: { id: assetReturn.id } });
    expect(updated.financeConfirmedAt).not.toBeNull();
    // Task 7a's amendment to confirmAssetDetails clears the return columns on
    // confirm — this is the only test in the suite that observes it, and it
    // is what makes "confirmed AND returned" unreachable.
    expect(updated.financeReturnedAt).toBeNull();
    expect(updated.financeReturnedById).toBeNull();
    expect(updated.financeReturnReason).toBeNull();
  });
});
