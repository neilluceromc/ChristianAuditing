import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { regWhere } from "@/lib/registration";
import { kpiValue } from "@/components/home/overview/chart-math";

const db = new PrismaClient();

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login — going there
  // directly (rather than /login) keeps this helper safe to call a second
  // time mid-test to switch users (see auth-shell.spec.ts / approvals-audit.spec.ts).
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Phase 47 (spec §5.4): the first page after a sign-in rewrites the settings cookies from the person's saved prefs
  // (UiPrefsSync → restoreUiPrefs, stamping br.uid). Wait for it, so a cookie this spec seeds next is not overwritten.
  const { id } = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(id);
}

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Seeded fixtures this file depends on (see prisma/seed.ts), all
// @thebackroomop.com / SEED_PASSWORD:
//   admin@ (admin, holds APR-2039 CLAIMED) · it@ (J. Sarmiento, it_staff) ·
//   purchasing@ (A. Reyes) · finance@ (L. Domingo) · viewer@ (viewer)
//   BR-LT-0027 is MISSING. APR-2040 breached SLA, APR-2025 EXECUTION_FAILED,
//   Dennis Ong offboarding, Karen Uy / Nina Robles recent hires short a
//   required slot.
//   Purchase orders (migration 38): PO-0202 SENT_BACK by IT (J. Sarmiento) ·
//   PO-0201 SENT_BACK, a pre-PO draft never sent · PO-0198 WITH_IT, whose last
//   word is Finance's old request-info (L. Domingo).
// Rows never reference raw cuids: the DB can be reseeded between runs and ids
// are cuids that change on every seed.
//
// Phase 46 (spec §3): every workspace's Home is the Overview — six KPI tiles
// ([data-kpis] > [data-kpi]), then Row A ("Needs you" beside the trend), then
// Row B (the make-up beside the ranked breakdown). The old cards (Worklist,
// Claimed by you, Fleet, Age, Warranty runway, Your requests, the money
// headline) are gone; e2e/phase-46-home.spec.ts checks every tile against its
// page. This file keeps the seeded-story checks, read through the Overview.

// Spec files share one database and run in alphabetical order — each file
// reseeds so no file inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

/** The Overview's Needs you items (src/components/home/overview/needs-you.tsx). */
const needsItems = (page: Page) => page.locator("[data-needs-you] > li");
const needsItem = (page: Page, text: string): Locator => needsItems(page).filter({ hasText: text });
const TONE_RANK: Record<string, number> = { bad: 0, warn: 1, info: 2 };

/** The IT Overview's secondary panels — what Focus hides. */
const IT_SECONDARY = ["Asset movements per week", "Fleet by status", "Missing kit by client"];

test.describe("home — IT Overview: the numbers, then the work, then the make-up", () => {
  test("six tiles lead; Needs you sits beside the trend; the make-up beside the breakdown", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    // Scoped to <main> — this list is the page's own cards (the sidebar has no headings).
    const headings = page.locator("main").getByRole("heading", { level: 2 });
    await expect(headings).toHaveText(["Needs you", ...IT_SECONDARY]);

    // Spec §3.1: the KPI row is the Overview's first child, six tiles.
    await expect(page.locator("[data-overview] > *").first()).toHaveAttribute("data-kpis", "");
    await expect(page.locator("[data-kpis] > [data-kpi]")).toHaveCount(6);
    await expect(page.locator('[data-row="a"]').getByRole("heading", { level: 2 })).toHaveText(["Needs you", "Asset movements per week"]);
    await expect(page.locator('[data-row="b"]').getByRole("heading", { level: 2 })).toHaveText(["Fleet by status", "Missing kit by client"]);

    // Spec §5.3/§5.4 (Phase 32): the nav's Worklist count still shows, and Needs you opens the full worklist.
    await expect(page.getByRole("complementary", { name: "Primary" }).getByLabel(/^\d+ waiting on the worklist$/)).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: /^See all/ })).toHaveAttribute("href", "/inventory/work");
  });
});

