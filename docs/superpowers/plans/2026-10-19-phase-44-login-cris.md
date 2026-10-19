# Phase 44 — Cris Login Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `/login` and `/signup` cards with the approved Cris login page: an illustrated back room where Cris works through a day, a stepped Log in / Sign up card, and a focus mode where the room blurs, the card centres and Cris flies forward to talk.

**Architecture:** Pure modules (scene data, step rules, sign-up rules, the world SVG builder) are unit-tested in node. The world SVG is built once on the server and injected as HTML; one client component (`LoginExperience`) composes the room scene, the day log, the sign-in card and the forward Cris, with a small loop hook driving the camera and moods by setting transforms, classes and a `data-at` attribute. Server actions keep their contracts except `signUp`, which returns `{ created: true }` and a `field` on errors.

**Tech Stack:** Next.js 15 App Router (React 19), TypeScript, plain CSS file for the page (`login.css`), existing `CrisOrb`/`CrisOrbDefs`, `FormField`/`Input`/`Button` UI components, vitest (node), Playwright + axe (battery at the end only).

**Spec:** `docs/superpowers/specs/2026-10-19-login-cris-design.md` (read it first; §-references below point into it). **Mockup source to port from:** `docs/mockups/2026-10-19-login-cris.html` (room builder JS at lines 576–735, scene table at 738+, CSS sections at lines 56–393, focus-mode JS at 965+, card JS at 886+).

## Global Constraints

- All copy (headings, labels, buttons, errors, Cris's lines, scene tasks and lines) is exactly as written in the spec §4.3, §5.2, §6. Do not reword.
- Breakpoint 900 px viewport width (`@media (max-width: 900px)` = narrow).
- Every class name and id inside the world SVG and every login-page CSS class is prefixed `lw-` (Tailwind v4 scans source for class candidates; unprefixed names like `shadow` would pick up utilities). Gradient/filter/clip ids too (`lw-sky`, `lw-cone`, `lw-blur`, `lw-doorclip`, …).
- Light values on the tokens' base selector, dark overrides under `[data-theme="dark"]` (the app's theme mechanism; `src/app/layout.tsx`). No `prefers-color-scheme` theme switching.
- Cris on the login page: `<CrisOrb color="gold" motion="lively" decorative …>`; the page renders `<CrisOrbDefs />` once.
- `prefers-reduced-motion: reduce`: no autoplay, travel, station animations, flight or slides; text appears without typing.
- No new dependencies. No raster images.
- Files are CRLF + UTF-8: edit with the Edit tool or Python (`encoding="utf-8", newline=""`), never `sed -i`.
- Never read or print `.env`. Never run `prisma migrate dev`/`reset`/`format`. Dev server only via `npm run dev -- -p 3100` (never port 3000), and **no Playwright or dev server during tasks** — browser tests run once at the end of the phase.
- Git: never `stash`, `checkout`, `restore`, `reset`, `switch`, `--amend`, or `--no-verify`. Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every task ends green on `npm run typecheck`, `npm run lint`, `npm test`.

## Review Focus

