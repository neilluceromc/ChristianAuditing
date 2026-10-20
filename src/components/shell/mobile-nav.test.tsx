import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { filterSectionsForRole, WORKSPACE_NAV } from "@/lib/workspaces";
import type { NavBadges } from "@/lib/nav-badges";
import { MobileNav, PageName } from "./mobile-nav";

// The page name reads the path; the drawer's Sign out and the sidebar prefs pull in auth and the db.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/inventory",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/server/auth/actions", () => ({ switchWorkspace: vi.fn(), signOutAction: vi.fn() }));
vi.mock("@/server/ui-prefs", () => ({ saveUiPref: vi.fn(async () => null) }));

const sections = filterSectionsForRole(WORKSPACE_NAV.it, "it_staff");
const badges: NavBadges = { approvals: { open: 0, overdue: 0 }, counts: { approvals: 0, worklist: 0 } };
const meta = {
  it: { label: "IT", landing: "/inventory" },
  finance: { label: "Finance", landing: "/finance" },
  purchasing: { label: "Purchasing", landing: "/purchases" },
} as Parameters<typeof MobileNav>[0]["meta"];

describe("Phase 47: the phone top bar reads CRIS, with no BR mark", () => {
  it("PageName shows the compact CRIS mark beside the page name, and no BR logo", () => {
    const html = renderToStaticMarkup(<PageName sections={sections} workspaceLabel="IT" />);
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*font-bold[^"]*">CRIS<\/span>/);
    expect(html).not.toContain(">BR<");
    expect(html).not.toContain("Backroom IT");
  });

  it("the closed mobile nav (its menu button) carries no BR mark either", () => {
    const html = renderToStaticMarkup(
      <MobileNav
        sections={sections}
        badges={badges}
        workspaceLabel="IT"
        user={{ name: "Jo Santos", role: "it_staff" }}
        ws="it"
        allowed={["it"]}
        meta={meta}
        defaultCls="IT"
      />,
    );
    expect(html).not.toContain(">BR<");
  });
});
