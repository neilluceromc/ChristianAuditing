# Phase 11 — Phone-scannable QR on the asset label: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Each printed asset label gains a QR code that, scanned with a phone, opens that asset's
record — the page that already says *"held by <name>"*.

**Architecture:** Three small pure modules feed one component edit. `label-qr.ts` validates the
configured base URL once and builds a per-tag URL. `qr.ts` wraps the QR dependency so its API touches
exactly one file. `label-geometry.ts` gains `qrFit`, sizing modules the way `barcodeFit` already sizes
bars. `label-sheet.tsx` renders the QR **below** the barcode. The QR encodes
`{APP_BASE_URL}/inventory?q={TAG}`, reusing the exact-tag redirect at
`src/app/(app)/inventory/page.tsx:39` — no new route, no new authorization surface.

**Tech Stack:** Next.js 15 Server Components · TypeScript · vitest (node env) · Playwright ·
`nayuki-qr-code-generator@1.8.0` (MIT, zero dependencies, ships its own types)

**Spec:** `docs/superpowers/specs/2026-08-26-label-qr-design.md` · **Branch:** `phase-11-label-qr`
(already cut, from `phase-10-polish`)

---

## Read this before Task 1

> ### AMENDED THROUGH EXECUTION — B-1 through B-11. The phase is code-complete; every task ran.
> **Of the eleven, the ones that were defects in THIS PLAN rather than in the implementations are B-1,
> B-2, B-3 and B-4 — and B-1 did not merely mislead, it broke the working environment.** The rest
> record deviations, verification results and the two physical checks no agent can close (B-11).
> **B-1. Task 2 Step 1's command was DESTRUCTIVE to the working environment.** As drafted it was
> `docker run … node:22-alpine sh -c "npm i -g npm@11 && npm install nayuki-qr-code-generator@1.8.0"` —
> a full install inside a container with the repo bind-mounted, which replaced `node_modules` with
> **Linux** binaries and broke the Windows host outright (`Cannot find module
> '@rollup/rollup-win32-x64-msvc'`). `README.md` documents this command **with `--package-lock-only`**
> for exactly that reason and the plan dropped the flag. A second consequence followed: npm 11's script
> allowlist skipped `@prisma/client`'s postinstall, leaving a stub client whose missing type exports
> broke `tsc --noEmit` across ~15 unrelated files. Recovery was `npm ci` then `npx prisma generate`.
> Step 1 now carries all three commands and says what each is for. **The lesson generalises past npm:
> a bind-mounted container writing anything other than the file you intended is a footgun, and "the
> README already documents this" is not the same as "the plan copied it correctly".**
>
> **B-2. Task 1's loopback guard accepted `0.0.0.0`, which is the one value an operator will actually
> paste.** The plan specified `LOOPBACK_HOSTS = {localhost, 127.0.0.1, ::1, [::1]}` plus
> `host.startsWith("127.")`, and a review found two holes, both reproduced by running the shipped code:
> `http://0.0.0.0:3000` returned `{ok: true}` — a QR that prints cleanly and is dead on every phone,
> which is the single failure the module exists to prevent — and **`docker ps` renders this project's
> own web service as `0.0.0.0:3000->3000/tcp`, so it is the likeliest wrong value in existence here.**
> Separately, `startsWith("127.")` is a string test standing in for a CIDR check: it refused `127.co`
> (a real purchasable domain), `127.evil.com` and `127.0.0.1.evil.com`. That direction fails safe, so it
> was the lesser bug. Fixed with a parsed dotted-quad check, an `UNREACHABLE_HOSTS` set including
> `0.0.0.0` and `[::]`, and `.localhost` handled per RFC 6761 as a suffix — so `dev.localhost` is
> refused while `localhost.evil.com`, a different machine entirely, is not. Two unreachable branches the
> review also caught (a bare `"::1"` that `url.hostname` never produces, since the parser always
> brackets IPv6, and an empty-hostname check the scheme test already intercepts) were deleted, and the
> comment claiming "every spelling of this machine" was rewritten to state what it does **not** cover:
> IPv6 has more spellings of loopback than are worth normalising for a sticker guard, and this is a
> guard against a plausible mistake, not a security boundary.
>
> **B-3. `localhost.` with a trailing dot slipped past the fixed guard too, and the cause is a URL-parser
> asymmetry worth knowing.** Found by the re-review after B-2 was closed. `new URL` **canonicalises** an
> IPv4 literal, so `http://0.0.0.0.:3000` arrives as hostname `0.0.0.0` and was already caught — but it
> leaves a **domain name** alone, so `http://localhost.:3000` arrives as `localhost.` and was accepted,
> returning `ok: true` for a host that is the same address as `localhost` to every resolver. Tools like
> `hostname -f` and `dig` emit the dotted form, so it is not exotic. Fixed by stripping a single
> trailing dot before the comparisons, and **verified by mutation** — removing the strip fails the
> loopback test on exactly `http://localhost.:3000`. The four trailing-dot cases are now pinned,
> including the two that already passed, so a future change to normalisation cannot quietly reintroduce
> half of it. **Three findings on one 70-line pure module, none of which a green suite would have shown:
> that is the argument for reviewing the rule rather than the diff, restated.**
>
> **B-4. Task 4 is NOT independently verifiable, and the plan implied it was.** Task 4 renders the QR
> gated on `base.ok`; nothing reaches that gate until Task 5 passes a `baseUrl`. So Task 4 shipped with
> no way to see whether it worked, on the phase's own riskiest edit. **Task 5 was pulled forward by the
> controller** (one line) so the rendering could be measured. Once it was, the measurements were clean:
> page box 209.996 × 296.999 mm · barcode height **9.000 mm** · barcode width 47.848 mm · QR footprint
> **20.497 mm** square (`qrFit` predicts 20.500) · calibration ruler **99.996 mm** · **0 cells clipped
> by `overflow: hidden`**. The silent-compression failure that once shipped an 89.38 mm ruler did not
> recur. **Lesson for the next plan: a task whose only output is rendered pixels must be sequenced
> with whatever makes those pixels reachable, or it cannot be reviewed at all.**
>
> **B-5. Task 8 was executed on `main`, out of order.** It is the only task in this plan independent of
> the QR, the defect was live and had just been made public by the Phase 10 push, and parking a
> one-line prose fix behind a phase the user had set aside would have left the accountability form
> lying indefinitely. Committed as `740571f` on `main`. It also deviates from this plan's drafted text:
> the draft additionally reworded "the signed **scan**" to "the signed **form**", which the defect does
> not require — and the two clauses using "scan" for *different things* (barcode-scanning, false;
> document-scanning, true) is very likely how the false half survived review in the first place.
>
> **B-6. Task 6's tests depend on an environment variable, and Playwright does load `.env` — verified,
> not assumed.** A test asserting the QR renders fails as "expected 1, got 0" when `APP_BASE_URL` is
> merely unset, which reads as a broken feature rather than an unconfigured one. The implementer
> checked empirically (a temporary `console.log` at describe scope) that `process.env.APP_BASE_URL` IS
> visible inside the test process: `@playwright/test` auto-loads `.env` when `dotenv` is present in
> `node_modules`, which it is. A precondition guard now names its own cause on failure.
>
> **B-7. Task 7 shipped a PLACEHOLDER hostname, because the user did not choose one.** Asked twice and
> deferred twice, so `.env.example` carries `http://inventory.example.local:3000` under a shouted
> must-change warning rather than blocking the phase. **The placeholder was run through `qrBase` before
> shipping** — a default the code would itself refuse would be worse than none. It validates and
> encodes correctly.
>
> **B-8. Step 3's refusal proof was driven by an env override, not by editing `.env`.** Next.js does not
> override an already-set `process.env` value, so `APP_BASE_URL=http://localhost:3000 npx playwright
> test …` exercises the loopback branch without touching the user's config. Result: **0 QRs, 1 barcode
> still rendered, and the sheet reading "No QR: APP_BASE_URL points at this machine, which no phone can
> reach."** — the cause-specific note, not a generic one. Done with a throwaway spec that was deleted
> afterwards.
>
> **B-9. The branch took a MERGE from `main`, not a rebase.** `git diff` showed zero file overlap
> between the two sides, so either was safe — but this project's docs and commit bodies cite SHAs
> heavily (the handover names `5b97d81`; a commit body references `f382041`), and a rebase would have
> rewritten every one of them into a dangling reference. Non-linear history is already the convention
> here, so the cost of merging is nil and the cost of rebasing was not.
>
> **B-10. The battery at this phase's close, all green:** `tsc` · `lint` · **818 unit / 49 files** ·
> `npm run build` · `docker compose --profile prod build` (3 images) · **149 e2e / 12 files** in four
> parts, measured: **51 · 58 · 34 · 6**. Part 2 grew from 56 to 58 (the two new label tests) and needed
> its `--global-timeout` raised. Axe moderates unchanged from Phase 10 — `empty-table-header` 9,
> `page-has-heading-one` 2, `landmark-unique` 1 — so nothing regressed.
>
> **B-11. Step 5 cannot be closed by an agent, and now there are TWO physical checks, not one.** The
> calibration bar still needs a tape measure, and the printed QR now needs a phone. Both hinge on the
> same setting: at "Fit to page" the QR modules and the ruler shrink together, so a failure there is a
> print-settings problem rather than a software one. `QR_PREFERRED_MODULE_MM` (0.5) and
> `QR_MIN_MODULE_MM` (0.4) remain the least-evidenced numbers in this phase — a judgement about phone
> optics that the physical read is meant to replace with a measurement.

