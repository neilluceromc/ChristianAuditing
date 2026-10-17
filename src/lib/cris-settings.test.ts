import { describe, expect, it } from "vitest";
import {
  CRIS_DEFAULTS, crisAvailabilityFrom, crisFlagValue, crisSettingsFromFlag, crisSettingsSchema, hasCris, parseCrisSettings,
} from "./cris-settings";

describe("hasCris (spec §2: only admin and it_staff)", () => {
  it("is true for admin and it_staff only", () => {
    expect(hasCris("admin")).toBe(true);
    expect(hasCris("it_staff")).toBe(true);
    for (const r of ["viewer", "purchasing_staff", "finance_staff"] as const) expect(hasCris(r)).toBe(false);
  });
});

describe("parseCrisSettings (spec §9)", () => {
  it("garbage falls back to the defaults", () => {
    for (const junk of [null, undefined, "x", 42, [], { on: "yes", dailyLimit: "lots", model: "gpt-4" }]) {
      expect(parseCrisSettings(junk)).toEqual(CRIS_DEFAULTS);
    }
  });
  it("the defaults are on, 100 a day, Haiku", () => {
    expect(CRIS_DEFAULTS).toEqual({ on: true, dailyLimit: 100, model: "claude-haiku-5-5" });
  });
  it("falls back field by field", () => {
    expect(parseCrisSettings({ on: false, model: "nope" })).toEqual({ on: false, dailyLimit: 100, model: "claude-haiku-5-5" });
    expect(parseCrisSettings({ dailyLimit: 40, model: "claude-opus-5-5" })).toEqual({ on: true, dailyLimit: 40, model: "claude-opus-5-5" });
  });
  it("clamps dailyLimit to 1–1000", () => {
    expect(parseCrisSettings({ dailyLimit: 0 }).dailyLimit).toBe(1);
    expect(parseCrisSettings({ dailyLimit: -5 }).dailyLimit).toBe(1);
    expect(parseCrisSettings({ dailyLimit: 5000 }).dailyLimit).toBe(1000);
    expect(parseCrisSettings({ dailyLimit: 12.6 }).dailyLimit).toBe(13);
    expect(parseCrisSettings({ dailyLimit: Number.NaN }).dailyLimit).toBe(100);
    expect(parseCrisSettings({ dailyLimit: Number.POSITIVE_INFINITY }).dailyLimit).toBe(100);
  });
});

describe("the cris FeatureFlag row", () => {
  it("enabled is the switch and value holds the rest", () => {
    expect(crisSettingsFromFlag({ enabled: false, value: { dailyLimit: 30, model: "claude-sonnet-5-5" } }))
      .toEqual({ on: false, dailyLimit: 30, model: "claude-sonnet-5-5" });
  });
  it("a stray `on` inside value never overrides the enabled column", () => {
    expect(crisSettingsFromFlag({ enabled: false, value: { on: true } }).on).toBe(false);
  });
  it("a missing or non-object value falls back to the defaults", () => {
    expect(crisSettingsFromFlag({ enabled: true, value: null })).toEqual(CRIS_DEFAULTS);
    expect(crisSettingsFromFlag({ enabled: true, value: "example.com" })).toEqual(CRIS_DEFAULTS);
  });
  it("crisFlagValue round-trips", () => {
    const s = { on: true, dailyLimit: 7, model: "claude-opus-5-5" as const };
    expect(crisSettingsFromFlag({ enabled: s.on, value: crisFlagValue(s) })).toEqual(s);
  });
});

describe("crisSettingsSchema", () => {
  it("accepts a full, valid save", () => {
    expect(crisSettingsSchema.safeParse({ on: true, dailyLimit: 50, model: "claude-sonnet-5-5" }).success).toBe(true);
  });
  it("refuses an unknown model, and a limit outside 1–1000", () => {
    expect(crisSettingsSchema.safeParse({ on: true, dailyLimit: 50, model: "gpt-4" }).success).toBe(false);
    expect(crisSettingsSchema.safeParse({ on: true, dailyLimit: 0, model: "claude-haiku-5-5" }).success).toBe(false);
    expect(crisSettingsSchema.safeParse({ on: true, dailyLimit: 1001, model: "claude-haiku-5-5" }).success).toBe(false);
    expect(crisSettingsSchema.safeParse({ on: true, dailyLimit: 1.5, model: "claude-haiku-5-5" }).success).toBe(false);
  });
});

describe("crisAvailabilityFrom (plan: Who and when)", () => {
  const on = CRIS_DEFAULTS;
  const off = { ...CRIS_DEFAULTS, on: false };
  it("the admin switch comes first", () => {
    expect(crisAvailabilityFrom(off, { ANTHROPIC_API_KEY: "k" })).toEqual({ on: false, reason: "off" });
    expect(crisAvailabilityFrom(off, {})).toEqual({ on: false, reason: "off" });
  });
  it("no key → off with reason no-key", () => {
    expect(crisAvailabilityFrom(on, {})).toEqual({ on: false, reason: "no-key" });
    expect(crisAvailabilityFrom(on, { ANTHROPIC_API_KEY: "" })).toEqual({ on: false, reason: "no-key" });
  });
  it("a key → on", () => {
    expect(crisAvailabilityFrom(on, { ANTHROPIC_API_KEY: "k" })).toEqual({ on: true });
  });
  it("the fake model stands in for the key, but never in production", () => {
    expect(crisAvailabilityFrom(on, { CRIS_MODEL: "fake", NODE_ENV: "development" })).toEqual({ on: true });
    expect(crisAvailabilityFrom(on, { CRIS_MODEL: "fake", NODE_ENV: "test" })).toEqual({ on: true });
    expect(crisAvailabilityFrom(on, { CRIS_MODEL: "fake", NODE_ENV: "production" })).toEqual({ on: false, reason: "no-key" });
  });
});
