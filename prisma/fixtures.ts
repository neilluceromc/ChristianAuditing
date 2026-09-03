/**
 * Seed fixture constants shared by `prisma/seed.ts` and the e2e suite.
 *
 * This exists because the seeded password was hardcoded in **fourteen places** —
 * `seed.ts` plus a `login` helper in every one of the eight spec files, and two
 * of those files also named it in a comment. That is §6a rules 26/37/38 exactly:
 * a contract string with no owner, where changing it means finding every copy and
 * a missed one fails as "wrong email or password" rather than as the edit it was.
 *
 * Nothing in `src/` imports this, deliberately — it is fixture data for a dev
 * database, not application code, so it must not be reachable from a bundle.
 */

/**
 * The password every seeded account carries.
 *
 * **NOTE THE ASYMMETRY, because it is real and deliberate:** `signupUser`
 * (`src/server/auth/actions.ts`) refuses anything under **10 characters**, so
 * this value is one the app's own signup would reject. That is fine and does not
 * break sign-in — `authorize` (`src/server/auth/index.ts`) does a plain
 * `bcrypt.compare` with no length rule, which is the correct place for the
 * asymmetry to live: a policy change must never lock out existing accounts. But
 * do not read this constant as evidence of what the password policy permits, and
 * do not use it as the fixture for a signup test — `e2e/auth-shell.spec.ts`'s
 * signup cases need their own ≥10-character value.
 *
 * Chosen by the user on 2026-08-24 for their own local deployment. The repo is
 * public, so treat this as what it is: a fixture for a loopback-only dev
 * database, never a credential for anything reachable.
 *
 * OVERRIDABLE via `SEED_PASSWORD`, and the fallback is deliberately still here:
 * the whole e2e suite imports this constant to log in, so removing the default
 * would mean every developer and every CI run had to set an env var before a
 * single test could pass. The protection that matters is in `seed.ts`, which
 * REFUSES to run under `NODE_ENV=production` unless the variable is set — and
 * the production image sets `NODE_ENV=production` in its Dockerfile, so seeding
 * a deployed stack with this published value is not something you can do by
 * forgetting. Reachability, not the constant, is what makes it dangerous.
 */
export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "admin123";