**Conventions for every task:** branch `phase-11-label-qr` (already exists); run
`npx tsc --noEmit && npm run lint` before each commit; **NEVER run `npm run build` while a dev server is
running** (they share `.next`); no new migrations this phase. DB via `docker compose up -d db`, seed via
`npm run db:seed`. **Subagents must not start a dev server — the controller owns the preview.**
Commit style `feat(scope): …` / `fix(scope): …` / `docs(plan): …`.

**Facts already verified for you — do not re-derive, but do not silently contradict either:**

1. **The dependency works.** `nayuki-qr-code-generator@1.8.0` was installed in a scratch directory and
   exercised. `index.js` uses `export default` with no `"type": "module"` in its `package.json`, which
   looks like a packaging error — it is fine here because the project mandates `node >=22`, whose
   `require(esm)` support handles it, and because all `src/` code uses `import` anyway.
2. **The encoder's real API** (from its shipped `index.d.ts`):
   `qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM)` returns an object with `.version`,
   `.size`, and `.getModule(x, y): boolean`. `Ecc` members are `LOW | MEDIUM | QUARTILE | HIGH`.
   The default export is the `qrcodegen` namespace.
3. **A measured vector to pin tests against.** For
   `http://inventory.backroom.local:3000/inventory?q=BR-LT-0166` (59 bytes) at ECC `MEDIUM`, the
   encoder returns **version 4, size 33, mask 2, 559 dark modules of 1089**. These are observed values,
   not computed predictions.
4. **The horizontal budget is nearly spent, which is why the QR goes BELOW the barcode.**
   `LABEL_USABLE_MM` is 53.333. `BR-LT-0166` is 10 chars → `11*10 + 35 = 145` modules → at
   `PREFERRED_MODULE_MM` (0.33) the barcode is **47.85 mm**, leaving **5.48 mm**. Squeezing it to 28 mm
   gives 0.193 mm/module against a `MIN_MODULE_MM` of 0.19 — within 0.003 mm of `barcodeFit` returning
   `encodable: false` and the sticker printing "no scannable code".
5. **The cell has ~40 mm of spare height.** Content box is `69.25 − 2*5 = 59.25` mm and currently uses
   roughly 19 mm (chip row, tag, 9 mm barcode).
6. **The cell is a column flex with `justifyContent: space-between` and `overflow: hidden`.** An
   over-tall child does not overflow visibly — **it compresses its siblings silently.** That is exactly
   how the calibration ruler once shipped at 89.38 mm against a declared 100 mm (`A-16` of the Phase 10
   plan). Every element added to this cell gets `flexShrink: 0`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/label-qr.ts` **(create)** | Validate `APP_BASE_URL` once; build the per-tag URL. Pure — no encoder, no React. |
| `src/lib/label-qr.test.ts` **(create)** | Every validation branch and URL shape. |
| `src/lib/qr.ts` **(create)** | The **only** file that imports the QR dependency. Exposes a minimal matrix. |
| `src/lib/qr.test.ts` **(create)** | Pinned against the measured vector in fact 3. |
| `src/lib/label-geometry.ts` **(modify)** | Add `qrFit` + QR constants, in the existing union style. |
| `src/lib/label-geometry.test.ts` **(modify)** | `qrFit` sizing and refusal. |
| `src/components/inventory/label-sheet.tsx` **(modify)** | Render the QR below the barcode; sheet-level note when unconfigured. |
| `src/app/(app)/inventory/labels/page.tsx` **(modify)** | Read `process.env.APP_BASE_URL`, pass it down. |
| `e2e/labels.spec.ts` **(modify)** | QR presence, encoded URL, refusal surface, and the unchanged measurements. |
| `.env.example` **(modify)** | `APP_BASE_URL` with the hostname-vs-IP trade-off. |
| `README.md` **(modify)** | The QR section, and the password prerequisite it creates. |
| `src/app/(app)/employees/[id]/form/page.tsx` **(modify)** | Delete the false "scan the code" clause. |

---

### Task 1: `label-qr.ts` — validate the base URL, build the tag URL (TDD)

**Files:**
- Create: `src/lib/label-qr.ts`
- Test: `src/lib/label-qr.test.ts`

Nothing in this task touches the QR encoder. It is string work, and it is where the "dead link printed
onto adhesive paper" failure is prevented.

- [ ] **Step 1: Write the failing test**

Create `src/lib/label-qr.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { qrBase, qrUrlFor } from "./label-qr";

