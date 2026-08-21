import { createHmac, randomBytes } from "node:crypto";

/**
 * Stripe/Slack-shaped signing, not GitHub's: signing the body alone made every
 * replay of a captured request byte-identical (same `id`, same `payload`, same
 * signature — nothing to reject a delivery a receiver already processed, an
 * admin's month-later "Replay", or an attacker's replay of a sniffed POST).
 *
 * The signed string is `` `${t}.${body}` ``, where `t` is Unix time in
 * SECONDS at the moment of signing — the timestamp is part of what's hashed,
 * not a sibling header, so a receiver can't strip it without invalidating the
 * signature. The header value is `t=<seconds>,v1=<hex>`: `v1` names the
 * *construction* (this exact "t.body" scheme), so a future change to how the
 * string is built is something a receiver can detect, unlike a bare `sha256=`
 * prefix that only ever named the algorithm.
 *
 * A receiver MUST: recompute the same `t.body` string, compare the digest
 * with a timing-safe equality function (never `===` on the hex strings), and
 * reject `t` outside a tolerance window — 5 minutes is the usual choice —
 * to bound how long a captured request stays replayable.
 *
 * `at` is a parameter rather than `Date.now()` inside, so the caller signs
 * the exact instant it sends (no drift between what's hashed and what's
 * logged) and so this stays testable without mocking the clock.
 */
export function signPayload(body: string, secret: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const hex = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
  return `t=${t},v1=${hex}`;
}

/** AAD binds ciphertext to its endpoint row — a secret lifted into another row refuses to decrypt. */
export function secretAad(endpointId: string): string {
  return `webhook:${endpointId}`;
}

/**
 * 256 bits, base64url-encoded — 43 characters, no padding. Lives here rather
 * than beside its only caller (`webhook-actions.ts`) because that file
 * carries `"use server"`, whose exports must be async server actions and so
 * can't include a plain sync helper — and because this shape is a contract
 * the worker (Task 10) also has to honour when it signs with the decrypted
 * value, same as `secretAad`.
 */
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
