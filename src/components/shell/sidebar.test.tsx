import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { User } from "@prisma/client";
import { filterSectionsForRole, WORKSPACE_NAV } from "@/lib/workspaces";
import type { NavBadges } from "@/lib/nav-badges";
import { Sidebar } from "./sidebar";
import { SidebarShell } from "./sidebar-collapse";

// The account menu, the nav and the workspace tag read the router; their actions pull in auth and the db.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams("status=SPARE"),
}));
vi.mock("@/server/auth/actions", () => ({ switchWorkspace: vi.fn(), signOutAction: vi.fn() }));

const user = { id: "u1", name: "Jo Santos", role: "it_staff" } as User;
const badges: NavBadges = { approvals: { open: 2, overdue: 1 }, counts: { approvals: 2, worklist: 15 } };

const render = (state: "rail" | "full") =>
  renderToStaticMarkup(
    <SidebarShell initial={state}>
      <Sidebar
        user={user}
        ws="it"
        sections={filterSectionsForRole(WORKSPACE_NAV.it, "it_staff")}
        badges={badges}
        allowed={["it"]}
        defaultCls="IT"
      />
    </SidebarShell>,
  );

/** The aside's class list, token by token. */
const asideClasses = (html: string) =>
  (/<aside aria-label="Primary" class="([^"]*)"/.exec(html)?.[1] ?? "").split(/\s+/);

describe("Sidebar stacking (Phase 45's z-scale kept)", () => {
  for (const state of ["full", "rail"] as const) {
    it(`has no unconditional z-index in the ${state} sidebar, only the raise while a rail item is hovered or focused`, () => {
      const classes = asideClasses(render(state));
      expect(classes).toContain("sticky");
      expect(classes.filter((c) => /^z-/.test(c))).toEqual([]);
      expect(classes).toContain("has-[[data-rail-item]:hover]:z-40");
      expect(classes).toContain("has-[[data-rail-item]:focus-within]:z-40");
    });
  }

  it("carries rail items only in the rail, so the full sidebar is never raised", () => {
    expect(render("full")).not.toContain('<li data-rail-item=""');
    expect(render("rail")).toContain('<li data-rail-item=""');
  });

  it("puts the collapse button above the account row", () => {
    const html = render("full");
    expect(html.indexOf('aria-label="Collapse sidebar"')).toBeGreaterThan(html.indexOf('aria-label="Workspace"'));
    expect(html.indexOf('aria-label="Collapse sidebar"')).toBeLessThan(html.indexOf('aria-label="Account menu"'));
  });
});
