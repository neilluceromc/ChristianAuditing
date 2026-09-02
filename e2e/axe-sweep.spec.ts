import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 10's axe pass. The point is COVERAGE, not severity: a design token
 * failed WCAG contrast on ~24 usages across the app while the suite stayed
 * green, because one spec axe-checked /employees/[id] and never /employees.
 * A green suite bounds what has been checked, not what is true.
 *
 * Fails on serious/critical. Moderates are COUNTED and printed, not failed —
 * the number across the ~38 never-scanned routes was unknown when this was
 * written, and committing to fix an uncounted set is how a polish phase
 * stops being polish. Record the final counts in HANDOVER.
 *
 * The route table below was built from `find src/app -name page.tsx`, not
 * from the plan's draft (which was hand-written, missed
 * /admin/webhooks/deliveries, /employees/[id]/timeline and
 * /purchases/[id]/edit, and put nearly everything under admin even where a
 * lower-privilege role can reach the same page). Every route is assigned the
 * LOWEST role that PATH_RULES (src/lib/workspaces.ts) and the page's own
 * requireRole/requireUser call together actually allow through, and
 * scanRoute asserts the URL landed on the intended path — an insufficient
 * role redirects to that role's home and axes an empty landing page, which
 * still "passes" and proves nothing.
 *
 * Deliberately OUT of scope: /dev/kitchen-sink (self-notFound()s outside
 * dev, so it isn't part of the production route surface this table
 * describes, and e2e/kitchen-sink.spec.ts already axe-checks it in both
 * themes). The `/[...pending]` catch-all this comment used to also exclude
 * was DELETED once every phase had shipped — it was intercepting genuine
 * 404s under the (app) group and telling signed-in users the page was
 * "PLANNED" and would "arrive in Phase 3". Unmatched paths now reach Next's
 * own not-found handling, which is not a page route and needs no entry here.
 *
 * Never reference a raw cuid — the DB is reseeded and ids change every time.
 * BR-LT-0148, EMP-0090 (Dennis Ong, the only OFFBOARDING employee), the
 * lowest-refNo approval/purchase request, and PR-0201 (the seed's one DRAFT
 * purchase request, owned by purchasing@thebackroomop.com — see prisma/seed.ts)
 * are all stable business keys.
 */
const db = new PrismaClient();
const moderates = new Map<string, number>();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
  const rows = [...moderates.entries()].sort((a, b) => b[1] - a[1]);
  console.log("\n=== moderate/minor axe violations by rule (not failed) ===");
  if (rows.length === 0) console.log("  none");
  for (const [rule, count] of rows) console.log(`  ${count.toString().padStart(4)}  ${rule}`);
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Navigates, asserts we actually landed on the intended path (an
 * insufficiently-privileged role silently redirects to that role's home —
 * axe would then "pass" a page we never meant to scan), settles the pointer
 * (Button variant="primary" reports a phantom SERIOUS 4.29 contrast
 * violation when axe samples it mid-transition or with the pointer resting
 * on it, measured three times in this project — it passes at rest), then
 * scans. Serious/critical fail the test; everything else is counted.
 */
