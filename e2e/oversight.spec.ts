import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient, type ApprovalType } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { fmtDateTime } from "@/lib/format";
import { DIRECT_KIND_LABEL, DIRECT_WINDOW_DAYS } from "@/lib/approvals-list";

/**
 * Phase 21, Task 7 — approvals oversight (spec §§2–4, 9), 7 cases run
 * serially: each case's database writes are read by a later case (case 2's
 * direct change feeds case 4's DB-derived total; case 6's claim feeds its
 * own "Claimed by you"/Worklist split).
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), verified against
 * source rather than assumed from the brief/facts files:
 *   admin@ (System Admin, admin, holds APR-2039 CLAIMED) · it@ (J.
 *   Sarmiento, it_staff). Three direct rows (Phase 21 seed, all
 *   appliedDirectly:true, EXECUTED, claimed and resolved by it@): APR-2036
 *   (lifecycle_assign, BR-HS-0501), APR-2037 (lifecycle_return, BR-HS-0502),
 *   APR-2038 (lifecycle_change_status, BR-KB-0402). Closed also holds
 *   APR-2031 (EXECUTED via the queue, no appliedDirectly) and APR-2028
 *   (REJECTED) — fresh-seed Closed = 5 (3 direct + 2 queue). APR-2040 is
 *   PENDING, slaAt one day overdue, employeeId Dennis Ong (EMP-0090), no
 *   assetId — it leads Home's "Approvals & leavers" queue section for it@
 *   (e2e/home-finance.spec.ts). BR-MN-0910 is SPARE (e2e/direct-
 *   lifecycle.spec.ts case 1 uses the same asset/flow).
 *
 * Read straight from source rather than trusted from the facts file, since
 * Task 6 changed markup after that file was written:
 *   ClosedViaChips (src/components/approvals/closed-via-chips.tsx) —
 *   role="group" aria-label="Closed by route", each chip a link whose
 *   accessible name is "{label} {count}" (e.g. "All 5"), aria-current="true"
 *   on the active one, href built by hrefFor("closed", 1, via) — "all" never
 *   appends ?via=, "direct"/"queue" do. QueueTable
 *   (src/components/approvals/queue-table.tsx) — the State cell reads
 *   `{row.state}` then, only when row.direct, a `<Pill>DIRECT</Pill>` in the
 *   SAME cell (Th/Table markup unrelated to Task 6's a11y changes). The
 *   detail page (src/app/(app)/approvals/[id]/page.tsx) branches on
 *   `approval.appliedDirectly`: the meta line reads "{type label} ·
 *   applied directly by {name} · {fmtDateTime(resolvedAt)}", and the card
 *   heading is "How it was applied" with no "What the system checked" card
 *   at all (not just hidden). Home (src/app/(app)/page.tsx) renders
 *   DirectChangesBody (src/components/home/direct-changes.tsx) inside a
 *   SectionCard titled "Applied directly · last 7 days" (an h2, README 1k),
 *   on the admin branch below "System" and on the IT branch (admin's
 *   default landing) above "Fleet" — both gated on `user.role === "admin"`
 *   and hidden under `!focus`.
 *
 * Never reference a raw cuid — the DB is reseeded and ids change every run.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.$disconnect();
});

// Copied from e2e/transfers.spec.ts (itself copied from e2e/stock.spec.ts) —
// house rule: never import helpers across spec files, since each file
// reseeds independently.
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

const ADMIN = "admin@thebackroomop.com";
const IT = "it@thebackroomop.com";

/** Sets the admin-branch workspace cookie the way switchWorkspace() does — see e2e/axe-sweep.spec.ts's own long comment on why `path: "/"` is required. */
async function switchToAdminBranch(page: Page) {
  await page.context().addCookies([{ name: "br.dept", value: "admin", domain: "localhost", path: "/" }]);
}

