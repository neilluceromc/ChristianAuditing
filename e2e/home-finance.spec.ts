import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

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
//   PR-0198 SUBMITTED (bounced back from finance) · PR-0201 DRAFT ·
//   PR-0195 IT_REVIEWED (₱45,000, reviewed 3 days ago).
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
    expect(rows.slice(0, at).filter((r) => r.tone === tone && !r.claim)).toEqual([]);
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
  test("PR-0198 reads as bounced back, not merely waiting on IT; PR-0201 reads as still a draft", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/");

    const row0198 = needsItem(page, "PR-0198");
    await expect(row0198).toContainText("came back from L. Domingo");
    // A bounced request needs attention; a draft is only to do.
    await expect(row0198).toHaveAttribute("data-tone", "warn");
    await expect(row0198.getByRole("link", { name: /^Fix and resubmit/ })).toBeVisible();

    const row0201 = needsItem(page, "PR-0201");
    await expect(row0201).toContainText("still a draft");
    await expect(row0201).toHaveAttribute("data-tone", "info");
    await expect(row0201.getByRole("link", { name: /^Submit/ })).toBeVisible();
  });
});

test.describe("home — finance leads with money, not counts", () => {
  test("the first tile reads ₱45,000 waiting on you, oldest 3 days; PR-0195 is to review", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/");

    // Spec §3.2: Finance's first tile is the money waiting, a plain card (no page shows that total).
    const first = page.locator("[data-kpis] > [data-kpi]").first();
    await expect(first).toHaveAttribute("data-kpi", "fin.waitingC");
    await expect(first).toContainText("Waiting on you");
    await expect(first.locator("[data-kpi-value]")).toHaveText("₱45,000");
    await expect(first).toContainText("oldest 3 days");
    await expect(page.locator('a[data-kpi="fin.waitingC"]')).toHaveCount(0);
    // The count is the supporting tile beside it, linked to the requests it counts.
    await expect(page.locator('a[data-kpi="fin.waitingCount"]')).toHaveAttribute("href", "/purchases?state=IT_REVIEWED");

    const pr0195 = needsItem(page, "PR-0195");
    await expect(pr0195).toBeVisible();
    await expect(pr0195).toContainText("₱45,000");
    await expect(pr0195.getByRole("link", { name: /^Review/ })).toBeVisible();
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
    // Phase 35 (plan P-5): the page is "Assets"; its footer line carries the whole filter's totals.
    await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
    await expect(page.getByText(/\d+ assets? · \d+ with a cost · ₱[\d,.]+ at cost/)).toBeVisible();

    const chip = page.getByRole("link", { name: "Defective", exact: true });
    await chip.click();
    await expect(page).toHaveURL(/status=DEFECTIVE/, { timeout: 15_000 });
    await expect(chip).toHaveAttribute("aria-current", "page");

    const row = page.getByRole("row", { name: /BR-MN-0731/ });
    await expect(row).toBeVisible();

    // Phase 35: the tag opens Finance's own asset page (/finance/assets/<id>).
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/finance\/assets\/[a-z0-9]+$/i, { timeout: 15_000 });
  });
});

test.describe("home — /finance/activity", () => {
  test("rows render with a domain pill (PURCHASE / ASSET)", async ({ page }) => {
    // A freshly reseeded DB has NO AuditEntry rows at all — the seed script
    // only ever inserts entityType "asset" entries directly; entityType
    // "purchase-request" entries are written exclusively by real purchase
    // actions. So "Finance activity" legitimately reads "No money has moved
    // yet" until something actually moves — this is the same reason
    // purchases.spec.ts's own activity check runs LAST in that file, after
    // its serial block has performed real transitions. This file reseeds
    // independently, so it needs its own transition: IT marks PR-0198
    // reviewed, which writes one entityType "purchase-request" AuditEntry.
    await login(page, "it@thebackroomop.com");
    await page.goto("/purchases");
    await page.getByRole("link", { name: "PR-0198" }).click();
    await expect(page.getByRole("heading", { name: "PR-0198" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Mark IT-reviewed" }).click();
    await expect(page.locator("main header").first()).toContainText("IT_REVIEWED", { timeout: 15_000 });

    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/activity");

    await expect(page.getByRole("heading", { name: "Finance activity" })).toBeVisible({ timeout: 15_000 });
    const rows = page.locator("ol li");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText("PURCHASE").first()).toBeVisible();
    await expect(rows.filter({ hasText: "PR-0198" }).first()).toBeVisible();
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
