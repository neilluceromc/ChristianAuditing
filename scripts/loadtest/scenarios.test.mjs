import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathAllowedForRole } from "@/lib/workspaces";
import {
  SCENARIOS, TERMS, USERS, extractIds, normaliseRoute, pickWeighted, resolveStep, routeLabel, stepPaths,
} from "./scenarios.mjs";

const ID = "c" + "k3x9q2m7p1z8v4b6n0w5r2t8y"; // cuid-shaped: "c" + 24 base-36 characters
const ID2 = "c" + "m1a2b3c4d5e6f7g8h9i0j1k2l";

describe("USERS (spec §1: 10 IT, 2 Purchasing, 2 Finance, 1 admin)", () => {
  it("are perf01–perf15 with the seed's role mix and workspace cookie, and carry no password", () => {
    expect(USERS.map((u) => u.email)).toEqual(
      Array.from({ length: 15 }, (_, i) => `perf${String(i + 1).padStart(2, "0")}@thebackroomop.com`),
    );
    const roles = USERS.map((u) => u.role);
    expect(roles.slice(0, 10).every((r) => r === "it_staff")).toBe(true);
    expect(roles.slice(10, 12)).toEqual(["purchasing_staff", "purchasing_staff"]);
    expect(roles.slice(12, 14)).toEqual(["finance_staff", "finance_staff"]);
    expect(roles[14]).toBe("admin");
    expect(USERS.map((u) => u.dept)).toEqual([...Array(10).fill("it"), "purchasing", "purchasing", "finance", "finance", "it"]);
    for (const u of USERS) expect(Object.keys(u).sort()).toEqual(["dept", "email", "name", "role"]);
  });
});

describe("normaliseRoute", () => {
  it("replaces record ids in the path", () => {
    expect(normaliseRoute(`/inventory/${ID}`)).toBe("/inventory/:id");
    expect(normaliseRoute(`/inventory/${ID}/history`)).toBe("/inventory/:id/history");
    expect(normaliseRoute(`http://192.168.1.193:3000/employees/${ID}`)).toBe("/employees/:id");
  });

  it("keeps fixed paths and filter values, and folds search terms, years and category ids", () => {
    expect(normaliseRoute("/inventory/activity")).toBe("/inventory/activity");
    expect(normaliseRoute("/inventory?status=DEFECTIVE&sort=defectiveSince")).toBe("/inventory?status=DEFECTIVE&sort=defectiveSince");
    expect(normaliseRoute("/inventory?q=ThinkPad")).toBe("/inventory?q=:q");
    expect(normaliseRoute("/employees?q=Dela%20Cruz")).toBe("/employees?q=:q");
    expect(normaliseRoute(`/finance/depreciation?tab=schedule&year=2026&cls=IT&cat=${ID}`))
      .toBe("/finance/depreciation?tab=schedule&year=:year&cls=IT&cat=:id");
    expect(normaliseRoute("/")).toBe("/");
  });
});

describe("routeLabel (fix round 1: one report row per workspace where the page differs)", () => {
  it("keys the admin workspace's pages apart from the same paths in IT", () => {
    expect(routeLabel("/", "admin")).toBe("/ [admin]");
    expect(routeLabel("/admin/users", "admin")).toBe("/admin/users [admin]");
    expect(routeLabel("/", "it")).toBe("/");
    expect(routeLabel(`/inventory/${ID}`, "it")).toBe("/inventory/:id");
  });

  it("keys each workspace's Home apart (its content is the workspace's own); other shared pages stay one row", () => {
    expect(routeLabel("/", "purchasing")).toBe("/ [purchasing]");
    expect(routeLabel("/", "finance")).toBe("/ [finance]");
    expect(routeLabel("/purchases?state=IT_REVIEWED", "finance")).toBe("/purchases?state=IT_REVIEWED");
    expect(routeLabel("/approvals", "purchasing")).toBe("/approvals");
  });
});

describe("extractIds", () => {
  const html = `
    <a href="/inventory/${ID}">BR-LT-1001</a>
    <a href="/inventory/${ID2}/history">history</a>
    <a href="/inventory/activity">Inventory activity</a>
    <a href="/inventory/work">Worklist</a>
    <a href="/employees/${ID}">Ana</a>
    <a href="/employees/${ID2}/timeline">timeline</a>
    <a href="/purchases/${ID}">PR-1001</a>
    <a href="/purchases/suppliers/${ID2}">Supplier</a>
    <a href="/finance/assets/${ID}">BR-LT-1001</a>
    <a href="/approvals/${ID2}">APR-5001</a>
    <a href="/finance/depreciation?tab=schedule&amp;year=2026&amp;cls=IT&amp;cat=${ID}">Laptop</a>`;

  it("finds each record kind's ids and never a fixed sub-page", () => {
    const ids = extractIds(html);
    expect(ids.inventory.sort()).toEqual([ID, ID2].sort());
    expect(ids.employees.sort()).toEqual([ID, ID2].sort());
    expect(ids.purchases).toEqual([ID]);
    expect(ids.suppliers).toEqual([ID2]);
    expect(ids.financeAssets).toEqual([ID]);
    expect(ids.approvals).toEqual([ID2]);
  });

  it("keeps the depreciation drill-down's whole link, unescaped", () => {
    expect(extractIds(html).depDrill).toEqual([`/finance/depreciation?tab=schedule&year=2026&cls=IT&cat=${ID}`]);
  });

  it("finds nothing in a page without records", () => {
    const ids = extractIds("<main>No assets match</main>");
    expect(Object.values(ids).every((list) => list.length === 0)).toBe(true);
  });
});

