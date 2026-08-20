import { Prisma } from "@prisma/client";
import { conflict, type ActionResult } from "@/server/action-result";

/**
 * Prisma throws rather than returning. P2028 (the transaction couldn't get a
 * connection — reachable with two concurrent transactions), P2025 (the row
 * vanished between the read and the guarded write), and P2003 (a
 * `RESTRICT`-protected row this call checked and then tried to delete
 * acquired a new reference in between — see `deleteEndpoint` in
 * webhook-actions.ts: it counts `WebhookDelivery` rows, then deletes, and a
 * delivery landing in that gap raises exactly this) are all designed
 * conflicts here, not 500s. Everything else rethrows: an unexpected error
 * must never be laundered into a friendly banner.
 *
 * `policy-actions.ts` carries a private copy of this helper with its OWN
 * P2003 branch, for the opposite direction on that module's FK (a create
 * whose referenced row was deleted concurrently, not a delete whose
 * referencing row just appeared) — the two messages are not interchangeable;
 * don't merge the modules.
 *
 * `restrictedMessage` follows `goneMessage`'s shape exactly, and for the same
 * reason: P2003 can mean different things at different call sites (a row
 * that gained a reference vs. one whose reference vanished), so the generic
 * default below is deliberately vague — callers whose FK shape gives them a
 * more precise story should say it via the option, not by forking this file.
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
  opts?: { goneMessage?: string; restrictedMessage?: string },
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
      if (err.code === "P2003") {
        return conflict(
          opts?.restrictedMessage ??
            "Something referencing this was just created — refresh and try again.",
        );
      }
    }
    throw err;
  }
}