test.describe.serial("oversight", () => {
  test("1. Closed tab: route chips read All 5 / Applied directly 3 / Through the queue 2; via=direct/queue filter correctly; chip hrefs carry via, tab links don't", async ({ page }) => {
    await login(page, IT);
    await page.goto("/approvals?tab=closed");

    const chips = page.getByRole("group", { name: "Closed by route" });
    const all = chips.getByRole("link", { name: "All 5" });
    const direct = chips.getByRole("link", { name: "Applied directly 3" });
    const queue = chips.getByRole("link", { name: "Through the queue 2" });
    await expect(all).toBeVisible();
    await expect(direct).toBeVisible();
    await expect(queue).toBeVisible();
    await expect(all).toHaveAttribute("aria-current", "true");

    // Chip hrefs carry `via` (direct/queue); "All" (via=all) does not, and
    // neither does the Closed tab link itself.
    await expect(all).toHaveAttribute("href", "/approvals?tab=closed");
    await expect(direct).toHaveAttribute("href", "/approvals?tab=closed&via=direct");
    await expect(queue).toHaveAttribute("href", "/approvals?tab=closed&via=queue");
    const tabsNav = page.getByRole("navigation", { name: "Queue tabs" });
    await expect(tabsNav.getByRole("link", { name: "Closed" })).toHaveAttribute("href", "/approvals?tab=closed");
    await expect(tabsNav.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/approvals");

    await page.goto("/approvals?tab=closed&via=direct");
    for (const ref of ["APR-2036", "APR-2037", "APR-2038"]) {
      const row = page.getByRole("row", { name: new RegExp(ref) });
      await expect(row).toBeVisible();
      await expect(row.getByText("DIRECT")).toBeVisible();
    }
    for (const ref of ["APR-2031", "APR-2028"]) {
      await expect(page.getByRole("row", { name: new RegExp(ref) })).toHaveCount(0);
    }

    await page.goto("/approvals?tab=closed&via=queue");
    for (const ref of ["APR-2031", "APR-2028"]) {
      await expect(page.getByRole("row", { name: new RegExp(ref) })).toBeVisible();
    }
    for (const ref of ["APR-2036", "APR-2037", "APR-2038"]) {
      await expect(page.getByRole("row", { name: new RegExp(ref) })).toHaveCount(0);
    }
  });

  test("2. Change status on BR-MN-0910 -> DEFECTIVE creates a direct row: appliedDirectly in the DB, the DIRECT pill under via=direct, and the detail's 'How it was applied' card", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-MN-0910" } });
    await login(page, IT);
    await page.goto(`/inventory/${asset.id}`);
    await page.getByRole("button", { name: "Change status" }).click();
    const dialog = page.getByRole("dialog", { name: "Change status" });
    await waitForHydration(dialog);
    await dialog.getByLabel("New status").selectOption("DEFECTIVE");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    // "Success: " is the toast's own sr-only prefix (TONE_LABEL.settled,
    // src/components/ui/toast.tsx) — part of the element's text content, so
    // the exact:true match needs it too (mirrors transfers.spec.ts's own
    // "Success: Transferred to HR" toast assertion). A generous timeout: the
    // first hit of /inventory/[id] and the lifecycle action in this file, on
    // a cold dev server.
    await expect(page.getByText("Success: BR-MN-0910 is now DEFECTIVE", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    const approval = await db.approval.findFirstOrThrow({
      where: { assetId: asset.id, type: "lifecycle_change_status" },
    });
    expect(approval.appliedDirectly).toBe(true);

    await page.goto("/approvals?tab=closed&via=direct");
    const row = page.getByRole("row", { name: new RegExp(approval.refNo) });
    await expect(row).toBeVisible();
    await expect(row.getByText("DIRECT")).toBeVisible();

    await page.goto(`/approvals/${approval.id}`);
    await expect(page.getByRole("heading", { name: approval.refNo })).toBeVisible();
    await expect(
      page.getByText(`applied directly by J. Sarmiento · ${fmtDateTime(approval.resolvedAt)}`),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it was applied" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What the system checked" })).toHaveCount(0);
  });

  test("3. APR-2031 (executed via the queue) still shows 'What the system checked' and carries no DIRECT pill", async ({ page }) => {
    const apr2031 = await db.approval.findUniqueOrThrow({ where: { refNo: "APR-2031" } });
    await login(page, IT);
    await page.goto("/approvals?tab=closed&via=queue");
    const row = page.getByRole("row", { name: /APR-2031/ });
    await expect(row).toBeVisible();
    await expect(row.getByText("DIRECT")).toHaveCount(0);

    await page.goto(`/approvals/${apr2031.id}`);
    await expect(page.getByRole("heading", { name: "What the system checked" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it was applied" })).toHaveCount(0);
  });

  test("4. as admin@ with the admin cookie, Home's 'Applied directly · last 7 days' shows a DB-derived total, by-kind order, J. Sarmiento and the Closed link; the focus toggle hides it", async ({ page }) => {
    // Derived from the DB rather than hardcoded: by this point in the serial
    // run, case 2 added a fourth direct row on top of the three seeded ones,
    // so the fresh-seed "3 total / 1 each" numbers the facts file describes
    // no longer hold — the brief is explicit that this case reads the DB.
    const since = new Date(Date.now() - DIRECT_WINDOW_DAYS * 86_400_000);
    const directRows = await db.approval.findMany({
      where: { appliedDirectly: true, resolvedAt: { gte: since } },
      select: { type: true },
    });
    const expectedTotal = directRows.length;
    const kindCounts = new Map<ApprovalType, number>();
    for (const r of directRows) kindCounts.set(r.type, (kindCounts.get(r.type) ?? 0) + 1);
    // Same comparator as directChanges() (src/server/modules/home/queries.ts):
    // count desc, then label asc.
    const expectedByKind = [...kindCounts.entries()]
      .map(([type, count]) => ({ label: DIRECT_KIND_LABEL[type], count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    await login(page, ADMIN);
    await switchToAdminBranch(page);
    await page.goto("/");
    await expect(page.getByText("Who can get in")).toBeVisible();

    const card = page.locator("main > div > *").filter({
      has: page.getByRole("heading", { name: "Applied directly · last 7 days", level: 2 }),
    });
    await expect(card).toBeVisible();

    const totalStat = card.getByText("Applied directly", { exact: true }).locator("..");
    await expect(totalStat).toContainText(String(expectedTotal));

    const kindItems = card.locator("ul").first().locator("li");
    await expect(kindItems).toHaveCount(expectedByKind.length);
    for (const [i, k] of expectedByKind.entries()) {
      await expect(kindItems.nth(i)).toContainText(k.label);
    }

    await expect(card).toContainText("J. Sarmiento");
    await expect(card.getByRole("link", { name: "See them in Closed →" })).toHaveAttribute(
      "href",
      "/approvals?tab=closed&via=direct",
    );

    const focusToggle = page.getByRole("button", { name: "Focus" });
    await expect(focusToggle).toBeVisible();
    await focusToggle.click();
    await expect(page.getByRole("button", { name: "Show everything" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Applied directly · last 7 days", level: 2 })).toHaveCount(0);
  });

  test("5. without the admin cookie, admin@'s (IT-branch, default landing) Home also shows the section; it@'s Home does not", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Applied directly · last 7 days", level: 2 })).toBeVisible();

    await login(page, IT);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Applied directly · last 7 days", level: 2 })).toHaveCount(0);
  });

  test("6. double-count (P-5): claiming APR-2040 for admin shows it once, in 'Claimed by you', absent from the Worklist's queue section, and still on /inventory/work", async ({ page }) => {
    const admin = await db.user.findUniqueOrThrow({ where: { email: ADMIN } });
    await db.approval.update({
      where: { refNo: "APR-2040" },
      data: { state: "CLAIMED", claimedById: admin.id, claimedAt: new Date() },
    });

    await login(page, ADMIN);
    await page.goto("/");

    const claimsCard = page.locator("main > div > *").filter({
      has: page.getByRole("heading", { name: "Claimed by you", level: 2 }),
    });
    await expect(claimsCard).toContainText("APR-2040");
    // One approval, once per screen (spec §4.2) — the refNo's own link text
    // is exactly "APR-2040" wherever it renders, so a page-wide exact count
    // of 1 proves it appears nowhere else (in particular, not repeated in
    // the Worklist's queue section below).
    await expect(page.getByText("APR-2040", { exact: true })).toHaveCount(1);

    const worklistCard = page.locator("main > div > *").filter({
      has: page.getByRole("heading", { name: "Worklist", level: 2 }),
    });
    await expect(worklistCard).not.toContainText("APR-2040");

    await page.goto("/inventory/work");
    await expect(page.getByText("APR-2040")).toBeVisible();
  });

  test("7. axe: the Closed/via=direct tab, a direct approval's detail, and the admin Home branch", async ({ page }) => {
    await login(page, IT);
    await page.goto("/approvals?tab=closed&via=direct");
    await expectNoSeriousAxe(page);

    const directApproval = await db.approval.findFirstOrThrow({
      where: { appliedDirectly: true },
      orderBy: { refNo: "asc" },
    });
    await page.goto(`/approvals/${directApproval.id}`);
    await expectNoSeriousAxe(page);

    await login(page, ADMIN);
    await switchToAdminBranch(page);
    await page.goto("/");
    await expect(page.getByText("Who can get in")).toBeVisible();
    await expectNoSeriousAxe(page);
  });
});
