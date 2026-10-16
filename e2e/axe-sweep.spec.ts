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

// Rules that fail regardless of impact, once their root cause is fixed and
// the tail is verified to be zero — see
// docs/superpowers/specs/2026-09-14-approvals-oversight-design.md §7.
const PROMOTED_RULES = new Set<string>([
  "empty-table-header",
  "page-has-heading-one",
  "heading-order",
  "landmark-unique",
]);

/**
 * Shared by every scan site (scanRoute and the admin-branch "/" scan). A
 * violation fails the test when its impact is serious/critical OR its rule
 * id is in PROMOTED_RULES; everything else is counted into `moderates` (and,
 * with AXE_DETAIL=1, printed one line per node as
 * `${label} · ${rule} · ${impact} · ${target}`) so the tail stays visible
 * without failing the suite on it.
 */
function record(results: Awaited<ReturnType<AxeBuilder["analyze"]>>, label: string) {
  const bad: string[] = [];
  for (const v of results.violations) {
    const failing = v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id);
    if (failing) {
      bad.push(`${v.id} (${v.impact}) x${v.nodes.length}`);
      continue;
    }
    moderates.set(v.id, (moderates.get(v.id) ?? 0) + v.nodes.length);
    if (process.env.AXE_DETAIL === "1") {
      for (const node of v.nodes) {
        console.log(`${label} · ${v.id} · ${v.impact} · ${node.target.join(" ")}`);
      }
    }
  }
  expect(bad, `axe on ${label}`).toEqual([]);
}

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

  await scanHere(page, path);
}

/**
 * The scan half of scanRoute, for a page already in the state to be checked: a wizard step reached by
 * clicking, or a side panel that is open. Settles the pointer first, for the same reason scanRoute does.
 */
async function scanHere(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);

  const results = await new AxeBuilder({ page }).analyze();
  record(results, label);
}

// ── Admin-only: workspace "admin" in PATH_RULES, or requireRole("admin") ──
const ADMIN_ROUTES = ["/admin/users", "/admin/flags", "/admin/webhooks", "/admin/webhooks/deliveries"];

// ── it_staff: PATH_RULES roles:[admin,it_staff], or page-level requireRole ─
// Phase 30 (spec §5.1): /inventory/new is a redirect to /inventory/register now — scanning it would
// scan the Register form twice (and scanRoute's landing check would, rightly, refuse the redirect).
const IT_STAFF_ROUTES = [
  "/inventory/import", "/inventory/register", "/inventory/work",
  "/admin/asset-categories", "/admin/asset-types", "/admin/departments", "/admin/departments?tab=internal",
  "/employees/import", "/employees/new",
  // Phase 37 (spec §7.2): the per-client policies tab. /employees/new is scanned again below at steps 2 and 3.
  "/admin/equipment-policies?tab=client",
  // Phase 38 (spec §4.2): Equipment by client, both tabs, without money columns. The panel-open scan is below.
  "/equipment-by-client", "/equipment-by-client?tab=internal",
];

// ── purchasing_staff: requireRole(...DRAFT_ROLES) = [purchasing_staff, admin] ─
const PURCHASING_STAFF_ROUTES = [
  "/purchases/new", "/approvals", "/employees",
  "/admin/asset-categories", "/admin/asset-types", "/inventory?cls=PURCHASING",
];

