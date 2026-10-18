// Phase 43 (spec §1, §4): who the 15 virtual people are and what each role clicks, as weighted page GETs.
//
// A step is one of:
//   { w, path, dept? }                       — a fixed URL; `{inventoryTerm}` / `{employeeTerm}` take a search term;
//   { w, record, from, suffix?, dept? }      — a record page: an id (or link) found on the role's own list pages.
// `w` is the step's weight within its role. `dept` overrides the user's `br.dept` workspace cookie for that step
// (the admin switches between the Admin and IT workspaces). Record ids are never written here: every HTML page a
// person fetches is scanned for record links (extractIds), and a record step whose pool is still empty fetches its
// `from` list first — which is also what a person does.

const EMAIL_DOMAIN = "thebackroomop.com";

const ROLE_DEPT = { it_staff: "it", purchasing_staff: "purchasing", finance_staff: "finance", admin: "it" };

/** perf01–10 IT, perf11–12 Purchasing, perf13–14 Finance, perf15 admin — the scale seed's accounts (spec §3). */
export const USERS = Array.from({ length: 15 }, (_, i) => {
  const n = i + 1;
  const role = n <= 10 ? "it_staff" : n <= 12 ? "purchasing_staff" : n <= 14 ? "finance_staff" : "admin";
  const name = `perf${String(n).padStart(2, "0")}`;
  return { name, email: `${name}@${EMAIL_DOMAIN}`, role, dept: ROLE_DEPT[role] };
});

/**
 * Search terms people type. None is an exact asset tag: an exact tag on /inventory?q= redirects to the record (the
 * scanner contract), which the harness would count as an error. `BR-LT-11` is a tag prefix and lists several.
 */
export const TERMS = {
  inventoryTerm: ["ThinkPad", "Latitude", "Jabra", "OptiPlex", "MacBook", "Logitech", "Dell P27", "BR-LT-11", "BR-HS-12"],
  employeeTerm: ["Santos", "Reyes", "Dela Cruz", "Garcia", "Mendoza", "Villanueva", "EMP-12", "EMP-14"],
};

/** Where each record kind lives; `:id` is filled from the pool. `depDrill` pools whole links, not ids. */
export const RECORD_PATH = {
  inventory: "/inventory/:id",
  employees: "/employees/:id",
  purchases: "/purchases/:id",
  suppliers: "/purchases/suppliers/:id",
  financeAssets: "/finance/assets/:id",
  approvals: "/approvals/:id",
  depDrill: "/finance/depreciation",
};

export const SCENARIOS = {
  // Spec §1: "mostly in Inventory, Employees, the Worklist and Approvals".
  it_staff: [
    { w: 8, path: "/inventory" },
    { w: 6, path: "/inventory?status=SPARE" },
    { w: 3, path: "/inventory?status=DEFECTIVE&sort=defectiveSince" },
    { w: 1, path: "/inventory?status=MISSING" },
    { w: 5, path: "/inventory?q={inventoryTerm}" },
    { w: 2, path: "/inventory?sort=-purchasedAt" },
    { w: 3, path: "/inventory?page=2" },
    { w: 1, path: "/inventory?status=SPARE&page=2" },
    { w: 10, record: "inventory", from: "/inventory" },
    { w: 2, record: "inventory", from: "/inventory?status=SPARE", suffix: "/history" },
    { w: 6, path: "/employees" },
    { w: 3, path: "/employees?gaps=1" },
    { w: 2, path: "/employees?kind=CLIENT" },
    { w: 2, path: "/employees?employment=OFFBOARDING" },
    { w: 3, path: "/employees?q={employeeTerm}" },
    { w: 1, path: "/employees?page=2" },
    { w: 8, record: "employees", from: "/employees" },
    { w: 6, path: "/inventory/work" },
    { w: 5, path: "/approvals" },
    { w: 1, path: "/approvals?tab=closed" },
    { w: 2, record: "approvals", from: "/approvals" },
    { w: 1, path: "/purchases?state=SUBMITTED" },
    { w: 4, path: "/" },
    { w: 2, path: "/offboarding" },
    { w: 1, path: "/offboarding?due=overdue" },
    { w: 2, path: "/reservations" },
    { w: 2, path: "/equipment-by-client" },
    { w: 1, path: "/equipment-by-client?tab=internal" },
    { w: 2, path: "/inventory/activity" },
    { w: 1, path: "/employees/activity" },
    { w: 2, path: "/audit" },
  ],
  purchasing_staff: [
    { w: 4, path: "/" },
    { w: 8, path: "/purchases" },
    { w: 2, path: "/purchases?state=DRAFT" },
    { w: 3, path: "/purchases?state=SUBMITTED" },
    { w: 2, path: "/purchases?state=IT_REVIEWED" },
    { w: 2, path: "/purchases?state=COMPLETED" },
    { w: 8, record: "purchases", from: "/purchases" },
    { w: 4, path: "/purchases/suppliers" },
    { w: 2, record: "suppliers", from: "/purchases/suppliers" },
    { w: 4, path: "/stock" },
    { w: 1, path: "/stock/reports" },
    { w: 3, path: "/inventory?cls=PURCHASING" },
    { w: 2, path: "/approvals" },
    { w: 1, path: "/purchases/activity" },
  ],
  finance_staff: [
    { w: 4, path: "/" },
    { w: 8, path: "/finance/assets" },
    { w: 2, path: "/finance/assets?page=2" },
    { w: 4, record: "financeAssets", from: "/finance/assets" },
    { w: 5, path: "/finance/depreciation" },
    // The schedule's category drill-down (`cat=`), as linked from the schedule table itself.
    { w: 4, record: "depDrill", from: "/finance/depreciation" },
    { w: 1, path: "/finance/depreciation?tab=policies" },
    { w: 3, path: "/approvals" },
    { w: 4, path: "/purchases" },
    { w: 3, path: "/purchases?state=IT_REVIEWED" },
    { w: 3, record: "purchases", from: "/purchases" },
    { w: 2, path: "/equipment-by-client" },
    { w: 1, path: "/finance/activity" },
  ],
  // Spec §4: home, users, approvals, and IT pages under the `br.dept=it` workspace cookie.
  admin: [
    { w: 4, path: "/", dept: "admin" },
    { w: 4, path: "/admin/users", dept: "admin" },
    { w: 2, path: "/", dept: "it" },
    { w: 5, path: "/approvals", dept: "it" },
    { w: 2, record: "approvals", from: "/approvals", dept: "it" },
    { w: 3, path: "/inventory", dept: "it" },
    { w: 2, record: "inventory", from: "/inventory", dept: "it" },
    { w: 2, path: "/employees", dept: "it" },
    { w: 1, path: "/inventory/work", dept: "it" },
    { w: 2, path: "/audit", dept: "it" },
  ],
};