describe("pickWeighted", () => {
  const steps = [{ w: 1, path: "/a" }, { w: 3, path: "/b" }];
  it("walks the cumulative weights", () => {
    expect(pickWeighted(steps, () => 0).path).toBe("/a");
    expect(pickWeighted(steps, () => 0.24).path).toBe("/a");
    expect(pickWeighted(steps, () => 0.26).path).toBe("/b");
    expect(pickWeighted(steps, () => 0.999).path).toBe("/b");
  });
});

describe("resolveStep", () => {
  const rand = () => 0;
  it("fills a search term from TERMS", () => {
    const out = resolveStep({ w: 1, path: "/inventory?q={inventoryTerm}" }, {}, rand);
    expect(out).toEqual({ url: `/inventory?q=${encodeURIComponent(TERMS.inventoryTerm[0])}` });
  });

  it("asks for the list page first when the record pool is empty, then opens a record from it", () => {
    const step = { w: 1, record: "inventory", from: "/inventory?status=SPARE", suffix: "/history" };
    expect(resolveStep(step, {}, rand)).toEqual({ need: "/inventory?status=SPARE" });
    expect(resolveStep(step, { inventory: [ID] }, rand)).toEqual({ url: `/inventory/${ID}/history` });
  });

  it("opens a drill-down link as it was found", () => {
    const href = `/finance/depreciation?tab=schedule&year=2026&cls=IT&cat=${ID}`;
    expect(resolveStep({ w: 1, record: "depDrill", from: "/finance/depreciation" }, { depDrill: [href] }, rand)).toEqual({ url: href });
  });
});

// ---- Every scenario URL is a real page the role may open (no redirect, no 404) ----

const APP = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../src/app/(app)");

/** The page.tsx for these path segments, or null. Route groups `(x)` are transparent; `:id` matches a `[param]` dir. */
function pageFile(dir, segs) {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  if (segs.length === 0 && existsSync(path.join(dir, "page.tsx"))) return path.join(dir, "page.tsx");
  for (const group of entries.filter((n) => /^\(.+\)$/.test(n))) {
    const found = pageFile(path.join(dir, group), segs);
    if (found) return found;
  }
  if (segs.length === 0) return null;
  const [head, ...rest] = segs;
  if (head === ":id") {
    for (const n of entries.filter((e) => /^\[[^.\]]+\]$/.test(e))) {
      const found = pageFile(path.join(dir, n), rest);
      if (found) return found;
    }
    return null;
  }
  return entries.includes(head) ? pageFile(path.join(dir, head), rest) : null;
}

/**
 * A page that renders returns markup; a bare redirect page (`/stock/reports` → on-hand) never returns at all, and with
 * `redirect: "manual"` every hit on it would be recorded as an error (fix round 1).
 */
const rendersMarkup = (file) => /\breturn\b/.test(readFileSync(file, "utf8"));

describe("SCENARIOS", () => {
  it("the page checks below are not vacuous", () => {
    expect(pageFile(APP, ["inventory", ":id", "history"])).not.toBeNull();
    expect(pageFile(APP, [])).not.toBeNull();
    expect(pageFile(APP, ["inventory", "nope"])).toBeNull();
    expect(pageFile(APP, ["finance", "depreciation", ":id"])).toBeNull();
    expect(pathAllowedForRole("/admin/users", "it_staff")).toBe(false);
    expect(rendersMarkup(pageFile(APP, ["stock", "reports"]))).toBe(false);
    expect(rendersMarkup(pageFile(APP, ["stock", "reports", "on-hand"]))).toBe(true);
  });

  it("has a scenario for every role in USERS", () => {
    for (const u of USERS) expect(SCENARIOS[u.role]?.length).toBeGreaterThan(0);
  });

  for (const [role, steps] of Object.entries(SCENARIOS)) {
    it(`${role}: every step is a real page the role may open`, () => {
      for (const step of steps) {
        for (const p of stepPaths(step)) {
          const pathname = p.split("?")[0];
          expect(pathAllowedForRole(pathname.replace(":id", ID), role), `${role} may open ${p}`).toBe(true);
          const file = pageFile(APP, pathname.split("/").filter(Boolean));
          expect(file, `page for ${p}`).not.toBeNull();
          expect(rendersMarkup(file), `${p} renders a page, not a bare redirect`).toBe(true);
        }
      }
    });
  }

  it("IT covers the spec §1 mix: lists with filters, search, sort, page 2, records, worklist, approvals, activity", () => {
    const paths = SCENARIOS.it_staff.flatMap(stepPaths);
    for (const want of [
      "/inventory?status=SPARE", "/inventory?status=DEFECTIVE&sort=defectiveSince", "/inventory?q={inventoryTerm}",
      "/inventory?sort=-purchasedAt", "/inventory?page=2", "/inventory/:id", "/employees?gaps=1", "/employees/:id",
      "/inventory/work", "/approvals", "/", "/offboarding", "/reservations", "/equipment-by-client",
      "/inventory/activity", "/employees/activity", "/audit",
    ]) expect(paths).toContain(want);
  });

  it("Finance drills into a depreciation category; Purchasing opens a request; admin works in two workspaces", () => {
    expect(SCENARIOS.finance_staff.some((s) => s.record === "depDrill")).toBe(true);
    expect(SCENARIOS.purchasing_staff.some((s) => s.record === "purchases")).toBe(true);
    const depts = new Set(SCENARIOS.admin.map((s) => s.dept));
    expect(depts).toEqual(new Set(["admin", "it"]));
    expect(SCENARIOS.admin.flatMap(stepPaths)).toContain("/admin/users");
  });

  it("never hard-codes a record id", () => {
    const all = JSON.stringify(SCENARIOS);
    expect(all).not.toMatch(/c[a-z0-9]{24}/);
  });
});
