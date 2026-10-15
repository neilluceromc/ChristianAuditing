import { describe, expect, it } from "vitest";
import { categoryIcon, categoryModelExample, categoryNoun, categorySerialCopy, orderCategories } from "./register-catalog";

describe("orderCategories", () => {
  it("IT in the spec order, unknown IT names after by name, Uncategorised dropped", () => {
    const names = orderCategories([
      { name: "Other", cls: "IT" as const }, { name: "Zebra printer", cls: "IT" as const }, { name: "Laptop", cls: "IT" as const },
      { name: "Uncategorised", cls: "IT" as const }, { name: "Mouse", cls: "IT" as const }, { name: "Workstation (PC)", cls: "IT" as const },
    ]).map((c) => c.name);
    expect(names).toEqual(["Laptop", "Workstation (PC)", "Mouse", "Other", "Zebra printer"]);
  });
  it("Keyboard, Webcam, UPS and Windows License follow Mouse; Laptop Bag and Other close the list", () => {
    const names = orderCategories(
      ["Other", "Windows License", "UPS", "Webcam", "Laptop Bag", "Keyboard", "Mouse"].map((name) => ({ name, cls: "IT" as const })),
    ).map((c) => c.name);
    expect(names).toEqual(["Mouse", "Keyboard", "Webcam", "UPS", "Windows License", "Laptop Bag", "Other"]);
  });
  it("Purchasing by name", () => {
    expect(orderCategories([{ name: "Vehicle", cls: "PURCHASING" as const }, { name: "Building", cls: "PURCHASING" as const }]).map((c) => c.name))
      .toEqual(["Building", "Vehicle"]);
  });
});

describe("categoryNoun", () => {
  it.each([
    ["Laptop", 1, "laptop"], ["Laptop", 3, "laptops"], ["Mouse", 2, "mice"], ["Windows License", 1, "Windows license"], ["Windows License", 2, "Windows licenses"],
    ["Workstation (PC)", 1, "workstation"], ["Other", 4, "items"], ["Furniture", 2, "pieces of furniture"],
    ["Zebra printer", 2, "zebra printers"], ["UPS", 1, "UPS"], ["UPS", 3, "UPS units"], ["Keyboard", 2, "keyboards"], ["Webcam", 2, "webcams"],
  ])("%s × %i → %s", (name, n, noun) => {
    expect(categoryNoun(name as string, n as number)).toBe(noun);
  });
});

describe("categoryIcon", () => {
  it("known names map; unknown falls back to the generic box", () => {
    expect(categoryIcon("Laptop Bag")).toBe("bag");
    expect(categoryIcon("Zebra printer")).toBe("inventory");
    expect([categoryIcon("Keyboard"), categoryIcon("Webcam"), categoryIcon("UPS"), categoryIcon("Windows License")]).toEqual(["keyboard", "webcam", "ups", "license"]);
  });
});

describe("categoryModelExample", () => {
  it("each IT card has its own example; an unknown category says Model name; Purchasing keeps its class example", () => {
    expect(categoryModelExample("Laptop", "IT")).toBe("ThinkPad T14 Gen 4");
    expect(categoryModelExample("Monitor", "IT")).toBe("Dell P2422H");
    expect(categoryModelExample("Webcam", "IT")).toBe("Logitech C920");
    expect(categoryModelExample("UPS", "IT")).toBe("APC Back-UPS 650");
    expect(categoryModelExample("Windows License", "IT")).toBe("Windows 11 Pro");
    expect(categoryModelExample("Zebra printer", "IT")).toBe("Model name");
    expect(categoryModelExample(null, "IT")).toBe("Model name");
    expect(categoryModelExample("Vehicle", "PURCHASING")).toBe("Toyota Vios 1.3 E");
  });
});

describe("categorySerialCopy", () => {
  it("Windows License asks for the licence / COA number and points at Secrets; others keep the serial wording", () => {
    expect(categorySerialCopy("Windows License")).toEqual({
      label: "Licence / COA no.",
      hint: "Required. The licence or COA sticker number. Add the product key on the record's Secrets after registering.",
    });
    expect(categorySerialCopy("Laptop")).toEqual({
      label: "Serial number",
      hint: "Required. It’s on the box label or the sticker under the device.",
    });
  });
});
