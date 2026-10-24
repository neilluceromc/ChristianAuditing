import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client"; // type-only: erased at build, edge-safe

/**
 * Edge-safe config: middleware.ts builds its own NextAuth instance from this.
 * NOTHING here may import Prisma or any Node-only API (Web Crypto is fine: it is global on the edge and in Node).
 */
export const authConfigEdge = {
  trustHost: true, // self-hosted behind localhost/LAN, not Vercel
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // cap a stale/terminated-user token at one workday

  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role as Role;
        // Users & access (spec §4.2): a provider that leaves these out (none does today) starts at 0, nothing owed.
        token.sessionVersion = typeof user.sessionVersion === "number" ? user.sessionVersion : 0;
        token.mustChangePassword = user.mustChangePassword === true;
      }
      if (trigger === "update") {
        const next = await provenSessionUpdate(token.id, session);
        if (next) {
          token.sessionVersion = next.sessionVersion;
          token.mustChangePassword = next.mustChangePassword;
        }
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      // A token issued before this release has neither field: version 0 is what every account started at, so it
      // stays signed in until the first bump, and is signed out by it.
      session.user.sessionVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      session.user.mustChangePassword = token.mustChangePassword === true;
      return session;
    },
  },
} satisfies NextAuthConfig;

/*
 * Users & access (spec §4.2): a session update may move the token's sessionVersion and mustChangePassword, e.g. after
 * someone changes their own password, so this device stays signed in while every other one is signed out. The
 * update endpoint (POST /api/auth/session) is open to the browser as well as to the server's `unstable_update`, so a
 * bare `{ sessionVersion }` would let a signed-out-everywhere token write itself the new version and survive. The
 * callback therefore takes the values only with a proof: an HMAC of (user id, version, flag) under a key derived from
 * AUTH_SECRET, made on the server by `signedSessionUpdate` (session-version.ts) and never sent to the browser.
 *
 * Rule for callers (review ⚠️c): sign only a version just produced by `bumpSessionVersion` in the same transaction,
 * with the mustChangePassword the row now holds, and never return the payload from a server action to the client.
 * Proofs don't follow Auth.js's AUTH_SECRET_1..3 rotation: after a rotation an in-flight proof is simply refused.
 */

const PROOF_CONTEXT = "cris.session-update.v1";
/** Fix round 1 (M-3): the HKDF label that separates this HMAC key from Auth.js's own use of the secret (JWE). */
const KEY_LABEL = "cris-session-update";

function authSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

/** HMAC-SHA256 key = HKDF-SHA256(AUTH_SECRET, salt = label, info = label). Web Crypto only, so edge-safe. */
async function proofKey(enc: TextEncoder): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", enc.encode(authSecret()), "HKDF", false, ["deriveKey"]);
  const label = enc.encode(KEY_LABEL);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: label, info: label },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/** The proof a session update must carry: hex HMAC-SHA256 of the user id and the two values. */
export async function sessionUpdateProof(userId: string, sessionVersion: number, mustChangePassword: boolean): Promise<string> {
  const enc = new TextEncoder();
  const key = await proofKey(enc);
  const message = `${PROOF_CONTEXT}|${userId}|${sessionVersion}|${mustChangePassword ? 1 : 0}`;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time for equal lengths; the length of a hex HMAC is public anyway. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The update's values when they are well formed and proven for this token's user; null otherwise (ignored). */
async function provenSessionUpdate(
  userId: string | undefined,
  data: unknown,
): Promise<{ sessionVersion: number; mustChangePassword: boolean } | null> {
  if (!userId || typeof data !== "object" || data === null) return null;
  const { sessionVersion, mustChangePassword, proof } = data as Record<string, unknown>;
  if (typeof sessionVersion !== "number" || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return null;
  if (typeof mustChangePassword !== "boolean" || typeof proof !== "string") return null;
  try {
    const expected = await sessionUpdateProof(userId, sessionVersion, mustChangePassword);
    return sameText(proof, expected) ? { sessionVersion, mustChangePassword } : null;
  } catch {
    return null; // no secret configured: no update can be proven
  }
}