describe("qrBase", () => {
  it("accepts a hostname base and keeps its port", () => {
    expect(qrBase("http://inventory.backroom.local:3000")).toEqual({
      ok: true,
      prefix: "http://inventory.backroom.local:3000",
    });
  });

  it("accepts https", () => {
    expect(qrBase("https://inventory.example.com")).toEqual({
      ok: true,
      prefix: "https://inventory.example.com",
    });
  });

  // A trailing slash is normalised, not refused: it is the single most likely
  // way a human writes this value, and refusing it would print no QR at all.
  it("normalises a trailing slash", () => {
    expect(qrBase("http://host:3000/")).toEqual({ ok: true, prefix: "http://host:3000" });
    expect(qrBase("http://host:3000///")).toEqual({ ok: true, prefix: "http://host:3000" });
  });

  // A sub-path deployment must survive: dropping the path would 404 every scan.
  it("preserves a base path", () => {
    expect(qrBase("http://host:3000/inv/")).toEqual({ ok: true, prefix: "http://host:3000/inv" });
  });

  it("refuses an unset or blank value", () => {
    expect(qrBase(undefined)).toEqual({ ok: false, reason: "unset" });
    expect(qrBase("")).toEqual({ ok: false, reason: "unset" });
    expect(qrBase("   ")).toEqual({ ok: false, reason: "unset" });
  });

  // "inventory.local:3000" parses as scheme "inventory.local:" with path
  // "3000" — it is not a bare host, and a QR built from it would be dead.
  it("refuses a value with no http(s) scheme", () => {
    expect(qrBase("inventory.local:3000")).toEqual({ ok: false, reason: "not-absolute" });
    expect(qrBase("ftp://host")).toEqual({ ok: false, reason: "not-absolute" });
  });

  it("refuses something that is not a URL at all", () => {
    expect(qrBase("http://")).toEqual({ ok: false, reason: "bad-url" });
  });

  // THE defect this module exists to prevent: a QR that works on the dev
  // machine and is dead on every phone.
  it("refuses loopback in all its spellings", () => {
    for (const base of [
      "http://localhost:3000",
      "http://LOCALHOST:3000",
      "http://dev.localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.1.2.3:3000",
      "http://[::1]:3000",
      "http://[::]:3000",
      "http://0.0.0.0:3000",
      // Trailing DNS root dot. `new URL` canonicalises it away for an IPv4
      // literal but keeps it on a domain name, so these two slipped past the
      // guard while `http://0.0.0.0.:3000` never did.
      "http://localhost.:3000",
      "http://dev.localhost.:3000",
      "http://0.0.0.0.:3000",
      "http://127.0.0.1.:3000",
    ]) {
      expect(qrBase(base), base).toEqual({ ok: false, reason: "loopback" });
    }
  });
});

