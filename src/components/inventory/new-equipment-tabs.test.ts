import { describe, expect, it } from "vitest";
import { registerLink } from "./new-equipment-tabs";

describe("registerLink (Task 5)", () => {
  it("a role with the direct Register goes there, with the class it came from", () => {
    expect(registerLink(true, "IT")).toEqual({ label: "Register", href: "/inventory/register" });
    expect(registerLink(true, "PURCHASING")).toEqual({ label: "Register", href: "/inventory/register?cls=PURCHASING" });
  });
  it("Purchasing goes to every purchase order — a mixed PO it can register from may still be WITH_IT", () => {
    expect(registerLink(false, "PURCHASING")).toEqual({ label: "Register from a PO", href: "/purchases" });
  });
});
