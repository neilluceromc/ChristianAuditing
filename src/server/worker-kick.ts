import { after } from "next/server";
// Relative, not "@/": emit.ts imports this and is itself loaded by the worker under tsx.
import { isTicking } from "../lib/worker-state";

/** A kick is registered with `after` and its callback has not started yet; cleared when it starts. */
let scheduled = false;

/**
 * Cloud staging (spec §4.3): called right after something queues a job. On Vercel there is no long-running worker,
 * so this runs one budgeted tick once the response has been sent; the every-minute pg_cron call is the safety net
 * for anything an interrupted request leaves PENDING. Everywhere else it does nothing — the loop picks the job up
 * within 3 seconds.
 *
 * It never throws, never nests and never doubles up:
 * - Outside a request scope (the worker's executeApproval emitting a webhook), `after` throws; that is swallowed.
 * - Inside a tick (`isTicking()`), it returns at once, so a job that queues a job does not start a second run.
 * - While a kick is already scheduled and not yet started, a second call is a no-op: one request, one tick.
 */
export function kickWorker(): void {
  if (!process.env.VERCEL) return;
  if (isTicking() || scheduled) return;
  scheduled = true;
  try {
    after(async () => {
      scheduled = false;
      // Dynamic on purpose: run.ts → execute-approval → emit.ts → this file, so a static import would be circular.
      const { runTicks } = await import("@/worker/run");
      await runTicks({ workerId: "kick-" + Math.random().toString(36).slice(2, 10), budgetMs: 45_000 });
    });
  } catch {
    // Outside a request scope: nothing was registered, so nothing is scheduled. The cron tick works the job within
    // a minute.
    scheduled = false;
  }
}
