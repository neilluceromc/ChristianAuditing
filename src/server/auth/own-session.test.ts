import { describe, expect, it, vi } from "vitest";

/*
 * Task 5: refreshOwnSession signs and applies the update, then marks THIS request, against Next's real work-unit
 * storage (as refusal.test.ts does: install globalThis.AsyncLocalStorage first, as Next's server runtime does).
 */
const h = vi.hoisted(() => ({ update: vi.fn() }));

await vi.hoisted(async () => {
  const { AsyncLocalStorage: Als } = await import("node:async_hooks");
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = Als;
});
vi.mock("./index", () => ({ unstable_update: h.update }));

describe("own-session.ts with Next's real work-unit storage", () => {
  it("applies the signed update, and the request it ran in reads the new values; no other request does", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-for-own-session");
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
    const { refreshOwnSession, refreshedOwnSession } = await import("./own-session");
    const { signedSessionUpdate } = await import("./session-version");
    const run = workUnitAsyncStorage.run.bind(workUnitAsyncStorage) as unknown as <T>(s: object, f: () => T) => T;

    await run({}, async () => {
      await refreshOwnSession("u1", 4, false);
      expect(h.update).toHaveBeenCalledWith(await signedSessionUpdate("u1", 4, false));
      expect(refreshedOwnSession("u1")).toEqual({ sessionVersion: 4, mustChangePassword: false });
      expect(refreshedOwnSession("u2")).toBeNull();
    });
    run({}, () => expect(refreshedOwnSession("u1")).toBeNull());
    expect(refreshedOwnSession("u1")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("a mark made by one copy of the module is read by another (Next bundles the action and the render apart)", async () => {
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
    const run = workUnitAsyncStorage.run.bind(workUnitAsyncStorage) as unknown as <T>(s: object, f: () => T) => T;
    const actionCopy = await import("./own-session");
    vi.resetModules();
    const renderCopy = await import("./own-session");
    expect(renderCopy).not.toBe(actionCopy);
    run({}, () => {
      actionCopy.markOwnSessionRefreshed("u1", { sessionVersion: 7, mustChangePassword: false });
      expect(renderCopy.refreshedOwnSession("u1")).toEqual({ sessionVersion: 7, mustChangePassword: false });
    });
  });

  it("never throws after the commit: a failed update is logged without the payload, and nothing is marked (M-1)", async () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-for-own-session");
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
    const { refreshOwnSession, refreshedOwnSession } = await import("./own-session");
    const run = workUnitAsyncStorage.run.bind(workUnitAsyncStorage) as unknown as <T>(s: object, f: () => T) => T;
    h.update.mockRejectedValueOnce(new Error("no cookie store"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await run({}, async () => {
      expect(await refreshOwnSession("u9", 3, false)).toBe(false);
      expect(refreshedOwnSession("u9")).toBeNull();
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/proof/);
    log.mockRestore();
    vi.unstubAllEnvs();
  });
});
