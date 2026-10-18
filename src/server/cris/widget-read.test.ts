import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 43 (Task 4, item 2): the layout reads the `cris` flag for admin and IT through crisAvailability() and again
 * through crisWidgetStart(); it is now read once per request. React's `cache()` only memoises inside a server render,
 * so "react" is mocked with a request-scoped stand-in (one Map per wrapped function, cleared as a new request would).
 */

const h = vi.hoisted(() => ({
  stores: [] as Map<string, unknown>[],
  flag: { key: "cris", enabled: true, value: { dailyLimit: 30, model: "claude-haiku-4-5" } } as Record<string, unknown> | null,
  findUnique: vi.fn(),
  create: vi.fn(),
  latest: vi.fn(),
  used: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const store = new Map<string, R>();
    h.stores.push(store as Map<string, unknown>);
    return (...args: A): R => {
      const key = JSON.stringify(args);
      if (!store.has(key)) store.set(key, fn(...args));
      return store.get(key)!;
    };
  },
}));
vi.mock("@/server/db/client", () => ({ prisma: { featureFlag: { findUnique: h.findUnique, create: h.create } } }));
vi.mock("./turn-core", () => ({ latestConversationId: h.latest, usedToday: h.used }));

import { crisAvailability, crisSettings, ensureCrisFlag } from "./settings-read";
import { crisWidgetStart } from "./widget-read";

const newRequest = () => h.stores.forEach((s) => s.clear());

beforeEach(() => {
  newRequest();
  vi.clearAllMocks();
  h.flag = { key: "cris", enabled: true, value: { dailyLimit: 30, model: "claude-haiku-4-5" } };
  h.findUnique.mockImplementation(async () => h.flag);
  h.latest.mockResolvedValue("c1");
  h.used.mockResolvedValue(4);
});

describe("the cris flag, once per request (Phase 43)", () => {
  it("the layout's crisAvailability and crisWidgetStart share one flag read", async () => {
    const availability = await crisAvailability();
    const start = await crisWidgetStart("u1", new Date("2026-10-19T03:00:00Z"));
    expect(availability.on).toBe(true);
    expect(start).toEqual({ conversationId: "c1", left: 26 });
    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });

  it("Settings › Cris's crisSettings shares it too, and reads the same settings", async () => {
    const [a, b] = await Promise.all([crisSettings(), crisSettings(), crisAvailability()]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ on: true, dailyLimit: 30 });
    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });

  it("a new request reads the flag again — a switch flipped between requests is seen", async () => {
    expect((await crisAvailability()).on).toBe(true);
    newRequest();
    h.flag = { ...h.flag!, enabled: false };
    expect(await crisAvailability()).toEqual({ on: false, reason: "off" });
    expect(h.findUnique).toHaveBeenCalledTimes(2);
  });

  it("ensureCrisFlag itself stays uncached: the save action's read-before-write always hits the database", async () => {
    await ensureCrisFlag();
    await ensureCrisFlag();
    expect(h.findUnique).toHaveBeenCalledTimes(2);
  });

  it("the first-ever read still creates the row with the defaults, once per request", async () => {
    h.findUnique.mockResolvedValue(null);
    h.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
    await Promise.all([crisAvailability(), crisWidgetStart("u1")]);
    expect(h.create).toHaveBeenCalledTimes(1);
  });
});

describe("crisWidgetStart", () => {
  it("starts the open-conversation and today's-count reads together, not one after the other", async () => {
    let releaseLatest!: (v: string | null) => void;
    h.latest.mockImplementation(() => new Promise((r) => { releaseLatest = r; }));
    const pending = crisWidgetStart("u1", new Date("2026-10-19T03:00:00Z"));
    await Promise.resolve();
    await Promise.resolve();
    // the count has been asked for while the conversation read is still outstanding
    expect(h.used).toHaveBeenCalledWith("u1", new Date("2026-10-19T03:00:00Z"));
    releaseLatest(null);
    expect(await pending).toEqual({ conversationId: null, left: 26 });
  });

  it("never reports fewer than 0 left", async () => {
    h.used.mockResolvedValue(99);
    expect((await crisWidgetStart("u1")).left).toBe(0);
  });
});