describe("qrUrlFor", () => {
  it("builds the exact-tag search URL the redirect already handles", () => {
    expect(qrUrlFor("BR-LT-0166", { prefix: "http://host:3000" })).toBe(
      "http://host:3000/inventory?q=BR-LT-0166",
    );
  });

  it("percent-encodes a tag that would otherwise break the query", () => {
    expect(qrUrlFor("BR LT/0166", { prefix: "http://host:3000" })).toBe(
      "http://host:3000/inventory?q=BR%20LT%2F0166",
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/lib/label-qr.test.ts
```

Expected: FAIL — `Failed to resolve import "./label-qr"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/label-qr.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run src/lib/label-qr.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Mutation-test the loopback guard**

Per §6a, a new pure rule gets its tests mutation-tested before they are trusted. Run all three and
report the actual failure output for each:

- delete `"0.0.0.0"` from `UNREACHABLE_HOSTS` → the loopback test must fail on that case;
- change `host.endsWith(".localhost")` to `host.includes("localhost")` → the
  `localhost.evil.com` test must fail;
- change `octets[0] === "127"` to `octets[0].startsWith("127")` → **must still pass.** It is a genuine
  no-op: `octets[0]` has already cleared `/^\d{1,3}$/` and `<= 255`, so no valid octet can carry
  `"127"` as a proper prefix. If it FAILS, the implementation differs from this plan — say so.

Revert each after observing it. A green suite under mutation 1 or 2 means that test is inert.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/label-qr.ts src/lib/label-qr.test.ts
git commit -m "feat(labels): where a scanned label sends a phone, and every way that can be wrong"
```

---

### Task 2: `qr.ts` — the one file that knows the dependency (TDD)

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/lib/qr.ts`
- Test: `src/lib/qr.test.ts`

- [ ] **Step 1: Add the dependency — lockfile in a Linux container, `node_modules` on the host**

`package-lock.json` is consumed by the Docker build, and a lockfile rewritten by Windows npm breaks
that build. But the container must write **only the lockfile**: the repo is bind-mounted, so a full
`npm install` in there replaces `node_modules` with **Linux** binaries and breaks the Windows host —
vitest dies immediately with `Cannot find module '@rollup/rollup-win32-x64-msvc'`. `--package-lock-only`
is what keeps it to the lockfile, and it is why `README.md` documents the flag.

Three commands, in order, from Git Bash or WSL:

```bash
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only nayuki-qr-code-generator@1.8.0"
npm ci
npx prisma generate
```

`npm ci` installs from the freshly-updated lockfile with host-platform binaries and never rewrites the
lockfile. `npx prisma generate` is not optional housekeeping: npm 11's script allowlist can skip
`@prisma/client`'s postinstall, leaving a stub client whose missing type exports break `tsc --noEmit`
across roughly fifteen unrelated files. It is pure codegen from `schema.prisma` — no database access.

Then confirm what landed, and that it brought nothing with it:

```bash
npm ls nayuki-qr-code-generator
git diff --stat package.json package-lock.json
```

Expected: `nayuki-qr-code-generator@1.8.0` with no child dependencies, and **only those two files**
changed. If `git status` shows anything else, stop and report it.

- [ ] **Step 2: Write the failing test**

Create `src/lib/qr.test.ts`. Every number here is an OBSERVED value from running the encoder, not a
prediction — see fact 3 of "Read this before Task 1".

```ts
import { describe, expect, it } from "vitest";
import { qrMatrix } from "./qr";

const URL_59 = "http://inventory.backroom.local:3000/inventory?q=BR-LT-0166";

describe("qrMatrix", () => {
  // Pinned to a measured vector. If the dependency is ever swapped, THIS is
  // the test that says whether the replacement encodes identically.
  it("encodes a realistic label URL at the observed version and size", () => {
    const m = qrMatrix(URL_59);
    expect(URL_59.length).toBe(59);
    expect(m.version).toBe(4);
    expect(m.size).toBe(33);
  });

  // The three finder patterns are always dark at their outer corners. This is
  // a structural invariant of QR, so it holds for any payload — a cheap check
  // that we are reading a real symbol and not an empty matrix.
  it("places dark finder modules at the three corners", () => {
    const m = qrMatrix(URL_59);
    expect(m.isDark(0, 0)).toBe(true);
    expect(m.isDark(m.size - 1, 0)).toBe(true);
    expect(m.isDark(0, m.size - 1)).toBe(true);
  });

  // A QR is roughly half dark by construction; a matrix that is all-dark or
  // all-light means we are rendering garbage that would still LOOK like a code.
  it("produces a plausible dark-module ratio", () => {
    const m = qrMatrix(URL_59);
    let dark = 0;
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.isDark(x, y)) dark++;
    expect(dark).toBe(559);
    expect(dark / (m.size * m.size)).toBeGreaterThan(0.3);
    expect(dark / (m.size * m.size)).toBeLessThan(0.7);
  });

  // Version must follow the payload, never be assumed: the realistic URL above
  // clears version 4's 62-byte capacity by THREE bytes.
  it("grows the version as the payload grows", () => {
    expect(qrMatrix("http://a.io/inventory?q=BR-LT-0166").version).toBeLessThan(
      qrMatrix(`${URL_59}${"x".repeat(40)}`).version,
    );
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run src/lib/qr.test.ts
```

Expected: FAIL — `Failed to resolve import "./qr"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/qr.ts`:

```ts
import qrcodegen from "nayuki-qr-code-generator";

/**
 * The ONLY file in this codebase that imports the QR dependency.
 *
 * Unlike `code128.ts`, which is hand-rolled, QR is Reed–Solomon over GF(256)
 * plus eight mask patterns scored by four penalty rules. A subtly wrong
 * implementation fails on SOME readers and not others, which is exactly what
 * masking and error correction exist to prevent — so this is a vetted
 * dependency by decision, recorded in the spec's §0.6.
 *
 * Wrapping it in this three-line surface means a future swap touches one file
 * and is answerable by one test (`qr.test.ts` pins a measured vector).
 */
export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. 21 at version 1, +4 per version. */
  readonly size: number;
  /** 1–40. Derived from the payload by the encoder, never chosen here. */
  readonly version: number;
  isDark(x: number, y: number): boolean;
}

/**
 * ECC level MEDIUM (~15% recoverable). LOW would fit a longer URL into a
 * smaller symbol, but these are stickers on hardware that gets handled — a
 * scuffed label with error correction still reads.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  return {
    size: qr.size,
    version: qr.version,
    isDark: (x, y) => qr.getModule(x, y),
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
npx vitest run src/lib/qr.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint
git add package.json package-lock.json src/lib/qr.ts src/lib/qr.test.ts
git commit -m "feat(labels): a QR encoder behind a three-line surface, pinned to a measured vector"
```

---

### Task 3: `qrFit` — sizing, and the refusal (TDD)

**Files:**
- Modify: `src/lib/label-geometry.ts`
- Test: `src/lib/label-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/label-geometry.test.ts`:

```ts
describe("qrFit", () => {
  // Version 4 (33 modules) is what a realistic label URL produces. Below the
  // width cap, so it gets the full preferred module size.
  it("gives a version-4 symbol the full preferred module size", () => {
    const fit = qrFit(33);
    expect(fit.renderable).toBe(true);
    if (!fit.renderable) return;
    expect(fit.moduleMm).toBeCloseTo(QR_PREFERRED_MODULE_MM, 6);
    // Footprint includes the mandatory 4-module quiet zone on all sides, which
    // is what actually competes for space on the label — not the dark area.
    expect(fit.sizeMm).toBeCloseTo((33 + 2 * QR_QUIET_MODULES) * QR_PREFERRED_MODULE_MM, 6);
    expect(fit.sizeMm).toBeCloseTo(20.5, 6);
  });

  // Past the cap the module shrinks rather than the symbol growing without
  // bound — the same trade `barcodeFit` makes against LABEL_USABLE_MM.
  it("caps the dark area and lets the module shrink for a big symbol", () => {
    const fit = qrFit(53); // version 9
    expect(fit.renderable).toBe(true);
    if (!fit.renderable) return;
    expect(fit.moduleMm).toBeCloseTo(QR_MAX_DARK_MM / 53, 6);
    expect(fit.moduleMm).toBeLessThan(QR_PREFERRED_MODULE_MM);
    expect(fit.moduleMm).toBeGreaterThanOrEqual(QR_MIN_MODULE_MM);
  });

  it("refuses a symbol whose modules fall under the phone-camera floor", () => {
    // 61 modules is version 11: 24/61 = 0.393mm, under the 0.4mm floor.
    expect(qrFit(61)).toEqual({ renderable: false });
  });

  it("refuses a size that is not a legal QR module count", () => {
    expect(qrFit(0)).toEqual({ renderable: false });
    expect(qrFit(20)).toEqual({ renderable: false });
    expect(qrFit(24)).toEqual({ renderable: false }); // 21+4n only
    expect(qrFit(33.5)).toEqual({ renderable: false });
    expect(qrFit(181)).toEqual({ renderable: false }); // past version 40
  });

  // The floor must be a real boundary, not decoration: 57 is the largest legal
  // size that clears it and 61 is the smallest that does not.
  it("puts the accept/refuse boundary between version 10 and version 11", () => {
    expect(qrFit(57).renderable).toBe(true);
    expect(qrFit(61).renderable).toBe(false);
  });
});
```

Add `qrFit`, `QR_PREFERRED_MODULE_MM`, `QR_MIN_MODULE_MM`, `QR_MAX_DARK_MM` and `QR_QUIET_MODULES` to
that file's existing import from `./label-geometry`.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/lib/label-geometry.test.ts
```

Expected: FAIL — `qrFit is not exported` / is not a function.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/label-geometry.ts`:

```ts
/** QR mandates 4 clear modules on every side. This is not padding to taste —
 *  a reader may fail without it, and it is what actually competes for space
 *  on the label: the footprint is `modules + 8`, not `modules`. */
export const QR_QUIET_MODULES = 4;

/**
 * Phone-camera module sizes, and the two least certain numbers in this feature.
 *
 * NOT `MIN_MODULE_MM` (0.19), which was chosen for a handheld laser scanner —
 * a phone camera at arm's length tolerates less. These are a judgement about
 * optics, not a measured result: the physical read test (spec §4) is what
 * validates or corrects them, and the outcome should be recorded against
 * these constants so a future change argues with a measurement.
 */
export const QR_PREFERRED_MODULE_MM = 0.5;
export const QR_MIN_MODULE_MM = 0.4;

/** The cap on the dark area's edge, past which the module shrinks instead of
 *  the symbol growing. The cell has roughly 40mm of spare height, so this
 *  leaves comfortable room (worst case footprint is ~27.9mm at version 8). */
export const QR_MAX_DARK_MM = 24;

export type QrFit =
  | { renderable: true; moduleMm: number; sizeMm: number }
  | { renderable: false };

/**
 * Deliberately the same shape as `barcodeFit`: take the preferred module size
 * unless the symbol is too big for its budget, then refuse below the floor.
 * Reading the two side by side should show one idea, not two.
 *
 * `modules` comes from the encoder (`qrMatrix().size`), never from a guess —
 * the realistic label URL clears version 4's capacity by three bytes, so a
 * hardcoded version would be a bug that only appears for longer hostnames.
 *
 * Legal QR sizes are 21 + 4n for versions 1–40, i.e. 21…177.
 */
export function qrFit(modules: number): QrFit {
  const legal =
    Number.isInteger(modules) && modules >= 21 && modules <= 177 && (modules - 21) % 4 === 0;
  if (!legal) return { renderable: false };

  const moduleMm = Math.min(QR_PREFERRED_MODULE_MM, QR_MAX_DARK_MM / modules);
  if (moduleMm < QR_MIN_MODULE_MM) return { renderable: false };

  return { renderable: true, moduleMm, sizeMm: (modules + 2 * QR_QUIET_MODULES) * moduleMm };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx vitest run src/lib/label-geometry.test.ts
```

Expected: PASS — the pre-existing geometry tests plus 4 new ones.

- [ ] **Step 5: Mutation-test the floor**

Change `moduleMm < QR_MIN_MODULE_MM` to `moduleMm < 0` and re-run. **Expected: the version-11 refusal
test and the boundary test both FAIL.** Then change `Math.min` to `Math.max` and re-run. **Expected:
the version-4 preferred-size test FAILS.** Revert both. A green suite under either mutation means those
tests prove nothing.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit && npm run lint
git add src/lib/label-geometry.ts src/lib/label-geometry.test.ts
git commit -m "feat(labels): QR sizing, with a phone-camera floor that actually refuses"
```

---

### Task 4: Render the QR below the barcode

**Files:**
- Modify: `src/components/inventory/label-sheet.tsx`

**This is the risky task.** The cell is a column flex with `overflow: hidden`, so a too-tall child does
not overflow — it compresses its siblings, which is how the calibration ruler once shipped at 89.38 mm.

- [ ] **Step 1: Add the imports**

In `src/components/inventory/label-sheet.tsx`, extend the existing imports:

```ts
import { code128Modules } from "@/lib/code128";
import { qrBase, qrUrlFor, type QrBase } from "@/lib/label-qr";
import { qrMatrix } from "@/lib/qr";
import {
  CALIBRATION_MM, LABEL_CELL_MM, LABEL_COLUMNS, LABEL_PADDING_MM, LABEL_USABLE_MM,
  PAGE_MARGIN_MM, PAGE_MM, QR_QUIET_MODULES, barcodeFit, labelPages, qrFit,
} from "@/lib/label-geometry";
```

- [ ] **Step 2: Add the `Qr` component**

Insert directly after the existing `Barcode` component (after its closing `}`):

```tsx
/**
 * The quiet zone is drawn as a white rect inside the viewBox rather than left
 * to CSS margin: it is part of the symbol, and a margin could be collapsed or
 * overridden by a print stylesheet without anything looking wrong.
 */
function Qr({ url }: { url: string }) {
  const matrix = qrMatrix(url);
  const fit = qrFit(matrix.size);
  // Cause-neutral, and consistent with Barcode's refusal above: a code too
  // fine for a phone to read is worse than no code, because the sticker looks
  // finished either way. The tag text on the label is still human-readable.
  if (!fit.renderable) {
    return (
      <span style={{ fontSize: "2.4mm", color: "#B42318", fontFamily: "monospace" }}>
        no scannable QR
      </span>
    );
  }

  const total = matrix.size + 2 * QR_QUIET_MODULES;
  const dark: React.ReactElement[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.isDark(x, y)) {
        dark.push(
          <rect
            key={`${x}-${y}`}
            x={x + QR_QUIET_MODULES}
            y={y + QR_QUIET_MODULES}
            width={1}
            height={1}
            fill="#000"
          />,
        );
      }
    }
  }

  return (
    <svg
      width={`${fit.sizeMm}mm`}
      height={`${fit.sizeMm}mm`}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={`QR ${url}`}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={total} height={total} fill="#fff" />
      {dark}
    </svg>
  );
}
```

The accessible name is the **URL**, not the tag — Task 6's e2e reads the encoded target out of it, and
a name of "QR BR-LT-0166" would let a wrong URL pass.

- [ ] **Step 3: Thread the base URL through `LabelSheet`**

Change the signature and add the per-sheet validation:

```tsx
export function LabelSheet({ rows, baseUrl }: { rows: LabelRow[]; baseUrl?: string }) {
  const byTag = new Map(rows.map((r) => [r.tag, r]));
  // Validated ONCE: the reason a base URL is unusable never depends on the tag,
  // so this is one note per sheet rather than the same refusal on twelve labels.
  const base = qrBase(baseUrl);
```

- [ ] **Step 4: Render the QR inside the cell**

Replace the barcode block at the end of each cell:

```tsx
                <div style={{ width: `${LABEL_USABLE_MM}mm`, flexShrink: 0 }}>
                  <Barcode tag={tag} />
                </div>
```

with the barcode **plus** the QR:

```tsx
                {/* flexShrink: 0 on BOTH, for the reason the calibration bar
                    carries it: this cell is a column flex with overflow
                    hidden, so an over-tall child is not clipped visibly — it
                    silently squeezes its siblings, which is how the ruler
                    once measured 89.38mm against a declared 100mm. */}
                <div style={{ width: `${LABEL_USABLE_MM}mm`, flexShrink: 0 }}>
                  <Barcode tag={tag} />
                </div>
                {base.ok && (
                  <div style={{ flexShrink: 0, lineHeight: 0 }}>
                    <Qr url={qrUrlFor(tag, base)} />
                  </div>
                )}
```

`lineHeight: 0` stops the inline SVG's line box adding a stray millimetre or two below it — invisible on
screen, and exactly the kind of drift that eats a print budget.

- [ ] **Step 5: Add the sheet-level note when there is no QR**

Inside the calibration caption's flex container, after the existing explanatory `<span>`, add:

```tsx
            {!base.ok && (
              /* Rule 10: every refusal the rule can return gets a surface. A
                 sheet that silently omits QR codes looks finished and is not
                 — an operator would stick 200 labels before noticing. */
              <span style={{ minWidth: 0, color: "#B42318" }}>
                {QR_NOTE[base.reason]}
              </span>
            )}
```

And define the map above `LabelSheet`:

```tsx
/** Named per cause, because "QR unavailable" would send someone hunting the
 *  wrong thing — a loopback base URL and a missing one need different fixes. */
const QR_NOTE: Record<Exclude<QrBase, { ok: true }>["reason"], string> = {
  unset: "No QR: APP_BASE_URL is not set.",
  "not-absolute": "No QR: APP_BASE_URL needs an http:// or https:// scheme.",
  loopback: "No QR: APP_BASE_URL points at this machine, which no phone can reach.",
  "bad-url": "No QR: APP_BASE_URL is not a valid URL.",
};
```

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both clean. `LabelSheet`'s caller does not yet pass `baseUrl`, which is fine — it is optional,
and Task 5 wires it.

- [ ] **Step 7: Commit**

```bash
git add src/components/inventory/label-sheet.tsx
git commit -m "feat(labels): render the QR below the barcode, with flexShrink on both"
```

---

### Task 5: Wire `APP_BASE_URL` into the labels page

**Files:**
- Modify: `src/app/(app)/inventory/labels/page.tsx`

- [ ] **Step 1: Pass the env var down**

Change the render at the end of the file:

```tsx
      <LabelSheet rows={rows} />
```

to:

```tsx
      <LabelSheet rows={rows} baseUrl={process.env.APP_BASE_URL} />
```

Read here rather than inside the component: this page is a Server Component and the sheet is a pure
render of its props, which is what keeps `label-sheet.tsx` testable through Playwright without an
environment stub.

- [ ] **Step 2: Typecheck, lint, commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/(app)/inventory/labels/page.tsx"
git commit -m "feat(labels): read APP_BASE_URL where the sheet is rendered"
```

---

### Task 6: E2E — the QR, its URL, its refusal, and the measurements that must not move

**Files:**
- Modify: `e2e/labels.spec.ts`

- [ ] **Step 1: Add the tests**

Append inside the existing `test.describe("label sheet", …)` block:

```ts
  test("each label carries a QR whose encoded URL is the exact-tag search", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/labels?ids=${asset.id}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });

    // The accessible name carries the encoded URL, so this asserts the PAYLOAD
    // rather than the presence of a square. A QR pointing at the wrong place
    // would pass a presence check.
    const qr = page.getByRole("img", { name: /^QR / });
    await expect(qr).toHaveCount(1);
    const name = await qr.getAttribute("aria-label");
    expect(name).toMatch(/^QR https?:\/\/.+\/inventory\?q=BR-LT-0148$/);
    expect(name).not.toMatch(/localhost|127\./);
  });

  test("the QR does not steal the barcode's width or the ruler's length", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/labels?ids=${asset.id}`);
    await expect(page.getByRole("img", { name: "Barcode BR-LT-0148" })).toBeVisible({ timeout: 30_000 });

    // A-16's class of bug, guarded in the direction the QR made possible: the
    // cell is a column flex with overflow hidden, so a too-tall QR compresses
    // these instead of overflowing. Both are MEASURED, not asserted visible.
    const pageBox = await page.locator(".label-page").first().boundingBox();
    expect(pageBox?.width).toBeCloseTo(PAGE_MM.width * MM_TO_PX, 1);
    expect(pageBox?.height).toBeCloseTo(PAGE_MM.height * MM_TO_PX, 1);

    const barcode = await page.getByRole("img", { name: "Barcode BR-LT-0148" }).boundingBox();
    expect(barcode?.height).toBeCloseTo(9 * MM_TO_PX, 1);

    const rulerWidths = await page.evaluate(() =>
      Array.from(document.querySelectorAll("span"))
        .filter((s) => (s as HTMLElement).style.height === "1.5mm")
        .map((s) => s.getBoundingClientRect().width),
    );
    expect(rulerWidths.length).toBeGreaterThan(0);
    for (const w of rulerWidths) expect(w).toBeCloseTo((CALIBRATION_MM * 96) / 25.4, 1);
  });
