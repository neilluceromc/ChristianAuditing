import { describe, expect, it } from "vitest";
import {
  cleanUiPatch, needsUiRestore, parseUiPrefs, UI_PREF_COOKIE_OPTIONS, UI_PREFS_DEFAULTS, UI_PREFS_KEY, uiPrefCookies,
  type UiPrefs,
} from "./ui-prefs";

const SAVED: UiPrefs = { theme: "dark", density: "dense", sidebar: "rail", focus: true, workspace: "finance" };

describe("UI_PREFS_KEY (spec §5.4)", () => {
  it("is the UserPreference key ui:prefs", () => {
    expect(UI_PREFS_KEY).toBe("ui:prefs");
  });
});

describe("parseUiPrefs", () => {
  it("defaults everything on missing or bad input", () => {
    const defaults = { theme: "light", density: "comfortable", sidebar: "full", focus: false, workspace: null };
    expect(UI_PREFS_DEFAULTS).toEqual(defaults);
    for (const v of [undefined, null, "dark", 3, [], true]) expect(parseUiPrefs(v)).toEqual(defaults);
  });

  it("round-trips a saved value", () => {
    expect(parseUiPrefs(SAVED)).toEqual(SAVED);
    expect(parseUiPrefs(JSON.parse(JSON.stringify(SAVED)))).toEqual(SAVED);
  });

  it("defaults only the field that is bad", () => {
    expect(parseUiPrefs({ ...SAVED, theme: "purple" })).toEqual({ ...SAVED, theme: "light" });
    expect(parseUiPrefs({ ...SAVED, density: "tiny" })).toEqual({ ...SAVED, density: "comfortable" });
    expect(parseUiPrefs({ ...SAVED, sidebar: "collapsed" })).toEqual({ ...SAVED, sidebar: "full" });
    expect(parseUiPrefs({ ...SAVED, focus: "on" })).toEqual({ ...SAVED, focus: false });
    expect(parseUiPrefs({ ...SAVED, workspace: "hr" })).toEqual({ ...SAVED, workspace: null });
  });

  it("keeps every known workspace", () => {
    for (const ws of ["it", "purchasing", "finance", "admin"] as const) expect(parseUiPrefs({ workspace: ws }).workspace).toBe(ws);
  });
});

describe("cleanUiPatch", () => {
  it("keeps the valid fields only, never inventing the rest", () => {
    expect(cleanUiPatch({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(cleanUiPatch({ theme: "neon", density: "compact", focus: "yes", sidebar: "rail", junk: 1 })).toEqual({
      density: "compact", sidebar: "rail",
    });
    expect(cleanUiPatch({ workspace: "admin", focus: false })).toEqual({ workspace: "admin", focus: false });
    expect(cleanUiPatch(null)).toEqual({});
    expect(cleanUiPatch("dark")).toEqual({});
  });
});

describe("uiPrefCookies (Review Focus #4)", () => {
  it("names all six cookies, with the person's values and whose they are", () => {
    expect(uiPrefCookies(SAVED, "u1")).toEqual([
      { name: "br.theme", value: "dark" },
      { name: "br.density", value: "dense" },
      { name: "br.sidebar", value: "rail" },
      { name: "br.focus", value: "on" },
      { name: "br.dept", value: "finance" },
      { name: "br.uid", value: "u1" },
    ]);
  });

  it("writes the defaults for someone with nothing saved: an empty br.dept means the role's first workspace", () => {
    expect(uiPrefCookies(UI_PREFS_DEFAULTS, "u2")).toEqual([
      { name: "br.theme", value: "light" },
      { name: "br.density", value: "comfortable" },
      { name: "br.sidebar", value: "full" },
      { name: "br.focus", value: "off" },
      { name: "br.dept", value: "" },
      { name: "br.uid", value: "u2" },
    ]);
  });

  it("uses the existing cookie shape: one year, site-wide, lax, readable by the toggles", () => {
    expect(UI_PREF_COOKIE_OPTIONS).toEqual({ path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: false });
  });
});

describe("needsUiRestore", () => {
  it("is true when the browser holds no one's or someone else's settings", () => {
    expect(needsUiRestore("u1", undefined)).toBe(true);
    expect(needsUiRestore("u1", "")).toBe(true);
    expect(needsUiRestore("u1", "u2")).toBe(true);
    expect(needsUiRestore("u1", "u1")).toBe(false);
  });
});
