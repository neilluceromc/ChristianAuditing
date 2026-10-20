import { cronAuthorized } from "@/server/worker-auth";
import { recoverStale, runTicks } from "@/worker/run";

/*
 * Cloud staging (spec §4.3): Supabase pg_cron calls this every minute. It returns stale leases, then works jobs
 * until none is due or 45 s is spent. A job that throws is retried or dead-lettered inside tick(), exactly as the
 * loop does it, so one bad job never fails the route; anything else (the database unreachable) is logged and
 * answered as a 503 with a JSON body rather than escaping as a 500.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!cronAuthorized(req)) return new Response("Unauthorized", { status: 401 });
  try {
    const recovered = await recoverStale();
    const { done, budgetHit } = await runTicks({
      workerId: "cron-" + Math.random().toString(36).slice(2, 10),
      budgetMs: 45_000,
    });
    return Response.json({ recovered, done, budgetHit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] tick route failed: ${message}`);
    return Response.json({ error: message }, { status: 503 });
  }
}
