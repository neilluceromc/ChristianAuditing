import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { filterSectionsForRole, WORKSPACE_META, WORKSPACE_NAV } from "@/lib/workspaces";
import type { NavBadges } from "@/lib/nav-badges";
import type { NavCurrent } from "@/lib/nav-match";
import { NavTree } from "./nav-tree";
import { WorkspaceTag } from "./workspace-switcher";

// The tag's menu switches by a server action; markup tests never call it, and its module pulls in auth and the db.
vi.mock("@/server/auth/actions", () => ({ switchWorkspace: vi.fn() }));

const sections = filterSectionsForRole(WORKSPACE_NAV.it, "it_staff");
const badges: NavBadges = {
  approvals: { open: 2, overdue: 1 },
  counts: { approvals: 2, purchaseReviews: 1, itSpare: 7, worklist: 15 },
};

const render = (current: NavCurrent) =>
  renderToStaticMarkup(<NavTree sections={sections} current={current} badges={badges} />);

/** Every link in the markup: its href, its opening `<a …>` tag, and the markup up to its closing `</a>`. */
function links(html: string): Array<{ href: string; tag: string; body: string }> {
  return [...html.matchAll(/<a [^>]*>/g)].map((m) => {
    const href = (/ href="([^"]*)"/.exec(m[0])?.[1] ?? "").replace(/&amp;/g, "&");
    return { href, tag: m[0], body: html.slice(m.index, html.indexOf("</a>", m.index)) };
  });
}

/** The `nth` link (0-based) to an href. */
function link(html: string, href: string, nth = 0): { tag: string; body: string } {
  const found = links(html).filter((l) => l.href === href);
  expect(found.length, `links to ${href}`).toBeGreaterThan(nth);
  return found[nth];
}

const CHEVRON = '<polyline points="7,4 12,9 7,14">';

describe("NavTree", () => {
  describe("on Inventory › Spare", () => {
    const html = render({ item: "Inventory", view: "Spare" });

    it("shows Inventory's five views", () => {
      for (const href of [
        "/inventory",
        "/inventory?status=SPARE",
        "/inventory?status=DEFECTIVE&sort=defectiveSince",
        "/inventory?status=MISSING",
        "/inventory/register",
      ]) link(html, href);
      // the link plus its All view
      expect(links(html).filter((l) => l.href === "/inventory")).toHaveLength(2);
    });

    it("marks Spare current, with its count", () => {
      const spare = link(html, "/inventory?status=SPARE");
      expect(spare.tag).toContain('aria-current="page"');
      expect(spare.body).toContain('aria-label="7 spare"');
      expect(spare.body).toMatch(/>7</);
    });

    it("leaves the Inventory link itself without aria-current", () => {
      expect(link(html, "/inventory").tag).not.toContain("aria-current");
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    });

    it("shows no other link's views", () => {
      expect(html).not.toContain("/employees?kind=CLIENT");
      expect(html).not.toContain("/approvals?tab=mine");
    });

    it("sums Approvals and purchase reviews on the closed Approvals link", () => {
      const approvals = link(html, "/approvals");
      expect(approvals.body).toMatch(/aria-label="3 waiting:[^"]*"/);
      expect(approvals.body).toMatch(/>3</);
    });

    it("has no headings, inside the Workspace nav", () => {
      expect(html).not.toContain("<h3");
      expect(html).toMatch(/^<nav aria-label="Workspace"/);
    });

    it("draws groups as lists and the views as a list inside the current link's item", () => {
      expect(html.match(/<ul/g)).toHaveLength(sections.length + 1);
      const inventoryItem = html.slice(html.indexOf(link(html, "/inventory").tag), html.indexOf(link(html, "/employees").tag));
      expect(inventoryItem).toContain("<ul");
    });
  });

  describe("on Worklist", () => {
    const html = render({ item: "Worklist", view: null });
    it("marks the Worklist link current and opens no views", () => {
      expect(link(html, "/inventory/work").tag).toContain('aria-current="page"');
      expect(html).not.toContain("/inventory?status=SPARE");
      expect(html.match(/<ul/g)).toHaveLength(sections.length);
    });
    it("keeps its count on the current link (it has no views to carry it)", () => {
      expect(link(html, "/inventory/work").body).toContain('aria-label="15 waiting on the worklist"');
    });
  });

  describe("on Approvals › Purchase reviews", () => {
    const html = render({ item: "Approvals", view: "Purchase reviews" });
    it("hides the Approvals badge; the views carry their own counts", () => {
      const approvalsLink = link(html, "/approvals");
      expect(approvalsLink.tag).not.toContain("aria-current");
      expect(approvalsLink.body).not.toContain("aria-label");
      expect(approvalsLink.body).not.toMatch(/>3</);
      // the Open view is the second /approvals link
      const open = link(html, "/approvals", 1).body;
      expect(open).toMatch(/>2</);
      expect(open).toContain('aria-label="2 open approvals, some past SLA"');
      const reviews = link(html, "/purchases?state=SUBMITTED");
      expect(reviews.tag).toContain('aria-current="page"');
      expect(reviews.body).toMatch(/>1</);
      expect(reviews.body).toContain('aria-label="1 waiting for IT"');
    });
  });

  it("hides every chevron from assistive tech", () => {
    for (const current of [
      { item: "Inventory", view: "Spare" },
      { item: "Worklist", view: null },
      { item: null, view: null },
    ]) {
      const html = render(current);
      const chevrons = html.split("<svg").filter((s) => s.includes(CHEVRON));
      // Inventory, Employees, Approvals, Offboarding, Reservations, Reports, Activity, Setup
      expect(chevrons).toHaveLength(8);
      for (const svg of chevrons) expect(svg.slice(0, svg.indexOf(">"))).toContain('aria-hidden="true"');
    }
  });

  it("gives the links without views no chevron", () => {
    const html = render({ item: null, view: null });
    for (const href of ["/", "/inventory/work"]) expect(link(html, href).body).not.toContain(CHEVRON);
  });
});

describe("WorkspaceTag", () => {
  it("is plain text for one workspace", () => {
    const html = renderToStaticMarkup(<WorkspaceTag current="it" allowed={["it"]} meta={WORKSPACE_META} />);
    expect(html).toContain(">IT<");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("workspace");
  });

  it("is a menu button named with the workspace count for several", () => {
    const html = renderToStaticMarkup(
      <WorkspaceTag current="it" allowed={["it", "purchasing", "finance", "admin"]} meta={WORKSPACE_META} />,
    );
    const button = html.slice(html.indexOf("<button"), html.indexOf(">", html.indexOf("<button")) + 1);
    expect(button).toMatch(/aria-label="[^"]*4 workspaces[^"]*"/);
    expect(button).toContain('aria-haspopup="menu"');
    expect(html).toContain(">IT<");
  });
});