// Phase 15's point survives the Overview: what breaks first comes first. Needs
// you flattens the worklist by urgency (bad, then warn, then info), so a DATA
// row (BR-LT-0027, MISSING) is not crowded out by the queue's own volume, and
// the full queue is one click away.
test.describe("home — Needs you: what breaks first", () => {
  test("urgent items lead, BR-LT-0027 among them; See all opens the worklist with APR-2040 and Dennis Ong", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    const items = needsItems(page);
    await expect(items.first()).toBeVisible();
    const n = await items.count();
    expect(n).toBeLessThanOrEqual(6);
    const tones = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-tone") ?? ""));
    expect(tones[0], "the first item is urgent").toBe("bad");
    const ranks = tones.map((t) => TONE_RANK[t]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // The panel says how many are urgent, and each urgent item carries the word (not only its tint).
    await expect(page.locator("main section").filter({ has: page.getByRole("heading", { name: "Needs you" }) }))
      .toContainText(`${tones.filter((t) => t === "bad").length} urgent`);
    await expect(items.first()).toContainText("Urgent");

    const missing = needsItem(page, "BR-LT-0027 is missing");
    await expect(missing).toHaveCount(1);
    await expect(missing).toHaveAttribute("data-tone", "bad");
    await expect(missing.getByRole("link", { name: /^Investigate/ })).toHaveAttribute("href", /^\/inventory\/[a-z0-9]+$/i);

    await page.locator("main").getByRole("link", { name: /^See all/ }).click();
    await expect(page).toHaveURL(/\/inventory\/work$/);
    const fullQueue = page.locator("section#queue");
    await expect(fullQueue).toContainText("APR-2040");
    await expect(fullQueue).toContainText("Dennis Ong is leaving");
  });
});

test.describe("home — claims sit above the pool", () => {
  test("as admin@, APR-2039 (claimed by you) is in Needs you, ahead of the unclaimed work of its tone", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/");

    const claim = needsItem(page, "APR-2039");
    await expect(claim).toHaveCount(1);
    await expect(claim).toContainText("claimed by you");
    // Within a tone, claims come first (needsFromWork): no unclaimed item of the claim's tone sits above it.
    const tone = (await claim.getAttribute("data-tone"))!;
    const rows = await needsItems(page).evaluateAll((els) =>
      els.map((e) => ({ tone: e.getAttribute("data-tone"), claim: (e.textContent ?? "").includes("claimed by you"), apr: (e.textContent ?? "").includes("APR-2039") })));
    const at = rows.findIndex((r) => r.apr);
    // Purchase orders (spec §7): the team's own cards ("N sent back to you", "N to check") lead the list; among the
    // worklist's items, claims still come first within a tone.
    const team = await needsItems(page).evaluateAll((els) =>
      els.map((e) => /sent back to you|\d+ (purchase orders? )?to check/.test(e.textContent ?? "")));
    expect(rows.slice(0, at).filter((r, i) => r.tone === tone && !r.claim && !team[i])).toEqual([]);
  });
});

test.describe("home — viewer is read-only", () => {
  test("Needs you reads Open everywhere, no row menus, no claims, READ-ONLY badge shows, the fleet still renders", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/");

    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    // Phase 32 (plan P-10): the viewer sees the work, with Open links and no controls.
    await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();
    const items = needsItems(page);
    await expect(items.first()).toBeVisible();
    const n = await items.count();
    for (let i = 0; i < n; i++) {
      await expect(items.nth(i).getByRole("link")).toHaveText(/^Open\b/);
      await expect(items.nth(i).getByRole("button")).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
    await expect(page.getByLabel(/waiting on the worklist$/)).toHaveCount(0);
    await expect(needsItem(page, "claimed by you")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fleet by status", level: 2 })).toBeVisible();
  });
});

test.describe("home — purchasing to-do", () => {
  test("the Sent back card leads; PO-0202 reads as sent back by IT; PO-0201 is with you", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/");

    // Spec §7: "N sent back to you", linked to the Sent back tab — the count is the tab's (state, never the bell).
    const card = needsItem(page, "sent back to you");
    await expect(card.first()).toContainText("2 purchase orders sent back to you");
    await expect(card.first()).toHaveAttribute("data-tone", "bad");
    await expect(card.first().getByRole("link", { name: /^Fix/ })).toHaveAttribute("href", "/purchases?state=SENT_BACK");

    const row0202 = needsItem(page, "PO-0202");
    await expect(row0202).toContainText("came back from J. Sarmiento");
    // A PO that came back needs attention; a never-sent one is only to do.
    await expect(row0202).toHaveAttribute("data-tone", "warn");
    await expect(row0202.getByRole("link", { name: /^Fix and resubmit/ })).toBeVisible();

    const row0201 = needsItem(page, "PO-0201");
    await expect(row0201).toContainText("with you");
    await expect(row0201).toHaveAttribute("data-tone", "info");
  });
});

