# Phase 10 — Polish: label sheet, scanner, deployment README, axe pass

**Date:** 2026-08-25 · **Status:** approved, not yet planned · **Base:** `main` (Phases 1–9 merged,
`7284c10`) · **Branch to cut:** `phase-10-polish`

Phase 10 is the last planned phase. It was split out of Phase 9 on 2026-08-21 because the two halves
share almost no code. Four items, plus one wording fix found while writing this spec.

Source material: `design_handover/README.md` cards `1m` (label sheet, scanning) and `7g`;
`design_handover/original-brief.md` §7; `docs/HANDOVER.md` §6 (entry criteria) and §6a (80 rules).

---

## 0. Decisions taken during brainstorming

Recorded here because each one closes a question the brief left open, and two of them **contradict the
brief** — deliberately, with reasons.

1. **Scan codes are 1-D Code 128-B of the asset tag**, not QR. The brief says only "scan codes". A USB
   laser scanner cannot read a QR, and the phase's other item ("a scan ticks the matching offboarding
   row") depends on the scanner emitting the tag — so Code 128 makes both items one feature where QR
   would make them two. Measured: `BR-LT-0148` is 145 modules; at 0.33 mm per module that is **47.9 mm
   wide**. The label cell is 63.33 mm and at 5 mm side padding the barcode area is 53.3 mm, so it fits
   with ~5 mm to spare at a module size any cheap handheld reads. **A longer tag would not** — see
   §1.3 for the bound that has to be enforced.
2. **The label sheet prints from an `/inventory` selection only.** The brief also says "or a completed
   purchase". **That cannot be built and is dropped**: `PurchaseUnit` (`prisma/schema.prisma:326`) has
   `description`, `qty` and `unitPrice` and **no relation to `Asset` at all**, nothing anywhere creates
   an Asset from a purchase, and `complete` merely flips the request to `COMPLETED`. There is nothing
   with a tag to put on a sticker. Building purchase→asset receiving is a real feature — schema,
   actions, audit, approvals — not polish. **Recorded as deferred in HANDOVER §8.**
3. **From an explicit selection, never "all matching".** The bulk drawer distinguishes the two.
   Labelling an entire filtered fleet is not a real intent, and "all matching" is the only path by
   which one click becomes 17 sheets of paper by accident.
4. **A scan preselects `Returned` and still requires Confirm.** It writes nothing. `decideItem` files a
   real, audited approval with a refNo, so a scan that auto-confirmed would make a mis-scan or a
   double-beep into a wrong approval that has to be cancelled through the queue. One scan plus one
   click per item, and the dry-run honesty the rest of the app has is preserved.
5. **"Full axe pass" means every route swept at the serious/critical bar**, plus the two known
   moderates fixed by name. Moderates found beyond those two are **counted and recorded, not fixed
   blind** — the count across 38 never-scanned routes is unknown, and committing to fix it before
   counting is how a polish phase stops being polish. This closes rule 62's actual gap, which was
   *coverage* (a token failed on ~24 usages while the suite was green, because one spec scanned
   `/employees/[id]` and never the list) rather than severity.
6. **The README is verified by execution**, not written from the files. Every command in it gets run
   once from a clean state. §6 of the handover predicts this item slips precisely because nothing forces
   a writing task to be true.
7. **HTML print route now; server-generated PDF is the recorded escape hatch.** Exact print scale is
   the real-world failure mode for label sheets and a browser can silently scale to fit. Mitigated by a
   printed calibration ruler rather than by adding a PDF dependency speculatively — see §5.

---

## 1. Label sheet

### 1.1 Files

