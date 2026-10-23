import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfigEdge } from "@/server/auth/config.edge";
import { PASSWORD_PAGE, pathAllowedForRole, ROLE_LANDING } from "@/lib/workspaces";

const { auth } = NextAuth(authConfigEdge);

const AUTH_PATHS = /^\/(login|signup|bootstrap)(\/|$)/;

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Dev-only review surfaces are outside the auth boundary (404 in prod anyway).
  if (pathname.startsWith("/dev")) return;

  // Stale-session escape hatch: /logout clears the cookie for ANY bearer —
  // a deleted/disabled user's JWT must be able to reach it or requireUser's
  // redirect would loop through the signed-in /login bounce below.
  if (pathname === "/logout") return;

  const user = req.auth?.user;

  if (!user) {
    if (AUTH_PATHS.test(pathname)) return;
    const login = new URL("/login", req.nextUrl);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Users & access (spec §4.3, Review Focus #2): signed in with a temporary password, every page (a deep link such as
  // /finance/assets included) goes to "Choose your own password" until one is chosen. /logout passed above; the auth
  // API and static assets never reach middleware (see `matcher`). A server action from a stale tab is a POST with
  // the Next-Action header: it goes on to the action, whose guard refuses it with "Choose your own password first"
  // (a redirect here would hand the action's fetch a page instead of its result).
  if (user.mustChangePassword && pathname !== PASSWORD_PAGE && !isServerAction(req)) {
    return NextResponse.redirect(new URL(PASSWORD_PAGE, req.nextUrl));
  }

  // Signed-in users don't see login/signup; /bootstrap 404s server-side on its own. They go to Home (spec §7.1).
  if (AUTH_PATHS.test(pathname) && !pathname.startsWith("/bootstrap")) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  if (!pathAllowedForRole(pathname, user.role)) {
    // Forbidden is a server-side redirect to the role's own landing,
    // never a dead end (brief §8).
    return NextResponse.redirect(new URL(ROLE_LANDING[user.role], req.nextUrl));
  }
});

function isServerAction(req: { method?: string; headers?: Headers }): boolean {
  return req.method === "POST" && !!req.headers?.get("next-action");
}

export const config = {
  matcher: [
    "/((?!api/auth|api/worker|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|ico|css|js|map)).*)",
  ],
};
