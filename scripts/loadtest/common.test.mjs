import { describe, expect, it } from "vitest";
import { CookieJar, MAX_MINUTES, parseBase, parseMinutes, requireSeedPassword, thinkMs } from "./common.mjs";

describe("requireSeedPassword", () => {
  it("returns SEED_PASSWORD when set", () => {
    expect(requireSeedPassword({ SEED_PASSWORD: "s3cret" })).toBe("s3cret");
  });

  it("refuses with a clear message when unset or empty, and never falls back to a literal", () => {
    for (const env of [{}, { SEED_PASSWORD: "" }]) {
      expect(() => requireSeedPassword(env)).toThrow(/SEED_PASSWORD is not set/);
    }
  });
});

describe("parseBase", () => {
  it("keeps the origin of an http(s) URL", () => {
    expect(parseBase("http://192.168.1.193:3000/")).toBe("http://192.168.1.193:3000");
    expect(parseBase("https://staging.example.test")).toBe("https://staging.example.test");
  });

  it("refuses a missing or non-http value", () => {
    expect(() => parseBase(undefined)).toThrow(/--base/);
    expect(() => parseBase("ftp://host")).toThrow(/--base/);
    expect(() => parseBase("not a url")).toThrow(/--base/);
  });
});

describe("parseMinutes (laptop safety: a full run is 8 minutes at most)", () => {
  it("defaults to 6 and accepts up to the cap", () => {
    expect(parseMinutes(undefined)).toBe(6);
    expect(parseMinutes("0.5")).toBe(0.5);
    expect(parseMinutes(String(MAX_MINUTES))).toBe(MAX_MINUTES);
  });

  it("refuses zero, negatives, garbage and anything over the cap", () => {
    for (const raw of ["0", "-1", "abc", String(MAX_MINUTES + 1)]) expect(() => parseMinutes(raw)).toThrow(/--minutes/);
  });
});

describe("thinkMs", () => {
  it("is 2–6 s", () => {
    expect(thinkMs(() => 0)).toBe(2000);
    expect(thinkMs(() => 0.5)).toBe(4000);
    expect(thinkMs(() => 0.999999)).toBeLessThanOrEqual(6000);
  });
});

describe("CookieJar", () => {
  const headers = (...cookies) => ({ getSetCookie: () => cookies });

  it("keeps cookies from Set-Cookie and sends them back as one header", () => {
    const jar = new CookieJar();
    jar.store(headers("authjs.csrf-token=abc%7Cdef; Path=/; HttpOnly; SameSite=Lax", "authjs.callback-url=http%3A%2F%2Fh; Path=/"));
    jar.set("br.dept", "it");
    expect(jar.header()).toBe("authjs.csrf-token=abc%7Cdef; authjs.callback-url=http%3A%2F%2Fh; br.dept=it");
    expect(jar.has(/session-token/)).toBe(false);
  });

  it("replaces a cookie by name and drops one the server expires", () => {
    const jar = new CookieJar();
    jar.store(headers("a=1; Path=/", "authjs.session-token=t1; Path=/; HttpOnly"));
    expect(jar.has(/session-token/)).toBe(true);
    jar.store(headers("a=2; Path=/"));
    jar.store(headers("authjs.session-token=; Path=/; Max-Age=0"));
    expect(jar.header()).toBe("a=2");
    jar.store(headers("a=gone; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"));
    expect(jar.header()).toBe("");
  });
});