| Path | Kind | Purpose |
|---|---|---|
| `src/lib/code128.ts` | pure | `code128Modules(text): number[]` — bar/space module widths, plus the module-width constant. No DOM, no React, no Prisma. |
| `src/lib/code128.test.ts` | unit | Known-good vectors, checksum, charset bounds, mutation-checked. |
| `src/lib/label-geometry.ts` | pure | Sheet geometry + pagination: `labelPages(tags)` → pages of ≤12, and the mm constants. |
| `src/lib/label-geometry.test.ts` | unit | Pagination at 0, 1, 12, 13, 200. |
| `src/components/inventory/label-sheet.tsx` | Server Component | The 3×4 grid, inline SVG barcodes, calibration ruler. |
| `src/app/(app)/inventory/labels/page.tsx` | route | Role guard, `?ids=` parse, cap refusal, fetch, render. |
| `src/components/ui/print-button.tsx` | moved | From `src/components/employees/print-button.tsx`. |

**The `PrintButton` move is deliberate scope, not creep.** It is a generic `window.print()` button that
already has two unrelated callers (the farewell report and the accountability form) and lives under
`components/employees/`. This phase adds a third, in `inventory`. Both existing imports are updated in
the same commit. Nothing about its behaviour changes.

**Naming, corrected during planning.** This module is `label-geometry.ts`, **not** `labels.ts`:
`src/lib/labels.ts` already exists, holds `M365_CANONICAL` and `APPROVAL_TYPE_LABEL`, and has eight
importers across the app. An earlier draft of this spec and of the plan both said `labels.ts`, which
would have had a verbatim implementer clobber it.

### 1.2 The encoder

Hand-rolled, not a dependency. Two reasons, in order of weight:

- It is **pure logic a unit test can reach**, which §6a's three-times-learned structural lesson is
  about. A barcode library's correctness would be untestable here in any useful sense.
- It dodges §7's npm-on-Windows hazard entirely: any install regenerates `package-lock.json` without
  the Linux optional-dep trees and breaks the Alpine production image, requiring the
  `docker run … --package-lock-only` dance.

A verified implementation already exists from the brainstorming session (the mockup's barcodes are real
Code 128-B, not drawings). It is ~60 lines: the 107-entry pattern table, `START B`, value mapping,
modulo-103 checksum, `STOP`.

**Testing it properly means known-good vectors, not "it renders".** At minimum: a fixed string whose
full module sequence is asserted; the checksum computed independently for one input; the first and last
usable characters of the charset; and a mutation pass confirming that breaking the checksum, dropping
`STOP`, or off-by-oneing the value mapping each fails a test. §6a rule 78.

### 1.3 Geometry

A4 is 210 × 297 mm. 3 columns × 4 rows with a 10 mm page margin gives cells of **63.3 × 69.25 mm**.
Inside each cell: the `BR` mark and model name, the tag in mono, and the barcode at 0.33 mm/module ×
9 mm tall. Light-theme-only, matching the two existing print surfaces — these are printed artifacts.

`@page { size: A4; margin: 0 }`; the grid carries its own margin so the browser's own page margin
cannot double up.

**The module width is COMPUTED to fit, not fixed.** Code 128-B costs exactly `11n + 35` modules for an
n-character string (verified by hand against the symbology: start 11 + checksum 11 + stop 13, and
`BR-LT-0148` measures 145 for n=10). A *fixed* 0.33 mm module would cap tags at
`(53.3 / 0.33 - 35) / 11 = 11` characters. **Corrected twice during planning:** an earlier draft said
14, which was an arithmetic error; and the "one character of headroom is a cliff" argument that
replaced it is **moot**, because `TAG_SHAPE` (`/^BR-[A-Z]{2}-\d{4}$/`) fixes every tag at exactly 10
characters on both write paths. The real reasons to compute the width are that **no DB CHECK constraint
enforces that format** (it is an application invariant) and that some width check is needed regardless
— with none, a 13-character tag overflows the cell silently.

So `label-geometry.ts` computes `moduleMm = min(PREFERRED_MODULE_MM, usableMm / modules)` per label. Any tag
length then degrades gracefully instead of overflowing the cell. It also needs a **floor**: below about
0.19 mm (7.5 mil) a cheap handheld stops reading reliably, so a tag long enough to force the module
under that gets **no barcode and a visible "tag too long to encode" note on the label** rather than a
printed code nobody can scan. Both bounds are asserted in `label-geometry.test.ts`, so the geometry constants
and the encoder cannot drift apart.

