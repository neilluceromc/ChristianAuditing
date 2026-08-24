import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { SEED_PASSWORD } from "../prisma/fixtures";

async function login(page: Page, email: string) {
  // /logout clears the session cookie and redirects to /login — going there
  // directly (rather than /login) keeps this helper safe to call a second
  // time mid-test to switch users (see auth-shell.spec.ts / approvals-audit.spec.ts).
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

// Seeded fixtures this file depends on (see prisma/seed.ts), all
// @thebackroomop.com / SEED_PASSWORD:
//   admin@ (admin, holds APR-2039 CLAIMED) · it@ (J. Sarmiento, it_staff) ·
//   purchasing@ (A. Reyes) · finance@ (L. Domingo) · viewer@ (viewer)
//   25 assets total; BR-LT-0148 & BR-LT-0122 (both Dell Latitude 5420) are the
//   warranty-runway cluster (38 d / 41 d); BR-LT-0027 is MISSING (the DATA
//   candidate that must not outrank a HIRE row for a shift-queue slot).
//   APR-2040 breached SLA, APR-2025 EXECUTION_FAILED, Dennis Ong offboarding,
//   Karen Uy / Nina Robles recent hires short a required slot.
//   PR-0198 SUBMITTED (bounced back from finance) · PR-0201 DRAFT ·
//   PR-0195 IT_REVIEWED (₱45,000, reviewed 3 days ago).
// Rows never reference raw cuids: the DB can be reseeded between runs and ids
// are cuids that change on every seed.

// Spec files share one database and run in alphabetical order — each file
// reseeds so no file inherits another's mutations.
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("home — IT dashboard leads with work, not KPIs", () => {
  test("the six card headings render in the documented order; no KPI row sits above Your shift", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    // Scoped to <main> — the sidebar's nav groups are h3s too ("Overview",
    // "Tracking", …) and would otherwise pollute this list.
    const headings = page.locator("main").getByRole("heading", { level: 3 });
    await expect(headings).toHaveText([
      "Your shift", "Claimed by you", "Fleet", "Age", "Warranty runway", "Jump to",
    ]);

    // Structural proof there's no KPI-tile row above it: the "Your shift"
    // card is literally the first child of the page's content column (the
    // h1 "Hello, …" lives in a sibling <header>, not this container).
    const firstCard = page.locator("main > div > *").first();
    await expect(firstCard.getByRole("heading", { level: 3 })).toHaveText("Your shift");
  });
});

test.describe("home — shift ordering: what breaks first", () => {
  test("SLA (APR-2040) leads; a DATA row never outranks a HIRE row for a slot", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    // Only "Your shift" rows carry a Clear button — a stable way to scope to
    // just those five <li>s regardless of card DOM nesting.
    const shiftRows = page.locator("li").filter({ has: page.getByRole("button", { name: /^Clear "/ }) });
    await expect(shiftRows).toHaveCount(5);

    const kinds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const chip = shiftRows.nth(i).getByText(/^(SLA|EXEC|LEAVE|HIRE|DATA)$/);
      kinds.push(((await chip.textContent()) ?? "").trim());
    }
    expect(kinds).toEqual(["SLA", "EXEC", "LEAVE", "HIRE", "HIRE"]);

    await expect(shiftRows.nth(0)).toContainText("APR-2040");

    // BR-LT-0027 (MISSING) is a real DATA candidate in the seed — it only
    // fails to appear because SLA/EXEC/LEAVE/HIRE×2 already fill the 5-row
    // cap, which is exactly "DATA never outranks HIRE" proven with live data.
    await expect(page.getByText("BR-LT-0027")).toHaveCount(0);
  });
});

test.describe("home — claims sit above the pool", () => {
  test("as admin@, Claimed by you lists APR-2039 and appears before Fleet", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/");

    const texts = await page.locator("main").getByRole("heading", { level: 3 }).allTextContents();
    expect(texts.indexOf("Claimed by you")).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf("Claimed by you")).toBeLessThan(texts.indexOf("Fleet"));

    const claimsCard = page.locator("main > div > *").filter({
      has: page.getByRole("heading", { name: "Claimed by you", level: 3 }),
    });
    await expect(claimsCard).toContainText("APR-2039");
  });
});

test.describe("home — viewer is read-only", () => {
  test("no Your shift, no clear buttons, READ-ONLY badge shows, Fleet still renders", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/");

    await expect(page.getByText("READ-ONLY · VIEWER")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your shift", level: 3 })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Clear "/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fleet", level: 3 })).toBeVisible();
  });
});

test.describe("home — purchasing to-do", () => {
  test("PR-0198 reads as bounced back, not merely waiting on IT; PR-0201 reads as still a draft", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/");

    const row0198 = page.locator("li").filter({ hasText: "PR-0198" });
    await expect(row0198).toContainText("came back from L. Domingo");
    await expect(row0198.getByRole("link", { name: "Fix and resubmit" })).toBeVisible();

    const row0201 = page.locator("li").filter({ hasText: "PR-0201" });
    await expect(row0201).toContainText("still a draft");
    await expect(row0201.getByRole("link", { name: "Submit" })).toBeVisible();
  });
});

