import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JWT } from "@auth/core/jwt";
import type { Session, User } from "next-auth";
import { authConfigEdge, sessionUpdateProof } from "./config.edge";

/*
 * Users & access (spec §4.2): the JWT carries sessionVersion and mustChangePassword from sign-in, and a session update
 * can move both. The update endpoint (POST /api/auth/session) is reachable from the browser too, so the callback only
 * takes values that carry a server-made proof — otherwise a signed-out-everywhere token could write itself the new
 * version and survive.
 */

type JwtParams = Parameters<typeof authConfigEdge.callbacks.jwt>[0];
type SessionParams = Parameters<typeof authConfigEdge.callbacks.session>[0];

const jwt = (p: Partial<JwtParams>) => authConfigEdge.callbacks.jwt({ token: {} as JWT, ...p } as JwtParams);
const signedIn = (): JWT => ({ id: "u1", role: "it_staff", sessionVersion: 1, mustChangePassword: true }) as JWT;

beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-test-secret-test-secret"));
afterEach(() => vi.unstubAllEnvs());

describe("jwt at sign-in", () => {
  it("copies id, role, sessionVersion and mustChangePassword from the user", async () => {
    const user = { id: "u1", role: "viewer", sessionVersion: 4, mustChangePassword: true } as User;
    expect(await jwt({ user })).toMatchObject({ id: "u1", role: "viewer", sessionVersion: 4, mustChangePassword: true });
  });

  it("defaults to version 0 and no password owed when a provider leaves them out", async () => {
    const user = { id: "u1", role: "viewer" } as User;
    expect(await jwt({ user })).toMatchObject({ sessionVersion: 0, mustChangePassword: false });
  });
});

describe("jwt on trigger: update", () => {
  it("sets both fields from a proven update", async () => {
    const proof = await sessionUpdateProof("u1", 2, false);
    const token = await jwt({ token: signedIn(), trigger: "update", session: { sessionVersion: 2, mustChangePassword: false, proof } });
    expect(token).toMatchObject({ id: "u1", role: "it_staff", sessionVersion: 2, mustChangePassword: false });
  });

  it("ignores an update with no proof (a browser POST to /api/auth/session)", async () => {
    const token = await jwt({ token: signedIn(), trigger: "update", session: { sessionVersion: 2, mustChangePassword: false } });
    expect(token).toMatchObject({ sessionVersion: 1, mustChangePassword: true });
  });

  it("ignores a proof made for other values or another person", async () => {
    const forOther = await sessionUpdateProof("u2", 2, false);
    const forThree = await sessionUpdateProof("u1", 3, false);
    for (const session of [
      { sessionVersion: 2, mustChangePassword: false, proof: forOther },
      { sessionVersion: 2, mustChangePassword: false, proof: forThree },
      { sessionVersion: 2, mustChangePassword: true, proof: await sessionUpdateProof("u1", 2, false) },
      { sessionVersion: 2, mustChangePassword: false, proof: "nonsense" },
    ]) {
      const token = await jwt({ token: signedIn(), trigger: "update", session });
      expect(token).toMatchObject({ sessionVersion: 1, mustChangePassword: true });
    }
  });

  it("ignores a proof made with another secret", async () => {
    const proof = await sessionUpdateProof("u1", 2, false);
    vi.stubEnv("AUTH_SECRET", "a-different-secret-a-different-secret");
    const token = await jwt({ token: signedIn(), trigger: "update", session: { sessionVersion: 2, mustChangePassword: false, proof } });
    expect(token).toMatchObject({ sessionVersion: 1, mustChangePassword: true });
  });

  it("ignores malformed values", async () => {
    const token = await jwt({ token: signedIn(), trigger: "update", session: { sessionVersion: "2", mustChangePassword: "no" } });
    expect(token).toMatchObject({ sessionVersion: 1, mustChangePassword: true });
  });
});

describe("session", () => {
  it("exposes sessionVersion and mustChangePassword", () => {
    const out = authConfigEdge.callbacks.session({
      session: { user: {} } as Session,
      token: signedIn(),
    } as SessionParams) as Session;
    expect(out.user).toMatchObject({ id: "u1", role: "it_staff", sessionVersion: 1, mustChangePassword: true });
  });

  it("reads a token issued before this release as version 0, nothing owed", () => {
    const out = authConfigEdge.callbacks.session({
      session: { user: {} } as Session,
      token: { id: "u1", role: "it_staff" } as JWT,
    } as SessionParams) as Session;
    expect(out.user).toMatchObject({ sessionVersion: 0, mustChangePassword: false });
  });
});