// ── finance_staff: PATH_RULES workspace "finance" only ─────────────────────
// Phase 38 (spec §4.2): Equipment by client with the Book value and Per person columns and the money stat.
const FINANCE_STAFF_ROUTES = [
  "/finance/assets", "/finance/activity", "/finance/assets?cls=PURCHASING",
  "/equipment-by-client", "/equipment-by-client?tab=internal",
];

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
  "/admin/equipment-policies", "/admin/equipment-policies?tab=client",
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
    record(results, "/ (admin branch)");
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

    // Phase 37 (spec §4.4, §7.2): EMP-0042's profile with the held-item side panel open on their laptop. The
    // panel loads its data after it mounts, so wait for the history heading — a scan of the skeleton proves
    // nothing. The laptop's id is read off its tag, never hardcoded.
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await page.goto(`/employees/${marites.id}?item=${laptop.id}`);
    const panel = page.getByRole("dialog", { name: `BR-LT-0148 · ${laptop.model}` });
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByRole("heading", { name: "Recent history" })).toBeVisible({ timeout: 15_000 });
    await scanHere(page, "/employees/[EMP-0042]?item=[BR-LT-0148] (panel open)");

    // Phase 38 (spec §4.2): Equipment by client with Bluepeak Telecom's detail panel open. The id is read off the
    // name; the panel is on screen once its heading is.
    const bluepeak = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    await page.goto(`/equipment-by-client?tab=client&group=${bluepeak.id}`);
    await expect(page.getByRole("heading", { name: "Bluepeak Telecom", level: 2 })).toBeVisible({ timeout: 20_000 });
    await scanHere(page, "/equipment-by-client?group=[Bluepeak Telecom] (panel open)");
  });

  // Phase 37 (spec §5, §7.2): Add employee, scanned on each of its three steps with valid input and nothing
  // created. Step 1 is also in IT_STAFF_ROUTES; here it is scanned with Client staff chosen, so the Client
  // select and the policy panel are on screen.
  test("Add employee, on step 1 (Client staff chosen), step 2 and step 3", async ({ page }) => {
    test.setTimeout(180_000);
    await login(page, "it@thebackroomop.com");
    await page.goto("/employees/new");
    expect(new URL(page.url()).pathname).toBe("/employees/new");

    const worksFor = page.getByRole("radiogroup", { name: "Works for" });
    await expect(worksFor).toBeVisible({ timeout: 30_000 });
    await worksFor.getByText("Client staff", { exact: true }).click();
    await page.getByRole("combobox", { name: "Client", exact: true }).selectOption({ label: "Bluepeak Telecom" });
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Axe Sweep");
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Agent");
    await expect(page.getByLabel("Employee no.")).not.toHaveValue("");
    await scanHere(page, "/employees/new (step 1)");

    const next = page.getByRole("button", { name: "Next", exact: true });
    await next.click();
    // Step 2: the policy's four lines are on screen once Monitor is.
    await expect(page.getByLabel("Monitor", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Monitor 2", { exact: true })).toBeVisible();
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await scanHere(page, "/employees/new (step 2)");

    await next.click();
    // Step 3: the summary and the button that would create the person (which this test never presses).
    await expect(page.getByRole("button", { name: "Create employee" })).toBeVisible({ timeout: 15_000 });
    await scanHere(page, "/employees/new (step 3)");
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

    // Phase 38 (spec §4.2): the same page with a panel open, where the per-category values show.
    const bluepeak = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    await page.goto(`/equipment-by-client?tab=client&group=${bluepeak.id}`);
    await expect(page.getByRole("heading", { name: "Bluepeak Telecom", level: 2 })).toBeVisible({ timeout: 20_000 });
    await scanHere(page, "/equipment-by-client?group=[Bluepeak Telecom] (panel open, money)");
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
      // The scan card, keyed by TAG rather than id — that is the whole point of
      // the route, since a cuid printed onto a sticker dies at the next reseed.
      // BOTH branches are scanned: the found card renders a <dl>, a StatusPill
      // and a header, while the miss renders a Banner instead, and a sweep that
      // only ever sees the happy path has not seen the page.
      `/inventory/scan/${asset.tag}`,
      `/inventory/scan/BR-XX-9999`,
    ]) await scanRoute(page, path);
  });

  // Phase 39 (spec §7.2 case 11): the new surfaces. Each scan waits for the content it is about — a panel loads
  // its rows after it mounts, and a scan of the skeleton proves nothing.
  test("Phase 39 — the profile's four side tabs, the notes panel and the purchase conversation panel", async ({ page }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const tag = String(stamp).slice(-6);
    await login(page, "it@thebackroomop.com");

    // EMP-0042's profile on each side tab (the remembered tab is per browser, so the URL decides each time).
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });
    const tablist = page.getByRole("tablist", { name: "About this person" });
    const ready: Record<string, () => Promise<void>> = {
      notes: async () => { await expect(page.locator('[role="tabpanel"]:not([hidden])')).toBeVisible({ timeout: 20_000 }); },
      setup: async () => { await expect(page.getByRole("combobox", { name: "Argus", exact: true })).toBeVisible({ timeout: 20_000 }); },
      form: async () => { await expect(page.getByRole("button", { name: "Print form", exact: true })).toBeVisible({ timeout: 20_000 }); },
      transfers: async () => { await expect(page.locator('[role="tabpanel"]:not([hidden])')).toBeVisible({ timeout: 20_000 }); },
    };
    for (const side of ["notes", "setup", "form", "transfers"] as const) {
      await page.goto(`/employees/${marites.id}?side=${side}`);
      await expect(tablist).toBeVisible({ timeout: 20_000 });
      await expect(tablist.getByRole("tab", { selected: true })).toHaveCount(1);
      await ready[side]();
      await scanHere(page, `/employees/[EMP-0042]?side=${side}`);
    }

    // A person with 5 notes (over the card's 3), with the Notes panel open on them.
    const it = await db.user.findUniqueOrThrow({ where: { email: "it@thebackroomop.com" } });
    const purchasing = await db.user.findUniqueOrThrow({ where: { email: "purchasing@thebackroomop.com" } });
    const dept = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const DAY = 86_400_000;
    const personName = `Axe Notes ${stamp}`;
    const person = await db.employee.create({
      data: {
        employeeNo: `EMP-${tag}${Math.floor(Math.random() * 10)}`, name: personName, title: "Agent",
        departmentId: dept.id, joinedAt: new Date(),
      },
    });
    try {
      await db.employeeNote.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          employeeId: person.id, authorId: it.id, text: `Axe note ${i} ${tag}`, createdAt: new Date(stamp - i * DAY),
        })),
      });
      await page.goto(`/employees/${person.id}?notes=1`);
      const notesPanel = page.getByRole("dialog", { name: `Notes — ${personName}`, exact: true });
      await expect(notesPanel).toBeVisible({ timeout: 20_000 });
      await expect(notesPanel.getByRole("listitem")).toHaveCount(5, { timeout: 15_000 });
      await scanHere(page, "/employees/[person with 5 notes]?notes=1 (panel open)");
    } finally {
      await db.employeeNote.deleteMany({ where: { employeeId: person.id } });
      await db.employee.deleteMany({ where: { id: person.id } });
    }

    // A purchase request with 8 messages (over the page's 5), with the Conversation panel open. NoteEntry is
    // append-only and Restrict-linked, so the request stays behind; the next reseed truncates it.
    const request = await db.purchaseRequest.create({
      data: { refNo: `PR-7${tag}`, state: "DRAFT", requestedById: purchasing.id, departmentId: dept.id },
    });
    await db.noteEntry.createMany({
      data: Array.from({ length: 8 }, (_, i) => ({
        requestId: request.id, authorId: i % 2 === 0 ? purchasing.id : it.id, kind: "COMMENT" as const,
        text: `Axe message ${i} ${tag}`, createdAt: new Date(stamp - (8 - i) * 3_600_000),
      })),
    });
    await page.goto(`/purchases/${request.id}?thread=1`);
    const thread = page.getByRole("dialog", { name: `Conversation — ${request.refNo}`, exact: true });
    await expect(thread).toBeVisible({ timeout: 20_000 });
    await expect(thread.getByRole("listitem")).toHaveCount(8, { timeout: 15_000 });
    await scanHere(page, "/purchases/[request with 8 messages]?thread=1 (panel open)");
  });

  test("Phase 39 — the stocktake sheet (count and review) and the On hand and Expiry reports", async ({ page }) => {
    test.setTimeout(240_000);
    const stamp = Date.now();
    const purchasing = await db.user.findUniqueOrThrow({ where: { email: "purchasing@thebackroomop.com" } });
    // An open stocktake over one seeded category, one line counted so the review has a difference to show.
    const category = await db.stockCategory.findFirstOrThrow({
      where: { items: { some: { archivedAt: null } } }, orderBy: { prefix: "asc" },
    });
    const items = await db.stockItem.findMany({ where: { categoryId: category.id, archivedAt: null }, orderBy: { code: "asc" } });
    const st = await db.stocktake.create({
      data: {
        refNo: `ST-AXE${String(stamp).slice(-6)}`, categoryId: category.id, state: "OPEN",
        openedAt: new Date(stamp), dueAt: new Date(stamp + 3 * 86_400_000), openedById: purchasing.id,
        lines: {
          create: items.map((item, i) => ({
            itemId: item.id, bookQty: 0,
            ...(i === 0 ? { countedQty: 1, countedAt: new Date(stamp), countedById: purchasing.id } : {}),
          })),
        },
      },
    });
    try {
      await login(page, "purchasing@thebackroomop.com");

      // The count sheet: on screen once its first count box is.
      await page.goto(`/stock/stocktakes/${st.id}`);
      expect(new URL(page.url()).pathname).toBe(`/stock/stocktakes/${st.id}`);
      await expect(page.getByRole("spinbutton", { name: /^Counted / }).first()).toBeVisible({ timeout: 30_000 });
      await scanHere(page, "/stock/stocktakes/[open] (count sheet)");

      // The review sheet, with its totals line and its table.
      await page.goto(`/stock/stocktakes/${st.id}?view=review`);
      await expect(page.getByText(/items counted/)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("table")).toBeVisible();
      await scanHere(page, "/stock/stocktakes/[open]?view=review (review sheet)");

      // On hand: the totals card and the table.
      await page.goto("/stock/reports/on-hand");
      expect(new URL(page.url()).pathname).toBe("/stock/reports/on-hand");
      await expect(page.getByRole("region", { name: "Totals", exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("searchbox", { name: "Search the report", exact: true })).toBeVisible();
      await scanHere(page, "/stock/reports/on-hand");

      // Expiry, on each tab: the tab row and the search box are there on either, and so is the table or its empty text.
      for (const tab of ["expired", "expiring"] as const) {
        const path = tab === "expired" ? "/stock/reports/expiry" : "/stock/reports/expiry?tab=expiring";
        await page.goto(path);
        expect(new URL(page.url()).pathname).toBe("/stock/reports/expiry");
        const tabs = page.getByRole("navigation", { name: "Expiry status" });
        await expect(tabs).toBeVisible({ timeout: 30_000 });
        await expect(tabs.getByRole("link", { name: tab === "expired" ? /^Expired \(\d+\)$/ : /^Expiring \(\d+\)$/ }))
          .toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("searchbox", { name: "Search the lots", exact: true })).toBeVisible();
        await expect(page.getByRole("table").or(page.getByText(/^Nothing (has expired|expires within)/)).first())
          .toBeVisible({ timeout: 15_000 });
        await scanHere(page, path);
      }
    } finally {
      await db.stocktake.deleteMany({ where: { id: st.id } });
    }
  });
});
