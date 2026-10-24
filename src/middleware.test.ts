import { describe, expect, it, vi } from "vitest";

/*
 * Follow-up spec §7.1: a signed-in person who visits /login goes to Home, whatever their role. ROLE_LANDING stays
 * for a page a role may not see.
 */

vi.mock("next-auth", () => ({
  // The real `auth(handler)` wraps the handler; the test calls the handler directly with a fake request.
  default: () => ({ auth: (handler: unknown) => handler }),
}));

import middleware from "./middleware";

type Handler = (req: {
  nextUrl: URL;
  method: string;
  headers: Headers;
  auth: { user: { role: string; mustChangePassword?: boolean } } | null;
}) => Response | undefined;

function run(
  path: string,
  role: string | null,
  opts: { mustChangePassword?: boolean; method?: string; headers?: Record<string, string> } = {},
): Response | undefined {
  return (middleware as unknown as Handler)({
    nextUrl: new URL(path, "http://localhost:3000"),
    method: opts.method ?? "GET",
    headers: new Headers(opts.headers),
    auth: role ? { user: { role, mustChangePassword: opts.mustChangePassword } } : null,
  });
}

describe("middleware signed-in bounce", () => {
  it.each(["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"])("sends %s on /login to Home", (role) => {
    const res = run("/login", role);
    expect(res?.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("sends a signed-in person on /signup to Home", () => {
    expect(run("/signup", "finance_staff")?.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("still sends a role away from a page it may not see to its own landing", () => {
    expect(run("/admin/users", "viewer")?.headers.get("location")).toBe("http://localhost:3000/inventory");
  });

  it("sends a signed-out visitor to /login with the page as next", () => {
    expect(run("/inventory/abc", null)?.headers.get("location")).toBe("http://localhost:3000/login?next=%2Finventory%2Fabc");
  });
});

describe("middleware: a password still owed (Users & access spec §4.3, Review Focus #2)", () => {
  const owed = { mustChangePassword: true };

  it("sends a deep link such as /finance/assets to /welcome/password", () => {
    expect(run("/finance/assets", "finance_staff", owed)?.headers.get("location")).toBe("http://localhost:3000/welcome/password");
  });

  it.each(["/", "/inventory/abc", "/settings/account", "/admin/users", "/login"])("sends %s there too", (path) => {
    expect(run(path, "admin", owed)?.headers.get("location")).toBe("http://localhost:3000/welcome/password");
  });

  it("lets /welcome/password itself through, for every role", () => {
    for (const role of ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"]) {
      expect(run("/welcome/password", role, owed)).toBeUndefined();
    }
  });

  it("lets /logout through", () => {
    expect(run("/logout", "viewer", owed)).toBeUndefined();
  });

  it("leaves the auth API and static assets to the matcher, which never runs middleware on them", async () => {
    const { config } = await import("./middleware");
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ["/api/auth/session", "/api/auth/csrf", "/_next/static/chunk.js", "/favicon.ico", "/logo.svg"]) {
      expect(matcher.test(p)).toBe(false);
    }
    expect(matcher.test("/finance/assets")).toBe(true);
  });

  it("lets a server action from a stale tab reach the action, whose guard refuses it with the copy", () => {
    const res = run("/finance/assets", "finance_staff", { ...owed, method: "POST", headers: { "next-action": "abc123" } });
    expect(res).toBeUndefined();
  });

  it("a plain POST without the action header is still sent to the password page", () => {
    expect(run("/finance/assets", "finance_staff", { ...owed, method: "POST" })?.headers.get("location")).toBe(
      "http://localhost:3000/welcome/password",
    );
  });

  it("a token that owes nothing is unaffected, and may open /welcome/password (its page sends it Home)", () => {
    expect(run("/finance/assets", "finance_staff")).toBeUndefined();
    expect(run("/welcome/password", "viewer")).toBeUndefined();
  });

  it("a signed-out visitor on /welcome/password goes to /login", () => {
    expect(run("/welcome/password", null)?.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fwelcome%2Fpassword");
  });
});
