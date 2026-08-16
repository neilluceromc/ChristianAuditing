import { NextResponse } from "next/server";

/**
 * Clears the session cookie and lands on /login. Exists for STALE sessions —
 * a JWT whose user was deleted/disabled/role-changed would otherwise loop
 * forever: requireUser → /login → middleware sees a "signed-in" JWT → bounce
 * to the role landing → requireUser → … Middleware lets /logout through for
 * everyone. Interactive sign-out still uses the Auth.js signOut action.
 */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) {
    res.cookies.set(name, "", { maxAge: 0, path: "/" });
  }
  return res;
}
