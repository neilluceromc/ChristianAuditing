import { describe, expect, it } from "vitest";
import { navLabelFor, workspaceCountLabel } from "./shell";
import type { NavSection } from "./workspaces";

const SECTIONS: NavSection[] = [
  { heading: "Overview", items: [{ label: "Home", href: "/" }] },
  {
    heading: "Tracking",
    items: [
      { label: "Inventory", href: "/inventory" },
      { label: "Register assets", href: "/inventory/register" },
      { label: "Worklist", href: "/inventory/work" },
      { label: "Purchase reviews", href: "/purchases?state=SUBMITTED" },
    ],
  },
];

describe("navLabelFor (the phone top bar's page name)", () => {
  it("names an exact nav path", () => {
    expect(navLabelFor("/inventory", SECTIONS)).toBe("Inventory");
    expect(navLabelFor("/inventory/work", SECTIONS)).toBe("Worklist");
  });

  it("names a record by its section — the longest matching prefix wins", () => {
    expect(navLabelFor("/inventory/abc123/history", SECTIONS)).toBe("Inventory");
    expect(navLabelFor("/inventory/register/x", SECTIONS)).toBe("Register assets");
  });

  it("matches Home only on the root itself", () => {
    expect(navLabelFor("/", SECTIONS)).toBe("Home");
    expect(navLabelFor("/reports", SECTIONS)).toBeNull();
  });

  it("ignores an item's query string when matching the path", () => {
    expect(navLabelFor("/purchases", SECTIONS)).toBe("Purchase reviews");
  });

  it("never matches a sibling path that merely shares a prefix", () => {
    expect(navLabelFor("/inventoryx", SECTIONS)).toBeNull();
  });
});

describe("workspaceCountLabel (spec §3: the switcher reads \"{n} workspaces\", never the cookie name)", () => {
  it("counts the workspaces", () => {
    expect(workspaceCountLabel(4)).toBe("4 workspaces");
    expect(workspaceCountLabel(2)).toBe("2 workspaces");
  });
  it("reads singular for one", () => {
    expect(workspaceCountLabel(1)).toBe("1 workspace");
  });
});
