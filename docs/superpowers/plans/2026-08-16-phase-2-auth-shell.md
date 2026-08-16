# Inventory v2 — Phase 2: Auth + Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working sign-in (credentials now, Entra-ready), first-run bootstrap, real role/workspace gating in middleware, and the full app shell — four workspace sidebars with a live approvals badge, workspace switcher, topbar, mobile drawer, and the ⌘K command palette — all riding on Phase 1's primitives.

**Architecture:** Auth.js v5 with JWT sessions; an edge-safe config split so middleware never imports Prisma. Enforcement is layered: middleware redirects (no DB), `requireUser`/`requireRole` guards re-check `disabled` against the DB, and the UI simply never renders what a role can't do. All pure decision logic (role→workspace maps, path gating, nav-active matching) lives in `src/lib/workspaces.ts`, built test-first. Cookies are the UI-state contract: `br.theme`/`br.density` are now read server-side in the root layout; `br.dept` drives which sidebar renders.

**Tech Stack:** next-auth@beta (v5) · bcryptjs (already a dep) · Phase 1 primitives (Drawer/Menu/Dialog/overlay stack, Table, form controls) · Playwright + axe.

**Conventions for every task:** work on branch `phase-2-auth-shell` (Task 1 creates it); run `npx tsc --noEmit` and `npm run lint` before each commit; NEVER run `npm run build` while a dev server is running (shared `.next`); do NOT run `prisma migrate reset` (blocked; not needed — no schema changes this phase). The Postgres container `inventory-db-1` must be up (`docker compose up -d db`) and seeded (`npm run db:seed` — credentials below).

**Seeded accounts (password `ChangeMe123!` for all):** admin@thebackroomop.com (admin, permanent) · it@thebackroomop.com (it_staff) · purchasing@thebackroomop.com (purchasing_staff) · finance@thebackroomop.com (finance_staff) · viewer@thebackroomop.com (viewer). Seeded approvals: 2 PENDING + 1 CLAIMED, one PENDING past SLA → the badge shows **3, urgent**.

**Recorded scope decisions:**
1. **Rate limiting is deferred to Phase 3.** `RateEvent.userId` is a required FK, so pre-auth surfaces (login/signup) can't use it; the 60/min cap belongs to Phase 3's authenticated mutations. Internal tool, loopback DB — acceptable.
2. **Signup creates `viewer` accounts** (least privilege); admins promote via `/admin/users` in Phase 8.
3. **Entra ID**: the provider registers only when `AUTH_MICROSOFT_ENTRA_ID_ID` env exists; the login page shows the Microsoft button only when the `m365_sso` DB flag is enabled. Both are off today — flag-ready per the spec.
4. **`disabled` users**: middleware can't reach the DB, so a disabled user's JWT survives until it hits a `requireUser` guard (every page/action) — that's the enforcement point, plus `authorize` blocks new logins.
5. **G-then-P chord shortcuts** for the palette are deferred to the phase that ships the screens they'd jump to; ⌘K + arrows + Enter ship now.
6. **`EmploymentStatus` status-map entries** are deferred to Phase 3 (first employee list) per the Phase 1 handoff notes.
7. **Nav routes that don't exist yet** render through a `(app)/[...pending]` catch-all showing a designed "arrives in Phase N" empty state — the whole sidebar is clickable from day one, and real routes automatically take precedence as later phases land them.

---

## File structure created/modified in this phase

```
src/middleware.ts                              (create — edge gating; MUST be in src/ for a src/-dir project)
src/server/auth/
  config.edge.ts                               (create — edge-safe NextAuth config, no Prisma)
  index.ts                                     (create — full NextAuth: Credentials + optional Entra)
  types.d.ts                                   (create — Session/JWT augmentation with id+role)
  guards.ts                                    (create — requireUser / requireRole, DB-backed)
  actions.ts                                   (create — signIn/signOut/signup/bootstrap/switchWorkspace server actions)
src/app/api/auth/[...nextauth]/route.ts        (create)
src/lib/
  auth-shared.ts (+ .test.ts)                  (create — normalizeEmail, isAllowedDomain; pure, TDD)
  workspaces.ts (+ .test.ts)                   (create — role/workspace maps, nav config, path gating, nav-active; pure, TDD)
src/app/layout.tsx                             (modify — cookie-driven data-theme/data-density)
src/app/page.tsx                               (delete — moves into (app)/page.tsx)
src/app/not-found.tsx                          (create — designed 404)
src/app/(auth)/layout.tsx                      (create — centered canvas, no shell)
src/app/(auth)/login/page.tsx (+ login-form.tsx)      (create)
src/app/(auth)/signup/page.tsx (+ signup-form.tsx)    (create)
src/app/(auth)/bootstrap/page.tsx (+ bootstrap-form.tsx) (create — dark-scoped, 404 when users exist)
src/app/(app)/layout.tsx                       (create — shell: skip link, Sidebar, Topbar, main)
src/app/(app)/page.tsx                         (create — minimal role-aware Home placeholder; Phase 6 replaces)
src/app/(app)/[...pending]/page.tsx            (create — "arrives in Phase N" catch-all)
src/components/ui/page-header.tsx              (create — deferred Phase 1 primitive)
src/components/ui/drawer.tsx                   (modify — side: "left" | "right" prop for the mobile nav)
src/app/globals.css                            (modify — add sheetLeft keyframe)
src/components/shell/
  sidebar.tsx                                  (create — server: nav data, badge counts, footer)
  nav-list.tsx                                 (create — client: active states via navIsActive)
  workspace-switcher.tsx                       (create — client: popover or static label)
  account-menu.tsx                             (create — client: sign out)
  topbar.tsx                                   (create — client: search trigger, toggles, hamburger)
  mobile-nav.tsx                               (create — client: left Drawer with nav)
  command-palette.tsx                          (create — client: ⌘K, groups, keyboard)
e2e/auth-shell.spec.ts                         (create)
```

Responsibilities: `workspaces.ts` is the ONLY place role→workspace→path→nav truth lives — middleware, guards, sidebar, and palette all consume it. `actions.ts` is the only mutation surface this phase; every mutation writes an AuditEntry.

---

### Task 1: Auth.js v5 core — deps, config split, route handler, types

**Files:**
- Create: `src/server/auth/config.edge.ts`, `src/server/auth/index.ts`, `src/server/auth/types.d.ts`, `src/app/api/auth/[...nextauth]/route.ts`
- Modify: `.env` (real AUTH_SECRET — NOT committed), `package.json` (next-auth)

- [ ] **Step 1: Create the branch**

```bash
git checkout -b phase-2-auth-shell
```

- [ ] **Step 2: Install next-auth v5**

```bash
npm install next-auth@beta
```

- [ ] **Step 3: Generate a real AUTH_SECRET into `.env`** (replace the placeholder line; `.env` stays uncommitted)

```bash
SECRET=$(openssl rand -base64 32)
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$SECRET|" .env
grep -c "^AUTH_SECRET=" .env   # expect 1
```

- [ ] **Step 4: Write `src/server/auth/types.d.ts`**

```ts
import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
  interface User {
    role: Role;
  }
}

// NOTE (applied deviation): with next-auth 5.0.0-beta.32, "next-auth/jwt" is a
// pure re-export of "@auth/core/jwt", so declaration merging must target the
// canonical module or the jwt callback types stay unknown.
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
```

- [ ] **Step 5: Write `src/server/auth/config.edge.ts`**

```ts
import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client"; // type-only: erased at build, edge-safe

/**
 * Edge-safe config: middleware.ts builds its own NextAuth instance from this.
 * NOTHING here may import Prisma or any Node-only API.
 */
export const authConfigEdge = {
  trustHost: true, // self-hosted behind localhost/LAN, not Vercel
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // cap a stale/terminated-user token at one workday
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role as Role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
```

- [ ] **Step 6: Write `src/server/auth/index.ts`**

```ts
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import bcrypt from "bcryptjs";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { authConfigEdge } from "./config.edge";

// A valid cost-10 bcrypt hash of a throwaway string, compared against when no
// user row exists so authorize() always spends bcrypt time — closes the
// timing oracle that would otherwise reveal whether an account exists/is disabled.
const DUMMY_HASH = "$2b$10$<generate: node -e \"console.log(require('bcryptjs').hashSync('x',10))\">";

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(credentials) {
      // findUnique on the normalized (lowercased) email — NOT mode:"insensitive",
      // which compiles to ILIKE and lets a "%" in the field match an arbitrary
      // account (auth bypass). All write paths store lowercase (normalizeEmail).
      const email = normalizeEmail(String(credentials?.email ?? "")).slice(0, 320);
      const password = String(credentials?.password ?? "");
      if (!email || !password) return null;
      const user = await prisma.user.findUnique({ where: { email } });
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!ok || !user?.passwordHash || user.disabled) return null;
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    },
  }),
];

// SSO is NOT functional yet: no signIn callback maps an Entra profile to a User
// row, so an Entra login would carry no role. Register only when FULLY
// configured (a bare _ID alone shows a broken button and defaults issuer to
// "common" = any tenant). TODO(sso-phase): add the signIn callback.
if (
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER
) {
  providers.push(MicrosoftEntraID);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfigEdge,
  providers,
});
```

