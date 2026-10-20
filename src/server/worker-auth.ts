import { timingSafeEqual } from "node:crypto";

/**
 * Cloud staging (spec §4.3): the one secret check for the routes Supabase pg_cron calls (`/api/worker/*`). True only
 * when `CRON_SECRET` is set and non-empty and the `authorization` header is exactly `Bearer ${CRON_SECRET}`. An
 * unset secret never matches `Bearer ` or `Bearer undefined`. The lengths are compared first, because
 * timingSafeEqual throws on unequal lengths.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
