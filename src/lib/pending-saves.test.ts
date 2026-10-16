import { describe, expect, it } from "vitest";
import { waitForAll } from "./pending-saves";

function deferred() {
  let resolve!: (v: boolean) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Lets every queued microtask run, so a still-pending wait is observably still pending. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("waitForAll", () => {
  it("resolves true at once when nothing is pending", async () => {
    await expect(waitForAll(new Set())).resolves.toBe(true);
  });

  it("waits for a save that is still in flight", async () => {
    const save = deferred();
    let done = false;
    const wait = waitForAll(new Set([save.promise])).then((ok) => { done = true; return ok; });
    await flush();
    expect(done).toBe(false);
    save.resolve(true);
    await expect(wait).resolves.toBe(true);
  });

  it("reports false when any save came back false, after all of them settle", async () => {
    const a = deferred();
    const b = deferred();
    let done = false;
    const wait = waitForAll(new Set([a.promise, b.promise])).then((ok) => { done = true; return ok; });
    a.resolve(false);
    await flush();
    expect(done).toBe(false);
    b.resolve(true);
    await expect(wait).resolves.toBe(false);
  });

  it("counts a rejected save as a failure instead of throwing", async () => {
    const a = deferred();
    const wait = waitForAll(new Set([a.promise]));
    a.reject(new Error("offline"));
    await expect(wait).resolves.toBe(false);
  });

  it("also waits for a save added while it was waiting", async () => {
    const pending = new Set<Promise<boolean>>();
    const first = deferred();
    const second = deferred();
    pending.add(first.promise);
    let done = false;
    const wait = waitForAll(pending).then((ok) => { done = true; return ok; });
    pending.add(second.promise);
    first.resolve(true);
    await flush();
    expect(done).toBe(false);
    second.resolve(true);
    await expect(wait).resolves.toBe(true);
  });

  it("never changes the set it is given", async () => {
    const a = deferred();
    const pending = new Set([a.promise]);
    const wait = waitForAll(pending);
    a.resolve(true);
    await wait;
    expect(pending.size).toBe(1);
  });
});
