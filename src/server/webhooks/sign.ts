import { createHmac } from "node:crypto";

/** Named once so the worker, any future docs page, and the tests agree. */
export const SIGNATURE_HEADER = "x-backroom-signature";

/**
 * HMAC-SHA256 over the exact bytes we POST, hex, prefixed with the algorithm so
 * a receiver can recognise a future scheme change instead of silently failing
 * every signature. The caller must sign the SAME string it sends — re-serialising
 * the object on either side is how signatures start disagreeing over key order.
 */
export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}