/** The URL patterns a step can produce, for checks: a record step yields its list and its record path. */
export function stepPaths(step) {
  if (step.path) return [step.path];
  return [step.from, RECORD_PATH[step.record] + (step.suffix ?? "")];
}

/** One step by weight; `rand` is a 0 ≤ x < 1 source. */
export function pickWeighted(steps, rand = Math.random) {
  const total = steps.reduce((sum, s) => sum + s.w, 0);
  let roll = rand() * total;
  for (const s of steps) {
    roll -= s.w;
    if (roll < 0) return s;
  }
  return steps[steps.length - 1];
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

/**
 * The URL a step opens now: `{ url }`, or `{ need }` — the list page to fetch first because the record pool for the
 * step is still empty.
 */
export function resolveStep(step, pools, rand = Math.random) {
  if (step.path) {
    const url = step.path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(pick(TERMS[key], rand)));
    return { url };
  }
  const pool = pools[step.record] ?? [];
  if (pool.length === 0) return { need: step.from };
  const found = pick(pool, rand);
  if (step.record === "depDrill") return { url: found };
  return { url: RECORD_PATH[step.record].replace(":id", found) + (step.suffix ?? "") };
}

// cuid-shaped ids: "c" + 24 base-36 characters (the normal seed's cuid() and the scale seed's idFactory).
const ID = "c[a-z0-9]{20,31}";
const ID_ONLY = new RegExp(`^${ID}$`);
const END = `(?=["'/?#&<\\s])`;

const LINKS = {
  inventory: new RegExp(`/inventory/(${ID})${END}`, "g"),
  employees: new RegExp(`/employees/(${ID})${END}`, "g"),
  purchases: new RegExp(`/purchases/(${ID})${END}`, "g"),
  suppliers: new RegExp(`/purchases/suppliers/(${ID})${END}`, "g"),
  financeAssets: new RegExp(`/finance/assets/(${ID})${END}`, "g"),
  approvals: new RegExp(`/approvals/(${ID})${END}`, "g"),
};
const DEP_DRILL = /href="(\/finance\/depreciation\?[^"]*?cat=[^"]+)"/g;

/** Record ids (and depreciation drill-down links) linked from a page's HTML, de-duplicated per kind. */
export function extractIds(html) {
  const out = {};
  for (const [kind, re] of Object.entries(LINKS)) {
    out[kind] = [...new Set([...html.matchAll(re)].map((m) => m[1]))];
  }
  out.depDrill = [...new Set([...html.matchAll(DEP_DRILL)].map((m) => m[1].replaceAll("&amp;", "&")))];
  return out;
}

/** Query params whose values vary per request and would split one route into many rows of the report. */
const FOLD = { q: ":q", cat: ":id", year: ":year" };

/** A URL as a report row: path ids become `:id`, search terms `:q`, years `:year`; filters stay as written. */
export function normaliseRoute(url) {
  const u = new URL(url, "http://placeholder");
  const pathname = u.pathname
    .split("/")
    .map((seg) => (ID_ONLY.test(seg) ? ":id" : seg))
    .join("/");
  const query = [...u.searchParams]
    .map(([k, v]) => `${k}=${FOLD[k] ?? (ID_ONLY.test(v) ? ":id" : v)}`)
    .join("&");
  return query ? `${pathname}?${query}` : pathname;
}
