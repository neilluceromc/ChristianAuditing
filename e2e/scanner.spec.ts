import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 10, Task 7. The offboarding wizard's USB-scanner integration
 * (Tasks 5-6): `src/lib/scan.ts` (pure `matchScan`), `scan-provider.tsx` (the
 * document-level keydown buffer, its focus guard, and the four non-ignored
 * verdict banners), and `item-decision.tsx` (each card's own reaction).
 *
 * A scan must write nothing — Confirm is what files an approval. Only the
 * "already-decided" test below performs a real write, and only by clicking
 * Confirm by hand, never by scanning.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts): Dennis Ong EMP-0090
 * is the only OFFBOARDING employee and holds exactly three items —
 * BR-LT-0166 (laptop), BR-PH-0312 (phone), BR-HS-0510 (headset) — none with
 * an open approval of their own. That means the `blocked` verdict cannot be
 * reached with seeded data alone (A-26): the seeded blocker APR-2039 sits on
 * BR-LT-0148, owned by ACTIVE EMP-0042, and APR-2040 has assetId: null by
 * design. The dedicated test at the bottom of this file manufactures a
 * PENDING lifecycle_change_status approval on one of Dennis's own assets
 * through Prisma, the same way e2e/import-export.spec.ts manufactures its
 * duplicate-serial state rather than adding a fixture to prisma/seed.ts — a
 * dozen other specs lean on those three assets being decidable.
 *
 * Never reference a raw cuid — the DB is reseeded and ids change every time.
 */

/** For the one thing no screen renders: creating the blocker approval for
 * A-26. Module scope, like e2e/import-export.spec.ts and e2e/labels.spec.ts. */
const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * A-27 / §6a rule 79: `Button variant="primary"` reports a phantom *serious*
 * contrast violation when axe samples it mid-transition or with the cursor
 * resting on it. Measured three times in this project (e2e/import-export.spec.ts).
 * Do not remove either line without re-running an axe scan on a page whose
 * primary button sits under wherever the last click left the mouse.
 */
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