```

- [ ] **Step 2: Run them and read the count**

```bash
npx playwright test e2e/labels.spec.ts --workers=1 --global-timeout=540000
```

Expected: 11 passed (the pre-existing 9 plus 2). **Read the count** — a run that hits
`--global-timeout` prints "N did not run" and its tail reads like a pass.

- [ ] **Step 3: Prove the refusal surface, then restore**

The refusal path is config-driven, so drive it with the environment rather than a fixture. With the
dev server stopped, ask the controller to restart the preview with `APP_BASE_URL` unset, then:

```bash
npx playwright test e2e/labels.spec.ts --workers=1 -g "QR" --global-timeout=300000
```

Expected: the encoded-URL test FAILS (no QR rendered) and the sheet shows
`No QR: APP_BASE_URL is not set.` **This is a manual confirmation, not a committed test** — the suite
runs against one server configuration and a test that mutates process env mid-run would race the other
files. Record what you saw in the commit message.

- [ ] **Step 4: Commit**

```bash
git add e2e/labels.spec.ts
git commit -m "test(e2e): the QR's payload, and the measurements it must not disturb"
```

---

### Task 7: `.env.example` and the README

**Files:**
- Modify: `.env.example`, `README.md`

- [ ] **Step 1: Add the env var**

Append to `.env.example`:

```
# Phase 11+: the absolute base URL a printed label's QR code sends a phone to.
# REQUIRED for QR codes; without it labels still print their Code 128 barcode
# and the sheet says why. There is deliberately no default — a default here
# would be a dead link printed onto adhesive paper.
#
# Use a HOSTNAME you control, not the server's IP: whatever is set here is
# baked into every sticker permanently, and a DHCP renewal or a machine swap
# would kill every label already stuck to a device. A localhost/127.x value is
# refused, because it scans perfectly on this machine and on no phone.
APP_BASE_URL=http://inventory.example.local:3000
```

- [ ] **Step 2: Document it in the README**

In `README.md`, add to the Secrets section's list (it is configuration, not a secret, so say so), and
add a short subsection after "Seeded accounts":

```markdown
## Scanning a label with a phone