test.describe("home — finance leads with money, not counts", () => {
  test("headline reads ₱45,000 waiting, oldest 3 days, and sits before the stat tiles", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/");

    const headline = page.getByText(/₱[\d,]+ waiting/);
    await expect(headline).toContainText("₱45,000 waiting");
    await expect(headline).toContainText("oldest 3 days");

    // The money line must sit ABOVE the stat-tile grid, not just be present
    // somewhere on the page — compare vertical position, not DOM/text order,
    // since the Stat label is visually uppercased by CSS (text-transform),
    // which would make a naive text-index comparison brittle.
    const headlineBox = await headline.boundingBox();
    const statBox = await page.getByText("Requests waiting").boundingBox();
    expect(headlineBox).not.toBeNull();
    expect(statBox).not.toBeNull();
    expect(headlineBox!.y).toBeLessThan(statBox!.y);

    await expect(page.locator("li").filter({ hasText: "PR-0195" })).toBeVisible();
    await expect(page.locator("li").filter({ hasText: "PR-0195" }).getByRole("link", { name: "Review" })).toBeVisible();
  });
});

test.describe("home — fleet coverage, age distribution and warranty runway", () => {
  test("fleet bar, age histogram (4y+ non-zero) and the clustered warranty pair all read correctly", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    await expect(page.getByRole("img", { name: "Fleet of 25 assets by status" })).toBeVisible();
    await expect(page.getByText("spare pool covers 4 of the 10 slots the incoming hires need")).toBeVisible();

    // Note the EN DASH (–) in the bucket labels, not a hyphen.
    await expect(
      page.getByRole("img", { name: "<1y: 3, 1–2y: 14, 2–3y: 1, 3–4y: 3, 4y+: 4" }),
    ).toBeVisible();

    const row0148 = page.locator("li").filter({ hasText: "BR-LT-0148" });
    await expect(row0148).toContainText("Dell Latitude 5420");
    await expect(row0148).toContainText("same week");
    await expect(row0148).toContainText("38 d");

    const row0122 = page.locator("li").filter({ hasText: "BR-LT-0122" });
    await expect(row0122).toContainText("Dell Latitude 5420");
    await expect(row0122).toContainText("same week");
    await expect(row0122).toContainText("41 d");
  });
});

test.describe("home — /finance/assets, the capitalized register", () => {
  test("lists capitalized assets with a cost total; a status chip filters; a tag opens the asset record", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/finance/assets");

    // The finance sidebar has an h3 nav-group heading with this same text —
    // scope to the page's h1 title.
    await expect(page.getByRole("heading", { name: "Capitalized assets", level: 1 })).toBeVisible();
    await expect(page.getByText(/\d+ assets? · ₱[\d,]+ at cost/)).toBeVisible();

    const chip = page.getByRole("link", { name: "DEFECTIVE" });
    await chip.click();
    await expect(page).toHaveURL(/status=DEFECTIVE/, { timeout: 15_000 });
    await expect(chip).toHaveAttribute("aria-current", "page");

    const row = page.getByRole("row", { name: /BR-MN-0731/ });
    await expect(row).toBeVisible();

    // Finance was granted access to /inventory/<id> for this Phase — the tag
    // link must actually open the record, not redirect finance away.
    await row.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 15_000 });
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

// Runs here, before the dismissal/focus block below mutates it@'s shift
// queue and view state, so the row-ordering assertions above still see the
// untouched fresh-seed shift order.
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
// order, in a serial block — nothing above depends on the shift queue or the
// focus cookie being untouched, but something below would if it ran first.
test.describe("home — dismissal and focus mode (mutating, serial)", () => {
  test.describe.configure({ mode: "serial" });

  test("clearing a shift row removes it, and it stays gone after a reload", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    const ninaRow = page.locator("li").filter({ hasText: "Nina Robles" });
    await expect(ninaRow).toHaveCount(1);
    await ninaRow.getByRole("button", { name: /^Clear "Nina Robles/ }).click();
    await expect(page.locator("li").filter({ hasText: "Nina Robles" })).toHaveCount(0, { timeout: 15_000 });

    // Per-user, per-day preference, not component state — must survive a reload.
    await page.reload();
    await expect(page.locator("li").filter({ hasText: "Nina Robles" })).toHaveCount(0, { timeout: 15_000 });
  });

  test("Focus collapses to Your shift + Claimed by you, survives a reload, and never touches the URL", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/");

    await page.getByRole("button", { name: "Focus" }).click();
    await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Your shift", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Claimed by you", level: 3 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fleet", level: 3 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Age", level: 3 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Warranty runway", level: 3 })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Jump to", level: 3 })).toHaveCount(0);
    expect(page.url()).not.toContain("focus");

    await expectNoSeriousAxe(page);

    // A cookie, not component state — must survive a real reload.
    await page.reload();
    await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Fleet", level: 3 })).toHaveCount(0);
    expect(page.url()).not.toContain("focus");

    await page.getByRole("button", { name: "Show everything" }).click();
    await expect(page.getByRole("button", { name: "Focus" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Fleet", level: 3 })).toBeVisible({ timeout: 15_000 });
  });
});
