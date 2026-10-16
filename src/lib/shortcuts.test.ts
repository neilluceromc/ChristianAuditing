import { describe, expect, it } from "vitest";
import { isMacPlatform, paletteShortcutOpens, searchShortcutLabel, slashFocusesSearch, type SlashKey } from "./shortcuts";

describe("searchShortcutLabel (spec §2.3 / §4: Ctrl K, or ⌘K on Mac)", () => {
  it("reads ⌘K on Apple platforms", () => {
    for (const p of ["MacIntel", "macOS", "iPhone", "iPad", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)"]) {
      expect(isMacPlatform(p)).toBe(true);
      expect(searchShortcutLabel(p)).toBe("⌘K");
    }
  });

  it("reads Ctrl K everywhere else, and when the platform is unknown", () => {
    for (const p of ["Win32", "Windows", "Linux x86_64", "Android", ""]) {
      expect(isMacPlatform(p)).toBe(false);
      expect(searchShortcutLabel(p)).toBe("Ctrl K");
    }
  });
});

const base: SlashKey = {
  key: "/", ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false,
  targetTag: "BODY", targetType: null, targetEditable: false, overlayOpen: false, targetInOverlay: false,
};

describe("slashFocusesSearch (spec §2.3: \"/\" focuses the page's search box, never while typing)", () => {
  it("takes a bare / pressed outside any field", () => {
    expect(slashFocusesSearch(base)).toBe(true);
    expect(slashFocusesSearch({ ...base, targetTag: "BUTTON" })).toBe(true);
    expect(slashFocusesSearch({ ...base, targetTag: "A" })).toBe(true);
  });

  it("ignores any other key", () => {
    expect(slashFocusesSearch({ ...base, key: "?" })).toBe(false);
    expect(slashFocusesSearch({ ...base, key: "k" })).toBe(false);
  });

  it("ignores / with a modifier held", () => {
    expect(slashFocusesSearch({ ...base, ctrlKey: true })).toBe(false);
    expect(slashFocusesSearch({ ...base, metaKey: true })).toBe(false);
    expect(slashFocusesSearch({ ...base, altKey: true })).toBe(false);
  });

  it("ignores / while typing in a field", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(slashFocusesSearch({ ...base, targetTag: tag, targetType: tag === "INPUT" ? "text" : null })).toBe(false);
    }
    expect(slashFocusesSearch({ ...base, targetTag: "DIV", targetEditable: true })).toBe(false);
  });

  it("ignores / on any input, even a checkbox", () => {
    expect(slashFocusesSearch({ ...base, targetTag: "INPUT", targetType: "checkbox" })).toBe(false);
  });

  it("ignores / while a dialog, drawer, palette, menu or popup is open (review I1, M2)", () => {
    expect(slashFocusesSearch({ ...base, overlayOpen: true })).toBe(false);
    expect(slashFocusesSearch({ ...base, targetTag: "BUTTON", overlayOpen: true })).toBe(false);
  });

  it("ignores / pressed inside a dialog, menu or listbox", () => {
    expect(slashFocusesSearch({ ...base, targetTag: "BUTTON", targetInOverlay: true })).toBe(false);
    expect(slashFocusesSearch({ ...base, targetTag: "DIV", targetInOverlay: true })).toBe(false);
  });

  it("ignores / that something else already handled", () => {
    expect(slashFocusesSearch({ ...base, defaultPrevented: true })).toBe(false);
  });
});

describe("paletteShortcutOpens — Ctrl K / ⌘K opens the palette, never under another modal (final review M1)", () => {
  const press = (over: Partial<Parameters<typeof paletteShortcutOpens>[0]> = {}) =>
    paletteShortcutOpens({ key: "k", ctrlKey: true, metaKey: false, otherModalOpen: false, ...over });
  it("opens on Ctrl K or ⌘K, either case", () => {
    expect(press()).toBe(true);
    expect(press({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(press({ key: "K" })).toBe(true);
  });
  it("does nothing for a bare K or another key", () => {
    expect(press({ ctrlKey: false })).toBe(false);
    expect(press({ key: "j" })).toBe(false);
  });
  it("does nothing while a dialog or drawer other than the palette is open", () => {
    expect(press({ otherModalOpen: true })).toBe(false);
    expect(press({ metaKey: true, ctrlKey: false, otherModalOpen: true })).toBe(false);
  });
});