Each printed label carries two codes. The **Code 128 barcode** is for a USB handheld scanner, which
behaves as a keyboard — it types the asset tag and presses Enter, which is what the offboarding
wizard's scanner listens for. The **QR code** is for a phone: it holds
`{APP_BASE_URL}/inventory?q={TAG}`, and the inventory list redirects an exact tag match to that
asset's record, which shows who currently holds it.

Set `APP_BASE_URL` to a hostname you control (see `.env.example`). Without it, labels print the
barcode only and the sheet says so rather than printing a dead QR.

**This makes changing the seeded password a prerequisite, not a suggestion.** A phone scanning a
label has to reach this app over the network, and `web` already publishes port 3000 on **all**
interfaces (unlike the database, which is loopback-only). There is **no HTTPS**, so every sign-in
crosses the network in plaintext. Before you print labels and hand phones to staff: change every
seeded password, and put the app behind a reverse proxy with TLS if it will be reachable beyond a
trusted LAN.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: APP_BASE_URL, and the password prerequisite a scannable label creates"
```

---

### Task 8: Delete the accountability form's false claim

**Files:**
- Modify: `src/app/(app)/employees/[id]/form/page.tsx`

That sheet prints *"scan the code to open this record"* and **there is no code on it** — the file
imports no barcode renderer, and nothing in the repo rendered QR before this phase. Rule 16, on paper.

- [ ] **Step 1: Fix the line**

At `src/app/(app)/employees/[id]/form/page.tsx`, change:

```tsx
        <p className="font-mono text-[8.5px] text-[#667085]">
          {employee.employeeNo} · scan the code to open this record · the signed scan uploads back into the equipment&apos;s documents
        </p>
