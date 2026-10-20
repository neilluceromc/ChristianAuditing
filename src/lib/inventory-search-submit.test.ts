import { describe, expect, it, vi } from "vitest";
import { inventorySearchSubmit } from "./inventory-search-submit";

/*
 * Task 6 review I1 / I3 (spec §7.2): Inventory's search box. Typing filters with router.replace. Enter asks the server
 * for an exact tag (the USB scanner contract) and, on a hit, PUSHES the record — so Back returns to the list and no
 * same-page `go=1` navigation is involved; on a miss it is the ordinary live search.
 */

function deps(hit: { id: string } | null | Error, current = true) {
  return {
    listHref: "/inventory?q=BR-LT-0148",
    find: vi.fn(async () => {
      if (hit instanceof Error) throw hit;
      return hit;
    }),
    push: vi.fn(),
    replace: vi.fn(),
    stillCurrent: vi.fn(() => current),
  };
}

describe("inventorySearchSubmit", () => {
  it("typing (and pasting) a full tag only filters, with replace; nothing is looked up", async () => {
    const d = deps({ id: "a148" });
    await inventorySearchSubmit("BR-LT-0148", { enter: false }, d);
    expect(d.replace).toHaveBeenCalledExactlyOnceWith("/inventory?q=BR-LT-0148");
    expect(d.find).not.toHaveBeenCalled();
    expect(d.push).not.toHaveBeenCalled();
  });
  it("Enter on an exact tag pushes the record (Back returns to the list), and does not touch the list URL", async () => {
    const d = deps({ id: "a148" });
    await inventorySearchSubmit("BR-LT-0148", { enter: true }, d);
    expect(d.find).toHaveBeenCalledExactlyOnceWith("BR-LT-0148");
    expect(d.push).toHaveBeenCalledExactlyOnceWith("/inventory/a148");
    expect(d.replace).not.toHaveBeenCalled();
  });
  it("Enter with no exact tag is the ordinary live search (replace, no go=1)", async () => {
    const d = deps(null);
    await inventorySearchSubmit("Carlo", { enter: true }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.replace).toHaveBeenCalledExactlyOnceWith("/inventory?q=BR-LT-0148");
    expect(d.replace.mock.calls[0][0]).not.toContain("go=");
  });
  it("Enter on an empty box just clears, with nothing looked up", async () => {
    const d = deps({ id: "x" });
    await inventorySearchSubmit("  ", { enter: true }, d);
    expect(d.find).not.toHaveBeenCalled();
    expect(d.replace).toHaveBeenCalledOnce();
  });
  it("a lookup that fails falls back to the live search", async () => {
    const d = deps(new Error("offline"));
    await inventorySearchSubmit("BR-LT-0148", { enter: true }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.replace).toHaveBeenCalledOnce();
  });
  it("does nothing when a newer search started while the lookup ran", async () => {
    const d = deps({ id: "a148" }, false);
    await inventorySearchSubmit("BR-LT-0148", { enter: true }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.replace).not.toHaveBeenCalled();
  });
});
