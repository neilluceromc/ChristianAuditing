import { describe, expect, it } from "vitest";
import { buildWorld, WORLD_H, WORLD_W } from "./world";

describe("buildWorld", () => {
  const a = buildWorld();

  it("is deterministic: the seed resets on every call", () => {
    expect(buildWorld()).toBe(a);
  });

  it("returns one svg sized to the world", () => {
    expect(WORLD_W).toBe(3960);
    expect(WORLD_H).toBe(760);
    expect(a.startsWith("<svg")).toBe(true);
    expect(a).toContain('viewBox="0 0 3960 760"');
  });

  it("draws the stations, signs and paperwork", () => {
    for (const s of [
      "STOCKROOM",
      "PURCHASING",
      "RECEIVING",
      "FINANCE",
      "OFFBOARDING",
      "BR-LT-0230",
      "BR-LT-0027",
      "PO-1042",
      "PO-2219",
      "₱58,000",
      "RETURN KIT",
      "RETURN DESK",
      "EXIT",
      "OCT 2026",
    ]) {
      expect(a).toContain(s);
    }
  });

  it("exposes the clock hands and the shared defs by id", () => {
    for (const id of ["lw-hour", "lw-minute", "lw-sky", "lw-doorclip"]) expect(a).toContain(`id="${id}"`);
  });

  it("has no broken numbers", () => {
    expect(a).not.toMatch(/NaN|undefined/);
  });

  it("prefixes every class and id", () => {
    expect(a).not.toMatch(/class="(?!lw-)[^"]*"/);
    expect(a).not.toMatch(/class="[^"]*\s(?!lw-)[^"\s]+[^"]*"/);
    expect(a).not.toMatch(/\sid="(?!lw-)/);
    expect(a).not.toMatch(/url\(#(?!lw-)/);
    expect(a).not.toMatch(/var\(--(?!lw-)/);
  });
});
