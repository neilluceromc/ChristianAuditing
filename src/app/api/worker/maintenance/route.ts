import { cronAuthorized } from "@/server/worker-auth";
import { safeExpire, safePrune, safeSnapshot, snapshotMissing } from "@/worker/run";

/*
 * Cloud staging (spec §4.3): Supabase pg_cron calls this hourly at :05. Prune and hold expiry are idempotent and
 * log their own failures; today's snapshot is written only when the database has no row for today's Manila day, so
 * a second run in the same day writes nothing. No error escapes as a 500: a failed check or write is "failed".
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  await safePrune();
  await safeExpire();
  let snapshot: "written" | "exists" | "failed";
  try {
    const now = new Date();
    if (await snapshotMissing(now)) snapshot = (await safeSnapshot(now)) ? "written" : "failed";
    else snapshot = "exists";
  } catch (err) {
    console.error(`[worker] snapshot check failed: ${err instanceof Error ? err.message : String(err)}`);
    snapshot = "failed";
  }
  return Response.json({ snapshot });
}
