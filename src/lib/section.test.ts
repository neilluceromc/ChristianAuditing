import { describe, expect, it, vi } from "vitest";
import { safeSection } from "./section";

describe("safeSection — one failing query must not blank the page", () => {
  it("passes data through when the loader resolves", async () => {
    const res = await safeSection("Fleet", async () => ({ total: 22 }));
    expect(res).toEqual({ ok: true, data: { total: 22 } });
  });

  it("turns a thrown error into a typed failure carrying the section label", async () => {
    const res = await safeSection("Fleet", async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.label).toBe("Fleet");
      expect(res.message).toBe("This section couldn't load.");
    }
  });

  it("does not leak the underlying error text to the UI", async () => {
    const res = await safeSection("Fleet", async () => {
      throw new Error("password authentication failed for user \"postgres\"");
    });
    if (!res.ok) expect(res.message).not.toMatch(/password|postgres/);
  });

  it("still logs the real error server-side so it is diagnosable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await safeSection("Fleet", async () => {
      throw new Error("boom");
    });
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0]?.join(" "))).toMatch(/Fleet/);
    spy.mockRestore();
  });

  it("catches a synchronous throw as well as a rejected promise", async () => {
    const res = await safeSection("Fleet", () => {
      throw new Error("sync boom");
    });
    expect(res.ok).toBe(false);
  });

  it("never throws, whatever the loader does", async () => {
    await expect(safeSection("X", async () => { throw "a string, not an Error"; })).resolves.toMatchObject({ ok: false });
  });
});