```

to:

```tsx
        {/* There is no code on this sheet — this file renders no barcode and no
            QR — so the clause that promised one has been removed rather than
            reworded. Putting a real QR here is deliberately out of Phase 11's
            scope (spec §0.7): a different sheet, a different payload, and a
            different reader from the asset label's. */}
        <p className="font-mono text-[8.5px] text-[#667085]">
          {employee.employeeNo} · the signed form uploads back into the equipment&apos;s documents
        </p>
```

- [ ] **Step 2: Confirm nothing asserted the old wording**

```bash
grep -rn "scan the code" e2e/ src/
```

Expected: no matches. If an e2e asserts that string, update it in this commit.

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit && npm run lint
git add "src/app/(app)/employees/[id]/form/page.tsx"
git commit -m "fix(employees): the accountability form promised a code it does not print"
```

---

### Task 9: Battery and close-out

- [ ] **Step 1: The battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
docker compose --profile prod build
```

Expected: 3 images built. **Then clear `.next` before the e2e suite** — `build` and `next dev` share it
and their outputs are incompatible. Be aware that doing so makes the suite compile cold, which is what
tipped `it-core.spec.ts:126` in Phase 10 (§6a rules 90 and 91): an empty `main` in a failure snapshot
means "waiting on a server render", not "wrong page".

- [ ] **Step 2: The e2e suite in four parts**

```bash
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/scanner.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```

Baseline to beat: 51 · 56 · 34 · 6 = **147**. This phase adds 2, so part 2 should read **58** and the
total **149**. Part 2's timeout is raised because it grew. **Check every count.**

- [ ] **Step 3: Amend this plan**

Every task whose code deviated gets an `AMENDED` banner saying what and why, numbered from `B-1`
(Phase 10 used `A-1…A-44`; a fresh letter keeps the two phases' amendments distinguishable).

- [ ] **Step 4: Update `docs/HANDOVER.md`**

Header (phases, battery numbers, push state as it actually is). §0 gains Phase 11. §4 gains a Phase 11
paragraph. §6a gains this phase's rules. §8 loses nothing and **gains the QR's physical read result if
Step 5 has been done**.

- [ ] **Step 5: The one thing no test can do**

Print a sheet at **Scale 100%, A4, Margins None** and scan a QR with a phone. Record: the phone, whether
it read first time, the distance, and the measured module size against `QR_PREFERRED_MODULE_MM` (0.5) and
`QR_MIN_MODULE_MM` (0.4) — those two constants are a judgement, and this is the measurement that
replaces it. **Needs a human, a printer and a phone; no agent can close it.**

- [ ] **Step 6: Finish the branch**

`superpowers:finishing-a-development-branch`. **Merging and pushing are the user's decisions** —
present the options and wait. Note that this branch sits on top of `phase-10-polish`, which is itself
unmerged, so the merge question is about both.

---

## Out of scope, deliberately

- **No public/anonymous asset page.** A sticker anyone can photograph must not name the holder.
- **No new route.** `?q=` already redirects.
- **No QR on the accountability form.** Task 8 removes a false claim; it does not add a feature.
- **No HTTPS work.** Task 7 documents the exposure; closing it is its own phase.
- **No change to Code 128, the calibration bar, the grid, or pagination.** If any of those numbers move,
  something has gone wrong — Task 6 Step 2 is the guard.

---

## Added 2026-09-02 — Tasks 10–12, after spec decision 8 reversed decision 3

The QR reads on paper (confirmed by the user on a printed sheet), but it lands on the full inventory
record, which answers "who holds this" only after everything else. These three tasks add a compact scan
card and repoint the QR at it. **The `/inventory?q=TAG` redirect is NOT touched** — it is the desk
scanner's contract and `e2e/it-core.spec.ts:126` guards it.

---

### Task 10: The scan card

**Files:**
- Create: `src/app/(app)/inventory/scan/[tag]/page.tsx`
- Modify: `e2e/labels.spec.ts`

**No unit test.** This is a Server Component doing one Prisma read; vitest here is `environment: "node"`
and this project covers component behaviour with Playwright by design. Do not invent a component test.

- [ ] **Step 1: Write the page**

Create `src/app/(app)/inventory/scan/[tag]/page.tsx`:

```tsx
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/guards";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";

/**
 * Where a scanned label QR lands. Deliberately NOT the full record: a phone
 * held next to a device should answer "whose is this, and is it healthy?"
 * without scrolling.
 *
 * Keyed on the TAG, never on the id. Cuids change on every reseed — the seed
 * TRUNCATEs and reinserts, and every e2e spec reseeds in its own beforeAll —
 * so a QR encoding an id would die the first time anyone ran the suite, on
 * paper already stuck to hardware. Asset.tag is @unique, so this is a natural
 * findUnique.
 *
 * Gating comes from the general /inventory PATH_RULES entry, which this route
 * matches by living under /inventory/. That is deliberate: PATH_RULES is
 * first-match-wins, three separate comments in that file warn about ordering,
 * and adding nothing to it is the safest possible change. The static `scan`
 * segment wins over the sibling [id] route the same way /inventory/labels
 * already does.
 *
 * Reading Prisma inline rather than via queries.ts follows the accountability
 * form page, which does the same for the same reason: one read, no reuse.
 */
