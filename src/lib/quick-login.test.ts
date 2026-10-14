import { describe, expect, it } from "vitest";
import { isQuickLoginEmail, parseQuickLoginEmails } from "./quick-login";

describe("parseQuickLoginEmails", () => {
  it("is off (empty) when unset or blank", () => {
    expect(parseQuickLoginEmails(undefined)).toEqual([]);
    expect(parseQuickLoginEmails("")).toEqual([]);
    expect(parseQuickLoginEmails(" , ,")).toEqual([]);
  });
  it("trims, lowercases and keeps the listed order", () => {
    expect(parseQuickLoginEmails(" IT@Example.com, finance@example.com ")).toEqual([
      "it@example.com",
      "finance@example.com",
    ]);
  });
  it("drops duplicates and entries that are not emails", () => {
    expect(parseQuickLoginEmails("a@b.co,A@B.co,nope,c@d.co")).toEqual(["a@b.co", "c@d.co"]);
  });
});

describe("isQuickLoginEmail", () => {
  const raw = "it@example.com,admin@example.com";
  it("accepts a listed email in any case", () => {
    expect(isQuickLoginEmail(" Admin@Example.com", raw)).toBe(true);
  });
  it("refuses an unlisted email", () => {
    expect(isQuickLoginEmail("finance@example.com", raw)).toBe(false);
  });
  it("refuses everything when the setting is off", () => {
    expect(isQuickLoginEmail("it@example.com", undefined)).toBe(false);
    expect(isQuickLoginEmail("", "")).toBe(false);
  });
});
