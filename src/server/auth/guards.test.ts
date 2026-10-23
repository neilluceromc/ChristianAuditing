import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 43 (Task 4, item 1): requireUser() reads the session's user once per request. React's `cache()` only
 * memoises inside a server render (outside one — like here — it calls straight through), so "react" is mocked with a
 * request-scoped stand-in: one Map per wrapped function, cleared in beforeEach as a new request would. The
 * behaviour tests pin today's redirects exactly; the dedupe tests prove the read sits behind `cache()`.
 */

const h = vi.hoisted(() => ({
  session: null as { user?: { id?: string; role?: string; sessionVersion?: number } } | null,
  user: null as {
    id: string; role: string; disabled: boolean; sessionVersion?: number; approvalState?: string; mustChangePassword?: boolean;
  } | null,
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
// Users & access: the request store a server action runs in (Next's work-unit storage), as a real AsyncLocalStorage.
vi.mock("next/dist/server/app-render/work-unit-async-storage.external", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { workUnitAsyncStorage: new AsyncLocalStorage<object>() };
});
vi.mock("@/server/db/client", () => ({ prisma: { user: { findUnique: h.findUnique } } }));

import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { forbidden, PASSWORD_OWED_COPY } from "@/server/action-result";
import { actionRole, actionUser, passwordOwedUser, requirePasswordOwedUser, requireRole, requireUser } from "./guards";

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

describe("a password still owed (Users & access spec §4.3, Review Focus #2)", () => {
  /** One server-action request: Next runs the action inside its work-unit store. */
  const inRequest = <T,>(fn: () => Promise<T>) => (workUnitAsyncStorage as unknown as { run: (s: object, f: () => Promise<T>) => Promise<T> }).run({}, fn);

  beforeEach(() => {
    h.user = { ...ACTIVE, mustChangePassword: true };
  });

  it("requireUser and requireRole send every page to /welcome/password", async () => {
    await expect(requireUser()).rejects.toThrow("REDIRECT /welcome/password");
    newRequest();
    await expect(requireRole("it_staff")).rejects.toThrow("REDIRECT /welcome/password");
  });

  it("a stale or disabled account that also owes a password is logged out, not sent to the password page", async () => {
    h.user = { ...ACTIVE, mustChangePassword: true, sessionVersion: 4 };
    await expect(requireUser()).rejects.toThrow("REDIRECT /logout");
    newRequest();
    h.user = { ...ACTIVE, mustChangePassword: true, disabled: true };
    await expect(requirePasswordOwedUser()).rejects.toThrow("REDIRECT /logout");
  });

  it("requirePasswordOwedUser lets /welcome/password render, and sends someone who owes nothing Home", async () => {
    expect(await requirePasswordOwedUser()).toEqual(h.user);
    newRequest();
    h.user = { ...ACTIVE };
    await expect(requirePasswordOwedUser()).rejects.toThrow("REDIRECT /");
    newRequest();
    h.session = null;
    await expect(requirePasswordOwedUser()).rejects.toThrow("REDIRECT /login");
  });

  it("actionUser and actionRole refuse, and the action's own bare forbidden() says \"Choose your own password first\"", async () => {
    await inRequest(async () => {
      expect(await actionUser()).toBeNull();
      expect(forbidden()).toMatchObject({ kind: "forbidden", reason: "password_owed", message: PASSWORD_OWED_COPY });
    });
    await inRequest(async () => {
      expect(await actionRole("it_staff")).toBeNull();
      expect(forbidden()).toMatchObject({ message: PASSWORD_OWED_COPY });
    });
  });

  it("the reason belongs to its own request: another request's forbidden() keeps the default sentence", async () => {
    await inRequest(async () => {
      await actionUser();
    });
    h.user = { ...ACTIVE };
    await inRequest(async () => {
      expect(await actionRole("admin")).toBeNull(); // refused for the role, not for a password
      expect(forbidden()).toEqual({ ok: false, kind: "forbidden", message: "You don't have permission to do that." });
    });
    expect(forbidden()).toMatchObject({ message: "You don't have permission to do that." }); // outside any request
  });

  it("passwordOwedUser returns the user only while the flag is set, and never a stale or disabled one", async () => {
    expect(await passwordOwedUser()).toEqual(h.user);
    h.user = { ...ACTIVE };
    expect(await passwordOwedUser()).toBeNull();
    h.user = { ...ACTIVE, mustChangePassword: true, disabled: true };
    expect(await passwordOwedUser()).toBeNull();
    h.user = { ...ACTIVE, mustChangePassword: true, sessionVersion: 9 };
    expect(await passwordOwedUser()).toBeNull();
    h.user = { ...ACTIVE, mustChangePassword: true };
    h.session = null;
    expect(await passwordOwedUser()).toBeNull();
  });

  it("an account that owes nothing passes actionUser as before", async () => {
    h.user = { ...ACTIVE, mustChangePassword: false };
    expect(await actionUser()).toEqual(h.user);
    expect(await requireUser()).toEqual(h.user);
  });
});
