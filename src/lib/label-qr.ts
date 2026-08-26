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

/** Every spelling of "this machine". A QR built from any of them scans
 *  perfectly on the developer's laptop and is dead on every phone — which is
 *  the whole reason this validation exists rather than a default value. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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
  if (url.hostname === "") return { ok: false, reason: "bad-url" };

  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) || host.startsWith("127.")) {
    return { ok: false, reason: "loopback" };
  }

  // Trailing slashes are stripped rather than refused (the likeliest human
  // input), but any query or fragment on the base is dropped: this prefix is
  // concatenated with a path and its own `?q=`, so carrying one through would
  // build a URL with two query strings.
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, prefix: `${url.protocol}//${url.host}${path}` };
}

/**
 * `/inventory?q=<tag>` rather than `/inventory/<id>`: the list page already
 * redirects an exact tag match to that asset's record
 * (`src/app/(app)/inventory/page.tsx`), so this reuses a proven path instead of
 * adding a route — and it degrades usefully, since a reader that yields plain
 * text still shows a human something meaningful.
 */
export function qrUrlFor(tag: string, base: { prefix: string }): string {
  return `${base.prefix}/inventory?q=${encodeURIComponent(tag)}`;
}