- [ ] **Step 7: Write `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from "@/server/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 8: Stub `src/lib/auth-shared.ts` so Task 1 compiles** (Task 2 rewrites it test-first — the stub is only the function the import needs)

```ts
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
```

- [ ] **Step 9: Verify**

```bash
npx tsc --noEmit
npm run lint
```

Both PASS. Then start the dev server briefly and probe the session endpoint:

```bash
curl -s http://localhost:3000/api/auth/session
```

Expected: `null` or `{}` (no session) with HTTP 200 — proves the handler mounts. Stop the dev server if you started it (find detached node PIDs via PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(auth): Auth.js v5 core — edge-safe config split, credentials provider, session types"
```

---

### Task 2: auth-shared helpers (TDD)

**Files:**
- Create: `src/lib/auth-shared.test.ts`, then rewrite `src/lib/auth-shared.ts`

- [ ] **Step 1: Write the failing test — `src/lib/auth-shared.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isAllowedDomain, normalizeEmail } from "./auth-shared";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Neil@TheBackroomOp.com ")).toBe("neil@thebackroomop.com");
  });
  it("passes through already-normal input", () => {
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });
});

describe("isAllowedDomain", () => {
  it("accepts an exact domain match, case-insensitively", () => {
    expect(isAllowedDomain("neil@thebackroomop.com", "TheBackroomOp.com")).toBe(true);
  });
  it("rejects other domains", () => {
    expect(isAllowedDomain("neil@gmail.com", "thebackroomop.com")).toBe(false);
  });
  it("rejects subdomain lookalikes", () => {
    expect(isAllowedDomain("x@evil.thebackroomop.com", "thebackroomop.com")).toBe(false);
  });
  it("rejects strings without an @", () => {
    expect(isAllowedDomain("not-an-email", "thebackroomop.com")).toBe(false);
  });
  it("uses the LAST @ (quoted-local-part trick)", () => {
    expect(isAllowedDomain('"a@thebackroomop.com"@evil.com', "thebackroomop.com")).toBe(false);
  });
  it("allows everything when no domain is configured", () => {
    expect(isAllowedDomain("x@anywhere.io", null)).toBe(true);
    expect(isAllowedDomain("x@anywhere.io", undefined)).toBe(true);
    expect(isAllowedDomain("x@anywhere.io", "")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (isAllowedDomain doesn't exist yet)

```bash
npx vitest run src/lib/auth-shared.test.ts
```

Expected: FAIL — `isAllowedDomain` is not exported.

- [ ] **Step 3: Write the full `src/lib/auth-shared.ts`**

```ts
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * allowedDomain comes from the allowed_domain feature flag's value when the
 * flag is enabled; null/undefined/"" means unrestricted. Matching is exact
 * on the text after the LAST @ — subdomains are different domains.
 */
export function isAllowedDomain(
  email: string,
  allowedDomain: string | null | undefined,
): boolean {
  if (!allowedDomain) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === allowedDomain.toLowerCase();
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/auth-shared.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-shared.ts src/lib/auth-shared.test.ts
git commit -m "feat(auth): email normalization and domain allowlist helpers (TDD)"
```

---

### Task 3: Workspace/role/nav truth module (TDD)

This module is consumed by middleware, guards, the sidebar, the switcher, and the palette. It is pure — no imports beyond the Prisma `Role` type.

**Files:**
- Create: `src/lib/workspaces.test.ts`, then `src/lib/workspaces.ts`

- [ ] **Step 1: Write the failing test — `src/lib/workspaces.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  navIsActive,
  pathAllowedForRole,
  resolveWorkspace,
  ROLE_LANDING,
  ROLE_WORKSPACES,
  WORKSPACE_NAV,
} from "./workspaces";

describe("role → workspaces (brief §2)", () => {
  it("matches the brief's table", () => {
    expect(ROLE_WORKSPACES.admin).toEqual(["it", "purchasing", "finance", "admin"]);
    expect(ROLE_WORKSPACES.it_staff).toEqual(["it"]);
    expect(ROLE_WORKSPACES.purchasing_staff).toEqual(["purchasing"]);
    expect(ROLE_WORKSPACES.finance_staff).toEqual(["finance"]);
    expect(ROLE_WORKSPACES.viewer).toEqual(["it"]);
  });
  it("matches the brief's default landings", () => {
    expect(ROLE_LANDING.admin).toBe("/");
    expect(ROLE_LANDING.it_staff).toBe("/inventory");
    expect(ROLE_LANDING.purchasing_staff).toBe("/purchases");
    expect(ROLE_LANDING.finance_staff).toBe("/finance/assets");
    expect(ROLE_LANDING.viewer).toBe("/inventory");
  });
});

describe("resolveWorkspace", () => {
  it("honours a valid cookie", () => {
    expect(resolveWorkspace("admin", "finance")).toBe("finance");
  });
  it("falls back to the first allowed workspace on a bad or missing cookie", () => {
    expect(resolveWorkspace("it_staff", "finance")).toBe("it");
    expect(resolveWorkspace("purchasing_staff", undefined)).toBe("purchasing");
    expect(resolveWorkspace("admin", "nonsense")).toBe("it");
  });
});

describe("pathAllowedForRole", () => {
  const cases: Array<[string, string, boolean]> = [
    // IT workspace paths
    ["/inventory", "it_staff", true],
    ["/inventory/abc/history", "viewer", true],
    ["/employees", "purchasing_staff", false],
    ["/audit", "finance_staff", false],
    ["/audit", "it_staff", true],
    // inventory is shared with purchasing (Reference nav)
    ["/inventory", "purchasing_staff", true],
    ["/inventory", "finance_staff", false],
    // approvals shared IT + finance
    ["/approvals", "finance_staff", true],
    ["/approvals", "purchasing_staff", false],
    ["/approvals/xyz", "viewer", true],
    // purchases shared purchasing + finance
    ["/purchases", "finance_staff", true],
    ["/purchases/new", "it_staff", false],
    // finance-only
    ["/finance/assets", "finance_staff", true],
    ["/finance/assets", "it_staff", false],
    // reference-data CRUD: admin/it_staff only — viewer is IT-workspace but excluded
    ["/admin/asset-categories", "it_staff", true],
    ["/admin/asset-categories", "viewer", false],
    ["/admin/equipment-policies", "viewer", true],
    // admin workspace
    ["/admin/users", "admin", true],
    ["/admin/users", "it_staff", false],
    ["/admin/webhooks/deliveries", "admin", true],
    ["/admin/flags", "finance_staff", false],
    // secrets: IT-workspace only — purchasing (references inventory) excluded
    ["/inventory/abc/secrets", "it_staff", true],
    ["/inventory/abc/secrets", "purchasing_staff", false],
    ["/inventory/abc/secrets", "viewer", true],
    // default-deny: unenumerated routes forbidden for everyone, admin included
    ["/export/assets", "viewer", false],
    ["/api/export/audit", "finance_staff", false],
    ["/totally-unknown", "admin", false],
    ["/admin/future-thing", "viewer", false],
    ["/admin/future-thing", "admin", true],
    // ungated
    ["/", "viewer", true],
    ["/dev/kitchen-sink", "viewer", true],
  ];
  it.each(cases)("%s for %s → %s", (path, role, allowed) => {
    expect(pathAllowedForRole(path, role as never)).toBe(allowed);
  });
  it("admin can reach every workspace's paths", () => {
    for (const p of ["/inventory", "/purchases", "/finance/assets", "/admin/users", "/audit"]) {
      expect(pathAllowedForRole(p, "admin")).toBe(true);
    }
  });
});

describe("navIsActive", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("plain link matches its exact path with no state param", () => {
    expect(navIsActive("/inventory", "/inventory", q(""))).toBe(true);
    expect(navIsActive("/inventory", "/inventory/abc", q(""))).toBe(false);
    expect(navIsActive("/", "/", q(""))).toBe(true);
    expect(navIsActive("/", "/inventory", q(""))).toBe(false);
  });
  it("saved-filter link is active only when its params match", () => {
    expect(navIsActive("/purchases?state=DRAFT", "/purchases", q("state=DRAFT"))).toBe(true);
    expect(navIsActive("/purchases?state=DRAFT", "/purchases", q("state=SUBMITTED"))).toBe(false);
    expect(navIsActive("/purchases?state=DRAFT", "/purchases", q(""))).toBe(false);
  });
  it("the bare list link yields to an active saved filter", () => {
    expect(navIsActive("/purchases", "/purchases", q("state=DRAFT"))).toBe(false);
    expect(navIsActive("/purchases", "/purchases", q(""))).toBe(true);
  });
});