**The calibration ruler.** A 100 mm scale bar prints on every sheet, labelled. It exists because no
automated test can detect that Chrome printed at 96% "fit to printable area" — the operator measures it
once with a tape measure and either the sheet is right or the print dialog needs Scale 100% / Margins
None. The on-screen (non-printing) instructions say exactly that.

### 1.4 Route contract

- **Access:** `requireRole("admin", "it_staff")` — a SET, not a floor, matching both importers.
- **Its own `PATH_RULES` entry, placed BEFORE the general `/inventory` rule.** ⚠️ This is the E-7 /
  W-1 trap that both import routes hit: `/inventory` is granted to the `it`, `purchasing` **and**
  `finance` workspaces, so without a dedicated entry a finance user could print asset labels. Assert
  it in e2e; do not assume the rule.
- **`?ids=` only.** Comma-separated, deduplicated, order preserved from the selection.
- **Cap is `BULK_MAX` (200)**, imported from `src/lib/inventory-list.ts` — never a literal (rules 26 /
  37 / 38). 200 labels is **17 sheets**, which is why decision 3 keeps this to an explicit selection.
  Over the cap the route **refuses with a named message and prints nothing**, the same
  posture as `idsRefusal`; it does not slice, which is the defect §8 records for the export route's
  original `?ids=` handling.
- **Ids that match no asset are dropped, and the sheet says how many** — a stale selection should not
  silently produce fewer stickers than the operator counted.
- **Zero usable ids** renders an explanation and a link back to `/inventory`, not a blank sheet.
- The sheet header (non-printing) states **"N labels · M sheets"** before the operator prints.

### 1.5 Entry point

The bulk drawer gains a **Print labels** link beside its existing export link, enabled only when
`selectedIds.length > 0` — absent, not disabled, when the scope is "all matching" (decision 3).

---

## 2. Scanner in the offboarding wizard

### 2.1 What exists

`?q=` exact-tag-match already redirects to the record on `/inventory` (`exactTagMatch`,
`src/server/modules/inventory/queries.ts:288`) and two e2e specs lean on it. The offboarding wizard
has **no scan handling at all**. Each held item renders as
`<div role="group" aria-label="Decide ${tag}">` with a 4-way `SegmentedControl`, a Reason textarea and
a Confirm button; `ItemDecision` owns its own `outcome` state and `decideItem` files the approval.

### 2.2 Files

| Path | Kind | Purpose |
|---|---|---|
| `src/lib/scan.ts` | pure | `matchScan(buffer, items)` → a discriminated verdict. `items` is the minimal STRUCTURAL shape it reads — `{ assetId, tag, decided: boolean, blockedBy: string \| null }[]` — never the wizard's own `WizardItem`, so the wizard's query and this rule can change independently. |
| `src/lib/scan.test.ts` | unit | Every branch, including the two the brief never mentions. |
| `src/components/offboarding/scan-listener.tsx` | client | Keystroke buffer, Enter flush, focus guard, verdict rendering. |
| `src/components/offboarding/scan-context.tsx` | client | `{ tag, nonce }` provider so `ItemDecision` can react. |

**`matchScan` is pure and lives outside the component on purpose.** ⚠️ Three Phase 9 defects were pure
logic sitting where vitest could not reach it (`resolveAssetRefs`, `assetDiff`, `hasDiverged`), each
found only by review. The scan verdict is a decision over a list and a string; it belongs in `src/lib`.

### 2.3 Verdicts — all four render

`matchScan` returns exactly one of:

