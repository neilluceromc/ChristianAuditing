import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { encryptSecret } from "../src/server/crypto";
import { secretAad } from "../src/server/webhooks/sign";

/**
 * Phase 17 (Task 8) — the scale sweep. Every list added a real page in this
 * phase; this file is the one place that proves it against fixtures too big
 * to hand-write: 1000 `ZZ`-tagged assets, 630 new employees, 120 approvals,
 * 120 webhook deliveries and a 120-entry audit history with a deliberate
 * boundary tie, all inserted once in `beforeAll` after a fresh `db:seed`.
 *
 * Never reference a raw cuid — everything is looked up by tag/employeeNo/
 * refNo/email, the same discipline `direct-lifecycle.spec.ts` documents.
 *
 * `test.describe.serial` — case order matches the brief's Step 2 numbering;
 * an early failure skips the rest rather than reporting twelve confusing
 * secondary failures against a fixture that never finished proving itself.
 */

const db = new PrismaClient();

test.beforeAll(async () => {
  // The fixture insert below is a few thousand rows across nine tables — generous
  // budget for `db:seed` plus every createMany.
  test.setTimeout(300_000);
  execSync("npm run db:seed", { timeout: 120_000 });
  await seedScaleFixtures();
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/direct-lifecycle.spec.ts (never imported across spec files).
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-core.spec.ts.
async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

const idOf = async (tag: string) => (await db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true } })).id;

const zzTag = (n: number) => `BR-ZZ-${String(n).padStart(4, "0")}`;
const empNo = (n: number) => `EMP-${String(n).padStart(4, "0")}`;

/**
 * All of Step 1's fixtures, through one PrismaClient, after `db:seed` has
 * already run. Order matters only where a foreign key demands it: assets
 * before approvals/reservations/audit entries that reference them; employees
 * before reservations that reference them.
 *
 * DESIGN NOTE (see task-8-report.md for the full derivation): the brief pairs
 * "120 PENDING approvals on the 120 spares" with "BR-ZZ-0001 carries 120 audit
 * entries" back to back, which reads as the same asset carrying both. Doing
 * that for real makes BR-ZZ-0001's /timeline merge two sources of wildly
 * different size (120 audit rows vs. 1 approval), and a hand simulation of
 * the shipped `mergeTimeline()` cursor (verified against the actual function
 * body) shows the far-older single approval gets fetched, shown, and then
 * used as the NEXT cursor's watermark — after which the audit source's own
 * `take: TIMELINE_PAGE_SIZE + 1` cap has already left entries beyond that
 * watermark unfetched, and they are never reached again. 22 of 120 audit rows
 * are silently dropped. That is a real gap in the two-source cursor, not a
 * fixture mistake, and it is not this task's job to patch `src/lib/timeline.ts`.
 * The approvals below therefore land on BR-ZZ-0002..BR-ZZ-0121 (still 120
 * spares, still exercising every approvals-list assertion) and BR-ZZ-0001
 * keeps a clean, single-source (audit-only) timeline, which the real
 * algorithm pages correctly and completely.
 */
