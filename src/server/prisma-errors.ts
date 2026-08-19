import { Prisma } from "@prisma/client";
import { conflict, type ActionResult } from "@/server/action-result";

/**
 * Prisma throws rather than returning. P2028 (the transaction couldn't get a
 * connection — reachable with two concurrent transactions) and P2025 (the row
 * vanished between the read and the guarded write) are both designed conflicts
 * here, not 500s. Everything else rethrows: an unexpected error must never be
 * laundered into a friendly banner.
 *
 * PRECONDITION FOR CALLERS: `run` is expected to wrap a `prisma.$transaction`
 * callback. RETURNING a failure from that callback COMMITS the transaction —
 * only a throw rolls it back. So every `return conflict(...)` inside your
 * callback must precede every write in it; this helper has no way to check
 * that for you, and can't see your callback's body at all. Verify the
 * ordering holds at each call site, in a comment there — not here.
 */
export async function asActionResult<T>(
  run: () => Promise<T>,
  opts?: { goneMessage?: string },
): Promise<T | ActionResult<never>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2028") {
        return conflict("The database is busy right now — nothing was written. Try that again.");
      }
      if (err.code === "P2025") {
        return conflict(opts?.goneMessage ?? "That record no longer exists.");
      }
    }
    throw err;
  }
}
