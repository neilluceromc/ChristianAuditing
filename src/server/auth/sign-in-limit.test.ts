import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Users & access (spec §4.6, Review Focus #5): three failed sign-ins for one lower-cased email within 15 minutes
 * pause that email for 15 minutes. The SignInAttempt table and the advisory-locked transaction are the in-memory
 * double in sign-in-attempts.fake.ts.
 */

vi.mock("../db/client", async () => {
  const fake = await import("./sign-in-attempts.fake");
  return { prisma: { signInAttempt: fake.signInAttemptTable, $transaction: fake.fakeTransaction } };
});

import { attempts, resetAttempts } from "./sign-in-attempts.fake";
import {
  CURRENT_PASSWORD_LIMIT, SIGN_IN_LIMIT, clearCurrentPasswordFailures, clearSignInFailures, currentPasswordKey,
  recordSignInFailure, releaseSignInAttempt, reserveCurrentPasswordAttempt, reserveSignInAttempt, signInPaused,
} from "./sign-in-limit";

const T0 = new Date("2026-10-24T02:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

async function failAt(email: string, ms: number) {
  vi.setSystemTime(at(ms));
  await recordSignInFailure(email);
}

beforeEach(() => {
  resetAttempts();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SIGN_IN_LIMIT", () => {
  it("is three tries in 15 minutes", () => {
    expect(SIGN_IN_LIMIT).toEqual({ tries: 3, windowMs: 15 * 60_000 });
  });
});

describe("signInPaused", () => {
  it("is false with fewer than three failures", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    expect(await signInPaused("a@b.co", at(2 * MIN))).toBe(false);
  });

  it("three failures in 15 minutes pause the email", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    await failAt("a@b.co", 2 * MIN);
    expect(await signInPaused("a@b.co", at(2 * MIN + 1))).toBe(true);
  });

  it("the third failure at 14:59 after the first still pauses", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", 7 * MIN);
    await failAt("a@b.co", 14 * MIN + 59_000);
    expect(await signInPaused("a@b.co", at(15 * MIN))).toBe(true);
  });

  it("the pause lasts 15 minutes from the third failure, then lifts", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    await failAt("a@b.co", 2 * MIN);
    expect(await signInPaused("a@b.co", at(16 * MIN))).toBe(true);
    expect(await signInPaused("a@b.co", at(17 * MIN - 1))).toBe(true);
    expect(await signInPaused("a@b.co", at(17 * MIN))).toBe(false);
  });

  it("failures older than 15 minutes don't count", async () => {
    await failAt("a@b.co", 0);
    await failAt("a@b.co", MIN);
    await failAt("a@b.co", 20 * MIN);
    expect(await signInPaused("a@b.co", at(20 * MIN + 1))).toBe(false);
    // Three failures spread wider than 15 minutes are not a pause either
    await failAt("b@b.co", 0);
    await failAt("b@b.co", 8 * MIN);
    await failAt("b@b.co", 16 * MIN);
    expect(await signInPaused("b@b.co", at(16 * MIN + 1))).toBe(false);
  });

  it("counts per lower-cased, trimmed email", async () => {
    await failAt("Nina@Example.com", 0);
    await failAt(" nina@example.com ", MIN);
    await failAt("NINA@EXAMPLE.COM", 2 * MIN);
    expect(attempts.rows.every((r) => r.emailKey === "nina@example.com")).toBe(true);
    expect(await signInPaused("nina@example.com", at(3 * MIN))).toBe(true);
    expect(await signInPaused("other@example.com", at(3 * MIN))).toBe(false);
  });
});

describe("clearSignInFailures", () => {
  it("resets the count for that email only", async () => {
    for (const ms of [0, MIN, 2 * MIN]) {
      await failAt("a@b.co", ms);
      await failAt("c@b.co", ms);
    }
    await clearSignInFailures("A@B.co");
    expect(await signInPaused("a@b.co", at(3 * MIN))).toBe(false);
    expect(await signInPaused("c@b.co", at(3 * MIN))).toBe(true);
  });
});

