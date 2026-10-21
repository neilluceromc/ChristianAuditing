import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { filterSectionsForRole, WORKSPACE_META, WORKSPACE_NAV } from "@/lib/workspaces";
import type { NavBadges } from "@/lib/nav-badges";
import type { NavCurrent } from "@/lib/nav-match";
import { NavRail, pillText, viewsHint } from "./nav-rail";
import { SidebarCollapseButton, SidebarShell, SidebarVariant } from "./sidebar-collapse";
import { WorkspaceTag } from "./workspace-switcher";

// The tag's menu switches by a server action; markup tests never call it, and its module pulls in auth and the db.
vi.mock("@/server/auth/actions", () => ({ switchWorkspace: vi.fn() }));
// The collapse toggle saves to the person's prefs by a server action (Phase 47); same reason.
vi.mock("@/server/ui-prefs", () => ({ saveUiPref: vi.fn(async () => null) }));

const sections = filterSectionsForRole(WORKSPACE_NAV.it, "it_staff");
const items = sections.flatMap((s) => s.items);
const badges: NavBadges = {
  approvals: { open: 2, overdue: 1 },
  counts: { approvals: 2, poWithIt: 1, itSpare: 7, worklist: 15 },
};

const render = (current: NavCurrent, b: NavBadges = badges) =>
  renderToStaticMarkup(<NavRail sections={sections} current={current} badges={b} />);

/** Every rail item: its `<li …>` markup, split at the next top-level item. */
function railItems(html: string): string[] {
  return html.split('<li data-rail-item=""').slice(1);
}

/** The rail item whose icon links to `href`. */
function item(html: string, href: string): { icon: string; body: string; fly: string } {
  const body = railItems(html).find((li) => iconTag(li).includes(`href="${href}"`));
  expect(body, `rail item for ${href}`).toBeDefined();
  const fly = body!.slice(body!.indexOf("data-rail-flyout"));
  return { icon: iconTag(body!), body: body!, fly };
}

/** The item's icon link: the first `<a …>` in it. */
const iconTag = (li: string) => /<a [^>]*>/.exec(li)?.[0] ?? "";

/** The icon link's markup up to its `</a>`. */
const iconBody = (li: string) => li.slice(li.indexOf("<a "), li.indexOf("</a>"));

const CHEVRON = '<polyline points="7,4 12,9 7,14">';