test.describe("home — finance leads with money, not counts", () => {
  test("the first tile is the money waiting; Groups to review and N to check both open To review", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/");

    // Spec §3.2: Finance's first tile is the money waiting, a plain card (no page shows that total). Purchase orders
    // (Task 6): it is what the registration groups waiting in To review add up to — every asset with Finance that is
    // not on a sent-back PO (REVIEW_GROUP_WHERE in server/modules/finance/groups.ts, built on the same regWhere), and
    // the oldest group's age counts from its registration (the purchase record), or the asset when it has none.
    const waiting = await db.asset.findMany({
      where: {
        AND: [
          regWhere("with-finance"),
          { OR: [{ purchaseOrderId: null }, { purchaseOrder: { is: { state: { not: "SENT_BACK" } } } }] },
        ],
      },
      select: { cost: true, createdAt: true, purchaseRecord: { select: { createdAt: true } } },
    });
    expect(waiting.length, "the seed has assets waiting for Finance").toBeGreaterThan(0);
    const total = waiting.reduce((s, a) => s + (a.cost === null ? 0 : Number(a.cost)), 0);
    const oldest = Math.min(...waiting.map((a) => (a.purchaseRecord?.createdAt ?? a.createdAt).getTime()));
    const days = Math.max(0, Math.round((Date.now() - oldest) / 86_400_000));
    const { shown, exact } = kpiValue({ value: Math.round(total * 100) / 100, money: true });

    const first = page.locator("[data-kpis] > [data-kpi]").first();
    await expect(first).toHaveAttribute("data-kpi", "fin.waitingC");
    await expect(first).toContainText("Waiting on you");
    await expect(first.locator("[data-kpi-value]")).toHaveText(shown + (exact ?? ""));
    await expect(first).toContainText(`oldest ${days} ${days === 1 ? "day" : "days"}`);
    await expect(page.locator('a[data-kpi="fin.waitingC"]')).toHaveCount(0);
    // The count is the supporting tile beside it, linked to the queue it counts.
    const count = page.locator('a[data-kpi="fin.waitingCount"]');
    await expect(count).toHaveAttribute("href", "/finance/review");
    await expect(count).toContainText("Groups to review");

    // Spec §7: the team card "N to check" leads Needs you and opens the same queue.
    const toCheck = needsItem(page, "to check");
    await expect(toCheck.first()).toHaveAttribute("data-tone", "warn");
    await expect(toCheck.first().getByRole("link", { name: /^Review/ })).toHaveAttribute("href", "/finance/review");
  });
});

test.describe("home — the fleet's make-up and the missing kit breakdown", () => {
  test("the fleet bar links each status and carries the coverage line; a breakdown row's number is its page's", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    // Phase 25 / Phase 40 §6: every segment and legend status links to the inventory filtered to it; the legend
    // carries the bare status as its name, the segment its sr-only "Deployed: N assets".
    await expect(page.getByRole("link", { name: "Deployed", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Deployed: \d+ assets$/ })).toHaveAttribute("href", "/inventory?status=DEPLOYED");
    await expect(page.getByText("spare pool covers 4 of the 10 slots the incoming hires need")).toBeVisible();

    // Spec §3.2: people missing required kit, by client — each row links to that page's filter, so its number is
    // the people count there.
    const breakdown = page.locator("[data-ranked] > li").first();
    await expect(breakdown).toBeVisible();
    const value = Number((await breakdown.locator("span").last().innerText()).replace(/,/g, ""));
    const link = breakdown.getByRole("link");
    await expect(link).toHaveAttribute("href", /^\/employees\?.*gaps=1/);
    await link.click();
    await expect(page).toHaveURL(/\/employees\?.*gaps=1/);
    await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /\d[\d,]* (people|person)\b/ }))
      .toHaveText(new RegExp(`^${value.toLocaleString("en-US")} (people|person)\\b`));
  });
});

test.describe("home — /finance/assets, the register", () => {
  test("lists every asset with a cost total; a status chip filters; a tag opens Finance's asset page", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/assets");

    // The finance sidebar has an "Assets" link with this same text (an h3
    // heading before Phase 42) — scope to the page's h1 title.
    // Phase 35 (plan P-5): the page is "Assets". Phase 47 (spec §3 item 2): the At cost card carries the totals.
    await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
    const totals = page.getByRole("region", { name: "Money totals" });
    await expect(totals).toContainText("At cost");
    await expect(totals).toContainText(/₱[\d,.]+/);
    await expect(totals).toContainText(/\d+ assets?( · \d+)? with a cost/);

    // Phase 47 (spec §3 item 4): the status chips are the Phase 45 tiles; DEFECTIVE reads "In repair"
    const chip = page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /^In repair\b/ });
    await chip.click();
    await expect(page).toHaveURL(/status=DEFECTIVE/, { timeout: 15_000 });
    await expect(chip).toHaveAttribute("aria-current", "true");

    const row = page.getByRole("row", { name: /BR-MN-0731/ });
    await expect(row).toBeVisible();

    // Phase 35: the tag opens Finance's own asset page (/finance/assets/<id>).
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/finance\/assets\/[a-z0-9]+$/i, { timeout: 15_000 });
  });
});