async function scanRoute(page: Page, path: string) {
  await page.goto(path);
  const wantPath = path.split("?")[0];
  expect(new URL(page.url()).pathname, `expected to land on ${wantPath}, got ${page.url()}`).toBe(wantPath);

  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);

  const results = await new AxeBuilder({ page }).analyze();
  for (const v of results.violations) {
    if (v.impact === "serious" || v.impact === "critical") continue;
    moderates.set(v.id, (moderates.get(v.id) ?? 0) + v.nodes.length);
  }
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`), `axe on ${path}`).toEqual([]);
}

// ── Admin-only: workspace "admin" in PATH_RULES, or requireRole("admin") ──
const ADMIN_ROUTES = ["/admin/users", "/admin/flags", "/admin/webhooks", "/admin/webhooks/deliveries"];

// ── it_staff: PATH_RULES roles:[admin,it_staff], or page-level requireRole ─
const IT_STAFF_ROUTES = [
  "/inventory/new", "/inventory/import",
  "/admin/asset-categories", "/admin/asset-types", "/admin/departments",
  "/employees/import",
];

// ── purchasing_staff: requireRole(...DRAFT_ROLES) = [purchasing_staff, admin] ─
const PURCHASING_STAFF_ROUTES = ["/purchases/new"];

// ── finance_staff: PATH_RULES workspace "finance" only ─────────────────────
const FINANCE_STAFF_ROUTES = ["/finance/assets", "/finance/activity"];

// ── viewer: everything else — PATH_RULES workspace "it" (viewer's only
// workspace) with no further role restriction. This is the lowest role that
// can reach the shared list/detail/activity pages, and per the motivating
// defect it's exactly the render most likely to differ from what an
// admin-logged-in sweep would show (a "READ-ONLY · VIEWER" pill, hidden
// mutate actions) and therefore the render most likely to have gone unchecked.
const VIEWER_STATIC_ROUTES = [
  "/inventory", "/inventory/activity",
  "/employees", "/employees?gaps=1", "/employees/activity",
  "/approvals", "/audit", "/offboarding", "/reservations",
  "/admin/equipment-policies",
  "/purchases", "/purchases/activity",
];

test.describe("axe sweep", () => {
  // One test per role, sweeping that role's routes, so a failure names the role.
  test("admin-only routes, plus the Home admin branch (needs an explicit workspace cookie)", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, "admin@thebackroomop.com");
    for (const path of ADMIN_ROUTES) await scanRoute(page, path);

    // Home's admin branch (AdminHomeBody) is NOT what an admin sees by
    // default: resolveWorkspace's fallback is allowed[0], which for admin is
    // "it" (ROLE_WORKSPACES.admin = ["it","purchasing","finance","admin"]) —
    // admin is the only role whose default landing on "/" is NOT its own
    // dedicated home branch. Reaching AdminHomeBody at all requires the
    // br.dept=admin cookie that switchWorkspace() sets; without this, "/"
    // renders the same IT/viewer branch already covered by the viewer sweep
    // below, and the admin-only branch (users/flags/webhooks counts, "Who
    // can get in") is never exercised by any spec in this suite.
    // `path` MUST be explicit: addCookies({ url }) alone derives the cookie's
    // path from that URL's directory (here /admin/webhooks/, the last route
    // visited above) rather than "/" — the cookie then never reaches "/" at
    // all, resolveWorkspace silently falls back to admin's default ("it"),
    // and this scan would axe the already-covered IT/viewer branch while
    // believing it tested the admin one. Caught by asserting the branch
    // marker text below, not by the URL check, which still says "/" either way.
    await page.context().addCookies([
      { name: "br.dept", value: "admin", domain: "localhost", path: "/" },
    ]);
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByText("Who can get in")).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(700);
    const results = await new AxeBuilder({ page }).analyze();
    for (const v of results.violations) {
      if (v.impact === "serious" || v.impact === "critical") continue;
      moderates.set(v.id, (moderates.get(v.id) ?? 0) + v.nodes.length);
    }
    const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}`), "axe on / (admin branch)").toEqual([]);
  });

  test("it_staff-reachable routes, static and dynamic", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, "it@thebackroomop.com");
    for (const path of IT_STAFF_ROUTES) await scanRoute(page, path);

    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    const employee = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    for (const path of [
      `/inventory/${asset.id}/edit`,
      `/inventory/labels?ids=${asset.id}`,
      `/employees/${employee.id}/edit`,
    ]) await scanRoute(page, path);
  });

  test("purchasing_staff-reachable routes", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "purchasing@thebackroomop.com");
    await scanRoute(page, "/"); // Home's purchasing branch — this role's own default landing
    for (const path of PURCHASING_STAFF_ROUTES) await scanRoute(page, path);

    // PR-0201 is the seed's one DRAFT purchase request, requested by this
    // very user (prisma/seed.ts: `requestedById: purchasing.id`) — the edit
    // route additionally requires `state === "DRAFT"` and
    // `requestedById === user.id || role === "admin"`, so this is the one
    // seeded record purchasing_staff (not just admin) can actually reach.
    const draftPr = await db.purchaseRequest.findUniqueOrThrow({ where: { refNo: "PR-0201" } });
    await scanRoute(page, `/purchases/${draftPr.id}/edit`);
  });

  test("finance_staff-reachable routes", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "finance@thebackroomop.com");
    await scanRoute(page, "/"); // Home's finance branch — this role's own default landing
    for (const path of FINANCE_STAFF_ROUTES) await scanRoute(page, path);
  });

  // The one public, unauthenticated page nothing had ever scanned. /login has
  // been axe-checked since Phase 2 (e2e/auth-shell.spec.ts) and its sibling
  // never was — the coverage gap this whole sweep exists to close, sitting on
  // the least-privileged surface in the app. /bootstrap is deliberately NOT
  // here: it 404s once any user exists (asserted in auth-shell.spec.ts), so it
  // is unreachable in any seeded state and there is nothing to scan.
  test("the public signup page, which no spec had ever scanned", async ({ page }) => {
    await page.goto("/logout");
    await scanRoute(page, "/signup");
  });

  test("viewer-reachable routes — the largest group, and the one most likely to have gone unchecked", async ({ page }) => {
    test.setTimeout(900_000);
    await login(page, "viewer@thebackroomop.com");
    await scanRoute(page, "/");
    for (const path of VIEWER_STATIC_ROUTES) await scanRoute(page, path);

    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    const employee = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0090" } });
    const approval = await db.approval.findFirstOrThrow({ orderBy: { refNo: "asc" } });
    const pr = await db.purchaseRequest.findFirstOrThrow({ orderBy: { refNo: "asc" } });

    for (const path of [
      `/inventory/${asset.id}`, `/inventory/${asset.id}/history`, `/inventory/${asset.id}/timeline`,
      `/inventory/${asset.id}/documents`, `/inventory/${asset.id}/secrets`, `/inventory/${asset.id}/reservations`,
      `/employees/${employee.id}`, `/employees/${employee.id}/form`, `/employees/${employee.id}/timeline`,
      `/offboarding/${employee.id}`, `/offboarding/${employee.id}?step=collect`,
      `/offboarding/${employee.id}/report`,
      `/approvals/${approval.id}`, `/purchases/${pr.id}`,
    ]) await scanRoute(page, path);
  });
});