describe("WORKSPACE_NAV shape", () => {
  it("every workspace has an Overview → Home section first", () => {
    for (const ws of ["it", "purchasing", "finance", "admin"] as const) {
      expect(WORKSPACE_NAV[ws][0].heading).toBe("Overview");
      expect(WORKSPACE_NAV[ws][0].items[0]).toMatchObject({ label: "Home", href: "/" });
    }
  });
  it("the IT Approvals item carries the badge marker", () => {
    const tracking = WORKSPACE_NAV.it.find((s) => s.heading === "Tracking");
    expect(tracking?.items.find((i) => i.label === "Approvals")?.badge).toBe("approvals");
  });
  it("Records & admin items are role-restricted", () => {
    const records = WORKSPACE_NAV.it.find((s) => s.heading === "Records & admin");
    for (const item of records?.items ?? []) {
      expect(item.roles).toEqual(["admin", "it_staff"]);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/workspaces.test.ts
```

Expected: FAIL — cannot resolve `./workspaces`.

- [ ] **Step 3: Write `src/lib/workspaces.ts`**

```ts
import type { Role } from "@prisma/client";

export type WorkspaceId = "it" | "purchasing" | "finance" | "admin";

// Brief §2 — the role/workspace table, verbatim.
export const ROLE_WORKSPACES: Record<Role, WorkspaceId[]> = {
  admin: ["it", "purchasing", "finance", "admin"],
  it_staff: ["it"],
  purchasing_staff: ["purchasing"],
  finance_staff: ["finance"],
  viewer: ["it"],
};

export const ROLE_LANDING: Record<Role, string> = {
  admin: "/",
  it_staff: "/inventory",
  purchasing_staff: "/purchases",
  finance_staff: "/finance/assets",
  viewer: "/inventory",
};

export const WORKSPACE_META: Record<WorkspaceId, { label: string; landing: string }> = {
  it: { label: "IT", landing: "/inventory" },
  purchasing: { label: "Purchasing", landing: "/purchases" },
  finance: { label: "Finance", landing: "/finance/assets" },
  admin: { label: "Admin", landing: "/admin/users" },
};

export interface NavItem {
  label: string;
  href: string;
  badge?: "approvals";
  /** restrict the item to these roles, within an already-allowed workspace */
  roles?: Role[];
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

// Brief §2 — the four workspace IAs, verbatim.
export const WORKSPACE_NAV: Record<WorkspaceId, NavSection[]> = {
  it: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    {
      heading: "Tracking",
      items: [
        { label: "Inventory", href: "/inventory" },
        { label: "Employees", href: "/employees" },
        { label: "Approvals", href: "/approvals", badge: "approvals" },
        { label: "Audit log", href: "/audit" },
      ],
    },
    {
      heading: "People lifecycle",
      items: [
        { label: "Offboarding", href: "/offboarding" },
        { label: "Equipment policies", href: "/admin/equipment-policies" },
        { label: "Reservations", href: "/reservations" },
      ],
    },
    {
      heading: "Records & admin",
      items: [
        { label: "Asset categories", href: "/admin/asset-categories", roles: ["admin", "it_staff"] },
        { label: "Asset types", href: "/admin/asset-types", roles: ["admin", "it_staff"] },
        { label: "Departments", href: "/admin/departments", roles: ["admin", "it_staff"] },
      ],
    },
    {
      heading: "Activity logs",
      items: [
        { label: "Inventory activity", href: "/inventory/activity" },
        { label: "Employee activity", href: "/employees/activity" },
      ],
    },
  ],
  purchasing: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    {
      heading: "Procurement",
      items: [
        { label: "All requests", href: "/purchases" },
        { label: "Register purchase", href: "/purchases/new" },
        { label: "Activity log", href: "/purchases/activity" },
      ],
    },
    {
      heading: "By status",
      items: [
        { label: "My drafts", href: "/purchases?state=DRAFT" },
        { label: "Awaiting IT", href: "/purchases?state=SUBMITTED" },
        { label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
        { label: "Completed", href: "/purchases?state=COMPLETED" },
      ],
    },
    { heading: "Reference", items: [{ label: "Inventory", href: "/inventory" }] },
  ],
  finance: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    {
      heading: "Capitalized assets",
      items: [
        { label: "Approved assets", href: "/finance/assets" },
        { label: "Activity log", href: "/finance/activity" },
      ],
    },
    { heading: "Approvals & spend", items: [{ label: "PR approvals", href: "/approvals" }] },
    {
      heading: "By status",
      items: [
        { label: "Awaiting finance", href: "/purchases?state=IT_REVIEWED" },
        { label: "Approved", href: "/purchases?state=COMPLETED" },
        { label: "Cancelled", href: "/purchases?state=CANCELLED" },
        { label: "All purchases", href: "/purchases" },
      ],
    },
  ],
  admin: [
    { heading: "Overview", items: [{ label: "Home", href: "/" }] },
    { heading: "Identity & access", items: [{ label: "Users & roles", href: "/admin/users" }] },
    {
      heading: "Integrations & flags",
      items: [
        { label: "Webhooks", href: "/admin/webhooks" },
        { label: "Feature flags", href: "/admin/flags" },
      ],
    },
  ],
};

export function resolveWorkspace(role: Role, cookie: string | undefined): WorkspaceId {
  const allowed = ROLE_WORKSPACES[role];
  if (cookie && (allowed as string[]).includes(cookie)) return cookie as WorkspaceId;
  return allowed[0];
}

// Paths intentionally NOT workspace-gated — reachable by any authenticated
// user. Everything else MUST match a PATH_RULE or it is denied (default-deny).
const UNGATED: RegExp[] = [/^\/$/, /^\/dev(\/|$)/];

/**
 * Which workspaces may visit a path — the middleware's decision table.
 * DEFAULT-DENY: an unenumerated route is forbidden, so forgetting to list a
 * future sensitive route fails closed. Shares per brief §7: purchasing
 * references /inventory; finance shares /purchases and /approvals.
 * Reference-data CRUD is additionally role-restricted (viewer excluded).
 * /secrets is IT-workspace-only (credential exposure, excludes purchasing).
 */
const PATH_RULES: Array<{ test: RegExp; workspaces: WorkspaceId[]; roles?: Role[] }> = [
  { test: /^\/admin\/(users|webhooks|flags)(\/|$)/, workspaces: ["admin"] },
  {
    test: /^\/admin\/(asset-categories|asset-types|departments)(\/|$)/,
    workspaces: ["it"],
    roles: ["admin", "it_staff"],
  },
  { test: /^\/admin\/equipment-policies(\/|$)/, workspaces: ["it"] },
  // Backstop: any unlisted /admin/* route is admin-only, never default-allow.
  { test: /^\/admin(\/|$)/, workspaces: ["admin"] },
  // Credential exposure (SECRET_READ-audited GET) — IT workspace only. MUST
  // precede the general /inventory rule (first-match-wins).
  { test: /^\/inventory\/[^/]+\/secrets(\/|$)/, workspaces: ["it"] },
  { test: /^\/inventory(\/|$)/, workspaces: ["it", "purchasing"] },
  { test: /^\/(employees|audit|offboarding|reservations)(\/|$)/, workspaces: ["it"] },
  { test: /^\/approvals(\/|$)/, workspaces: ["it", "finance"] },
  { test: /^\/purchases(\/|$)/, workspaces: ["purchasing", "finance"] },
  { test: /^\/finance(\/|$)/, workspaces: ["finance"] },
];

export function pathAllowedForRole(pathname: string, role: Role): boolean {
  if (UNGATED.some((re) => re.test(pathname))) return true;
  const rule = PATH_RULES.find((r) => r.test.test(pathname));
  if (!rule) return false; // default-deny: an unenumerated route is forbidden
  if (rule.roles && !rule.roles.includes(role)) return false;
  const mine = ROLE_WORKSPACES[role];
  return rule.workspaces.some((w) => mine.includes(w));
}

/**
 * Saved-filter links (href carries a query) are active only when every one
 * of their params matches the URL. A bare list link yields to an active
 * sibling saved filter (state param present ⇒ the filter owns the highlight).
 */
export function navIsActive(href: string, pathname: string, search: URLSearchParams): boolean {
  const [hrefPath, hrefQuery] = href.split("?");
  if (pathname !== hrefPath) return false;
  if (hrefQuery) {
    const wanted = new URLSearchParams(hrefQuery);
    for (const [k, v] of wanted) if (search.get(k) !== v) return false;
    return true;
  }
  return !search.has("state");
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/workspaces.test.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspaces.ts src/lib/workspaces.test.ts
git commit -m "feat(shell): workspace/role/nav truth module with exhaustive tests (TDD)"
```

---

### Task 4: Guards + middleware (the two enforcement layers)

**Files:**
- Create: `src/server/auth/guards.ts`, `src/middleware.ts`

- [ ] **Step 1: Write `src/server/auth/guards.ts`**

```ts
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { auth } from "./index";
import { prisma } from "../db/client";
import { ROLE_LANDING } from "@/lib/workspaces";

/**
 * Layer-2 enforcement. Middleware (layer 1) can't reach the DB, so a
 * disabled account's JWT survives until it hits this guard — every page
 * and server action goes through requireUser or requireRole.
 */
export async function requireUser(): Promise<User> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled) redirect("/login");
  // The JWT freezes role at sign-in; if an admin has since changed it, force
  // re-auth so middleware's (token-based) gating can't drift from the DB.
  if (user.role !== session.user.role) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(ROLE_LANDING[user.role]);
  return user;
}
```

- [ ] **Step 2: Write `src/middleware.ts`** (MUST live in `src/` — this project uses a `src/` directory, so a repo-root `middleware.ts` is silently ignored by Next and never registers)

```ts
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfigEdge } from "@/server/auth/config.edge";
import { pathAllowedForRole, ROLE_LANDING } from "@/lib/workspaces";

const { auth } = NextAuth(authConfigEdge);

const AUTH_PATHS = /^\/(login|signup|bootstrap)(\/|$)/;

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Dev-only review surfaces are outside the auth boundary (404 in prod anyway).
  if (pathname.startsWith("/dev")) return;

  const user = req.auth?.user;

  if (!user) {
    if (AUTH_PATHS.test(pathname)) return;
    const login = new URL("/login", req.nextUrl);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Signed-in users don't see login/signup; /bootstrap 404s server-side on its own.
  if (AUTH_PATHS.test(pathname) && !pathname.startsWith("/bootstrap")) {
    return NextResponse.redirect(new URL(ROLE_LANDING[user.role], req.nextUrl));
  }

  if (!pathAllowedForRole(pathname, user.role)) {
    // Forbidden is a server-side redirect to the role's own landing,
    // never a dead end (brief §8).
    return NextResponse.redirect(new URL(ROLE_LANDING[user.role], req.nextUrl));
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|ico|css|js|map)).*)",
  ],
};
```

- [ ] **Step 3: Verify redirect behaviour live**

```bash
npx tsc --noEmit && npm run lint
```

Start the dev server, then:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/inventory
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dev/kitchen-sink
```

