# Phase 11 — A phone-scannable QR on the asset label

**Date:** 2026-08-26 · **Status:** approved, not yet planned · **Base:** `phase-10-polish` (Phase 10
code-complete, **UNMERGED**) · **Branch to cut:** `phase-11-label-qr`

One item: each printed asset label gains a QR code that, scanned with a phone, opens that asset's
record — the page that already says *"held by <name>"* and links through to the employee.

Source material: `docs/superpowers/specs/2026-08-25-phase-10-polish-design.md` §1 (the label sheet this
extends) and its decision 1, which this spec deliberately revisits; `docs/HANDOVER.md` §6a (93 rules).

**⚠ This phase stacks on unmerged work.** The label sheet it extends exists only on `phase-10-polish`,
which is held for a merge decision the user has not made. If Phase 10 is ever abandoned rather than
merged, this phase goes with it. Cutting from `main` is not an option — there is no label sheet there.

---

## 0. Decisions taken during brainstorming

Recorded here because each closes a question, and the first one revisits a Phase 10 decision.

1. **QR is ADDED alongside Code 128, not substituted for it.** Phase 10's spec decision 1 chose
   Code 128-B over QR, and that decision was right for its reader: a USB laser scanner cannot read a
   QR, and the offboarding scanner depends on the code typing a bare tag as keystrokes. **This phase
   does not reverse it.** The two codes serve two different readers — Code 128 for the desk scanner,
   QR for a phone — and removing either breaks a shipped workflow. A label carries both.

2. **The QR opens the record for signed-in staff only.** No public route, no anonymous read. An
   unauthenticated scan lands on `/login` via the existing middleware and continues to the record after
   sign-in. **Rejected:** a public page naming the holder. Asset tags are sequential, so a public
   endpoint keyed by tag is a walkable index of who holds what — a sticker anyone can photograph,
   including whoever took the device. The convenience is real and the exposure is worse.

3. **The QR encodes `{APP_BASE_URL}/inventory?q={TAG}`**, reusing the exact-tag redirect at
   `src/app/(app)/inventory/page.tsx:39`. **No new route.** That redirect is the same one the scanner
   contract relies on and is already covered by `e2e/it-core.spec.ts:126`. It also degrades usefully:
   a reader that yields plain text still gives a human something meaningful.
   **Rejected:** encoding `/inventory/<cuid>` — an opaque id on a permanent sticker, dead if the row is
   ever re-created. **Rejected:** a new short route `/a/<tag>` — a second way to say what `?q=` already
   says, and rule 26/37/38 territory.

4. **`APP_BASE_URL` is a required env var with NO default, and a `localhost`/`127.0.0.1` value is
   REFUSED.** This is the specific way the feature ships broken: a QR that works on the dev machine and
   is dead on every phone. No default, because a default here is a dead link printed onto adhesive
   paper. When it is unset or invalid the label prints Code 128 only, plus a visible note saying why.

5. **The address baked in is a hostname the user controls**, e.g.
   `http://inventory.backroom.local:3000`, not the server's IP. A DHCP renewal or a machine swap would
   otherwise kill every label already stuck to a device, discovered only when someone scans one. The
   code does not enforce "hostname not IP" — an IP is a legitimate choice for someone with a static
   reservation — but the `.env.example` comment states the trade-off.

6. **QR comes from a vetted dependency, not a hand-rolled encoder.** This departs from the precedent
   `src/lib/code128.ts` set. Code 128-B is a lookup table and a weighted checksum; QR is Reed–Solomon
   over GF(256), version selection, and eight mask patterns scored by four penalty rules. The failure
   mode of a subtly wrong QR is that some readers accept it and others do not — exactly what masking
   and ECC exist to prevent, and exactly what a hand-rolled version gets wrong quietly, on paper.
   Prefer a single-file, dependency-free implementation (Nayuki `qrcodegen` or equivalent) rendered to
   **inline SVG** — no canvas, no runtime, consistent with how the barcode renders.

7. **The employee accountability form's false claim is fixed here.**
   `src/app/(app)/employees/[id]/form/page.tsx:99` prints *"scan the code to open this record"* and
   **there is no code on that sheet** — the file imports no barcode renderer and nothing in the repo
   does QR. That is rule 16 on adhesive paper. This phase deletes the false clause. **Putting a real QR
   on that form is explicitly OUT of scope** (§6) — a different sheet, a different payload, a different
   reader.

---

## 1. What gets built

### `src/lib/label-qr.ts` — pure, new

