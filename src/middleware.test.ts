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

type Handler = (req: { nextUrl: URL; auth: { user: { role: string } } | null }) => Response | undefined;

function run(path: string, role: string | null): Response | undefined {
  return (middleware as unknown as Handler)({
    nextUrl: new URL(path, "http://localhost:3000"),
    auth: role ? { user: { role } } : null,
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