Expected: `307 http://localhost:3000/login?next=/inventory` · `200` (login not built yet — Next's 404 page is fine, what matters is NO redirect loop; a `404` body with 200/404 status is acceptable) · `200` (dev bypass works). Stop the server.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts src/server/auth/guards.ts
git commit -m "feat(auth): edge middleware gating + DB-backed requireUser/requireRole guards"
```

---

### Task 5: Route groups, cookie-driven root layout, PageHeader, not-found, catch-all, Home

**Files:**
- Modify: `src/app/layout.tsx`
- Delete: `src/app/page.tsx` (content moves)
- Create: `src/components/ui/page-header.tsx`, `src/app/not-found.tsx`, `src/app/(auth)/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/[...pending]/page.tsx`

- [ ] **Step 1: Rewrite `src/app/layout.tsx`** — the cookie contract lands here

```tsx
import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backroom IT — Inventory",
  description: "IT asset management for The Backroom Offshoring",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // br.theme / br.density are written by the Phase 1 toggles; reading them
  // here is what makes the choice survive a reload (the cookie contract).
  const jar = await cookies();
  const theme = jar.get("br.theme")?.value === "dark" ? "dark" : "light";
  const density = jar.get("br.density")?.value === "compact" ? "compact" : "comfortable";
  return (
    <html lang="en" data-theme={theme} data-density={density} suppressHydrationWarning>
      <body className="bg-canvas text-fg font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Write `src/components/ui/page-header.tsx`** (the deferred Phase 1 primitive)

```tsx
import { Breadcrumb } from "./breadcrumb";

export function PageHeader({
  title,
  breadcrumb,
  badge,
  actions,
}: {
  title: string;
  breadcrumb?: Array<{ label: string; href?: string }>;
  /** e.g. the READ-ONLY · VIEWER pill */
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pb-4">
      <div className="flex flex-col gap-1.5">
        {breadcrumb && <Breadcrumb items={breadcrumb} />}
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-fg">
            {title}
          </h1>
          {badge}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
```

- [ ] **Step 3: Write `src/app/not-found.tsx`**

```tsx
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-8">
      <EmptyState
        title="This page doesn't exist"
        description="The link may be stale, or the record it pointed at is gone."
        actions={
          <Link
            href="/"
            className="rounded-(--radius-btn) bg-accent px-3.5 py-[9px] text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            Back to home
          </Link>
        }
      />
    </main>
  );
}
```

- [ ] **Step 4: Write `src/app/(auth)/layout.tsx`** — auth screens live on bare canvas, no shell

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-screen place-items-center bg-canvas p-4">{children}</main>;
}
```

- [ ] **Step 5: Write `src/app/(app)/layout.tsx`** — skeleton now; Tasks 9–11 fill the shell slots

```tsx
import { requireUser } from "@/server/auth/guards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser(); // layer-2: catches disabled accounts middleware can't see
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-(--radius-btn) focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>
      {/* Sidebar (Task 9) and Topbar (Task 11) mount here */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Delete `src/app/page.tsx` and write `src/app/(app)/page.tsx`** — minimal role-aware Home (Phase 6 replaces it)

```tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/server/auth/guards";
import { resolveWorkspace, WORKSPACE_NAV } from "@/lib/workspaces";

export default async function Home() {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const links = WORKSPACE_NAV[ws]
    .flatMap((s) => s.items)
    .filter((i) => i.href !== "/" && (!i.roles || i.roles.includes(user.role)))
    .slice(0, 8);
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} />
      <Card className="max-w-xl">
        <CardHeader title="Jump to" />
        <CardBody className="grid grid-cols-2 gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-(--radius-ctl) px-2.5 py-1.5 text-[12.5px] text-fg-secondary hover:bg-surface-subtle hover:text-fg"
            >
              {l.label}
            </Link>
          ))}
        </CardBody>
      </Card>
      <p className="mt-4 text-[11px] text-fg-muted">
        The full dashboard (your shift, fleet, warranty runway) arrives in Phase 6.
      </p>
    </>
  );
}
```

- [ ] **Step 7: Write `src/app/(app)/[...pending]/page.tsx`** — every not-yet-built nav route renders this; real routes override it as phases land

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { requireUser } from "@/server/auth/guards";

const PHASE_BY_PREFIX: Array<[RegExp, number]> = [
  [/^(inventory|employees)\/activity$/, 4],
  [/^(approvals|audit)(\/|$)/, 4],
  [/^(inventory|employees|admin\/(asset-categories|asset-types|departments))(\/|$)/, 3],
  [/^purchases(\/|$)/, 5],
  [/^finance(\/|$)/, 6],
  [/^(offboarding|reservations|admin\/equipment-policies)(\/|$)/, 7],
  [/^admin(\/|$)/, 8],
];

export default async function PendingPage({
  params,
}: {
  params: Promise<{ pending: string[] }>;
}) {
  await requireUser();
  const { pending } = await params;
  const path = pending.join("/");
  const phase = PHASE_BY_PREFIX.find(([re]) => re.test(path))?.[1] ?? 3;
  const last = pending[pending.length - 1] ?? "";
  const title = (last.replace(/-/g, " ") || "Screen").replace(/^\w/, (c) => c.toUpperCase());
  return (
    <>
      <PageHeader title={title} badge={<Pill>PLANNED</Pill>} />
      <EmptyState
        title={`This screen arrives in Phase ${phase}`}
        description={`/${path} is on the roadmap — the navigation is real, the page isn't built yet.`}
      />
    </>
  );
}
```

- [ ] **Step 8: Verify**

```bash
npx tsc --noEmit && npm run lint
```

Start the dev server. `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/` → expect `307 …/login` (unauthenticated). `/dev/kitchen-sink` still 200. Stop the server. NOTE: you cannot see the Home/pending pages yet — login doesn't exist until Task 6; the middleware redirect IS the verification.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(shell): route groups, cookie-driven SSR theme/density, PageHeader, catch-all pending pages"
```

---

### Task 6: Login — page, form, sign-in/sign-out actions

**Files:**
- Create: `src/server/auth/actions.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/login-form.tsx`

- [ ] **Step 1: Write `src/server/auth/actions.ts`** (sign-in/out only — later tasks append to this file)

```ts
"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "./index";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { ROLE_LANDING } from "@/lib/workspaces";

export interface AuthFormState {
  error?: string;
}

function safeNext(raw: FormDataEntryValue | null): string | undefined {
  const next = String(raw ?? "");
  return next.startsWith("/") && !next.startsWith("//") ? next : undefined;
}

export async function signInWithCredentials(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Wrong email or password — or the account is disabled." };
    }
    throw err;
  }
  // Read the role straight from the DB by email — auth() called in the same
  // request right after signIn(redirect:false) reads the pre-login request
  // cookies and returns a stale/empty session (Auth.js v5 behavior).
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  redirect(safeNext(formData.get("next")) ?? (user ? ROLE_LANDING[user.role] : "/"));
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
```

- [ ] **Step 2: Write `src/app/(auth)/login/login-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signInWithCredentials, type AuthFormState } from "@/server/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signInWithCredentials,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <Banner tone="fault" title={state.error} />}
      <FormField label="Email" required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </FormField>
      <FormField label="Password" required>
        {(p) => (
          <Input {...p} name="password" type="password" autoComplete="current-password" required />
        )}
      </FormField>
      <Button type="submit" variant="primary" loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Write `src/app/(auth)/login/page.tsx`** (handover 3i: brand, domain note, flag-gated Microsoft button, OR divider, role-decides-landing note)

```tsx
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { signIn } from "@/server/auth";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const [ssoFlag, domainFlag] = await Promise.all([
    prisma.featureFlag.findUnique({ where: { key: "m365_sso" } }),
    prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } }),
  ]);
  const domain =
    domainFlag?.enabled && typeof domainFlag.value === "string" ? domainFlag.value : null;
  const showMicrosoft = !!ssoFlag?.enabled && !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

  return (
    <div className="w-full max-w-[360px] rounded-[11px] border border-border bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg">Sign in</h1>
      {domain && (
        <p className="mt-1 text-[11px] text-fg-muted">Access is limited to @{domain} accounts.</p>
      )}
      {showMicrosoft && (
        <>
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id");
            }}
            className="mt-4"
          >
            <Button type="submit" variant="secondary" className="w-full">
              Continue with Microsoft
            </Button>
          </form>
          <div aria-hidden className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase text-fg-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <div className={showMicrosoft ? "" : "mt-4"}>
        <LoginForm next={next} />
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-fg-muted">
        New here? <Link href="/signup" className="text-accent hover:text-accent-hover">Create an account</Link>
        {domain ? " — signup is domain-restricted" : ""}, and your role decides where you land.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify the whole flow live**

```bash
npx tsc --noEmit && npm run lint
```

Start the dev server. Then, with curl and a cookie jar:

```bash
curl -s -c /tmp/jar -o /dev/null http://localhost:3000/login
curl -s -b /tmp/jar http://localhost:3000/api/auth/csrf
```

Full form-flow via curl is fiddly (CSRF) — verify interactively instead: open http://localhost:3000/login in a browser, sign in as `it@thebackroomop.com` / `ChangeMe123!`, confirm you land on `/inventory` (the pending page renders with PLANNED pill), and that revisiting `/login` while signed in redirects away. If no browser is available, report DONE_WITH_CONCERNS and the e2e task will prove it. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): login page with credentials flow, role landings, flag-gated Microsoft button"
```

---

### Task 7: Signup — page, form, action

**Files:**
- Modify: `src/server/auth/actions.ts` (append)
- Create: `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/signup/signup-form.tsx`

- [ ] **Step 1: Append to `src/server/auth/actions.ts`**

```ts
// … append below signOutAction …
import bcrypt from "bcryptjs";
import { prisma } from "../db/client";
import { isAllowedDomain, normalizeEmail } from "@/lib/auth-shared";
```
(Consolidate the imports at the top of the file — ESLint will flag misplaced imports.)

```ts
export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (name.length < 2) return { error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };

  const domainFlag = await prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } });
  const domain =
    domainFlag?.enabled && typeof domainFlag.value === "string" ? domainFlag.value : null;
  if (!isAllowedDomain(email, domain)) {
    return { error: `Signup is limited to @${domain} addresses.` };
  }

  // Exact lookup on the normalized email — NOT mode:"insensitive" (ILIKE),
  // which treats %/_ as wildcards (unauthenticated enumeration oracle).
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    // Least privilege: every signup is a viewer; admins promote via /admin/users.
    data: { name, email, passwordHash, role: "viewer" },
  });
  await prisma.auditEntry.create({
    data: {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "user",
      entityId: user.id,
      action: "signup",
      diff: { role: { from: null, to: "viewer" } },
    },
  });

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch {
    redirect("/login"); // account exists; worst case they sign in manually
  }
  redirect(ROLE_LANDING.viewer);
}
```

- [ ] **Step 2: Write `src/app/(auth)/signup/signup-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signUp, type AuthFormState } from "@/server/auth/actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Banner tone="fault" title={state.error} />}
      <FormField label="Name" required>
        {(p) => <Input {...p} name="name" autoComplete="name" required />}
      </FormField>
      <FormField label="Email" required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </FormField>
      <FormField label="Password" required hint="At least 10 characters">
        {(p) => (
          <Input {...p} name="password" type="password" autoComplete="new-password" required />
        )}
      </FormField>
      <Button type="submit" variant="primary" loading={pending}>
        Create account
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Write `src/app/(auth)/signup/page.tsx`**

