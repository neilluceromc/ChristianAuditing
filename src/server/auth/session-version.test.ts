import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { authConfigEdge } from "./config.edge";
import { bumpSessionVersion, signedSessionUpdate } from "./session-version";

/* Users & access (spec §4.2): every sign-out-everywhere change bumps the counter inside the change's transaction. */

describe("bumpSessionVersion", () => {
  it("increments the user's counter and returns the new value", async () => {
    const update = vi.fn().mockResolvedValue({ sessionVersion: 7 });
    const tx = { user: { update } } as unknown as Prisma.TransactionClient;
    expect(await bumpSessionVersion(tx, "u1")).toBe(7);
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
  });
});

describe("signedSessionUpdate", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", "test-secret-test-secret-test-secret"));
  afterEach(() => vi.unstubAllEnvs());

  it("builds the payload the jwt callback accepts on a session update", async () => {
    const data = await signedSessionUpdate("u1", 8, false);
    expect(data).toMatchObject({ sessionVersion: 8, mustChangePassword: false, proof: expect.any(String) });
    type JwtParams = Parameters<typeof authConfigEdge.callbacks.jwt>[0];
    const token = await authConfigEdge.callbacks.jwt({
      token: { id: "u1", role: "viewer", sessionVersion: 7, mustChangePassword: true },
      trigger: "update",
      session: data,
    } as JwtParams);
    expect(token).toMatchObject({ sessionVersion: 8, mustChangePassword: false });
  });
});
