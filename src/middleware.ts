import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfigEdge } from "@/server/auth/config.edge";
import { pathAllowedForRole, ROLE_LANDING } from "@/lib/workspaces";

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

  // Signed-in users don't see login/signup; /bootstrap 404s server-side on its own.
  if (AUTH_PATHS.test(pathname) && !pathname.startsWith("/bootstrap")) {
    return NextResponse.redirect(new URL(ROLE_LANDING[user.role], req.nextUrl));
  }

  if (!pathAllowedForRole(pathname, user.role)) {
    // Forbidden is a server-side redirect to the role's own landing,
    // never a dead end (brief §8).
    return NextResponse.redirect(new URL(ROLE_LANDING[user.role], req.nextUrl));
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|ico|css|js|map)).*)",
  ],
};