URL construction and base-URL validation. No React, no Prisma, no `next/*` — the same purity rule
`label-geometry.ts` follows, so the string printed onto a sticker is unit-testable without a browser.

```
export type QrTarget =
  | { ok: true; url: string }
  | { ok: false; reason: "unset" | "not-absolute" | "loopback" | "bad-url" };

export function qrTargetFor(tag: string, baseUrl: string | undefined): QrTarget;
```

A discriminated union for the same reason `BarcodeFit` is one: a caller must not be able to render a
QR with no URL. `fit.url` should not typecheck until `ok` is narrowed to `true`.

Validation, in order: unset/empty → `unset`; unparseable → `bad-url`; scheme not `http:`/`https:` →
`not-absolute`; hostname `localhost`, `127.0.0.1`, `::1`, or any `127.0.0.0/8` → `loopback`. A trailing
slash on the base is normalised rather than refused.

### `src/lib/label-geometry.ts` — extended

QR sizing constants and a fit function in the existing `encodable` union shape.

Worked from the actual example rather than estimated — the first draft of this spec said "~50
characters, version 3, 29×29" and all three figures were wrong:

```
http://inventory.backroom.local:3000/inventory?q=BR-LT-0166   =  59 bytes

byte-mode capacity, ECC level M (ISO/IEC 18004):
  v3  29x29   42 bytes   too small
  v4  33x33   62 bytes   FITS  <- 3 bytes of headroom
  v5  37x37   84 bytes   fits

v4 at 20 mm  ->  0.606 mm per module   (PREFERRED_MODULE_MM is 0.33)
```

**The version MUST be derived from the encoded byte length, never assumed** — and the reason is in that
table: the realistic example clears version 4 by **three bytes**. A hostname four characters longer
tips it to version 5, 37×37, and the module size shrinks with it. Hardcoding a version here would be a
bug that appears only for customers with longer hostnames.

Also budget the **4-module quiet zone** QR requires on all sides: v4 is 33 + 8 = 41 module-widths of
footprint, ~24.8 mm at 0.606 mm modules. That is what competes with the barcode for the 53.33 mm of
`LABEL_USABLE_MM`, not the 20 mm of dark modules alone.

Refuse, rather than shrink, if modules fall below a QR-specific floor. Phone cameras tolerate less than
a dedicated laser scanner, so this floor is **not** `MIN_MODULE_MM` (0.19 mm, set for handheld lasers).
**Target `QR_PREFERRED_MODULE_MM = 0.5`, refuse below `QR_MIN_MODULE_MM = 0.4`.** These two numbers are
the least certain in this spec: they are a judgement about phone optics at arm's length, not a measured
result, and the physical read test in §4 is what validates or corrects them. Record the outcome against
these constants so a future change has a measurement to argue with rather than a guess to inherit.

### `src/components/inventory/label-sheet.tsx` — extended

The QR renders **BELOW the barcode as a fourth child of the cell's column flex**, as an
`<svg role="img">` with an accessible name, matching how the barcode is already asserted by role rather
than by text.

**Corrected while planning — the first draft of this spec said "beside the barcode", and that would
have broken the barcode.** The horizontal budget is nearly spent:

```
LABEL_USABLE_MM                    53.33 mm
'BR-LT-0166' = 10 chars = 145 modules
  at PREFERRED_MODULE_MM (0.33)    47.85 mm  <- barcode's actual width
  horizontal slack                  5.48 mm  <- all there is

barcode squeezed to 28 mm  ->  0.193 mm/module
MIN_MODULE_MM                   0.19  mm     <- refuses just below this
```

A QR placed beside the barcode leaves it ~28 mm, which is *within 0.003 mm* of the width at which
`barcodeFit` returns `encodable: false` and the label prints "no scannable code" instead. One extra
character in a tag tips it. **Vertical is where the room is:** the cell's content box is
69.25 − 10 = 59.25 mm tall and currently uses roughly 19 mm (chip row, tag, 9 mm barcode), leaving
~40 mm. A 20 mm QR plus its quiet zone fits below the barcode with slack to spare, and the barcode
keeps its full preferred module size.

**This is the risky edit in the phase.** The sheet's vertical budget was tightened once already —
`A-16` records the calibration ruler silently shipping at 89.38 mm against a declared 100 mm after a
`flex-shrink` bug, and `1a5bd0c` was a second pass on the ruler's height budget. Adding an element to
a cell can re-tip exactly that. The existing measurements are the safety net and must be re-run, not
assumed (§4).

### `.env.example` — one entry