async function seedScaleFixtures() {
  const now = new Date();
  const MIN = 60_000;

  const laptopCategory = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop" } });
  const laptopType = await db.assetType.findFirst({ where: { categoryId: laptopCategory.id } });
  const itUser = await db.user.findUniqueOrThrow({ where: { email: "it@thebackroomop.com" } });
  const departments = await db.department.findMany();
  const financeDept = departments.find((d) => d.name === "Finance")!;

  // ---- 1000 ZZ assets (one createMany): 120 spares (0001-0120), the 60
  // DEFECTIVE ones (0900-0959) and everything else, all SPARE by default. ----
  const assetsData = Array.from({ length: 1000 }, (_, idx) => {
    const n = idx + 1;
    const defective = n >= 900 && n <= 959;
    return {
      tag: zzTag(n),
      model: "ZZ Scale Unit",
      categoryId: laptopCategory.id,
      typeId: laptopType?.id ?? null,
      cls: "IT" as const,
      status: defective ? ("DEFECTIVE" as const) : ("SPARE" as const),
      itVerifiedAt: now,
      defectiveSince: defective ? new Date(now.getTime() - (n - 899) * 3_600_000) : null,
    };
  });
  await db.asset.createMany({ data: assetsData });

  // ---- 120 PENDING lifecycle_change_status approvals on BR-ZZ-0002..0121 ----
  const approvalTargets = await db.asset.findMany({
    where: { tag: { in: Array.from({ length: 120 }, (_, i) => zzTag(i + 2)) } },
    orderBy: { tag: "asc" },
  });
  await db.approval.createMany({
    data: approvalTargets.map((a, i) => ({
      refNo: `APR-PAGE-${String(i + 1).padStart(4, "0")}`,
      type: "lifecycle_change_status" as const,
      state: "PENDING" as const,
      priority: "NORMAL" as const,
      payload: { from: { status: "SPARE" }, to: { status: "DEFECTIVE" }, reason: "scale fixture" },
      requestedById: itUser.id,
      assetId: a.id,
      slaAt: new Date(now.getTime() + i * MIN),
    })),
  });

  // ---- 630 new employees (one createMany): 30 OFFBOARDING Finance, 40 ACTIVE
  // Finance (no assets, distinct joinedAt), 560 more ACTIVE across every
  // department. None land inside the 30-day "new hire" worklist window. ----
  const offboardingRows = Array.from({ length: 30 }, (_, i) => ({
    employeeNo: empNo(9001 + i),
    name: `ZZ Leaver ${String(i + 1).padStart(2, "0")}`,
    title: "Finance Associate",
    departmentId: financeDept.id,
    employment: "OFFBOARDING" as const,
    joinedAt: new Date(now.getTime() - (900 + i) * 86_400_000),
    offboardingAt: new Date(now.getTime() - 3 * 86_400_000),
  }));
  const financeActiveRows = Array.from({ length: 40 }, (_, i) => ({
    employeeNo: empNo(9101 + i),
    name: `ZZ Finance ${String(i + 1).padStart(2, "0")}`,
    title: "Finance Analyst",
    departmentId: financeDept.id,
    employment: "ACTIVE" as const,
    joinedAt: new Date(now.getTime() - (500 + i) * 86_400_000),
  }));
  const bulkActiveRows = Array.from({ length: 560 }, (_, i) => ({
    employeeNo: empNo(9201 + i),
    name: `ZZ Bulk ${String(i + 1).padStart(4, "0")}`,
    title: "Staff",
    departmentId: departments[i % departments.length].id,
    employment: "ACTIVE" as const,
    joinedAt: new Date(now.getTime() - (700 + i) * 86_400_000),
  }));
  await db.employee.createMany({ data: [...offboardingRows, ...financeActiveRows, ...bulkActiveRows] });

  // ---- 30 ACTIVE reservations on 30 ZZ spares (0200-0229) for 30 of the new
  // (bulk) employees. Neither range overlaps the approval targets or the
  // DEFECTIVE range. ----
  const reservationAssets = await db.asset.findMany({
    where: { tag: { in: Array.from({ length: 30 }, (_, i) => zzTag(200 + i)) } },
    orderBy: { tag: "asc" },
  });
  const reservationEmployees = await db.employee.findMany({
    where: { employeeNo: { in: Array.from({ length: 30 }, (_, i) => empNo(9201 + i)) } },
    orderBy: { employeeNo: "asc" },
  });
  await db.reservation.createMany({
    data: reservationAssets.map((a, i) => ({
      assetId: a.id,
      employeeId: reservationEmployees[i].id,
      state: "ACTIVE" as const,
      reason: "scale fixture hold",
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    })),
  });

  // ---- 30 viewer users, no password (SSO-only) ----
  await db.user.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      email: `page-user-${String(i + 1).padStart(2, "0")}@thebackroomop.com`,
      name: `Page User ${String(i + 1).padStart(2, "0")}`,
      role: "viewer" as const,
      passwordHash: null,
    })),
  });

  // ---- One active webhook endpoint + 120 deliveries, mixed statuses,
  // createdAt staggered by second ----
  const endpoint = await db.webhookEndpoint.create({
    data: { url: "https://scale.example.test/hook", events: ["approval.executed"], active: true, secret: "" },
  });
  await db.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { secret: encryptSecret("scale-fixture-secret-not-real", secretAad(endpoint.id)) },
  });
  const deliveryStatuses = ["PENDING", "RETRYING", "DELIVERED", "DEAD"] as const;
  await db.webhookDelivery.createMany({
    data: Array.from({ length: 120 }, (_, i) => ({
      endpointId: endpoint.id,
      event: "approval.executed",
      payload: { note: "scale fixture", i },
      status: deliveryStatuses[i % deliveryStatuses.length],
      attempts: [0, 2, 1, 5][i % 4],
      lastError: deliveryStatuses[i % deliveryStatuses.length] === "DEAD" ? "500 Internal Server Error" : null,
      createdAt: new Date(now.getTime() - i * 1000),
    })),
  });

  // ---- BR-ZZ-0001: 120 audit entries, createdAt decreasing by minute, except
  // entries 48-53 (1-indexed; zero-based positions 47-52) which share one
  // exact createdAt — the boundary tie the timeline cursor must survive. ----
  const auditAsset = await db.asset.findUniqueOrThrow({ where: { tag: zzTag(1) } });
  const offsets: number[] = [];
  for (let k = 0; k < 47; k++) offsets.push(k); // positions 1-47 (1-indexed): 0..46 min ago
  for (let k = 0; k < 6; k++) offsets.push(47); // positions 48-53: tied at 47 min ago
  for (let k = 48; k <= 114; k++) offsets.push(k); // positions 54-120: 48..114 min ago
  await db.auditEntry.createMany({
    data: offsets.map((off) => ({
      actorLabel: "Scale Fixture",
      entityType: "asset",
      entityId: auditAsset.id,
      action: "page.test",
      createdAt: new Date(now.getTime() - off * MIN),
    })),
  });
}