```tsx
import Link from "next/link";
import { prisma } from "@/server/db/client";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const domainFlag = await prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } });
  const domain =
    domainFlag?.enabled && typeof domainFlag.value === "string" ? domainFlag.value : null;
  return (
    <div className="w-full max-w-[360px] rounded-[11px] border border-border bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg">Create account</h1>
      <p className="mt-1 text-[11px] text-fg-muted">
        {domain ? `Limited to @${domain} addresses. ` : ""}New accounts start read-only; an
        admin assigns your role.
      </p>
      <div className="mt-4">
        <SignupForm />
      </div>
      <p className="mt-4 text-[11px] text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:text-accent-hover">Sign in</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run lint
```

Live check (dev server): sign up as `probe-signup@thebackroomop.com` / any 10+ char password → lands on `/inventory` (viewer landing). Then sign up with `probe@gmail.com` → inline fault banner "Signup is limited to @thebackroomop.com addresses." Clean up the created account (AuditEntry rows can't be deleted — append-only by design — so use the sanctioned reset):

```bash
npm run db:seed
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): domain-restricted signup creating least-privilege viewer accounts"
```

---

### Task 8: Bootstrap — first-run admin, dark surface, permanent 404

**Files:**
- Modify: `src/server/auth/actions.ts` (append)
- Create: `src/app/(auth)/bootstrap/page.tsx`, `src/app/(auth)/bootstrap/bootstrap-form.tsx`

- [ ] **Step 1: Append `createBootstrapAdmin` to `src/server/auth/actions.ts`**

```ts
export async function createBootstrapAdmin(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();

  if (name.length < 2) return { error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.user.count();
      if (count > 0) throw new Error("BOOTSTRAP_CLOSED");
      const admin = await tx.user.create({
        data: { name, email, passwordHash, role: "admin", isPermanentAdmin: true },
      });
      await tx.featureFlag.upsert({
        where: { key: "allowed_domain" },
        update: { enabled: !!domain, value: domain || undefined },
        create: {
          key: "allowed_domain",
          enabled: !!domain,
          value: domain || undefined,
          description: "Signup domain restriction",
        },
      });
      await tx.auditEntry.create({
        data: {
          actorId: admin.id,
          actorLabel: admin.name,
          entityType: "user",
          entityId: admin.id,
          action: "bootstrap",
          diff: { role: { from: null, to: "admin" }, allowedDomain: { from: null, to: domain || null } },
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "BOOTSTRAP_CLOSED") {
      return { error: "Setup is already complete." };
    }
    throw err;
  }

  await signIn("credentials", { email, password, redirect: false });
  const jar = await cookies();
  jar.set("br.dept", "it", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/"); // "Create admin and open IT" — admin home with the IT workspace active
}
```
(Add `import { cookies } from "next/headers";` to the imports.)

- [ ] **Step 2: Write `src/app/(auth)/bootstrap/bootstrap-form.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createBootstrapAdmin, type AuthFormState } from "@/server/auth/actions";

export function BootstrapForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    createBootstrapAdmin,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Banner tone="fault" title={state.error} />}
      <FormField label="Your name" required>
        {(p) => <Input {...p} name="name" autoComplete="name" required />}
      </FormField>
      <FormField label="Admin email" required>
        {(p) => <Input {...p} name="email" type="email" required />}
      </FormField>
      <FormField label="Password" required hint="At least 10 characters">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required />}
      </FormField>
      <FormField
        label="Allowed signup domain"
        hint="Changeable later under Feature flags. Leave empty for unrestricted signup."
      >
        {(p) => <Input {...p} name="domain" placeholder="thebackroomop.com" />}
      </FormField>
      <Button type="submit" variant="primary" loading={pending}>
        Create admin and open IT
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Write `src/app/(auth)/bootstrap/page.tsx`** — dark-scoped via `data-theme` on a wrapper (CSS vars re-scope), 404 the moment any user exists

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { BootstrapForm } from "./bootstrap-form";

export default async function BootstrapPage() {
  const users = await prisma.user.count();
  if (users > 0) notFound(); // permanently 404s after first run (brief §7 Auth)

  return (
    <div data-theme="dark" className="grid min-h-screen w-full place-items-center bg-canvas p-4 text-fg">
      <div className="w-full max-w-[400px] rounded-[11px] border border-border bg-surface p-6 shadow-dialog">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
            BR
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-fg-muted">
            First-run setup
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.015em]">Create the admin account</h1>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          This screen appears exactly once. The account it creates is the permanent admin —
          its role can never be changed.
        </p>
        <div className="mt-5">
          <BootstrapForm />
        </div>
      </div>
    </div>
  );
}
```

Note: `(auth)/layout.tsx` wraps this in a centered `<main>` — the full-bleed dark div intentionally overrides the canvas behind it.

- [ ] **Step 4: Verify** — with seeded users, `/bootstrap` must 404:

```bash
npx tsc --noEmit && npm run lint
```

Dev server: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/bootstrap` → `404`. (The create-path is proven by the transaction guard's unit-visible logic + the e2e task asserts the 404; testing the actual creation would require emptying the users table, which the seed restores anyway — skip it here.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): first-run bootstrap — permanent admin, allowed-domain flag, 404s forever after"
```

---

### Task 9: Sidebar — nav, live approvals badge, user footer, account menu

**Files:**
- Create: `src/components/shell/sidebar.tsx`, `src/components/shell/nav-list.tsx`, `src/components/shell/account-menu.tsx`
- Modify: `src/app/(app)/layout.tsx` (mount the sidebar)

- [ ] **Step 1: Write `src/components/shell/nav-list.tsx`** (client — active states need the URL)

```tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { navIsActive, type NavSection } from "@/lib/workspaces";

export interface ApprovalsBadge {
  open: number;
  overdue: number;
}

export function NavList({
  sections,
  badge,
  onNavigate,
}: {
  sections: NavSection[];
  badge: ApprovalsBadge;
  /** mobile drawer closes itself on navigation */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          <h3 className="px-2.5 pb-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-fg-muted">
            {section.heading}
          </h3>
          {section.items.map((item) => {
            const active = navIsActive(item.href, pathname, search);
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-(--radius-btn) px-2.5 py-[7px] text-[12.5px]",
                  "transition-colors duration-(--dur-1)",
                  active
                    ? "bg-accent-tint text-accent shadow-[inset_2px_0_0_var(--accent)]"
                    : "text-fg-secondary hover:bg-surface-subtle hover:text-fg",
                )}
              >
                {item.label}
                {item.badge === "approvals" && badge.open > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-(--radius-ctl) border px-1.5 font-mono text-[10px]",
                      badge.overdue > 0
                        ? "border-[var(--st-fault-border)] bg-[var(--st-fault-bg)] text-[var(--st-fault-text)]"
                        : "border-border bg-border-faint text-fg-secondary",
                    )}
                    aria-label={`${badge.open} open approvals${badge.overdue > 0 ? ", some past SLA" : ""}`}
                  >
                    {badge.overdue > 0 && (
                      <span
                        aria-hidden
                        className="size-[5px] rounded-full bg-[var(--st-fault-dot)]"
                        style={{ animation: "pulse 1.9s ease-in-out infinite" }}
                      />
                    )}
                    {badge.open}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write `src/components/shell/account-menu.tsx`**

```tsx
"use client";

import { Menu } from "@/components/ui/menu";
import { signOutAction } from "@/server/auth/actions";

export function AccountMenu() {
  return (
    <Menu
      align="end"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label="Account menu"
          className="rounded-(--radius-ctl) px-1.5 py-0.5 text-fg-muted hover:bg-surface-subtle"
        >
          ⋯
        </button>
      )}
      items={[{ label: "Sign out", onSelect: () => void signOutAction() }]}
    />
  );
}
```

- [ ] **Step 3: Write `src/components/shell/sidebar.tsx`** (server — fetches the badge, reads cookies)

```tsx
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { Avatar } from "@/components/ui/avatar";
import {
  resolveWorkspace,
  ROLE_WORKSPACES,
  WORKSPACE_META,
  WORKSPACE_NAV,
} from "@/lib/workspaces";
import { AccountMenu } from "./account-menu";
import { NavList } from "./nav-list";
import { WorkspaceSwitcher } from "./workspace-switcher";