test.describe("home — /finance/activity", () => {
  test("rows render with a domain pill (PURCHASE / ASSET)", async ({ page }) => {
    // A freshly reseeded DB has NO purchase AuditEntry rows — the seed only
    // inserts entityType "asset" entries directly; "purchase-order" entries are
    // written exclusively by real purchase actions. This file reseeds
    // independently, so it needs its own transition: IT sends PO-0198 back to
    // Purchasing, which writes one entityType "purchase-order" AuditEntry.
    await login(page, "it@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PO-0198" }).click();
    await expect(page.getByRole("heading", { name: "PO-0198" })).toBeVisible({ timeout: 15_000 });
    const sendBack = page.getByRole("button", { name: "Send back to Purchasing" });
    await waitForHydration(sendBack);
    await sendBack.click();
    const dialog = page.getByRole("dialog", { name: "Send PO-0198 back to Purchasing" });
    await dialog.getByLabel("SI number").check();
    await dialog.getByRole("button", { name: "Send back", exact: true }).click();
    await expect(page.locator("main header").first()).toContainText("Sent back to Purchasing", { timeout: 15_000 });

    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/activity");

    await expect(page.getByRole("heading", { name: "Finance activity" })).toBeVisible({ timeout: 15_000 });
    const rows = page.locator("ol li");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("PURCHASE").first()).toBeVisible();
    await expect(rows.filter({ hasText: "PO-0198" }).first()).toBeVisible();
  });
});

// Runs here, before the dismissal/focus block below mutates it@'s worklist
// and view state.
test.describe("home — axe", () => {
  test("/, viewer /, /finance/assets, /finance/activity — no serious/critical violations", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");
    await expectNoSeriousAxe(page);

    await login(page, "viewer@thebackroomop.com");
    await page.goto("/");
    await expectNoSeriousAxe(page);

    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/assets");
    await expectNoSeriousAxe(page);

    await page.goto("/finance/activity");
    await expectNoSeriousAxe(page);
  });
});

// Both tests here mutate state that outlives the click that caused it: a
// dismissal writes a per-user, per-day UserPreference row that is meant to
// survive (that's the point of the test), and Focus writes a durable
// br.focus cookie. Neither is undone afterward, so they run last, in this
// order, in a serial block — nothing above depends on the worklist or the
// focus cookie being untouched, but something below would if it ran first.
test.describe("home — dismissal and focus mode (mutating, serial)", () => {
  test.describe.configure({ mode: "serial" });

  test("hiding a worklist row until tomorrow removes it, it stays gone after a reload, and Home's Needs you drops it too", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // Phase 46: Home's Needs you has no row menus (one action link per item); the row menu lives on the worklist.
    await page.goto("/inventory/work");

    // Nina Robles' row lives in the "New hires" section — any section's row
    // hides the same way (the row menu's Hide until tomorrow,
    // home/work-row-menu.tsx), this one is simply the one the seed already
    // pins a stable assertion to.
    const ninaRow = page.locator("li").filter({ hasText: "Nina Robles" });
    await expect(ninaRow).toHaveCount(1);
    await ninaRow.getByRole("button", { name: /^Actions for Nina Robles/ }).click();
    await page.getByRole("menuitem", { name: "Hide until tomorrow" }).click();
    await expect(page.locator("li").filter({ hasText: "Nina Robles" })).toHaveCount(0, { timeout: 15_000 });

    // Per-user, per-day preference, not component state — must survive a reload.
    await page.reload();
    await expect(page.locator("li").filter({ hasText: "Nina Robles" })).toHaveCount(0, { timeout: 15_000 });

    // Needs you reads the same worklist, so a hidden row is not there either.
    await page.goto("/");
    await expect(needsItems(page).first()).toBeVisible();
    await expect(needsItem(page, "Nina Robles")).toHaveCount(0);
  });

  test("Focus keeps the tiles and Needs you, survives a reload, and never touches the URL", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    await page.getByRole("button", { name: "Focus" }).click();
    await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible({ timeout: 15_000 });

    // Spec §3.1: focus shows only the KPI row and Needs you.
    await expect(page.locator("[data-kpis] > [data-kpi]")).toHaveCount(6);
    await expect(page.getByRole("heading", { name: "Needs you", level: 2 })).toBeVisible();
    for (const heading of IT_SECONDARY) {
      await expect(page.getByRole("heading", { name: heading, level: 2 }), heading).toHaveCount(0);
    }
    await expect(page.getByText(/^Focus mode — the trend, make-up and breakdown are hidden\./)).toBeVisible();
    expect(page.url()).not.toContain("focus");

    await expectNoSeriousAxe(page);

    // A cookie, not component state — must survive a real reload.
    await page.reload();
    await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Fleet by status", level: 2 })).toHaveCount(0);
    expect(page.url()).not.toContain("focus");

    await page.getByRole("button", { name: "Show everything" }).click();
    await expect(page.getByRole("button", { name: "Focus" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Fleet by status", level: 2 })).toBeVisible({ timeout: 15_000 });
  });
});
