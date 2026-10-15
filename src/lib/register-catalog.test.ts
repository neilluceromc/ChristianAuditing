import { describe, expect, it } from "vitest";
import { categoryIcon, categoryNoun, orderCategories } from "./register-catalog";

describe("orderCategories", () => {
  it("IT in the spec order, unknown IT names after by name, Uncategorised dropped", () => {
    const names = orderCategories([
      { name: "Other", cls: "IT" as const }, { name: "Zebra printer", cls: "IT" as const }, { name: "Laptop", cls: "IT" as const },
      { name: "Uncategorised", cls: "IT" as const }, { name: "Mouse", cls: "IT" as const }, { name: "Workstation (PC)", cls: "IT" as const },
    ]).map((c) => c.name);
    expect(names).toEqual(["Laptop", "Workstation (PC)", "Mouse", "Other", "Zebra printer"]);
  });
  it("Keyboard and Webcam follow Mouse; UPS follows Docking Station", () => {
    const names = orderCategories(
      ["Other", "UPS", "Webcam", "Laptop Bag", "Keyboard", "Docking Station", "Mouse", "Type C Hub"].map((name) => ({ name, cls: "IT" as const })),
    ).map((c) => c.name);
    expect(names).toEqual(["Mouse", "Keyboard", "Webcam", "Type C Hub", "Docking Station", "UPS", "Laptop Bag", "Other"]);
  });
  it("Purchasing by name", () => {
    expect(orderCategories([{ name: "Vehicle", cls: "PURCHASING" as const }, { name: "Building", cls: "PURCHASING" as const }]).map((c) => c.name))
      .toEqual(["Building", "Vehicle"]);
  });
});

describe("categoryNoun", () => {
  it.each([
    ["Laptop", 1, "laptop"], ["Laptop", 3, "laptops"], ["Mouse", 2, "mice"], ["Docking Station", 2, "docking stations"],
    ["Workstation (PC)", 1, "workstation"], ["Other", 4, "items"], ["Type C Hub", 2, "Type C hubs"], ["Furniture", 2, "pieces of furniture"],
    ["Zebra printer", 2, "zebra printers"], ["UPS", 1, "UPS"], ["UPS", 3, "UPS units"], ["Keyboard", 2, "keyboards"], ["Webcam", 2, "webcams"],
  ])("%s × %i → %s", (name, n, noun) => {
    expect(categoryNoun(name as string, n as number)).toBe(noun);
  });
});

describe("categoryIcon", () => {
  it("known names map; unknown falls back to the generic box", () => {
    expect(categoryIcon("Laptop Bag")).toBe("bag");
    expect(categoryIcon("Zebra printer")).toBe("inventory");
    expect([categoryIcon("Keyboard"), categoryIcon("Webcam"), categoryIcon("UPS")]).toEqual(["keyboard", "webcam", "ups"]);
  });
});
