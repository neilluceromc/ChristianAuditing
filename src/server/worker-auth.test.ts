import { afterEach, describe, expect, it, vi } from "vitest";
import { cronAuthorized } from "./worker-auth";

/* Cloud staging (spec §4.3): the shared CRON_SECRET bearer check behind /api/worker/*. */

const req = (auth?: string) =>
  new Request("http://localhost/api/worker/tick", {
    method: "POST",
    headers: auth === undefined ? {} : { authorization: auth },
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cronAuthorized", () => {
  it("accepts exactly `Bearer ${CRON_SECRET}`", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(cronAuthorized(req("Bearer s3cret"))).toBe(true);
  });

  it("rejects no header, a wrong secret, a different length and a missing scheme", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(cronAuthorized(req())).toBe(false);
    expect(cronAuthorized(req("Bearer s3creT"))).toBe(false);
    expect(cronAuthorized(req("Bearer s3cret2"))).toBe(false);
    expect(cronAuthorized(req("s3cret"))).toBe(false);
  });

  it("rejects everything when CRON_SECRET is empty or unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(cronAuthorized(req("Bearer "))).toBe(false);
    vi.stubEnv("CRON_SECRET", undefined);
    expect(cronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(cronAuthorized(req("Bearer "))).toBe(false);
  });
});