1. Pasted emails with spaces or capitals (`"  Neil.Lucero@TheBackroomOp.com "`) must pass the email check and the domain check (case-insensitive) — test in Task 2.
2. Unknown `?step=` values (`/login?step=admin`) must render Welcome, and `/login?step=login&next=/employees` must keep `next` through the form — test in Task 2 (`initialStep`) and Task 4 (hidden `next` input).
3. Enter in the Work email field on Log in 1 (and Full name/Work email on Sign up 1) must advance to the next step, never post the half-filled form — test in Task 8.
4. Resizing the window while in focus mode must keep the card centred and Cris's bubble left of the card — test in Task 8.
5. A very long email (60+ characters) in the Log in 2 chip must ellipsize, never widen the card or scroll the page sideways — test in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/signup-rules.ts` (+ `.test.ts`) | Pure sign-up validation with the field each error belongs to |
| `src/server/auth/actions.ts` | `AuthFormState` gains `field`/`created`; `signUp` uses the rules and returns `{ created: true }` |
| `src/lib/cris-mood.ts`, `src/components/cris/cris.css`, `orb.test.tsx` | New `shy` mood |
| `src/components/login/login-steps.ts` (+ test) | Step type, progress, initial step, email check, initials, names, Cris's lines, slide direction |
| `src/components/login/scenes.ts` (+ test) | The six scenes, travel time, clock formatting, timeline %, camera x |
| `src/components/login/world.ts` (+ test) | `buildWorld()` → the room SVG string |
| `src/components/login/login.css` | All login-page styles: tokens, hero, room, station keyframes, day log, card, focus mode |
| `src/components/login/sign-in-card.tsx` | The stepped card (controlled, both forms, quick sign-in, Microsoft) |
| `src/components/login/room-scene.tsx` | World container, room Cris, room bubble (presentational) |
| `src/components/login/day-log.tsx` | Clock, task, pause, timeline |
| `src/components/login/use-room-loop.ts` | Scene loop, camera, moods, clock, pause/resume |
| `src/components/login/use-typewriter.ts` | Typing effect used by both bubbles |
| `src/components/login/forward-cris.tsx` | The forward Cris and its bubble |
| `src/components/login/login-experience.tsx` | Composition, step state, focus mode |
| `src/app/(auth)/layout.tsx`, `login/page.tsx`, `signup/page.tsx`, `bootstrap/page.tsx` | Routing and landmarks |
| `e2e/*.spec.ts` (sign-in blocks), `e2e/quick-login.spec.ts`, `e2e/auth-shell.spec.ts`, `e2e/login-cris.spec.ts` | Browser tests |

---

### Task 1: Sign-up rules and the `signUp` result

**Files:**
- Create: `src/lib/signup-rules.ts`, `src/lib/signup-rules.test.ts`
- Modify: `src/server/auth/actions.ts:14-16` (`AuthFormState`), `:64-107` (`signUp`)

**Interfaces:**
- Produces: `type SignUpField = "name" | "email" | "password"`; `signUpProblem(input: { name: string; email: string; password: string }, domain: string | null): { error: string; field: SignUpField } | null`; `AuthFormState = { error?: string; field?: SignUpField; created?: boolean }`.

- [ ] **Step 1: Write the failing tests** in `src/lib/signup-rules.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { signUpProblem } from "./signup-rules";
const ok = { name: "Ana Reyes", email: "ana.reyes@thebackroomop.com", password: "0123456789" };
describe("signUpProblem", () => {
  it("accepts a valid sign-up", () => expect(signUpProblem(ok, "thebackroomop.com")).toBeNull());
  it("needs a name of at least 2 characters after trimming", () => {
    expect(signUpProblem({ ...ok, name: "   " }, null)).toEqual({ error: "Enter your name.", field: "name" });
    expect(signUpProblem({ ...ok, name: " A " }, null)).toEqual({ error: "Enter your name.", field: "name" });
  });
  it("needs a valid email", () =>
    expect(signUpProblem({ ...ok, email: "ana@" }, null)).toEqual({ error: "Enter a valid email.", field: "email" }));
  it("needs 10+ character passwords", () =>
    expect(signUpProblem({ ...ok, password: "123456789" }, null)).toEqual({ error: "Password must be at least 10 characters.", field: "password" }));
  it("enforces the allowed domain", () =>
    expect(signUpProblem({ ...ok, email: "ana@gmail.com" }, "thebackroomop.com")).toEqual({ error: "Signup is limited to @thebackroomop.com addresses.", field: "email" }));
  it("skips the domain check when no domain is set", () =>
    expect(signUpProblem({ ...ok, email: "ana@gmail.com" }, null)).toBeNull());
  it("reports the first problem in name, email, password order", () =>
    expect(signUpProblem({ name: "", email: "x", password: "1" }, null)?.field).toBe("name"));
});
```
- [ ] **Step 2: Run** `npx vitest run src/lib/signup-rules.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `signUpProblem` with today's exact checks from `signUp` (`name.trim().length < 2`, the same email regex `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`, `password.length < 10`, `isAllowedDomain(email, domain)` from `@/lib/auth-shared`). The caller passes the already-normalized email.
- [ ] **Step 4: Change `signUp`** to call `signUpProblem({ name, email, password }, domain)` (return it as the state when non-null), return `{ error: "An account with that email already exists.", field: "email" }` for the duplicate, keep the user create + audit entry + `signIn("credentials", { …, redirect: false })` with the `catch { redirect("/login"); }`, and finish with `return { created: true };` instead of `redirect(ROLE_LANDING.viewer)`. Extend `AuthFormState` as above. Remove now-unused imports only if nothing else uses them.
- [ ] **Step 5: Run** `npx vitest run src/lib/signup-rules.test.ts` then `npm run typecheck && npm run lint && npm test` — Expected: all PASS. (`signup-form.tsx` still compiles: it only reads `state.error`.)
- [ ] **Step 6: Commit** `feat(auth): sign-up rules report their field; signUp returns { created } instead of redirecting (Phase 44)`.

---

### Task 2: Step rules, scene data and the `shy` mood

**Files:**
- Create: `src/components/login/login-steps.ts`, `login-steps.test.ts`, `src/components/login/scenes.ts`, `scenes.test.ts`
- Modify: `src/lib/cris-mood.ts:4` (add `"shy"` to `CrisMood`), `src/components/cris/cris.css` (after `.cris-orb.m-cross` rules: `.cris-orb.m-shy .cr-orb { animation: cris-bob 4s ease-in-out infinite; --cr-eye-anim: cris-eye-shy; --cr-eye-dur: 3s; }` and `@keyframes cris-eye-shy { 0%,100% { transform: translate(-30px,-28px); } 50% { transform: translate(-24px,-32px); } }` beside the other eye keyframes), `src/components/cris/orb.test.tsx` (one case: `CrisOrb` with `mood="shy"` renders class `m-shy`)

**Interfaces:**
- Consumes: `SignUpField` (Task 1), `CrisMood` (now incl. `"shy"`).
- Produces (`login-steps.ts`):
  - `type Step = "welcome" | "login-email" | "login-password" | "signup-name" | "signup-password" | "signup-done"`
  - `STEP_PROGRESS: Record<Step, number>` = welcome 0, login-email 50, login-password 100, signup-name 33, signup-password 67, signup-done 100
  - `initialStep(page: "login" | "signup", stepParam: string | undefined): Step`
  - `emailProblem(raw: string, domain: string | null): string` ("" when fine)
  - `initials(email: string): string`, `firstFromEmail(email: string): string`, `firstWord(name: string): string`
  - `stepForField(field: SignUpField): Step`
  - `crisLine(step: Step, ctx: { email: string; name: string }): string | null`
  - `errorLine(message: string): string` → `` `Hmm. ${message}` ``
  - `isBackward(from: Step, to: Step): boolean`
- Produces (`scenes.ts`):
  - `type SceneId = "scan" | "missing" | "stamp" | "short" | "dep" | "off"`
  - `type Scene = { id: SceneId; minute: number; area: string; task: string; line: string; moods: [CrisMood, number][]; sayAt: number; cx: number; cy: number; focus: number; anchor: [number, number]; align: "left" | "right"; sky: [string, string] }`
  - `SCENES: readonly Scene[]` (spec §4.3; minutes 520, 595, 680, 825, 930, 1025; `sayAt` = 2500, 2200, 2600, 2400, 2600, 2500), `DWELL_MS = 6200`
  - `travelSeconds(fromCx: number | null, toCx: number): number`, `fmtClock(minute: number): string`, `dayPct(minute: number): number`, `cameraX(focus: number, scale: number, visibleRight: number, viewportWidth: number): number`

- [ ] **Step 1: Write the failing tests.** `login-steps.test.ts`:
```ts
expect(initialStep("login", undefined)).toBe("welcome");
expect(initialStep("login", "login")).toBe("login-email");
expect(initialStep("login", "admin")).toBe("welcome");
expect(initialStep("signup", undefined)).toBe("signup-name");
expect(emailProblem("", null)).toBe("Enter your work email.");
expect(emailProblem("neil@", null)).toBe("That doesn't look like an email address. Check for typos.");
expect(emailProblem("neil@gmail.com", "thebackroomop.com")).toBe("Use your @thebackroomop.com email.");
expect(emailProblem("  Neil.Lucero@TheBackroomOp.com ", "thebackroomop.com")).toBe("");
expect(emailProblem("a@x.thebackroomop.com", "thebackroomop.com")).toBe("Use your @thebackroomop.com email.");
expect(emailProblem("neil@gmail.com", null)).toBe("");
expect(initials("neil.lucero@thebackroomop.com")).toBe("NL");
expect(initials("it@thebackroomop.com")).toBe("I");
expect(firstFromEmail("neil.lucero@x.com")).toBe("Neil");
expect(firstFromEmail("@x.com")).toBe("");
expect(firstWord("  Ana  Reyes ")).toBe("Ana");
expect(stepForField("email")).toBe("signup-name");
expect(stepForField("password")).toBe("signup-password");
expect(crisLine("login-email", { email: "", name: "" })).toBe("Hi again! What's your work email?");
expect(crisLine("login-password", { email: "neil.lucero@x.com", name: "" })).toBe("Thanks, Neil. Now your password. I won't peek.");
expect(crisLine("login-password", { email: "", name: "" })).toBe("Thanks. Now your password. I won't peek.");
expect(crisLine("signup-name", { email: "", name: "" })).toBe("Hi, I'm Cris! Let's set up your account.");
expect(crisLine("signup-password", { email: "", name: "Ana Reyes" })).toBe("Nice to meet you, Ana. Pick a password with at least 10 characters.");
expect(crisLine("signup-done", { email: "", name: "" })).toBe("You're all set! An admin will give you a role soon.");
expect(crisLine("welcome", { email: "", name: "" })).toBeNull();
expect(isBackward("login-password", "login-email")).toBe(true);
expect(isBackward("login-email", "welcome")).toBe(true);
expect(isBackward("signup-name", "login-email")).toBe(false);
expect(isBackward("welcome", "signup-name")).toBe(false);
```
`initials` uses the local part split on `.`, `_`, `-`, first letter of up to two parts, upper-cased (`"?"` when empty). Domain comparison is case-insensitive on the trimmed value; `emailProblem` uses the regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
`scenes.test.ts`:
```ts
expect(SCENES.map((s) => fmtClock(s.minute))).toEqual(["08:40", "09:55", "11:20", "13:45", "15:30", "17:05"]);
expect(SCENES[4].line).toBe("Month 7 of 36. Book value ₱58,000.");
expect(travelSeconds(null, 560)).toBe(0);
expect(travelSeconds(560, 560)).toBe(0);
expect(travelSeconds(560, 1000)).toBe(1.3);
expect(travelSeconds(560, 3370)).toBe(2.4);
expect(travelSeconds(1000, 2850)).toBeCloseTo(1850 / 1100);
expect(fmtClock(1025 + 1440)).toBe("17:05");
expect(dayPct(480)).toBe(0); expect(dayPct(1080)).toBe(100);
expect(cameraX(700, 1, 960, 1440)).toBe(-220);
expect(cameraX(0, 1, 960, 1440)).toBe(0);            // never past the left end
expect(cameraX(3900, 1, 960, 1440)).toBe(1440 - 3960); // never past the right end
```
- [ ] **Step 2: Run** `npx vitest run src/components/login src/components/cris/orb.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** both modules and the `shy` mood. `cameraX` = `visibleRight / 2 - focus * scale` clamped to `[viewportWidth - 3960 * scale, 0]`. `travelSeconds` = 0 for null/equal, else `Math.min(2.4, Math.max(1.3, Math.abs(to - from) / 1100))`.
- [ ] **Step 4: Run** the same tests, then `npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(login): step rules, the six scenes and Cris's shy mood (Phase 44)`.

---

### Task 3: The world builder

**Files:**
- Create: `src/components/login/world.ts`, `src/components/login/world.test.ts`

**Interfaces:**
- Produces: `WORLD_W = 3960`, `WORLD_H = 760`, `buildWorld(): string` — one `<svg …>` string. Station animation hooks keep the mockup's names with the prefix (`lw-a-beam`, `lw-a-scanline`, `lw-a-pending`, `lw-a-done`, `lw-a-ok`, `lw-a-row`, `lw-a-scanner`, `lw-a-mag`, `lw-a-gap`, `lw-a-q`, `lw-a-sticky`, `lw-a-cursor`, `lw-a-pend`, `lw-a-appr`, `lw-a-shutter`, `lw-a-hb` (with `style="--d:…"`), `lw-a-miss`, `lw-a-recv`, `lw-a-past`, `lw-a-future`, `lw-a-dot`, `lw-a-val`, `lw-a-item`, `lw-a-tick`, `lw-a-done3`); clock hands `id="lw-hour"` and `id="lw-minute"`; gradients/filters/clip `lw-wallg`, `lw-floorg`, `lw-sky`, `lw-glow`, `lw-cone`, `lw-glare`, `lw-blur`, `lw-doorclip`, `lw-haz`. Sky stops read `var(--lw-sky1)` / `var(--lw-sky2)`; cone stops read `var(--lw-coneop)`.

- [ ] **Step 1: Write the failing test** `world.test.ts`:
```ts
const a = buildWorld(), b = buildWorld();
expect(a).toBe(b);                                   // seed resets per call
expect(a.startsWith("<svg")).toBe(true);
expect(a).toContain('viewBox="0 0 3960 760"');
for (const s of ["STOCKROOM", "PURCHASING", "RECEIVING", "FINANCE", "OFFBOARDING", "BR-LT-0230", "BR-LT-0027", "PR-1042", "PO-2219", "₱58,000", "RETURN KIT", "RETURN DESK", "EXIT", "OCT 2026"]) expect(a).toContain(s);
for (const id of ["lw-hour", "lw-minute", "lw-sky", "lw-doorclip"]) expect(a).toContain(`id="${id}"`);
expect(a).not.toMatch(/NaN|undefined/);
expect(a).not.toMatch(/class="(?!lw-)[^"]*"/);       // every class is prefixed
```
- [ ] **Step 2: Run** `npx vitest run src/components/login/world.test.ts` — Expected: FAIL.
- [ ] **Step 3: Port** the mockup's builder (`docs/mockups/2026-10-19-login-cris.html` lines 576–735: `R`, `T`, `rand`, `lamp`, `sign`, `win`, `shaft`, `shadow`, `qr`, `box`, `shelf`, `chair`, the shell, stations, motes, clock, lamps) into `buildWorld()` as typed TypeScript, renaming every class/id per Interfaces and moving `seed = 11` inside the function. Keep all coordinates and copy identical. Multi-class attributes (`class="past lw-a-past"`) become `class="lw-past lw-a-past"`.
- [ ] **Step 4: Run** the test, then `npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(login): the back-room world SVG builder (Phase 44)`.

---

### Task 4: The stepped sign-in card and the auth routes

**Files:**
- Create: `src/components/login/sign-in-card.tsx`, `src/components/login/login-experience.tsx` (card-only for now), `src/components/login/login.css` (tokens, hero layout, card styles)
- Modify: `src/app/(auth)/layout.tsx` (no `<main>`: `<div className="min-h-screen bg-canvas">{children}</div>`), `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/bootstrap/page.tsx` (outer `div` → `main`, same classes)
- Delete: `src/app/(auth)/login/login-form.tsx`, `src/app/(auth)/signup/signup-form.tsx`

**Interfaces:**
- Consumes: Task 1 `AuthFormState`, `signInWithCredentials`, `signUp`, `quickSignIn`; Task 2 `Step`, `STEP_PROGRESS`, `initialStep`, `emailProblem`, `initials`, `stepForField`, `isBackward`.
- Produces:
  - `type QuickSignIn = { accounts: { email: string; label: string }[]; refused: boolean } | null` (null = feature off)
  - `type CrisCue = { kind: "typing" } | { kind: "password-focus"; on: boolean } | { kind: "error"; message: string } | { kind: "pending" }`
  - `type SignInCardProps` (exported) and `SignInCard(props: SignInCardProps)` where `SignInCardProps = { step: Step; onStep: (s: Step) => void; domain: string | null; next?: string; microsoftAction: (() => Promise<void>) | null; quick: QuickSignIn; viewerLanding: string; onCue?: (c: CrisCue) => void; onValues?: (v: { email: string; name: string }) => void })`
  - `LoginExperience(props: { page: "login" | "signup"; initialStep: Step; world: string; card: Omit<SignInCardProps, "step" | "onStep" | "onCue" | "onValues"> })` — owns `step` state. (Task 4 ignores `world`; Task 6 renders it.)

- [ ] **Step 1: Pages.** `login/page.tsx` keeps today's server logic (flags, `showMicrosoft`, quick accounts query and order, `quick=refused`, `next`) and renders `<LoginExperience page="login" initialStep={initialStep("login", step)} world={WORLD} card={…} />` where `const WORLD = buildWorld();` is a module-level constant, `microsoftAction` is today's inline `"use server"` action (or `null`), quick accounts map to `{ email, label: ROLE_LABELS[role] }`, and `viewerLanding = ROLE_LANDING.viewer`. When `QUICK_LOGIN_EMAILS` is set but no account qualifies, pass `{ accounts: [], refused }` so the card shows "None of the listed accounts exists or is enabled.". `signup/page.tsx` renders the same with `page="signup"`, `initialStep("signup", undefined)`. Keep the existing `metadata` titles.
- [ ] **Step 2: Card.** Build `SignInCard` per spec §5 exactly: wordmark, progress bar (`STEP_PROGRESS`, hidden on welcome), each step's markup and copy, Back buttons, tiles as `<a href>` (`/login?step=login` + `&next=` when present, `/signup`) whose `onClick` calls `preventDefault()` and `onStep(…)`. One `<form action={loginAction}>` for login-email + login-password and one `<form action={signupAction}>` for signup-name + signup-password, both with **controlled** inputs held in card state, no `required`, and an `onSubmit` that on the first step of each form calls `preventDefault()` and runs Continue (client checks: `emailProblem`, name `< 2` after trim → "Enter your name.", empty password → "Enter your password.", `< 10` → "Use at least 10 characters."). Use `FormField` + `Input` (labels "Work email", "Password", "Full name"; `autoComplete` username/current-password/name/email/new-password; placeholders per §5.2) and `Button` (`variant="primary"`, `loading={pending}`; loading label text per §5.2 can be the visible children while pending). Show/Hide toggle (`aria-pressed`), Caps Lock hint (`getModifierState("CapsLock")` on keydown/keyup) wired into `aria-describedby`. `useActionState(signInWithCredentials, {})`: error → stays on login-password, shown on the password field. `useActionState(signUp, {})`: `created` → `onStep("signup-done")`; `field` → `onStep(stepForField(field))` with the message on that field. Quick sign-in: one `<form action={quickSignIn}>` with a `<select name="email">` (visually hidden label "Account") and `Continue` submit, `next` hidden input, the refused banner (`Banner tone="fault"` with today's text) and the selected email below. Focus each step's `h1` (`tabindex={-1}`) on step change but not on mount; set `aria-labelledby` on the card's `<main>` to the current `h1` id. Set `data-login-ready="true"` on the card's root in a mount effect. Fire `onCue` on typing (email/name inputs), password focus/blur, client/server errors and pending.
- [ ] **Step 3: CSS.** `login.css` (imported by `login-experience.tsx`): card styles ported from the mockup's "sign-in card" and "stepped sign-in card" sections (lines 103–139, 164–219) with `lw-` prefixes, using the app tokens; the hero layout for this task is the desktop hero with the card on the right over `--canvas`, and the narrow column. Step slide keyframes per §5.1; reduced motion drops them.
- [ ] **Step 4: Verify** `npm run typecheck && npm run lint && npm test` — Expected: PASS. Also `npx vitest run` shows no tests import the deleted forms.
- [ ] **Step 5: Commit** `feat(login): stepped Log in / Sign up card with the Cris wordmark; auth layout landmarks (Phase 44)`.

---

### Task 5: Move the e2e battery onto the new sign-in steps

**Files:**
- Modify: every `e2e/*.spec.ts` containing the old block; `e2e/quick-login.spec.ts`; `e2e/auth-shell.spec.ts`; any spec asserting old copy ("Sign in" heading or button, "Create account" button, the sign-up redirect)

**Interfaces:**
- Consumes: the card's labels, button names, tile link and `data-login-ready` (Task 4).

- [ ] **Step 1: Codemod** with a Python script (`newline=""`, preserve each file's line endings and indentation). Replace each occurrence of the three lines
  `await <pg>.getByLabel(/Email/).fill(<E>);` / `await <pg>.getByLabel(/Password/).fill(<P>);` / `await <pg>.getByRole("button", { name: "Sign in" }).click();`
  with the six-line block from spec §10 (using the same `<pg>`, `<E>`, `<P>`). Print the count per file; expected total 58 across 54 files. Then `grep -rn 'getByLabel(/Email/)\|name: "Sign in"' e2e` — Expected: no matches.
- [ ] **Step 2: Hand edits.** `quick-login.spec.ts`: heading "Welcome to Cris"; "absent by default" asserts no "Quick sign-in" heading and no `select` labelled "Account"; the sign-in test selects "IT staff" in the Account select and clicks `Continue` (`exact: true`); the forged test sets the IT option's `value` to the unlisted email via `evaluate` and submits. `auth-shell.spec.ts` and others: update any old-copy assertions found by `grep -rn '"Sign in"\|Create account\|/signup' e2e`. Sign-up tests (if any) now expect the "You're in" step, then click "Go to Cris".
- [ ] **Step 3: Verify** `npx tsc --noEmit -p .` (or `npm run typecheck` if it covers `e2e/`) and `npm run lint` — Expected: PASS. Do not run Playwright.
- [ ] **Step 4: Commit** `test(e2e): sign in through the new Log in steps; quick sign-in dropdown (Phase 44)`.

---

### Task 6: The room scene and day log

**Files:**
- Create: `src/components/login/room-scene.tsx`, `day-log.tsx`, `use-room-loop.ts`, `use-typewriter.ts`
- Modify: `src/components/login/login-experience.tsx`, `login.css` (room tokens light/dark, `@property --lw-sky1/--lw-sky2`, world classes, station keyframes and `[data-at=…]` rules, Cris halo/shadow, room bubble, day log)

**Interfaces:**
- Consumes: Task 2 `SCENES`, `DWELL_MS`, `travelSeconds`, `fmtClock`, `dayPct`, `cameraX`; Task 3 `WORLD_W`, `WORLD_H` and the world string; `CrisOrb`, `CrisOrbDefs`.
- Produces:
  - `useTypewriter(text: string | null, opts: { reduced: boolean; msPerChar: number; startDelayMs?: number }): { shown: string; done: boolean }`
  - `useRoomLoop(opts: { reduced: boolean; sceneRef: RefObject<HTMLDivElement | null>; worldRef: RefObject<HTMLDivElement | null>; visibleRight: () => number }): { index: number; playing: boolean; minute: number; mood: CrisMood; line: string | null; travelling: boolean; tx: number; scale: number; goTo(i: number): void; togglePlay(): void; suspend(): void; resume(): void; relayout(): void; crisPoint(): { x: number; y: number; scale: number } }` — `crisPoint` is in scene-element coordinates.
  - `RoomScene(props: { world: string; loop: ReturnType<typeof useRoomLoop>; hidden: boolean })`, `DayLog(props: { loop: ReturnType<typeof useRoomLoop> })`

- [ ] **Step 1: Loop.** Implement `useRoomLoop` with the mockup's `go()`/`frame()` behaviour (lines 738–856): set `--lw-tv`, sky vars, `data-at` reset-then-set on the world (force reflow between), the world transform `translate3d(tx,0,0) scale(s)` with `s = sceneHeight / 760` and `tx = cameraX(...)`, Cris's world transform, travel lean (`--lw-lean` ±10°) for the travel, mood timers from `scene.moods`, the line at `travel + sayAt`, the next scene at `travel + DWELL_MS`, the clock count during travel (ease-in-out, forward across midnight), clock hands via `#lw-hour`/`#lw-minute` `transform` attributes. Pause on `visibilitychange` hidden, resume on visible unless suspended or paused. Reduced motion: `playing` starts false, travel 0, line shown at once. All timers and RAFs cleared on unmount. Recompute on `resize` with transitions off for one frame.
- [ ] **Step 2: Components.** `RoomScene`: `aria-hidden` scene div, world div with `dangerouslySetInnerHTML={{ __html: world }}`, the room Cris (`CrisOrb` size 200, mood from the loop, halo and floor shadow) inside the world, the room bubble (screen space, `useTypewriter(line, { msPerChar: 34 })`, clamped inside the visible room per §4.5, align left/right per scene). `DayLog`: `<section aria-label="Cris's day">` per §4.6 (clock, area, task, pause/play button with the two labels and `aria-pressed`, six timeline buttons with labels "08:40 Stockroom: Checking in a returned laptop" etc., fill bar, 08:00/13:00/18:00 labels). `LoginExperience`: `<CrisOrbDefs />`, hero with scene, card (`<main>` first in DOM), day log; `visibleRight` = card's `offsetLeft − 24` on desktop, scene width on narrow.
- [ ] **Step 3: CSS.** Port the mockup's room tokens (light base, `[data-theme="dark"]` overrides), "room svg" classes and station animation rules (lines 240–330) with `lw-` prefixes, the hero/scene/bubble/day-log sections (lines 56–102) and the narrow banner rules (§3: banner `clamp(260px, 62vw, 360px)`, card then day log). Reduced motion stops world animations and transitions.
- [ ] **Step 4: Verify** `npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(login): Cris's day in the back room — scene loop, camera, moods, day log (Phase 44)`.

---

### Task 7: Focus mode and the forward Cris

**Files:**
- Create: `src/components/login/forward-cris.tsx`
- Modify: `src/components/login/login-experience.tsx`, `login.css` (focus rules per mockup lines 140–163, with the spec's veil values)

**Interfaces:**
- Consumes: Task 2 `crisLine`, `errorLine`, `isBackward`; Task 4 `CrisCue`, `onValues`; Task 6 `useRoomLoop` (`suspend`, `resume`, `crisPoint`, `relayout`), `useTypewriter`.
- Produces: `ForwardCris(props: { point: { x: number; y: number; scale: number }; flying: boolean; lean: number; visible: boolean; mood: CrisMood; line: string | null; bubble: { left: number; top: number; maxWidth: number; side: boolean; tail: number } })`.

- [ ] **Step 1: Focus state.** In `LoginExperience`, `focused = step !== "welcome"`. Entering (from welcome): `loop.suspend()`, set the card's `--lw-dx` to `(heroWidth − cardWidth)/2 − card.offsetLeft` (0 on narrow), place the forward Cris at `loop.crisPoint()` with no transition, show it, hide the room Cris, then (next frame) move it to the focus point (§6: desktop `x = max(154, cardLeftCentred − 170)`, `y = 0.54 × heroHeight`, scale 1.3; narrow `x = 0.28 × bannerWidth`, `y = banner centre`, scale `min(1, bannerHeight/280)`), leaning toward travel; end flight after 860 ms. Leaving (to welcome): reverse to `loop.crisPoint()`, then hide it, show the room Cris and `loop.resume()` (or show the current line if paused). Direct load with a non-welcome `initialStep`: start focused, Cris already at the focus point, line after 300 ms. Resize while focused: recompute `--lw-dx`, point and bubble without transitions.
- [ ] **Step 2: Lines and reactions.** On each step change while focused, `crisLine(step, values)` after 820 ms (entering) or 120 ms (later), mood `talk`, then `idle` 700 ms after typing ends (or `shy` while a password field is focused). Cues: `typing` → `search` for 800 ms; `password-focus` on → `shy` and hide the bubble, off → `idle`; `error` → `look` with `errorLine(message)`; `pending` → `think`, bubble hidden. Typing via `useTypewriter(…, { msPerChar: 30 })`.
- [ ] **Step 3: Bubble placement.** Desktop: above Cris, `maxWidth = max(180, min(300, cardLeftCentred − 36))`, `left = max(12, min(x − 0.35·bw, cardLeftCentred − 24 − bw))`, `top = y − 100·scale − 10`, tail at `clamp(16, x − left − 6, bw − 30)`. Narrow: to Cris's right, vertically centred, `left = x + 100·scale + 14`, `maxWidth = heroWidth − left − 12` (min 140), tail on the left.
- [ ] **Step 4: CSS.** Focus rules: scene `blur(7px) saturate(.85)` + `scale(1.04)` + veil (light `rgba(240,243,247,.42)`, dark `rgba(8,10,14,.5)`), scene animations paused, room bubble hidden, day log faded and non-interactive (narrow: `display: none`), card `translate(var(--lw-dx), -50%)` (narrow: `none`), forward Cris transitions `.85s cubic-bezier(.5,0,.2,1)`; reduced motion removes all these transitions.
- [ ] **Step 5: Verify** `npm run typecheck && npm run lint && npm test` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(login): focus mode — room blurs, card centres, Cris flies forward and talks (Phase 44)`.

---

### Task 8: Login e2e spec

**Files:**
- Create: `e2e/login-cris.spec.ts` (own helpers per the house rule; reseeds in `beforeAll` like its neighbours)
- Modify: `e2e/axe-sweep.spec.ts` (add `/login?step=login` beside `/login` and `/signup`)

**Interfaces:**
- Consumes: everything above; seed accounts and `SEED_PASSWORD` as neighbouring specs read them.

- [ ] **Step 1: Write the tests** (each a `test(...)`):
  1. Welcome shows "Welcome to Cris" and the wordmark "Cris"; clicking the Log in tile turns focus mode on (`hero` has the focus state; the day log section is hidden from the accessibility tree) and shows "What's your work email?".
  2. Pressing Enter in Work email advances to "Enter your password" (no navigation, URL unchanged).
  3. A wrong password shows "Wrong email or password — or the account is disabled." on the password step and the chip still shows the email; the right password lands on the IT landing page.
  4. Sign up: a duplicate seed email returns to "Create your account" with "An account with that email already exists." under Work email and both fields still filled; a new email + 10-char password reaches "You're in, {first name}" and "Go to Cris" lands signed in.
  5. Back from Log in 1 returns to Welcome and the day log is visible again.
  6. The second timeline button shows "09:55" and "Looking for a laptop that isn't on its shelf"; Pause sets `aria-pressed="true"` and the clock text stays the same after 3 s.
  7. At 375 × 812: `document.documentElement.scrollWidth <= 375`, and the first Tab from the top focuses a control inside `<main>`.
  8. With `reducedMotion: "reduce"` (via `page.emulateMedia`), entering Log in shows the full line "Hi again! What's your work email?" immediately.
  9. Resizing from 1440 to 1100 wide while on Log in 1 keeps the card's centre within 2 px of the viewport centre and the bubble's right edge left of the card's left edge.
  10. A 64-character email on Log in 2 leaves `scrollWidth` equal to the viewport width and the card's width unchanged.
  11. axe: no serious/critical violations on Welcome, Log in 1 and Sign up 1, in light and in dark (`br.theme=dark` cookie).
- [ ] **Step 2: Verify** `npm run typecheck && npm run lint` — Expected: PASS. Do not run Playwright (the battery runs it at the end of the phase).
- [ ] **Step 3: Commit** `test(e2e): Cris login page — steps, focus mode, scenes, phone, reduced motion, axe (Phase 44)`.