export async function getApprovalsBadge() {
  const [open, overdue] = await Promise.all([
    prisma.approval.count({ where: { state: { in: ["PENDING", "CLAIMED"] } } }),
    prisma.approval.count({
      where: { state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: new Date() } },
    }),
  ]);
  return { open, overdue };
}

export function filterSectionsForRole(sections: typeof WORKSPACE_NAV.it, role: User["role"]) {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);
}

export async function Sidebar({ user }: { user: User }) {
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  const badge = await getApprovalsBadge();
  const allowed = ROLE_WORKSPACES[user.role];

  return (
    <aside
      aria-label="Primary"
      className="hidden w-[238px] shrink-0 flex-col border-r border-border bg-surface lg:flex"
    >
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <WorkspaceSwitcher
        current={ws}
        allowed={allowed}
        meta={WORKSPACE_META}
      />
      <NavList sections={sections} badge={badge} />
      <div className="flex items-center gap-2.5 border-t border-border-faint px-4 py-3">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg">{user.name}</p>
          <p className="font-mono text-[9.5px] uppercase text-fg-muted">{user.role}</p>
        </div>
        <AccountMenu />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Mount in `src/app/(app)/layout.tsx`** — replace the file with:

```tsx
import { requireUser } from "@/server/auth/guards";
import { Sidebar } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-(--radius-btn) focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar mounts here in Task 11 */}
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

NOTE: this task will not compile until `workspace-switcher.tsx` exists — Task 10 provides it. To keep this task self-contained and committable, create a MINIMAL placeholder now that Task 10 replaces:

```tsx
// src/components/shell/workspace-switcher.tsx — placeholder, Task 10 replaces
import type { WorkspaceId } from "@/lib/workspaces";

export function WorkspaceSwitcher({
  current,
  meta,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: Record<WorkspaceId, { label: string; landing: string }>;
}) {
  return (
    <div className="mx-3 mb-2 rounded-(--radius-btn) border border-border px-2.5 py-2">
      <p className="text-[12.5px] font-semibold text-fg">{meta[current].label}</p>
    </div>
  );
}
```

- [ ] **Step 5: Verify live** (dev server): sign in as it@ → sidebar shows the IT sections (Records & admin visible), Approvals badge shows **3** with the urgent fault styling and pulsing dot (seeded overdue). Sign in as viewer@ → Records & admin section is ABSENT. `useSearchParams` in NavList requires the layout to render inside a Suspense-capable tree — the shell is dynamic (cookies+auth) so no extra boundary is needed; if Next complains at build time, wrap `<NavList>` in `<Suspense>`.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(shell): sidebar with role-filtered nav, live approvals badge, account menu"
```

---

### Task 10: Workspace switcher — popover for admin, static label for everyone else

**Files:**
- Modify: `src/server/auth/actions.ts` (append), `src/components/shell/workspace-switcher.tsx` (replace the Task 9 placeholder)

- [ ] **Step 1: Append `switchWorkspace` to `src/server/auth/actions.ts`**

```ts
import { cookies } from "next/headers"; // already imported for bootstrap
import { requireUser } from "./guards";
import { ROLE_WORKSPACES, WORKSPACE_META, type WorkspaceId } from "@/lib/workspaces";
```

```ts
export async function switchWorkspace(ws: WorkspaceId) {
  const user = await requireUser();
  if (!ROLE_WORKSPACES[user.role].includes(ws)) redirect(ROLE_LANDING[user.role]);
  const jar = await cookies();
  jar.set("br.dept", ws, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect(WORKSPACE_META[ws].landing);
}
```

- [ ] **Step 2: Replace `src/components/shell/workspace-switcher.tsx`** (handover shell spec: 6px accent dot, name 12.5/600, `br.dept · N available` mono 9.5, ▲▼; degrades to a static label with NO chevron for single-workspace roles — not a disabled control)

```tsx
"use client";

import { Menu } from "@/components/ui/menu";
import { switchWorkspace } from "@/server/auth/actions";
import type { WorkspaceId } from "@/lib/workspaces";

export function WorkspaceSwitcher({
  current,
  allowed,
  meta,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: Record<WorkspaceId, { label: string; landing: string }>;
}) {
  const body = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-[12.5px] font-semibold text-fg">
          {meta[current].label}
        </span>
        <span className="block font-mono text-[9.5px] text-fg-muted">
          br.dept · {allowed.length} available
        </span>
      </span>
    </span>
  );

  if (allowed.length === 1) {
    // Static label, not a disabled control (handover shell spec).
    return <div className="mx-3 mb-2 flex items-center rounded-(--radius-btn) border border-border px-2.5 py-2">{body}</div>;
  }

  return (
    <div className="mx-3 mb-2">
      <Menu
        align="start"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className="flex w-full items-center gap-2 rounded-(--radius-btn) border border-border px-2.5 py-2 hover:bg-surface-subtle"
          >
            {body}
            <span aria-hidden className="font-mono text-[9px] text-fg-muted">▲▼</span>
          </button>
        )}
        items={allowed.map((ws) => ({
          label: meta[ws].label + (ws === current ? " ✓" : ""),
          onSelect: () => void switchWorkspace(ws),
        }))}
      />
    </div>
  );
}
```

NOTE: `Menu`'s popover is not portaled (recorded Phase 1 limitation) — inside the sidebar it has no `overflow` ancestor above it in the aside until the nav list, so it renders fine; verify visually.

- [ ] **Step 3: Verify live** (dev server): admin@ sees the switcher with ▲▼; selecting Purchasing navigates to `/purchases` and the sidebar now shows Procurement/By status sections; the cookie persists across reloads. it@ sees a static label without ▲▼ and no popover.

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(shell): workspace switcher with cookie-backed switching, static label degradation"
```

---

### Task 11: Topbar + mobile drawer (Drawer gains a side prop)

**Files:**
- Modify: `src/components/ui/drawer.tsx` (side prop), `src/app/globals.css` (sheetLeft keyframe), `src/app/(app)/layout.tsx` (mount Topbar + MobileNav)
- Create: `src/components/shell/topbar.tsx`, `src/components/shell/mobile-nav.tsx`

- [ ] **Step 1: Add `sheetLeft` to `src/app/globals.css`** (next to the existing `sheet` keyframe)

```css
@keyframes sheetLeft {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}
```

- [ ] **Step 2: Give `Drawer` a side prop** — in `src/components/ui/drawer.tsx`, change the signature and panel:

```tsx
export function Drawer({
  open,
  onClose,
  title,
  width = 376,
  side = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
```

and replace the panel `className`/`style`:

```tsx
        className={cn(
          "absolute inset-y-0 flex max-w-full flex-col bg-surface-raised",
          side === "right" ? "right-0 border-l shadow-drawer" : "left-0 border-r",
          "border-border",
        )}
        style={{
          width,
          animation: `${side === "right" ? "sheet" : "sheetLeft"} var(--dur-4) var(--ease-std)`,
        }}
```

(Add the `cn` import if missing. The left drawer keeps the same veil; shadow-drawer's offset is tuned for the right side, so the left panel uses the border only.)

- [ ] **Step 3: Write `src/components/shell/mobile-nav.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import type { NavSection } from "@/lib/workspaces";
import { NavList, type ApprovalsBadge } from "./nav-list";

export function MobileNav({
  sections,
  badge,
  workspaceLabel,
}: {
  sections: NavSection[];
  badge: ApprovalsBadge;
  workspaceLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="grid size-[34px] place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle"
      >
        <Icon name="filter" size={16} />
      </button>
      {open && (
        <Drawer open onClose={() => setOpen(false)} title={workspaceLabel} side="left" width={280}>
          <NavList sections={sections} badge={badge} onNavigate={() => setOpen(false)} />
        </Drawer>
      )}
    </div>
  );
}
```

(The hamburger uses the `filter` icon — three shrinking lines — since the 16-icon set has no dedicated hamburger and the design rule says never guess a new glyph. Its position is fixed at the topbar's left edge so the header never jumps, per the handover.)

- [ ] **Step 4: Write `src/components/shell/topbar.tsx`**

```tsx
import Link from "next/link";
import { DensityToggle } from "@/components/ui/density-toggle";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { NavSection } from "@/lib/workspaces";
import { CommandPaletteTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import type { ApprovalsBadge } from "./nav-list";

export function Topbar({
  sections,
  badge,
  workspaceLabel,
}: {
  sections: NavSection[];
  badge: ApprovalsBadge;
  workspaceLabel: string;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <MobileNav sections={sections} badge={badge} workspaceLabel={workspaceLabel} />
      <CommandPaletteTrigger />
      <div className="ml-auto flex items-center gap-2">
        <DensityToggle />
        <ThemeToggle />
        <Link
          href="/dev/kitchen-sink"
          aria-label="Help"
          className="grid size-[34px] place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle"
        >
          <Icon name="alert" size={16} />
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Mount in `src/app/(app)/layout.tsx`** — pass the same nav data the sidebar computed. Restructure so the data is computed once:

```tsx
import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import {
  resolveWorkspace,
  ROLE_WORKSPACES,
  WORKSPACE_META,
  WORKSPACE_NAV,
} from "@/lib/workspaces";
import { filterSectionsForRole, getApprovalsBadge, Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { CommandPalette } from "@/components/shell/command-palette";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  const badge = await getApprovalsBadge();

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-(--radius-btn) focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>
      <Sidebar
        user={user}
        ws={ws}
        sections={sections}
        badge={badge}
        allowed={ROLE_WORKSPACES[user.role]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar sections={sections} badge={badge} workspaceLabel={WORKSPACE_META[ws].label} />
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
      <CommandPalette role={user.role} sections={sections} />
    </div>
  );
}
```

Refactor `Sidebar` accordingly: it now RECEIVES `ws/sections/badge/allowed` as props instead of computing them (delete its cookie/prisma reads; keep `getApprovalsBadge` and `filterSectionsForRole` exported from the same file for the layout to use). Full replacement for the component:

```tsx
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { Avatar } from "@/components/ui/avatar";
import {
  WORKSPACE_META,
  WORKSPACE_NAV,
  type NavSection,
  type WorkspaceId,
} from "@/lib/workspaces";
import { AccountMenu } from "./account-menu";
import { NavList, type ApprovalsBadge } from "./nav-list";
import { WorkspaceSwitcher } from "./workspace-switcher";

export async function getApprovalsBadge(): Promise<ApprovalsBadge> {
  const [open, overdue] = await Promise.all([
    prisma.approval.count({ where: { state: { in: ["PENDING", "CLAIMED"] } } }),
    prisma.approval.count({
      where: { state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: new Date() } },
    }),
  ]);
  return { open, overdue };
}

export function filterSectionsForRole(
  sections: (typeof WORKSPACE_NAV)[WorkspaceId],
  role: User["role"],
): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);
}

export function Sidebar({
  user,
  ws,
  sections,
  badge,
  allowed,
}: {
  user: User;
  ws: WorkspaceId;
  sections: NavSection[];
  badge: ApprovalsBadge;
  allowed: WorkspaceId[];
}) {
  return (
    <aside
      aria-label="Primary"
      className="hidden w-[238px] shrink-0 flex-col border-r border-border bg-surface lg:flex"
    >
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <WorkspaceSwitcher current={ws} allowed={allowed} meta={WORKSPACE_META} />
      <NavList sections={sections} badge={badge} />
      <div className="flex items-center gap-2.5 border-t border-border-faint px-4 py-3">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg">{user.name}</p>
          <p className="font-mono text-[9.5px] uppercase text-fg-muted">{user.role}</p>
        </div>
        <AccountMenu />
      </div>
    </aside>
  );
}
```

(`CommandPalette` doesn't exist until Task 12 — create the minimal stub now so this task compiles; Task 12 replaces it:)

```tsx
// src/components/shell/command-palette.tsx — stub, Task 12 replaces
"use client";

import type { Role } from "@prisma/client";
import type { NavSection } from "@/lib/workspaces";

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      className="hidden h-[34px] w-[320px] items-center gap-2 rounded-(--radius-btn) border border-border bg-canvas px-3 text-left text-xs text-fg-muted hover:border-border-strong md:flex"
    >
      Search…
    </button>
  );
}

export function CommandPalette(_props: { role: Role; sections: NavSection[] }) {
  return null;
}
```

- [ ] **Step 6: Verify live**: desktop — topbar shows search trigger + toggles; theme/density flips still work AND persist across reload (cookie → SSR). Mobile viewport (375px) — sidebar hidden, hamburger opens the LEFT drawer with the nav, ESC closes it, focus returns to the hamburger, navigating closes it.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(shell): topbar and mobile left-drawer nav; Drawer gains a side prop"
```

---

### Task 12: Command palette — ⌘K search across assets, people, requests, actions

**Files:**
- Create: `src/server/palette.ts`
- Replace: `src/components/shell/command-palette.tsx`

- [ ] **Step 1: Write `src/server/palette.ts`** (server action; role-filters hrefs through the same gate as middleware)

```ts
"use server";

import { prisma } from "./db/client";
import { requireUser } from "./auth/guards";
import { pathAllowedForRole } from "@/lib/workspaces";

export interface PaletteHit {
  label: string;
  sub: string;
  href: string;
}

export interface PaletteResults {
  assets: PaletteHit[];
  people: PaletteHit[];
  requests: PaletteHit[];
}

export async function paletteSearch(query: string): Promise<PaletteResults> {
  const user = await requireUser();
  const q = query.trim();
  if (q.length < 2) return { assets: [], people: [], requests: [] };

  const [assets, people, requests] = await Promise.all([
    prisma.asset.findMany({
      where: { OR: [{ tag: { contains: q, mode: "insensitive" } }, { model: { contains: q, mode: "insensitive" } }] },
      take: 5,
      orderBy: { tag: "asc" },
    }),
    prisma.employee.findMany({
      where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { employeeNo: { contains: q, mode: "insensitive" } }] },
      take: 5,
      orderBy: { name: "asc" },
    }),
    prisma.purchaseRequest.findMany({
      where: { refNo: { contains: q, mode: "insensitive" } },
      take: 5,
      orderBy: { refNo: "desc" },
    }),
  ]);

  const gate = (href: string) => pathAllowedForRole(href, user.role);
  return {
    assets: assets
      .map((a) => ({ label: a.tag, sub: a.model, href: `/inventory/${a.id}` }))
      .filter((h) => gate(h.href)),
    people: people
      .map((e) => ({ label: e.name, sub: e.employeeNo, href: `/employees/${e.id}` }))
      .filter((h) => gate(h.href)),
    requests: requests
      .map((r) => ({ label: r.refNo, sub: r.state, href: `/purchases/${r.id}` }))
      .filter((h) => gate(h.href)),
  };
}
```

- [ ] **Step 2: Replace `src/components/shell/command-palette.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/cn";
import type { NavSection } from "@/lib/workspaces";
import { Kbd } from "@/components/ui/kbd";
import { Icon } from "@/components/ui/icon";
import { useFocusTrap } from "@/components/ui/use-focus-trap";
import { paletteSearch, type PaletteResults } from "@/server/palette";

const OPEN_EVENT = "br:open-palette";

export function CommandPaletteTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
      className="hidden h-[34px] w-[320px] items-center gap-2 rounded-(--radius-btn) border border-border bg-canvas px-3 text-left text-xs text-fg-muted hover:border-border-strong md:flex"
    >
      <Icon name="search" size={14} />
      <span className="flex-1">Search assets, people, requests…</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

const EMPTY: PaletteResults = { assets: [], people: [], requests: [] };

export function CommandPalette({ role, sections }: { role: Role; sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteResults>(EMPTY);
  const [cursor, setCursor] = useState(0);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY);
    setCursor(0);
  }, []);

  const setTrapRef = useFocusTrap(open, close);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  const actions = useMemo(
    () =>
      sections
        .flatMap((s) => s.items)
        .filter((i) => !i.roles || i.roles.includes(role))
        .filter((i) => !query || i.label.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5)
        .map((i) => ({ label: i.label, sub: "Go to", href: i.href })),
    [sections, role, query],
  );

  const groups = useMemo(
    () =>
      [
        { heading: "Assets", hits: results.assets },
        { heading: "People", hits: results.people },
        { heading: "Requests", hits: results.requests },
        { heading: "Actions", hits: actions },
      ].filter((g) => g.hits.length > 0),
    [results, actions],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  function onQueryChange(value: string) {
    setQuery(value);
    setCursor(0);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      startTransition(async () => {
        setResults(await paletteSearch(value));
      });
    }, 150);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && flat[cursor]) {
      e.preventDefault();
      router.push(flat[cursor].href);
      close();
    }
  }

  if (!open) return null;

  let index = -1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div aria-hidden onClick={close} className="absolute inset-0 bg-black/40" style={{ animation: "veil var(--dur-4) var(--ease-std)" }} />
      <div
        ref={setTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-(--radius-card) border border-border bg-surface-raised shadow-dialog"
        style={{ animation: "pop var(--dur-4) var(--ease-std)" }}
      >
        <div className="flex items-center gap-2 border-b border-border-faint px-3">
          <Icon name="search" size={15} className="text-fg-muted" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search assets, people, requests…"
            aria-label="Search"
            className="h-11 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-faint"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5" role="listbox" aria-label="Results">
          {flat.length === 0 && (
            <p className="px-2.5 py-6 text-center text-xs text-fg-muted">
              {query.length < 2 ? "Type to search." : "No matches."}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.heading}>
              <h3 className="px-2.5 pb-0.5 pt-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-fg-muted">
                {g.heading}
              </h3>
              {g.hits.map((hit) => {
                index += 1;
                const active = index === cursor;
                return (
                  <button
                    key={g.heading + hit.href + hit.label}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      router.push(hit.href);
                      close();
                    }}
                    className={cn(
                      "flex w-full items-baseline justify-between gap-3 rounded-(--radius-ctl) px-2.5 py-1.5 text-left",
                      active ? "bg-accent-tint text-accent" : "text-fg-secondary hover:bg-surface-subtle",
                    )}
                  >
                    <span className="truncate font-mono text-xs">{hit.label}</span>
                    <span className="truncate text-[11px] text-fg-muted">{hit.sub}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-border-faint px-3 py-2 font-mono text-[9.5px] uppercase text-fg-muted">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2b: Mouse/keyboard cursor note** — arrow keys move `cursor`; the active option is highlighted with accent-tint. The palette registers as a MODAL overlay via `useFocusTrap`, so ESC and Tab containment come from the layer stack for free.

- [ ] **Step 3: Verify live**: ⌘K (or Ctrl+K) opens it; typing `BR-LT` lists seeded assets; typing `mar` lists Marites; Enter navigates to the pending page and closes; ESC closes and returns focus; the topbar trigger button opens it too; viewer role sees asset hits (IT workspace) but a purchasing user searching people gets no /employees hits (gated).

- [ ] **Step 4: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add -A
git commit -m "feat(shell): command palette with grouped server search and keyboard flow"
```

---

### Task 13: Phase 2 e2e suite

**Files:**
- Create: `e2e/auth-shell.spec.ts`

- [ ] **Step 1: Write `e2e/auth-shell.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("auth", () => {
  test("login page passes axe", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("unauthenticated deep link redirects to login and back", async ({ page }) => {
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/login\?next=%2Femployees|\/login\?next=\/employees/);
    await page.getByLabel(/Email/).fill("it@thebackroomop.com");
    await page.getByLabel(/Password/).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/employees/);
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/Email/).fill("it@thebackroomop.com");
    await page.getByLabel(/Password/).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText(/Wrong email or password/);
  });

  test("roles land on their brief-mandated defaults", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await expect(page).toHaveURL(/\/purchases$/);
  });

  test("bootstrap 404s once users exist", async ({ page }) => {
    const res = await page.goto("/bootstrap");
    expect(res?.status()).toBe(404);
  });

  test("signed-in users are bounced off /login", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/inventory/);
  });
});

test.describe("workspace gating", () => {
  test("purchasing cannot open IT-only pages", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/purchases$/);
  });

  test("viewer is excluded from reference-data CRUD", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("navigation", { name: "Workspace" })).not.toContainText("Asset categories");
  });

  test("admin switches workspaces; the cookie sticks", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.getByRole("button", { name: /br\.dept/ }).click();
    await page.getByRole("menuitem", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/\/purchases$/);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toContainText("Procurement");
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Workspace" })).toContainText("Procurement");
  });

  test("single-workspace roles get a static label, no switcher", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await expect(page.getByText("br.dept · 1 available")).toBeVisible();
    await expect(page.getByRole("button", { name: /br\.dept/ })).toHaveCount(0);
  });
});