describe("NavRail", () => {
  describe("on Inventory › Spare", () => {
    const html = render({ item: "Inventory", view: "Spare" });

    it("is the Workspace nav, one icon link per visible link", () => {
      expect(html).toMatch(/^<nav aria-label="Workspace"/);
      expect(railItems(html)).toHaveLength(items.length);
    });

    it("gives every icon an accessible name: its label, plus its badge's words", () => {
      for (const it of items) {
        const icon = item(html, it.href).icon;
        expect(icon).toMatch(new RegExp(`aria-label="${it.label}(, [^"]+)?"`));
      }
      expect(item(html, "/inventory/work").icon).toContain('aria-label="Worklist, 15 waiting on the worklist"');
      expect(item(html, "/approvals").icon).toContain('aria-label="Approvals, 2 open approvals, some past SLA"');
      expect(item(html, "/purchases?state=WITH_IT").icon).toContain('aria-label="Purchase orders, 1 with IT"');
    });

    it("draws icons only: no visible label inside the icon link, no chevron", () => {
      for (const it of items) {
        const body = iconBody(item(html, it.href).body);
        expect(body).not.toContain(`>${it.label}<`);
        expect(body).toContain("<svg");
      }
      expect(html).not.toContain(CHEVRON);
    });

    it("marks Inventory's icon as the current link, and Spare in its flyout as the page", () => {
      const inv = item(html, "/inventory");
      expect(inv.icon).toContain('aria-current="true"');
      expect(inv.icon).toContain("data-nav-current");
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      const spare = /<a [^>]*href="\/inventory\?status=SPARE"[^>]*>/.exec(inv.fly)?.[0] ?? "";
      expect(spare).toContain('aria-current="page"');
    });

    it("puts the link's name and its views, with counts, in the flyout as links", () => {
      const inv = item(html, "/inventory");
      expect(inv.fly).toContain(">Inventory</p>");
      expect(inv.fly).toContain('<ul aria-label="Inventory views"');
      for (const href of [
        "/inventory",
        "/inventory?status=SPARE",
        "/inventory?status=DEFECTIVE&amp;sort=defectiveSince",
        "/inventory?status=MISSING",
        "/inventory/register",
      ]) expect(inv.fly).toContain(`href="${href}"`);
      expect(inv.fly).toContain('aria-label="7 spare"');
      // every view of every link, not only the current one's
      expect(item(html, "/employees").fly).toContain('href="/employees?kind=CLIENT"');
      expect(item(html, "/approvals").fly).toContain('href="/approvals?tab=mine"');
    });

    it("shows a link with no views by name alone in its flyout", () => {
      const work = item(html, "/inventory/work");
      expect(work.fly).toContain(">Worklist</p>");
      expect(work.fly).not.toContain("<ul");
      expect(work.fly).not.toContain("<a ");
    });

    it("describes an icon with views by their number, so a screen reader knows a list follows", () => {
      expect(viewsHint(1)).toBe("Has 1 view");
      for (const it of items) {
        const { icon, body } = item(html, it.href);
        if (it.views.length === 0) {
          expect(icon).not.toContain("aria-describedby");
          continue;
        }
        const id = / aria-describedby="([^"]+)"/.exec(icon)?.[1];
        expect(id, `${it.label} has a description`).toBeDefined();
        expect(body).toContain(`<span id="${id}" hidden="">Has ${it.views.length} view${it.views.length === 1 ? "" : "s"}</span>`);
      }
      // Task 7: All, Spare, Repairs, Missing, Sent back, Register assets
      expect(item(html, "/inventory").body).toContain(">Has 6 views</span>");
    });

    it("hides every flyout until hover or focus, and its title from assistive tech", () => {
      for (const li of railItems(html)) {
        const fly = /<div [^>]*data-rail-flyout[^>]*>/.exec(li)?.[0] ?? "";
        expect(fly).toMatch(/class="[^"]*\bfixed\b[^"]*\bhidden\b[^"]*group-focus-within\/fly:block[^"]*group-hover\/fly:block/);
        expect(li).toMatch(/<p aria-hidden="true"/);
      }
    });
  });

  describe("badges as corner pills", () => {
    const html = render({ item: "Inventory", view: "Spare" });

    it("puts a red pill on the Approvals icon while any approval is past SLA", () => {
      const pill = /<span aria-hidden="true" data-rail-pill="fault"[^>]*>([^<]*)</.exec(iconBody(item(html, "/approvals").body));
      expect(pill?.[1]).toBe("2");
      expect(pill?.[0]).toContain("bg-[var(--st-fault-dot)]");
    });

    it("puts a neutral pill on the Worklist icon", () => {
      const pill = /<span aria-hidden="true" data-rail-pill="count"[^>]*>([^<]*)</.exec(iconBody(item(html, "/inventory/work").body));
      expect(pill?.[1]).toBe("15");
      expect(pill?.[0]).toContain("bg-[var(--st-neutral-bg)]");
    });

    it("draws no pill for a link with nothing waiting", () => {
      expect(iconBody(item(html, "/employees").body)).not.toContain("data-rail-pill");
      const calm = render({ item: null, view: null }, { approvals: { open: 0, overdue: 0 }, counts: {} });
      expect(calm).not.toContain("data-rail-pill");
    });

    it("keeps the pill neutral when nothing is overdue", () => {
      const ok = render({ item: null, view: null }, { approvals: { open: 4, overdue: 0 }, counts: { approvals: 4 } });
      expect(iconBody(item(ok, "/approvals").body)).toContain('data-rail-pill="count"');
    });

    it("keeps the current link's own badge (its views are out of sight)", () => {
      const onApprovals = render({ item: "Approvals", view: "Open" });
      expect(iconBody(item(onApprovals, "/approvals").body)).toContain('data-rail-pill="fault"');
    });

    it("caps the pill at 99+, the name keeping the exact count", () => {
      expect(pillText(7)).toBe("7");
      expect(pillText(99)).toBe("99");
      expect(pillText(100)).toBe("99+");
      const busy = render({ item: null, view: null }, { ...badges, counts: { ...badges.counts, worklist: 150 } });
      const work = item(busy, "/inventory/work");
      expect(work.icon).toContain('aria-label="Worklist, 150 waiting on the worklist"');
      expect(iconBody(work.body)).toMatch(/data-rail-pill="count"[^>]*>99\+</);
    });
  });

  it("marks a link with no views as the page itself", () => {
    const html = render({ item: "Worklist", view: null });
    expect(item(html, "/inventory/work").icon).toContain('aria-current="page"');
    expect(html.match(/aria-current=/g)).toHaveLength(1);
  });
});