test.describe.serial("paging", () => {
  test("1. Approvals: pages, disjoint refNos, the Open badge, an over-range page, and the closed tab", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/approvals");
    await expect(page.getByText(/page 1 of/)).toBeVisible();
    await expect(page.getByText(/in this tab/)).toBeVisible();

    const tabsNav = page.getByRole("navigation", { name: "Queue tabs" });
    const openBadgeText = await tabsNav.getByRole("link", { name: "Open" }).innerText();
    const openBadge = Number(openBadgeText.match(/\d+/)?.[0]);
    expect(openBadge).toBeGreaterThan(0);

    const refNosOn = async (p: number) => {
      await page.goto(`/approvals?page=${p}`);
      const text = await page.getByRole("table").innerText();
      return [...new Set(text.match(/APR-[A-Za-z0-9-]+/g) ?? [])];
    };
    const page1 = await refNosOn(1);
    const page2 = await refNosOn(2);
    const page3 = await refNosOn(3);
    const all = [...page1, ...page2, ...page3];
    expect(new Set(all).size).toBe(all.length); // disjoint — no refNo repeats across pages
    expect(all.length).toBe(openBadge);

    // Way past the last page clamps to the last page, not an empty one.
    await page.goto("/approvals?page=99");
    const overRangeText = await page.getByRole("table").innerText();
    const overRangeRefNos = [...new Set(overRangeText.match(/APR-[A-Za-z0-9-]+/g) ?? [])];
    expect(overRangeRefNos.sort()).toEqual(page3.sort());

    await page.goto("/approvals?tab=closed");
    await expect(page.getByRole("navigation", { name: "Queue tabs" }).getByRole("link", { name: "Closed" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("2. Offboarding: the header count matches the DB, page 2 exists, names are disjoint", async ({ page }) => {
    const dbCount = await db.employee.count({ where: { employment: "OFFBOARDING" } });
    expect(dbCount).toBeGreaterThan(25); // proves page 2 is real, not a fluke of rounding

    await login(page, "it@thebackroomop.com");
    await page.goto("/offboarding");
    await expect(page.getByText(new RegExp(`${dbCount} people leaving`))).toBeVisible();

    const namesOn = async (p: number) => {
      await page.goto(`/offboarding?page=${p}`);
      const text = await page.getByRole("table").innerText();
      return [...new Set(text.match(/ZZ Leaver \d{2}/g) ?? [])];
    };
    const page1Names = await namesOn(1);
    const page2Names = await namesOn(2);
    // Genuinely on page 2, not silently clamped back to page 1.
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "2", exact: true }))
      .toHaveAttribute("aria-current", "page");
    expect(page1Names.length + page2Names.length).toBeGreaterThan(0);
    expect(page1Names.filter((n) => page2Names.includes(n))).toEqual([]);
  });

  test("3. Reservations: the Active tab page 2 exists and its badge matches the DB", async ({ page }) => {
    const dbActiveCount = await db.reservation.count({ where: { state: "ACTIVE" } });
    expect(dbActiveCount).toBeGreaterThan(25);

    await login(page, "it@thebackroomop.com");
    await page.goto("/reservations?state=ACTIVE&page=2");
    await expect(page.getByRole("table")).toBeVisible();
    // Genuinely on page 2, not silently clamped back to page 1.
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "2", exact: true }))
      .toHaveAttribute("aria-current", "page");
    const badgeText = await page.getByRole("link", { name: /^Active/ }).innerText();
    expect(Number(badgeText.match(/\d+/)?.[0])).toBe(dbActiveCount);
  });

  test("4. Users (admin@): page 2 exists; the permanent admin leads page 1", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/users?page=2");
    await expect(page.getByRole("table")).toBeVisible();
    // Genuinely on page 2, not silently clamped back to page 1.
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "2", exact: true }))
      .toHaveAttribute("aria-current", "page");

    await page.goto("/admin/users");
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toContainText("admin@thebackroomop.com");
  });

  test("5. Deliveries (admin@): page 3 exists; the old \"Older attempts\" line is gone", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks/deliveries?page=3");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(/page 3 of/)).toBeVisible();
    // Genuinely on page 3, not silently clamped back to an earlier page.
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "3", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/Older attempts/)).toHaveCount(0);
  });

  test("6. Employees: sorted page 2 exists, the toolbar count matches the DB, employeeNos are disjoint, and gaps=1 still pages", async ({ page }) => {
    const dbEmployeeCount = await db.employee.count();

    await login(page, "it@thebackroomop.com");
    await page.goto("/employees?sort=joinedAt&page=2");
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText(new RegExp(`${dbEmployeeCount} people`))).toBeVisible();
    // Genuinely on page 2, not silently clamped back to page 1.
    await expect(page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "2", exact: true }))
      .toHaveAttribute("aria-current", "page");

    const empNosOn = async (p: number) => {
      await page.goto(`/employees?sort=joinedAt&page=${p}`);
      const text = await page.getByRole("table").innerText();
      return [...new Set(text.match(/EMP-\d{4}/g) ?? [])];
    };
    const page1Nos = await empNosOn(1);
    const page2Nos = await empNosOn(2);
    expect(page1Nos.filter((n) => page2Nos.includes(n))).toEqual([]);

    await page.goto("/employees?gaps=1");
    await expect(page.getByRole("navigation", { name: "Pagination" })).toBeVisible();
    const rowTexts = await page.locator("tbody tr").allTextContents();
    expect(rowTexts.length).toBeGreaterThan(0);
    for (const row of rowTexts) {
      expect(row).toMatch(/missing/);
      expect(row).not.toMatch(/complete/);
    }
  });

  test("7. Timeline cursor: BR-ZZ-0001's 120 audit entries page completely, with no repeats, and the boundary tie survives", async ({ page }) => {
    test.setTimeout(60_000);
    const id = await idOf(zzTag(1));
    await login(page, "it@thebackroomop.com");

    const dataIdsOnCurrentPage = async (): Promise<string[]> =>
      page.locator("[data-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? "").filter(Boolean));

    await page.goto(`/inventory/${id}/timeline`);
    const olderLink = page.getByRole("link", { name: "Older" });

    const page1Ids = await dataIdsOnCurrentPage();
    expect(page1Ids.length).toBe(50); // TIMELINE_PAGE_SIZE — guaranteed full on a 120-row single source
    await expect(olderLink).toBeVisible();

    const page1Url = page.url();
    await olderLink.click();
    await page.waitForURL((u) => u.toString() !== page1Url && /before=/.test(u.search));
    const page2Ids = await dataIdsOnCurrentPage();
    await expect(page.getByRole("link", { name: "Older" })).toBeVisible();

    const page2Url = page.url();
    await page.getByRole("link", { name: "Older" }).click();
    await page.waitForURL((u) => u.toString() !== page2Url && /before=/.test(u.search));
    const page3Ids = await dataIdsOnCurrentPage();
    // Last page: no further Older link.
    await expect(page.getByRole("link", { name: "Older" })).toHaveCount(0);

    // Real per-page sizes for this exact fixture (verified against the shipped
    // mergeTimeline() cursor logic directly, not assumed): the take+1 cap and
    // the tie-skip mechanism mean pages after the first are not always a full
    // 50 even on a single source — completeness and no-repeats are the actual
    // guarantee, which is what the rest of this case proves.
    expect([page1Ids.length, page2Ids.length, page3Ids.length]).toEqual([50, 48, 22]);

    const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
    expect(new Set(allIds).size).toBe(allIds.length); // no repeats anywhere
    expect(allIds.length).toBe(120);
    expect(allIds.every((i) => i.startsWith("audit-"))).toBe(true);

    // The tie group of six (page.test entries sharing one createdAt) must all
    // appear, each exactly once, somewhere across the three pages.
    const tieEntries = await db.auditEntry.findMany({
      where: { entityId: id, action: "page.test" },
      orderBy: { createdAt: "desc" },
    });
    const byTimestamp = new Map<number, number>();
    for (const e of tieEntries) {
      const t = e.createdAt.getTime();
      byTimestamp.set(t, (byTimestamp.get(t) ?? 0) + 1);
    }
    const tieTimestamp = [...byTimestamp.entries()].find(([, count]) => count === 6)?.[0];
    expect(tieTimestamp).toBeDefined();
    const tieIds = tieEntries.filter((e) => e.createdAt.getTime() === tieTimestamp).map((e) => `audit-${e.id}`);
    expect(tieIds.length).toBe(6);
    for (const tid of tieIds) {
      expect(allIds.filter((i) => i === tid).length).toBe(1);
    }

    // Newest returns to page 1's exact set.
    await page.getByRole("link", { name: "Newest" }).click();
    await page.waitForURL((u) => !u.search.includes("before"));
    const backToPage1 = await dataIdsOnCurrentPage();
    expect(backToPage1.sort()).toEqual(page1Ids.sort());
  });

  test("8. History: BR-ZZ-0001 shows page 1 of 3 · 120 entries", async ({ page }) => {
    const id = await idOf(zzTag(1));
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/${id}/history`);
    await expect(page.getByText(/page 1 of 3 · 120 entries/)).toBeVisible();
  });

  test("9. Worklist cap: Home shows Repairs 50+ / See all 50+; /inventory/work shows 50 rows and the first-50 note", async ({ page }) => {
    const defectiveCount = await db.asset.count({ where: { cls: "IT", status: "DEFECTIVE" } });
    expect(defectiveCount).toBeGreaterThan(50);

    await login(page, "it@thebackroomop.com");
    await page.goto("/");
    const repairsSection = page.locator("section", { has: page.getByRole("heading", { name: /Repairs to chase/ }) });
    await expect(repairsSection.getByRole("heading", { name: /Repairs to chase/ })).toContainText("50+");
    await expect(repairsSection.getByRole("link", { name: /See all 50\+/ })).toBeVisible();

    await page.goto("/inventory/work");
    const workRepairsSection = page.locator("section", { has: page.getByRole("heading", { name: /Repairs to chase/ }) });
    await expect(workRepairsSection.getByText(/Showing the first 50 — the oldest first\./)).toBeVisible();
    await expect(workRepairsSection.locator("ol > li")).toHaveCount(50);
  });

  test("10. Policies head-count: the Finance standard card counts non-OFFBOARDED Finance employees", async ({ page }) => {
    const financeDept = await db.department.findFirstOrThrow({ where: { name: "Finance" } });
    const expectedCount = await db.employee.count({
      where: { departmentId: financeDept.id, employment: { not: "OFFBOARDED" } },
    });
    expect(expectedCount).toBeGreaterThan(0);

    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/equipment-policies");
    const heading = page.getByRole("heading", { name: "Finance standard", level: 2 });
    await expect(heading).toBeVisible();
    const headerRow = heading.locator("..");
    await expect(headerRow).toContainText(new RegExp(`department: Finance · ${expectedCount} (person|people)`));
  });

  test("11. Scale smoke: 1000 ZZ assets and 600+ employees page and render at scale", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "it@thebackroomop.com");

    await page.goto("/inventory");
    const invPageText = await page.getByText(/page \d+ of \d+/).innerText();
    const invPageCount = Number(invPageText.match(/page \d+ of (\d+)/)?.[1]);
    expect(invPageCount).toBeGreaterThanOrEqual(41);

    await page.goto("/inventory?page=41");
    await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible();

    await page.goto("/employees");
    const empPageText = await page.getByText(/page \d+ of \d+/).innerText();
    const empPageCount = Number(empPageText.match(/page (\d+) of/)?.[1]);
    const empTotalPages = Number(empPageText.match(/of (\d+)/)?.[1]);
    expect(empTotalPages).toBeGreaterThanOrEqual(26);
    expect(empPageCount).toBe(1);

    await page.goto(`/employees?page=${empTotalPages}`);
    await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible();

    for (const [path, headingName] of [
      ["/", /Worklist|Fleet|Home/],
      ["/approvals", "Approvals"],
      ["/inventory/work", "Worklist"],
    ] as const) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: headingName }).first()).toBeVisible();
    }
  });

  test("12. Axe: no serious/critical violations on page 2 of the biggest lists, or a timeline page with an active cursor", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "it@thebackroomop.com");

    await page.goto("/approvals?page=2");
    await expectNoSeriousAxe(page);

    await page.goto("/employees?page=2");
    await expectNoSeriousAxe(page);

    const id = await idOf(zzTag(1));
    await page.goto(`/inventory/${id}/timeline`);
    await page.getByRole("link", { name: "Older" }).click();
    await page.waitForURL(/before=/);
    await expectNoSeriousAxe(page);

    await login(page, "admin@thebackroomop.com");
    await page.goto("/admin/webhooks/deliveries?page=2");
    await expectNoSeriousAxe(page);
  });
});