describe("reserveSignInAttempt (fix round 1, I-1)", () => {
  it("records the attempt up front, under the email's lock, until the third; the 4th is paused", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await reserveSignInAttempt("Nina@Example.com"));
    expect(results.slice(0, 3).map((r) => r.paused)).toEqual([false, false, false]);
    expect(results[3]).toEqual({ paused: true });
    expect(attempts.rows).toHaveLength(3); // a paused attempt is not recorded
    expect(attempts.locked).toEqual(Array(4).fill("nina@example.com"));
  });

  it("a burst of parallel attempts gets three tries, not one per request", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveSignInAttempt("a@b.co")));
    expect(results.filter((r) => !r.paused)).toHaveLength(3);
    expect(results.filter((r) => r.paused)).toHaveLength(5);
    expect(attempts.rows).toHaveLength(3);
  });

  it("locks per email: another email's burst is not held back", async () => {
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => reserveSignInAttempt("a@b.co")),
      ...Array.from({ length: 2 }, () => reserveSignInAttempt("c@b.co")),
    ]);
    expect(results.slice(4).every((r) => !r.paused)).toBe(true);
  });

  it("a released reservation no longer counts", async () => {
    const first = await reserveSignInAttempt("a@b.co");
    await reserveSignInAttempt("a@b.co");
    await reserveSignInAttempt("a@b.co");
    if (first.paused) throw new Error("not reserved");
    await releaseSignInAttempt(first.attemptId);
    expect(attempts.rows).toHaveLength(2);
    expect(await reserveSignInAttempt("a@b.co")).toMatchObject({ paused: false });
  });
});

describe("wrong current passwords in Account settings (fix round 1, M5)", () => {
  it("five within 15 minutes pause that account; the sixth is refused and records nothing", async () => {
    expect(CURRENT_PASSWORD_LIMIT).toEqual({ tries: 5, windowMs: 15 * MIN });
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(at(i * MIN));
      expect((await reserveCurrentPasswordAttempt("u1")).paused).toBe(false);
    }
    vi.setSystemTime(at(6 * MIN));
    expect(await reserveCurrentPasswordAttempt("u1")).toEqual({ paused: true });
    expect(attempts.rows.filter((r) => r.emailKey === currentPasswordKey("u1"))).toHaveLength(5);
  });

  it("the pause lifts 15 minutes after the fifth", async () => {
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(at(i * MIN));
      await reserveCurrentPasswordAttempt("u1");
    }
    vi.setSystemTime(at(4 * MIN + 15 * MIN - 1));
    expect((await reserveCurrentPasswordAttempt("u1")).paused).toBe(true);
    vi.setSystemTime(at(4 * MIN + 15 * MIN + 1));
    expect((await reserveCurrentPasswordAttempt("u1")).paused).toBe(false);
  });

  it("a burst of 8 parallel tries gets exactly 5; the rest are paused", async () => {
    vi.setSystemTime(T0);
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveCurrentPasswordAttempt("u1")));
    expect(results.filter((r) => !r.paused)).toHaveLength(5);
    expect(results.filter((r) => r.paused)).toHaveLength(3);
  });

  it("a released try doesn't count, and clearing empties only that account's bucket", async () => {
    vi.setSystemTime(T0);
    for (let i = 0; i < 4; i++) await reserveCurrentPasswordAttempt("u1");
    const right = await reserveCurrentPasswordAttempt("u1");
    if (right.paused) throw new Error("unexpected pause");
    await releaseSignInAttempt(right.attemptId);
    expect((await reserveCurrentPasswordAttempt("u1")).paused).toBe(false); // 5th counted try
    await reserveCurrentPasswordAttempt("u2");
    await clearCurrentPasswordFailures("u1");
    expect(attempts.rows.map((r) => r.emailKey)).toEqual([currentPasswordKey("u2")]);
  });

  it("is a bucket no sign-in can touch: sign-in keys are lower-cased emails, this one is upper-case", async () => {
    vi.setSystemTime(T0);
    for (let i = 0; i < 5; i++) await reserveCurrentPasswordAttempt("u1");
    // Someone types the bucket's own name as an email: it is normalised to lower case, a different key.
    for (let i = 0; i < 3; i++) await reserveSignInAttempt(currentPasswordKey("u1"));
    await clearSignInFailures(currentPasswordKey("u1"));
    expect(attempts.rows.filter((r) => r.emailKey === "CURRENT:u1")).toHaveLength(5);
    expect(SIGN_IN_LIMIT.tries).toBe(3); // sign-in's own limit unchanged
  });
});