describe("SidebarShell and the collapse control", () => {
  const shell = (initial: "rail" | "full") =>
    renderToStaticMarkup(
      <SidebarShell initial={initial}>
        <SidebarVariant full={<i>full brand</i>} rail={<i>rail brand</i>} />
        <SidebarCollapseButton />
      </SidebarShell>,
    );

  it("starts from the cookie's state on the shell element, for the first paint", () => {
    expect(shell("full")).toMatch(/^<div data-sidebar="full" class="group\/shell flex min-h-screen">/);
    expect(shell("rail")).toMatch(/^<div data-sidebar="rail" class="group\/shell flex min-h-screen">/);
  });

  it("never animates the first paint: no animation attribute on the shell", () => {
    expect(shell("full")).not.toContain("data-sidebar-anim");
    expect(shell("rail")).not.toContain("data-sidebar-anim");
  });

  it("mounts only the rendering in use", () => {
    expect(shell("full")).toContain("full brand");
    expect(shell("full")).not.toContain("rail brand");
    expect(shell("rail")).toContain("rail brand");
    expect(shell("rail")).not.toContain("full brand");
  });

  it("reads Collapse sidebar with its [ key in the full sidebar, and Expand sidebar as an icon in the rail", () => {
    const full = shell("full");
    expect(full).toContain('aria-label="Collapse sidebar"');
    expect(full).toContain('aria-keyshortcuts="["');
    expect(full).toContain("<span>Collapse sidebar</span>");
    expect(full).toMatch(/<kbd[^>]*>\[<\/kbd>/);
    const rail = shell("rail");
    expect(rail).toContain('aria-label="Expand sidebar"');
    expect(rail).not.toContain("<span>Collapse sidebar</span>");
    expect(rail).not.toContain("<kbd");
  });
});

describe("WorkspaceTag in the rail (variant logo)", () => {
  // Phase 47 spec §5.3: the BR mark is gone; the rail's mark is the compact "CRIS" text.
  it("is the plain CRIS mark for one workspace", () => {
    const html = renderToStaticMarkup(<WorkspaceTag current="it" allowed={["it"]} meta={WORKSPACE_META} variant="logo" />);
    expect(html).toMatch(/<span class="[^"]*text-\[11px\][^"]*font-bold[^"]*">CRIS<\/span>/);
    expect(html).not.toContain(">BR<");
    expect(html).not.toContain("<button");
  });

  it("is the CRIS mark as the workspace menu button, with the same name, for several", () => {
    const html = renderToStaticMarkup(
      <WorkspaceTag current="it" allowed={["it", "purchasing", "finance", "admin"]} meta={WORKSPACE_META} variant="logo" />,
    );
    const button = html.slice(html.indexOf("<button"), html.indexOf(">", html.indexOf("<button")) + 1);
    expect(button).toContain('aria-label="Switch workspace — IT, 4 workspaces"');
    expect(button).toContain('aria-haspopup="menu"');
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*text-\[11px\][^"]*font-bold[^"]*">CRIS<\/span>/);
    expect(html).not.toContain(">BR<");
  });
});