/** See e2e/it-core.spec.ts and §6a rule 76 for why this is the only reliable
 * hydration signal: three cheaper proxies all pass before React is ready.
 * Probed on the ELEMENT about to be interacted with, never its ancestor. */
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((n) => Object.keys(n).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/**
 * A USB scanner types the payload and presses Enter. Typed on the BODY, not
 * into a field — which is exactly what the listener's focus guard must
 * allow. Clicking the body first is what makes this a scanner-shaped input
 * rather than "whatever the last test left focused" — but that click is
 * exactly wrong for A-28's second direction (see `scanKeepingFocus` below),
 * because it discards the very focus state that direction exists to test.
 */
async function scan(page: Page, tag: string) {
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.type(tag, { delay: 12 });
  await page.keyboard.press("Enter");
}

/**
 * A-28's second, previously-untested direction: after clicking an outcome by
 * hand, focus sits on the SegmentedControl's (sr-only) radio input — not the
 * body. This helper types and presses Enter WITHOUT reclaiming focus first,
 * so the keystrokes land exactly where an operator's really would: on
 * whatever they last clicked. Task 6's guard silently killed the scanner in
 * exactly this state, with no banner and no verdict — the regression that
 * shipped.
 */
async function scanKeepingFocus(page: Page, tag: string) {
  await page.keyboard.type(tag, { delay: 12 });
  await page.keyboard.press("Enter");
}

async function openCollect(page: Page) {
  await page.goto("/offboarding");
  await page.getByRole("row", { name: /Dennis Ong/ }).getByRole("link", { name: "Open wizard" }).click();
  await expect(page).toHaveURL(/\/offboarding\/[^/]+$/, { timeout: 30_000 });
  await page.getByRole("list", { name: "Offboarding steps" }).getByRole("link", { name: /Collect items/ }).click();
  await expect(page.getByText("Scanning works here")).toBeVisible({ timeout: 30_000 });
}

// These tests share database state (a decision confirmed by hand in one test
// stays decided for the rest of the file; a blocker manufactured by hand in
// the last test stays a blocker) and must run in a specific order relative
// to each other — describe.serial pins that order even under >1 worker,
// though the repo convention (and this file's own instructions) is
// `--workers=1` anyway.
test.describe.serial("offboarding scanner", () => {
  test("a scan preselects Returned on the matching item, writes nothing, and the step passes axe", async ({
    page,
  }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);

    const card = page.getByRole("group", { name: "Decide BR-LT-0166" });
    await waitForHydration(card.getByRole("radiogroup"));
    await scan(page, "BR-LT-0166");

    // Preselected, not confirmed: the radio is checked and no approval exists.
    await expect(card.getByRole("radio", { name: "Returned" })).toBeChecked();
    await expect(page.getByText(/APR-\d+ created/)).toHaveCount(0);
    await expect(page.getByRole("row", { name: /BR-LT-0166/ })).toHaveCount(0);

    // A-27: nothing has ever run axe on this step. Checked here, with the
    // banner, the aria-live "match" text and the scanned card's outline all
    // present at once — the richest state Task 6 added and the one most
    // likely to hide a contrast or labelling defect.
    await expectNoSeriousAxe(page);
  });

  test("a lower-case scan still matches", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-PH-0312" });
    await waitForHydration(card.getByRole("radiogroup"));
    await scan(page, "br-ph-0312");
    await expect(card.getByRole("radio", { name: "Returned" })).toBeChecked();
  });

  test("an unknown tag is refused by name", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    await waitForHydration(page.getByRole("group", { name: /^Decide / }).first().getByRole("radiogroup"));
    await scan(page, "BR-ZZ-9999");
    await expect(page.getByText("BR-ZZ-9999 is not one of this person's items.")).toBeVisible();
  });

  // A-28, direction one: the bug the implementer reasoned about. The listener
  // must not eat keystrokes meant for the Reason box.
  test("typing a Reason is not captured as a scan", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-HS-0510" });
    const reason = card.getByLabel(/Reason/);
    await waitForHydration(reason);
    await reason.fill("BR-LT-0166");
    await expect(reason).toHaveValue("BR-LT-0166");
    // The other card must NOT have reacted to those keystrokes.
    await expect(
      page.getByRole("group", { name: "Decide BR-LT-0166" }).getByRole("radio", { name: "Returned" }),
    ).not.toBeChecked();
  });

  // A-28, direction two: the bug the implementer did NOT reason about, and
  // the one that actually shipped. Clicking an outcome by hand is the
  // ordinary first step of deciding an item, and it leaves focus sitting on
  // the SegmentedControl's own (sr-only) radio input. A guard that bails on
  // every <input> — rather than only the ones that consume character text —
  // silently drops every keystroke after that, including a whole barcode,
  // with no banner and no verdict.
  test("clicking an outcome by hand, leaving focus on the radio, does not silently kill a later scan", async ({
    page,
  }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const phoneCard = page.getByRole("group", { name: "Decide BR-PH-0312" });
    await waitForHydration(phoneCard.getByRole("radiogroup"));

    // Click an outcome by hand — leaves focus on the <input type="radio">
    // under the "Defective" label (SegmentedControl's radios are sr-only,
    // but a native <label> click still focuses the input it wraps).
    await phoneCard.getByRole("radiogroup").getByText("Defective").click();
    await expect(phoneCard.getByRole("radio", { name: "Defective" })).toBeChecked();

    // Scan a DIFFERENT held tag without reclaiming focus first — exactly the
    // state Task 6's guard broke.
    const laptopCard = page.getByRole("group", { name: "Decide BR-LT-0166" });
    await scanKeepingFocus(page, "BR-LT-0166");
    await expect(laptopCard.getByRole("radio", { name: "Returned" })).toBeChecked();
  });

  // Guards the `nonce` counter: without it incrementing on every accepted
  // scan, re-scanning the SAME tag after changing your mind by hand would be
  // inert (the effect's dependencies wouldn't change), which reads as a
  // broken scanner.
  test("re-scanning the same tag after changing your mind re-preselects Returned", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-LT-0166" });
    await waitForHydration(card.getByRole("radiogroup"));

    await scan(page, "BR-LT-0166");
    await expect(card.getByRole("radio", { name: "Returned" })).toBeChecked();

    // Change your mind by hand...
    await card.getByRole("radiogroup").getByText("Defective").click();
    await expect(card.getByRole("radio", { name: "Defective" })).toBeChecked();

    // ...then re-scan the SAME tag. If `nonce` did not increment, `scan.tag`
    // and `tag` are unchanged from the first scan, the effect's dependency
    // list is unchanged, and this would stay on Defective.
    await scan(page, "BR-LT-0166");
    await expect(card.getByRole("radio", { name: "Returned" })).toBeChecked();
  });

  test("scanning an already-decided item says so instead of re-opening it", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    const card = page.getByRole("group", { name: "Decide BR-HS-0510" });
    await waitForHydration(card.getByRole("radiogroup"));
    await card.getByRole("radiogroup").getByText("Returned").click();
    await card.getByRole("button", { name: "Confirm decision" }).click();
    await expect(page.getByText(/APR-\d+ created — BR-HS-0510/)).toBeVisible({ timeout: 30_000 });

    // The toast fires the instant decideItem() resolves, but router.refresh()
    // is not awaited — it kicks off a background re-fetch that lands some
    // moments later. Scanning right after the toast can still see the OLD
    // `items` prop (decided: false) and produce a "match" verdict instead of
    // "already-decided" (observed: flaky exactly this way without this wait).
    // This card's own <ItemDecision> unmounts once the refreshed data lands
    // and `i.decision` becomes truthy, so its disappearance is the real signal.
    await expect(card).toHaveCount(0, { timeout: 30_000 });

    await scan(page, "BR-HS-0510");
    await expect(page.getByText("BR-HS-0510 is already decided.")).toBeVisible();
  });

  // A-26: zero blocked cards render anywhere in the seed, so the verdict
  // "§6a rule 10 exists for" is manufactured here, through Prisma, exactly as
  // e2e/import-export.spec.ts manufactures its duplicate-serial state — never
  // added to prisma/seed.ts, which a dozen other specs lean on for these
  // three assets being decidable. Placed LAST in this file: it permanently
  // blocks BR-LT-0166 for the rest of this run, and every earlier test that
  // touches BR-LT-0166 only preselects it client-side, never confirms it, so
  // it is still genuinely undecided (and unblocked) right up to this point.
  test("a manufactured blocker renders the blocked verdict and names the refNo", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0166" } });
    const itStaff = await db.user.findFirstOrThrow({ where: { email: "it@thebackroomop.com" } });
    // Distinctive on purpose — nothing in the seed's APR-20xx range looks
    // like this, so there is no chance of colliding with a real fixture.
    const refNo = "APR-SCANTEST-BLOCK-1";
    await db.approval.create({
      data: {
        refNo,
        type: "lifecycle_change_status",
        state: "PENDING",
        payload: { from: { status: "DEPLOYED" }, to: { status: "TEMPORARY" } },
        slaAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        requestedById: itStaff.id,
        assetId: asset.id,
      },
    });

    await login(page, "it@thebackroomop.com");
    await openCollect(page);
    // BR-LT-0166 itself now renders the "held by" paragraph, not an
    // <ItemDecision> — a blocked item has no radiogroup of its own to
    // hydrate against (src/app/(app)/offboarding/[employeeId]/page.tsx: the
    // blockedBy branch is a plain <p>, not the ItemDecision component).
    // Hydration is a property of the page's React tree, not of any one card,
    // so waiting on BR-PH-0312's radiogroup — still fully decidable — proves
    // the listener is live just as well.
    await waitForHydration(page.getByRole("group", { name: "Decide BR-PH-0312" }).getByRole("radiogroup"));
    await scan(page, "BR-LT-0166");
    await expect(page.getByText(`BR-LT-0166 is held by ${refNo}.`)).toBeVisible();

    // The next reseed (this file's own beforeAll, on the next run) is what
    // cleans this up — never prisma/seed.ts itself (A-26).
  });
});
