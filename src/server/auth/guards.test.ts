import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 43 (Task 4, item 1): requireUser() reads the session's user once per request. React's `cache()` only
 * memoises inside a server render (outside one — like here — it calls straight through), so "react" is mocked with a
 * request-scoped stand-in: one Map per wrapped function, cleared in beforeEach as a new request would. The
 * behaviour tests pin today's redirects exactly; the dedupe tests prove the read sits behind `cache()`.
 */

const h = vi.hoisted(() => ({
  session: null as { user?: { id?: string; role?: string; sessionVersion?: number } } | null,
  user: null as { id: string; role: string; disabled: boolean; sessionVersion?: number; approvalState?: string } | null,
  auth: vi.fn(),
  findUnique: vi.fn(),
  /** Every cache() store, so a test can start a fresh "request". */
  stores: [] as Map<string, unknown>[],
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
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("./index", () => ({ auth: h.auth }));
vi.mock("@/server/db/client", () => ({ prisma: { user: { findUnique: h.findUnique } } }));

import { actionRole, actionUser, requireRole, requireUser } from "./guards";

const newRequest = () => h.stores.forEach((s) => s.clear());
const ACTIVE = { id: "u1", role: "it_staff", disabled: false, sessionVersion: 0, approvalState: "APPROVED" };

beforeEach(() => {
  newRequest();
  vi.clearAllMocks();
  h.session = { user: { id: "u1", role: "it_staff", sessionVersion: 0 } };
  h.user = { ...ACTIVE };
  h.auth.mockImplementation(async () => h.session);
  h.findUnique.mockImplementation(async () => h.user);
});

describe("requireUser — today's semantics", () => {
  it("returns the signed-in user, read by the session's id", async () => {
    expect(await requireUser()).toEqual(h.user);
    expect(h.findUnique).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("sends a signed-out visitor to /login without reading the user", async () => {
    h.session = null;
    await expect(requireUser()).rejects.toThrow("REDIRECT /login");
    newRequest();
    h.session = { user: {} };
    await expect(requireUser()).rejects.toThrow("REDIRECT /login");
    expect(h.findUnique).not.toHaveBeenCalled();
  });

  it("sends a deleted, disabled or role-changed user to /logout", async () => {
    h.user = null;
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    newRequest();
    h.user = { ...ACTIVE, disabled: true };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    newRequest();
    h.user = { ...ACTIVE, role: "admin" };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
  });
});

describe("requireRole — today's semantics", () => {
  it("returns the user when their role is allowed", async () => {
    expect(await requireRole("admin", "it_staff")).toEqual(h.user);
  });

  it("sends a user without the role to their own landing", async () => {
    await expect(requireRole("finance_staff")).rejects.toThrow("REDIRECT /inventory");
  });

  it("passes requireUser's redirects through", async () => {
    h.session = null;
    await expect(requireRole("it_staff")).rejects.toThrow("REDIRECT /login");
  });
});

describe("requireUser — once per request (Phase 43)", () => {
  it("two calls in one request read the session and the user once", async () => {
    const [a, b] = [await requireUser(), await requireUser()];
    expect(a).toBe(b);
    expect(h.auth).toHaveBeenCalledTimes(1);
    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });

  it("the layout's requireUser and the page's requireRole share the one read", async () => {
    await Promise.all([requireUser(), requireRole("it_staff"), requireRole("admin", "it_staff")]);
    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });

  it("a redirect is the same redirect for every caller in the request", async () => {
    h.user = { ...ACTIVE, disabled: true };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    await expect(requireRole("it_staff")).rejects.toThrow("REDIRECT /logout");
    expect(h.findUnique).toHaveBeenCalledTimes(1);
  });

  it("a new request reads again — nothing is remembered across requests", async () => {
    await requireUser();
    newRequest();
    h.user = { ...ACTIVE, disabled: true };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    expect(h.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("actionUser / actionRole — unchanged", () => {
  it("return the user, or null for a signed-out, disabled or role-changed one", async () => {
    expect(await actionUser()).toEqual(h.user);
    expect(await actionRole("admin")).toBeNull();
    h.user = { ...ACTIVE, disabled: true };
    expect(await actionUser()).toBeNull();
    h.session = null;
    expect(await actionUser()).toBeNull();
  });
});

describe("session version and approval (Users & access spec §4.2, Review Focus #1)", () => {
  it("logs out when the token's sessionVersion is behind", async () => {
    h.user = { ...ACTIVE, sessionVersion: 2 };
    h.session = { user: { id: "u1", role: "it_staff", sessionVersion: 1 } };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    expect(await actionUser()).toBeNull();
  });

  it("logs out a token that is ahead of the database too: only an exact match stays in", async () => {
    h.session = { user: { id: "u1", role: "it_staff", sessionVersion: 1 } };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    expect(await actionUser()).toBeNull();
  });

  it("keeps a token whose sessionVersion matches", async () => {
    h.user = { ...ACTIVE, sessionVersion: 3 };
    h.session = { user: { id: "u1", role: "it_staff", sessionVersion: 3 } };
    expect(await requireUser()).toEqual(h.user);
    expect(await actionUser()).toEqual(h.user);
  });

  it("logs out a PENDING account", async () => {
    h.user = { ...ACTIVE, approvalState: "PENDING" };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    expect(await actionUser()).toBeNull();
    expect(await actionRole("it_staff")).toBeNull();
  });

  it("logs out a DECLINED account", async () => {
    h.user = { ...ACTIVE, approvalState: "DECLINED" };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    expect(await actionUser()).toBeNull();
  });
});