| Verdict | Meaning | UI |
|---|---|---|
| `match` | tag belongs to a held, undecided, unblocked item | scroll to card, select `Returned`, focus Confirm |
| `unknown` | tag matches nothing this employee holds | refusal naming the scanned value |
| `already-decided` | item already has a live decision | says so, and does not re-open it |
| `blocked` | item is held by a prior approval (the wizard's existing blocked state) | says so; preselecting would stage what the server refuses |

⚠️ **The brief names only the first.** The other three exist because §6a rule 10 — a page consuming
only the refusal its design card names — is the rule this codebase has broken in *every* task that
paired a rule module with a page, five times running. `blocked` in particular is the one a seed-based
test would miss, exactly like the `Job_one_live_deliver_per_delivery` case.

### 2.4 Listener behaviour

A USB scanner is a keyboard that types fast and presses Enter.

- Listens on `document` for `keydown`; buffers printable characters; flushes on `Enter`.
- **Ignores events while focus is inside an `input`, `textarea` or `select`** — otherwise typing a
  Reason would be captured as a scan. This is the one bug most likely to ship here.
- Normalises through the existing `tagKey` (trim + upper-case) rather than a second comparison rule —
  §6a's hand-written-twin lesson, four of which were removed in Phase 9.
- The buffer clears on flush and on a timeout, so a partial scan cannot poison the next one.
- Nothing is written. No server action is called.

### 2.5 Wiring

`ScanContext` carries `{ tag, nonce }`. The nonce increments on every flush so **scanning the same tag
twice re-triggers** — without it, re-scanning an item after changing your mind would be inert.
`ItemDecision` subscribes and acts only when the tag is its own.

### 2.6 Hydration ⚠️

The listener binds on hydration. A test that scans immediately after navigating will pass or fail
depending on compile warmth — this is §6a rules 61 and 76, and rule 61's *stated* fix does not work.
The e2e must gate on real hydration via `e2e/it-core.spec.ts`'s `waitForHydration` (probing the element
being interacted with, never its ancestor form). Reuse it; do not write a second one.

---

## 3. Deployment README

Root `README.md`, currently two lines, and the public face of a public repo.

**Contents:** what the system is · prerequisites (Docker Desktop, Node 22, npm 11) · dev quickstart
(`docker compose up -d db`, `prisma migrate deploy`, `npm run db:seed`, `npm run dev`) · production via
`docker compose --profile prod up` · generating every secret including `SECRET_ENCRYPTION_KEY` ·
migrations (hand-written additive SQL dirs then `migrate deploy`; **`prisma migrate reset` is
classifier-blocked and unnecessary**) · the worker service · seeded accounts pointing at
`SEED_PASSWORD` in `prisma/fixtures.ts`, **with the change-it-before-exposing warning and the note that
it is 8 characters where signup requires 10** · the npm-on-Windows lockfile hazard with the exact
Alpine command · troubleshooting.

**Troubleshooting must include "Docker Desktop is not running"**, which cost twenty minutes in the
session that produced this spec: the failure surfaces as
`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`, and it cannot be
fixed from a terminal because the service needs an interactive session and elevation.

**It states plainly that Entra SSO does not work.** `src/server/auth/index.ts` registers the provider
when three env vars are set but there is no `signIn` callback mapping an Entra profile to a `User`, so
a successful Entra login would arrive with no role. A README that lists the env vars without saying
this would be an instruction to break the deployment.

**Verification is the task, not the prose.** Fresh `git clone` into a temp directory, fresh `.env` from
`.env.example` with newly generated secrets, `docker compose --profile prod build`, `up`, migrate,
seed, sign in through the browser, tear down. Every command in the document is executed once. Anything
that does not work is fixed in the document, not in a footnote.

---

## 4. Axe pass

### 4.1 The sweep

`e2e/axe-sweep.spec.ts`: a table of `{ path, role, label }` covering **every** static route plus one
instance of each dynamic route (`/inventory/[id]`, `/employees/[id]`, `/approvals/[id]`,
`/purchases/[id]`, `/offboarding/[employeeId]`, and their sub-tabs), resolving ids from the seed by
stable business key — never a raw cuid.

- **Fails** on serious/critical.
- **Counts** moderate violations by rule id and prints a summary, without failing.
- Reuses the pointer-park-and-settle helper from `e2e/import-export.spec.ts`. ⚠️ Without it,
  `Button variant="primary"` reports a phantom *serious* 4.29 contrast when axe samples mid-transition
  or under the cursor (`#fdfefe` on `#487cb6`), while at rest `--accent` passes — measured three times
  now, and it would send this task chasing a violation that does not exist.
