import { describe, expect, it } from "vitest";
import { quickLoginUser } from "./quick-login";

const raw = "it@example.com";
const row = { id: "u1", email: "it@example.com", name: "IT", role: "it_staff" as const, disabled: false };

describe("quickLoginUser", () => {
  it("signs in a listed, active account", () => {
    expect(quickLoginUser("IT@example.com", raw, row)).toEqual({
      id: "u1", email: "it@example.com", name: "IT", role: "it_staff",
    });
  });
  it("refuses a disabled account", () => {
    expect(quickLoginUser("it@example.com", raw, { ...row, disabled: true })).toBeNull();
  });
  it("refuses a missing account", () => {
    expect(quickLoginUser("it@example.com", raw, null)).toBeNull();
  });
  it("refuses an unlisted email even if the row exists", () => {
    expect(quickLoginUser("admin@example.com", raw, { ...row, email: "admin@example.com" })).toBeNull();
  });
  it("refuses everything with the setting off", () => {
    expect(quickLoginUser("it@example.com", undefined, row)).toBeNull();
  });
  it("refuses a row whose email differs from the one asked for", () => {
    expect(quickLoginUser("it@example.com", raw, { ...row, email: "other@example.com" })).toBeNull();
  });
});
