import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";

/*
 * Users & access fix round 1 (M1): the refusal mark against the REAL Next module, not a mock, so a Next upgrade that
 * moves or splits `workUnitAsyncStorage` shows up here instead of silently turning the copy back into the generic
 * sentence. Next's own server runtime installs `globalThis.AsyncLocalStorage` before any app code loads
 * (next/dist/server/node-environment-baseline.js); without it the module builds a no-op fake. This file does the same
 * first, then imports everything dynamically, so the order is certain.
 */

await vi.hoisted(async () => {
  const { AsyncLocalStorage: Als } = await import("node:async_hooks");
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = Als;
});

describe("refusal.ts with Next's real work-unit storage", () => {
  it("a mark inside a request makes a bare forbidden() say \"Choose your own password first\"", async () => {
    const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
    const { markRefusal } = await import("./refusal");
    const { forbidden, PASSWORD_OWED_COPY } = await import("@/server/action-result");

    expect(workUnitAsyncStorage).toBeInstanceOf(AsyncLocalStorage);
    const run = workUnitAsyncStorage.run.bind(workUnitAsyncStorage) as unknown as (store: object, fn: () => void) => void;

    run({}, () => {
      markRefusal("password_owed");
      expect(forbidden()).toMatchObject({ kind: "forbidden", reason: "password_owed", message: PASSWORD_OWED_COPY });
    });
    // Another request, and no request at all, keep the default sentence.
    run({}, () => {
      expect(forbidden()).toMatchObject({ message: "You don't have permission to do that." });
    });
    expect(forbidden()).toMatchObject({ message: "You don't have permission to do that." });
  });
});