`APP_BASE_URL`, commented with what it is for, that labels bake it in permanently, and the
hostname-versus-IP trade-off from decision 5.

---

## 2. What is NOT built

Stated because each was considered and declined, not overlooked:

- **No public/anonymous asset page.** Decision 2.
- **No new route.** Decision 3.
- **No QR on the employee accountability form.** Decision 7 fixes that sheet's false prose only.
- **No HTTPS work.** §3 states the exposure; closing it is its own phase.
- **No change to Code 128, the calibration bar, the grid, or pagination.** If any of those numbers move,
  something has gone wrong.

---

## 3. Preconditions and exposure, stated plainly

The feature is inert unless a phone can reach the app, and that has consequences worth deciding
knowingly rather than discovering:

- **The app is already LAN-reachable when running.** `docker-compose.yml`'s `web` publishes
  `"3000:3000"` — all interfaces, unlike `db`, which is deliberately `127.0.0.1:5432`. Nothing needs
  to change, which is precisely why this deserves saying out loud.
- **There is no HTTPS.** Inviting phone sign-ins means credentials crossing the LAN in plaintext.
- **The seeded password is `admin123`** (`prisma/fixtures.ts`), eight characters where signup demands
  ten. `README.md` already says change it before the app is reachable beyond localhost. **This feature
  converts that from advice into a prerequisite**, and the README must say so where it introduces the QR.

---

## 4. Testing

**Unit — `label-qr.ts`:** the happy URL; every refusal branch (unset, empty, relative, `ftp:`,
malformed, `localhost`, `127.0.0.1`, `::1`, a `127.x` address); trailing-slash normalisation; a tag
needing URL-encoding.

**Unit — geometry:** version/module sizing derived from a short and a long base URL; the refusal when
modules fall below the QR minimum. Per §6a, **mutation-test these once green** — reverse a comparator
and weaken a bound and confirm the suite fails.

**E2E — `e2e/labels.spec.ts` (extended, not replaced):**
- the QR renders as a named `role="img"` SVG, one per label;
- the encoded URL is correct — read it out of the DOM, not inferred from the tag;
- with `APP_BASE_URL` unset, **no QR renders and the note appears** (rule 10: every refusal the rule
  can return gets a surface);
- **the page box and the calibration bar still measure what they measured before** — the regression
  guard for the layout change, and the reason this phase is safe to attempt at all.

**What no test can do:** prove a phone camera reads the *printed* QR. That is the same class as the
calibration measurement (`HANDOVER.md` §8) and needs a human, a printer and a phone. **Record it the
same way:** the phone, the print scale, and whether it read first time.

---

## 5. Risks, named

1. **The layout edit re-tips the sheet's vertical budget.** Highest-likelihood failure. Mitigated by
   the existing page-box and calibration-bar assertions, which must be run and read, not assumed green.
   Note the direction of the danger has moved: because the QR goes *below* the barcode (§1) it consumes
   the vertical budget, which is the same budget `A-16`'s `flex-shrink` bug raided. The cell is a column
   flex with `justifyContent: space-between` and `overflow: hidden`, so an over-tall QR does not
   overflow visibly — **it silently compresses its siblings, exactly as the calibration ruler was
   silently compressed to 89.38 mm.** Give the QR `flexShrink: 0` for the same reason the ruler has it,
   and assert the rendered barcode height, not just its presence.
2. **A long hostname overflows the assumed QR version.** Not hypothetical: the realistic example clears
   version 4 by **three bytes** (§1). Mitigated by deriving the version from the encoded payload length,
   and by a test that uses a deliberately long base URL rather than only the convenient one.
3. **A dead QR reaches paper.** Mitigated by decision 4's refusal path — the sheet must never print a
   QR it cannot justify.
4. **The dependency.** One new package on a project that hand-rolled its barcode. Adding it regenerates
   `package-lock.json`, which on Windows must be done **inside a Linux container** —
   `docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only"`
   (`README.md` troubleshooting). A lockfile rewritten by Windows npm breaks the Docker build.

---

## 6. Task order

1. `label-qr.ts` + its unit tests (TDD; pure, no deps on anything below).
2. The QR dependency, added via the Alpine lockfile command, plus geometry sizing + tests.
3. The label-sheet layout edit, then **re-measure** the page box and calibration bar.
4. The refusal surface and its e2e.
5. `.env.example`, and the README section introducing the QR with §3's password prerequisite.
6. Decision 7's one-line prose fix on the accountability form.
7. Battery, plan amendments, handover.