test.describe("shell", () => {
  test("approvals badge shows the seeded urgent count", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const badge = page.getByLabel(/open approvals/);
    await expect(badge).toContainText("3");
    await expect(badge).toHaveClass(/fault/);
  });

  test("theme survives a reload via the cookie contract", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.getByRole("button", { name: /Switch to dark/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("shell passes axe (light)", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("mobile drawer opens, traps, and closes on ESC", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, "it@thebackroomop.com");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "IT" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("command palette searches and navigates", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByRole("dialog", { name: "Command palette" }).getByLabel("Search");
    await expect(input).toBeFocused();
    await input.fill("BR-LT-0148");
    await expect(page.getByRole("option", { name: /BR-LT-0148/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory\//);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the suite** (nothing on port 3000 — Playwright manages its own server; reseed first so counts are exact)

```bash
npm run db:seed
npm run e2e
```

Expected: existing kitchen-sink 5 + new 14 = **19 passed**. Debug failures by reading test-results/ error contexts; adjust SELECTORS only if the accessible names genuinely differ — never weaken assertions.

- [ ] **Step 3: Commit**

```bash
git add e2e/auth-shell.spec.ts
git commit -m "test(e2e): auth flows, workspace gating, shell, palette, mobile drawer"
```

---

### Task 14: Full battery + push

- [ ] **Step 1: Stop any running dev server** (build and dev share .next).

- [ ] **Step 2: The battery**

```bash
npx tsc --noEmit
npm run lint
npm run test
npm run build
npm run db:seed && npm run e2e
```

All green: unit tests (Phase 1's 30 + the new auth-shared/workspaces suites), lint zero warnings, production build succeeds, 19 e2e.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin phase-2-auth-shell
```

---

## Phase completion checklist

- [ ] `npm run lint`, `npm run test`, `npm run build`, `npm run e2e` all green (19 e2e)
- [ ] Login → correct role landing for all five seeded accounts (e2e covers 2; spot-check finance@ and viewer@ manually)
- [ ] Theme/density/workspace cookies all survive reloads (the SSR contract)
- [ ] Sidebar eyeballed in all four workspaces (switch as admin), both themes, mobile drawer at 375px
- [ ] `/bootstrap` 404s; signup rejects foreign domains; disabled-user path: flip a seeded user's `disabled` in psql, confirm their session dies at the next navigation, flip back (or reseed)
- [ ] `docker compose --profile prod build` succeeds against the phase-2 tree
- [ ] Merge via superpowers:finishing-a-development-branch

**Non-goals of this phase:** real screens (inventory/purchases/etc — Phases 3+), rate limiting (Phase 3, with the RateEvent key question), Entra ID wiring (needs tenant credentials AND a signIn callback mapping profile→User; do not enable until then), employee status pills (Phase 3 with the EmploymentStatus map entries), G-then-P chords, Menu portaling.

**Security notes recorded from the Task 1 review (carry into deployment docs, Phase 8):**
- Session cookies travel in cleartext over LAN HTTP — accepted for an internal tool; document it. Set `AUTH_URL=http://<deployment-host>:3000` in the prod `.env` to remove the `trustHost` header-trust question.
- Middleware role gating reads the (up-to-8h-stale) JWT claim; `requireUser` forces re-auth on role drift, and `requireRole` re-checks per page/action — middleware is advisory, the guards are enforcement. Every server action must call a guard (layouts don't run for action POSTs).