- ~38 routes × a scan each will be slow. The suite already does not fit one foreground run (§0 item 7);
  this spec gets its own part in the split.

### 4.2 The two known moderates

- **`heading-order`, app-wide.** `PageHeader` renders `<h1>`, `CardHeader` renders `<h3>`
  (`src/components/ui/card.tsx:33`), so every page combining them skips `<h2>`. `CardHeader` is one
  component used by 15 files — change `h3` → `h2` once. Then verify no page ends up with a broken tree
  in the other direction (a card heading that should nest under a real `<h2>` that now collides).
- **`SegmentedControl`** takes an `aria-label` but never wires `aria-describedby` / `aria-invalid`, so
  its `FormField` hint and error are unannounced. Wire both from `FormField`'s existing ids.

### 4.3 What is NOT promised

Any other moderate the sweep finds is **counted and recorded in HANDOVER §8**, not fixed. The plan says
so explicitly so that a green sweep is not read as "the app is fully accessible" — §6a rule 62: a green
suite bounds what has been checked, not what is true.

---

## 5. Risks, named

| Risk | Mitigation | Escape hatch |
|---|---|---|
| Browser prints the sheet scaled, so stickers miss the die-cut | 100 mm calibration ruler on every sheet + on-screen Scale-100%/Margins-None instruction; one measured test print | Server-generated PDF. **Recorded in §8, not built** — adding a PDF dependency before measuring is speculative, and it also drags in §7's Windows lockfile hazard |
| Axe sweep surfaces an unbounded number of moderates | Bar stays serious/critical; moderates counted, not fixed | — |
| Scan listener steals keystrokes from the Reason textarea | Focus guard on input/textarea/select; asserted in e2e | — |
| Scan e2e is hydration-timing-dependent | `waitForHydration` on the probed element | — |
| Sweep needs a reachable instance of every dynamic route | Resolve ids from the seed by business key | — |

## 6. Testing

- **Unit:** `code128` (known vectors, checksum, charset bounds, mutation-checked); `labels`
  (pagination at 0/1/12/13/200); `scan` (all four verdicts, focus-guard input, tag normalisation).
- **E2E:** labels route renders N labels for N ids and one barcode per tag; refuses over `BULK_MAX`;
  **finance and viewer cannot reach it**; zero-ids renders the explanation. Scanner preselects
  `Returned` on a match, and renders each of the three refusals. The axe sweep.
- **Manual, once:** a real test print, measured. The ruler is the assertion and no automated test can
  substitute for it.
- **Mutation-test every load-bearing assertion** before calling a task done (rule 78): name the defect
  each one catches, break exactly that, confirm the failure lands in the expected place, revert with
  `git checkout --`, and check `git status` before committing.

## 7. Task order

1. `code128.ts` + tests — pure, no dependencies, nothing else blocks on it
2. `labels.ts` + tests
3. `LabelSheet` + the print route + the `PrintButton` move
4. Bulk-drawer entry point + labels e2e (including the role gate)
5. `scan.ts` + tests
6. `ScanListener` + `ScanContext` + `ItemDecision` wiring + scanner e2e
7. `CardHeader` / `SegmentedControl` fixes + `axe-sweep.spec.ts`
8. The CSV→xlsx wording fix in `bulk-drawer.tsx` (rule 16: user-facing prose claiming what the code
   does not do — the route has served xlsx since Phase 9 Task 3)
9. README + clean-state verification
10. Full battery, plan amendments, handover update, close the branch

## 8. Out of scope, deliberately

- **Purchase → asset receiving.** Decision 2. Blocks the brief's second label-sheet entry point; needs
  its own phase.
- **QR codes.** Decision 1.
- **A PDF renderer.** §5.
- **Clearing moderate axe violations beyond the two named.** Decision 5.
- **Entra SSO.** Deferred since Phase 8, unchanged; the README documents that it does not work.
