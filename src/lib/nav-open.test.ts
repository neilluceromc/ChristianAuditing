import { describe, expect, it } from "vitest";
import { isOpen, NO_TOGGLES, navOpenKey, parseOpened, toggleOpen, type NavToggles } from "./nav-open";

describe("click to open (Phase 46 spec §4.2)", () => {
  it("keeps one session key per workspace", () => {
    expect(navOpenKey("it")).toBe("br.nav.open.it");
    expect(navOpenKey("admin")).toBe("br.nav.open.admin");
  });

  it("reads the stored labels, and anything unreadable as none", () => {
    expect(parseOpened('["Employees","Setup"]')).toEqual(["Employees", "Setup"]);
    for (const raw of [null, "", "{", '{"a":1}', "42"]) expect(parseOpened(raw)).toEqual([]);
    expect(parseOpened('["Employees",3,null]')).toEqual(["Employees"]);
  });

  it("opens the current link by itself, and nothing else", () => {
    expect(isOpen("Inventory", true, NO_TOGGLES)).toBe(true);
    expect(isOpen("Employees", false, NO_TOGGLES)).toBe(false);
  });

  it("opens and closes any other link without touching the current one", () => {
    const opened = toggleOpen(NO_TOGGLES, "Employees", false);
    expect(opened.opened).toEqual(["Employees"]);
    expect(isOpen("Employees", false, opened)).toBe(true);
    expect(isOpen("Inventory", true, opened)).toBe(true);
    const closed = toggleOpen(opened, "Employees", false);
    expect(isOpen("Employees", false, closed)).toBe(false);
    expect(closed.opened).toEqual([]);
  });

  it("closes the current link until it is toggled again, and forgets it was opened", () => {
    const start: NavToggles = { opened: ["Inventory", "Setup"], closedCurrent: null };
    const closed = toggleOpen(start, "Inventory", true);
    expect(isOpen("Inventory", true, closed)).toBe(false);
    expect(closed.opened).toEqual(["Setup"]);
    // Once another link is current, the closed one stays closed: it was never opened by the toggle.
    expect(isOpen("Inventory", false, closed)).toBe(false);
    const reopened = toggleOpen(closed, "Inventory", true);
    expect(isOpen("Inventory", true, reopened)).toBe(true);
    expect(reopened.closedCurrent).toBeNull();
  });

  it("never mutates the state it is given", () => {
    const start: NavToggles = { opened: ["Setup"], closedCurrent: null };
    toggleOpen(start, "Employees", false);
    toggleOpen(start, "Setup", false);
    expect(start).toEqual({ opened: ["Setup"], closedCurrent: null });
  });
});
