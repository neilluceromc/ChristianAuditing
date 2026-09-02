/**
 * Where a scanned label sends a phone.
 *
 * Pure: no encoder, no React, no Prisma — the string that gets printed onto a
 * sticker is unit-testable without a browser, the same rule `label-geometry.ts`
 * follows.
 *
 * Split in two on purpose. The base URL is one config value and its validity
 * does not depend on the tag, so it is checked ONCE per sheet (`qrBase`) and
 * the per-label URL is then pure concatenation (`qrUrlFor`). That is what lets
 * the sheet render a single explanatory note instead of repeating a refusal on
 * all twelve labels.
 */

/** A discriminated union for the reason `BarcodeFit` is one: a caller must not
 *  be able to read a `prefix` that was never validated. `base.prefix` should
 *  not typecheck until `ok` is narrowed to `true`. */
export type QrBase =
  | { ok: true; prefix: string }
  | { ok: false; reason: "unset" | "not-absolute" | "loopback" | "bad-url" };

/**
 * Hosts that mean "the machine running the server", which is the one value
 * that must never reach a printed label: a QR built from it scans perfectly in
 * the office and is dead on every phone.
 *
 * `0.0.0.0` is here for a specific reason — `docker ps` renders this project's
 * own web service as `0.0.0.0:3000->3000/tcp`, so it is the value an operator
 * is most likely to copy by mistake.
 *
 * NOT exhaustive, and deliberately so: IPv6 has more spellings of loopback
 * than are worth normalising here (`http://[::ffff:127.0.0.1]` is accepted,
 * for instance, because the URL parser rewrites it to `[::ffff:7f00:1]`).
 * This covers what a human types into a `.env` file. The refusal is a guard
 * against a plausible mistake, not a security boundary.
 */
const UNREACHABLE_HOSTS = new Set(["localhost", "[::1]", "[::]", "0.0.0.0"]);

/** True for a dotted-quad IPv4 literal inside 127.0.0.0/8 — parsed as four
 *  octets rather than string-matched, so `127.co` and `127.0.0.1.evil.com`
 *  (both ordinary domain names) are not mistaken for loopback. */
function isLoopbackIpv4(host: string): boolean {
  const octets = host.split(".");
  if (octets.length !== 4) return false;
  if (!octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) return false;
  return octets[0] === "127";
}

export function qrBase(baseUrl: string | undefined): QrBase {
  const raw = (baseUrl ?? "").trim();
  if (raw === "") return { ok: false, reason: "unset" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "bad-url" };
  }

  // A bare "host:3000" parses as scheme "host:" with pathname "3000", so this
  // check is what catches the most natural wrong answer, not just exotic ones.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "not-absolute" };
  }
  // A trailing dot is the DNS root anchor: `localhost.` and `localhost` are the
  // same address to every resolver. It has to be stripped here because the URL
  // parser is asymmetric about it — it canonicalises an IPv4 literal, so
  // `0.0.0.0.` arrives as `0.0.0.0`, but it leaves a domain name alone, so
  // `localhost.` arrives with the dot still on and slipped past this guard
  // until it was normalised.
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // RFC 6761 reserves `.localhost` for loopback, so `dev.localhost` counts —
  // but `localhost.evil.com` does NOT, which is why this is a suffix test and
  // not a substring one.
  const isLocalhostName = host === "localhost" || host.endsWith(".localhost");
  if (UNREACHABLE_HOSTS.has(host) || isLocalhostName || isLoopbackIpv4(host)) {
    return { ok: false, reason: "loopback" };
  }

  // Trailing slashes are stripped rather than refused (the likeliest human
  // input), but any query or fragment on the base is dropped: this prefix has
  // a PATH concatenated onto it (`/inventory/scan/<tag>`), so carrying a query
  // through would strand it in the middle of the URL, before the path it was
  // meant to follow.
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, prefix: `${url.protocol}//${url.host}${path}` };
}

/**
 * The compact scan card (`/inventory/scan/<tag>`), NOT the full record.
 *
 * Keyed on the tag rather than the id because a cuid changes on every reseed
 * and this string is printed onto adhesive paper. Asset.tag is @unique, so
 * the card can find the row from it.
 *
 * `/inventory?q=<tag>` still redirects an exact tag match to the full record
 * and is untouched — that is the USB desk scanner's contract, guarded by
 * e2e/it-core.spec.ts. This function decides only where a PHONE lands.
 */
export function qrUrlFor(tag: string, base: { prefix: string }): string {
  return `${base.prefix}/inventory/scan/${encodeURIComponent(tag)}`;
}