export default async function ScanCardPage({ params }: { params: Promise<{ tag: string }> }) {
  await requireUser();
  const { tag: raw } = await params;
  const tag = decodeURIComponent(raw).trim().toUpperCase();

  const asset = await prisma.asset.findUnique({
    where: { tag },
    select: {
      id: true,
      tag: true,
      model: true,
      serial: true,
      status: true,
      purchasedAt: true,
      warrantyUntil: true,
      category: { select: { name: true } },
      assignee: {
        select: {
          id: true,
          name: true,
          employeeNo: true,
          employment: true,
          department: { select: { name: true } },
        },
      },
    },
  });

  // NOT notFound(): a sticker outlives the row it names. Assets get disposed
  // and the label stays on the hardware, so a miss is an expected outcome of
  // scanning, not an error. Name the tag back so the person holding the thing
  // knows the scan worked and the record is what is gone.
  if (!asset) {
    return (
      <>
        <PageHeader title="Unknown tag" breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]} />
        <Banner tone="attention" title={`No asset is registered as ${tag}.`}>
          The label may belong to an asset that has been disposed, or the code may have been misread.
        </Banner>
        <div className="pt-3"><ButtonLink href="/inventory">Back to inventory</ButtonLink></div>
      </>
    );
  }

  const rows: Array<[string, string]> = [
    ["Held by", asset.assignee ? `${asset.assignee.name} · ${asset.assignee.employeeNo}` : "Unassigned"],
    ["Department", asset.assignee ? asset.assignee.department.name : "—"],
    ["Employment", asset.assignee ? asset.assignee.employment : "—"],
    ["Category", asset.category.name],
    ["Purchased", fmtDate(asset.purchasedAt)],
    ["Warranty", fmtDate(asset.warrantyUntil)],
    ["Serial", asset.serial ?? "—"],
  ];

  return (
    <>
      <PageHeader
        title={asset.tag}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Scan" }]}
        badge={<StatusPill value={asset.status} />}
      />
      <p className="-mt-2 pb-4 text-[13px] text-fg-secondary">{asset.model}</p>

      {/*
        Cost, vendor, repair quote and notes are deliberately absent. This page
        is reachable by anyone physically holding the device who has a login,
        including `viewer` — a wider audience than the full record's, because
        the full record is somewhere you navigate to deliberately and this is
        somewhere a sticker sends you. Acquisition cost behind an adhesive
        label is a disclosure nobody asked for. Anyone who needs it taps
        through.
      */}
      <dl className="flex flex-col gap-0 rounded-(--radius-card) border border-border bg-surface">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 border-b border-border px-4 py-2.5 last:border-b-0">
            <dt className="w-28 shrink-0 text-[13px] text-fg-muted">{label}</dt>
            <dd className="text-[13px]">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="pt-4">
        <ButtonLink href={`/inventory/${asset.id}`}>Open full record</ButtonLink>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit && npm run lint
```

Expected: both clean.

- [ ] **Step 3: Write the e2e**

Append inside the existing `test.describe("label sheet", …)` block in `e2e/labels.spec.ts`:

```ts
  test("the scan card shows custody at a glance, keyed on the tag not the id", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // BY TAG. A cuid would break on the next reseed — this file's own header
    // says never to reference one, and the tag is what the QR encodes anyway.
    await page.goto("/inventory/scan/BR-LT-0148");
    await expect(page.getByRole("heading", { name: "BR-LT-0148", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Marites Bautista", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open full record" })).toBeVisible();
  });

  // The withholding IS the security decision (spec §0 decision 8), so it gets
  // an assertion rather than a comment. A future "just add cost, it is handy"
  // change has to delete a test that says why.
  test("the scan card withholds cost, which the full record shows", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({
      where: { tag: "BR-LT-0148" },
      select: { cost: true },
    });
    expect(asset.cost, "seed fixture needs a cost for this test to mean anything").not.toBeNull();
    const cost = String(asset.cost);

    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/scan/BR-LT-0148");
    await expect(page.getByRole("heading", { name: "BR-LT-0148", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(cost, { exact: false })).toHaveCount(0);
  });

  test("an unknown tag explains itself instead of 404ing", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/scan/BR-XX-9999");
    await expect(page.getByText(/No asset is registered as BR-XX-9999/)).toBeVisible({ timeout: 30_000 });
  });

  test("the scan card requires a session", async ({ page }) => {
    await page.goto("/logout");
    await page.goto("/inventory/scan/BR-LT-0148");
    await expect(page).toHaveURL(/\/login/);
  });
```

- [ ] **Step 4: Run the labels spec and CHECK THE COUNT**

```bash
npx playwright test e2e/labels.spec.ts --workers=1 --global-timeout=600000
```

Expected: **15 passed** (11 before + 4). A run that hits `--global-timeout` prints "N did not run" and
its tail still reads like a pass — read the number.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/inventory/scan/[tag]/page.tsx" e2e/labels.spec.ts
git commit -m "feat(inventory): a scan card that answers custody without the whole record"
```

---

### Task 11: Repoint the QR at the card

**Files:**
- Modify: `src/lib/label-qr.ts`, `src/lib/label-qr.test.ts`, `e2e/labels.spec.ts`

- [ ] **Step 1: Update the test first**

In `src/lib/label-qr.test.ts`, replace the whole `qrUrlFor` describe block:

```ts
describe("qrUrlFor", () => {
  // Decision 8: the QR lands on the compact scan card, not the full record.
  // The /inventory?q= redirect still exists and is still the desk scanner's
  // contract — it is simply not what the QR encodes any more.
  it("builds the scan-card URL", () => {
    expect(qrUrlFor("BR-LT-0166", { prefix: "http://host:3000" })).toBe(
      "http://host:3000/inventory/scan/BR-LT-0166",
    );
  });

  it("percent-encodes a tag that would otherwise break the path", () => {
    expect(qrUrlFor("BR LT/0166", { prefix: "http://host:3000" })).toBe(
      "http://host:3000/inventory/scan/BR%20LT%2F0166",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/lib/label-qr.test.ts
```

Expected: FAIL — both `qrUrlFor` tests, showing the old `?q=` URL.

- [ ] **Step 3: Change the one line**

In `src/lib/label-qr.ts`, replace `qrUrlFor` and its doc comment:

```ts
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
```

- [ ] **Step 4: Run the unit tests**

```bash
npx vitest run src/lib/label-qr.test.ts && npm run test
```

Expected: 12 passed in that file; **818 passed** overall — this task changes no test counts.

- [ ] **Step 5: Update the e2e assertion that pins the encoded URL**

In `e2e/labels.spec.ts`, the QR payload test asserts the old shape. Change that one line to:

```ts
    expect(name).toMatch(/^QR https?:\/\/.+\/inventory\/scan\/BR-LT-0148$/);
```

- [ ] **Step 6: Run the labels spec**

```bash
npx playwright test e2e/labels.spec.ts --workers=1 --global-timeout=600000
```

Expected: **15 passed**.

- [ ] **Step 7: Commit**

```bash
git add src/lib/label-qr.ts src/lib/label-qr.test.ts e2e/labels.spec.ts
git commit -m "feat(labels): the QR lands on the scan card, not the full record"
```

---

### Task 12: Battery and close-out

- [ ] **Step 1: The battery**

```bash
npx tsc --noEmit && npm run lint && npm run test && npm run build
docker compose --profile prod build
```

Expected: 818 unit / 49 files; 3 images.

- [ ] **Step 2: Clear `.next`, then the e2e in four parts**

`build` and `next dev` share `.next` and their outputs are incompatible, so clear it — and expect the
suite to compile cold as a result.

```bash
rm -rf .next
npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=600000
npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/scanner.spec.ts --workers=1 --global-timeout=540000
npx playwright test e2e/axe-sweep.spec.ts --workers=1 --global-timeout=1200000
```

Baseline: 51 · 58 · 34 · 6 = **149**. This adds 4 to part 2, so expect **51 · 62 · 34 · 6 = 153**.
**Check every count.**

⚠️ **`e2e/it-core.spec.ts:126` is the one to watch.** It guards the `/inventory?q=` redirect this phase
deliberately does not touch. If it fails, the change was not as contained as intended — do not reach
for headroom, read the diff first.

⚠️ **The axe sweep does not know about `/inventory/scan/[tag]`.** It enumerates page routes from the
filesystem and asserts its own coverage, so a new route may make it report 47 of 48. If it fails on
coverage, **add the route to the sweep** rather than weakening the assertion — that assertion exists
because a sweep that passes proves its list is clean, not that the app is.

- [ ] **Step 3: Amend this plan** with `B-12` onward — what Tasks 10–12 deviated on and why.

- [ ] **Step 4: Update `docs/HANDOVER.md`** — §0 item 4e (task count, battery numbers, the new route),
and §8 if the physical checks moved.

- [ ] **Step 5: Finish the branch.** `superpowers:finishing-a-development-branch`. **Merging and pushing
are the user's decisions** — present the options and wait.
