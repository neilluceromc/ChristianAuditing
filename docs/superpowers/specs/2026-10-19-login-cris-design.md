# Phase 44 — The Cris login page

**Status:** approved by the owner on 2026-10-19 (mockup version 6, then "yes write the spec and proceed until development").
**Mockup:** `docs/mockups/2026-10-19-login-cris.html` (open it in a browser; same content as artifact https://claude.ai/artifact/6BWEA1TnJpjKae7oEbxT1o v6). Where the mockup and this spec differ, this spec wins.

## 1. Intent

The login page is the first thing every IT, purchasing and finance person sees each day. Today it is a plain 360 px card. The owner wants it to carry the Cris mascot's personality: behind the sign-in card, Cris works through a day in one illustrated back room, doing the real tasks the app exists for (checking in a returned laptop, approving a purchase, running depreciation, collecting a leaver's kit) and the everyday struggles (a laptop that isn't on its shelf, a delivery that came up short). When someone chooses Log in or Sign up, the room blurs, the form moves to the centre, and Cris flies forward and talks them through the steps.

Success: the page feels like Cris's app, signing in is still quick (two short steps), and nothing about sign-in, sign-up or quick sign-in behaves differently on the server except where §7 says so.

**Anti-goals** (failure even if it technically works):
- signing in gets slower or flakier, for people or for the e2e battery;
- the scene costs noticeable CPU when nobody is looking at it, or hurts the login page's load on the staging laptop;
- screen-reader or keyboard users have to deal with the decoration;
- the form is ever hidden behind or covered by Cris or a speech bubble.

## 2. Scope

**In:** `/login` and `/signup` (the `(auth)` route group): page layout, the room scene, the day log, the stepped sign-in card, focus mode, Cris's lines, the `signUp` action's success result (§7), the e2e sign-in helper and every spec that signs in through the form.

**Out:** `/bootstrap` (first-admin setup) keeps its current card; the app shell, page titles and `APP_NAME` ("Backroom IT") are unchanged (only the card's wordmark becomes "Cris"); no password reset (the app has none); no theme toggle on the login page; Microsoft SSO behaviour is unchanged (the button just moves).

## 3. Layout

Breakpoint: **900 px viewport width**. Above it is "desktop", at or below it is "narrow".

**Desktop:** one full-viewport hero (`height: 100svh`, minimum 640 px; on a viewport shorter than that the page scrolls). Layers, back to front:
1. the room scene, filling the hero (§4);
2. the day log, bottom-left, 24 px from the edges, `width: min(400px, 38vw)` (§4.6);
3. the sign-in card, 392 px wide, vertically centred, `right: max(32px, 5vw)` (§5);
4. in focus mode, the forward Cris and its speech bubble (§6).

**Narrow:** a column inside the page gutter (16 px, safe-area aware): the room as a full-bleed banner `height: clamp(260px, 62vw, 360px)`, then the card (full width, max 520 px, centred), then the day log (compact: clock, area and task on one row, timeline below). In the DOM the card (`<main>`) comes **before** the day log so the reading and tab order is: card first. The banner is decorative.

**Landmarks:** `src/app/(auth)/layout.tsx` stops wrapping children in `<main>` (it becomes a plain wrapper); the login/signup page's card is the `<main>`, and `/bootstrap` wraps its own content in `<main>` with its current classes.

**Theme:** the page follows the existing `data-theme` on `<html>` (the `br.theme` cookie). Light is a bright daytime room; dark is the same room with the pendant lamps lit (light cones, warm glow) and monitors glowing. All colours are tokens with light values and `[data-theme="dark"]` overrides, matching the mockup's palettes. The card uses the app's existing tokens (`--surface`, `--border`, `--accent`, …).

## 4. The room scene

### 4.1 World
One SVG "world" 3960 × 760 units: back wall (0–540), floor (540–760), drawn once on the server. Left to right: stockroom shelf A (x 120–560, rows A1–A4) with the check-in bench and a wall tablet; stockroom shelf B (900–1320, rows B1–B4) with the empty slot in B3; window; purchasing desk with monitor and chair; wall clock (x 2062); receiving dock (roll-up door, delivery van outside, pallet of headset boxes, packing slip, extinguisher); window; finance desk with depreciation monitor, calculator, October 2026 calendar and chair; offboarding counter ("RETURN DESK", tray, return-kit checklist) and the exit door. Zone signs: STOCKROOM, PURCHASING, RECEIVING, FINANCE, OFFBOARDING. Pendant lamps along the ceiling. Port the drawing from the mockup's builder (the `R`/`T` helpers, `box`, `shelf`, `lamp`, `win`, `chair`, `qr`) as a pure function `buildWorld()` that resets its seed (11) on every call, so two calls return the identical string.

The world is scaled to the hero's height (`scale = sceneHeight / 760`) and panned horizontally (the "camera").

### 4.2 Cris in the room
Cris is the existing `<CrisOrb color="gold" motion="lively" decorative>` (spec of Phase 41, `src/components/cris/orb.tsx`), 200 world units across, with the mockup's halo (gold core fading to sky blue) and a soft floor shadow. The login page renders its own `<CrisOrbDefs />` once (the `(app)` layout's copy is not on auth pages). Gold is fixed here: there is no signed-in user whose colour preference could apply.

### 4.3 The six scenes
| # | Time | Area | Task (day log) | Cris's line (speech bubble) | Moods (ms after arrival) | Cris at (x, y) | Camera focus x | Bubble anchor, align | Sky (top, bottom) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 08:40 | Stockroom | Checking in a returned laptop | BR-LT-0230 is checked in. Back on shelf A2. | search 0, talk 2500 | 560, 340 | 700 | 604, 226, right | #a9d6f7, #eef8ff |
| 2 | 09:55 | Stockroom | Looking for a laptop that isn't on its shelf | Shelf B3 says BR-LT-0027. Shelf B3 disagrees. | look 0 | 1000, 340 | 1110 | 968, 226, left | #97cdf4, #e3f3ff |
| 3 | 11:20 | Purchasing | Approving a purchase request | PR-1042 approved. Five headsets for the new hires. | think 0, talk 2600 | 1650, 350 | 1830 | 1620, 238, left | #86c4f2, #d6eeff |
| 4 | 13:45 | Receiving | Receiving a delivery that came up short | Ordered 10. Received 9. Again. | search 0, cross 2400 | 2100, 350 | 2300 | 2068, 238, left | #86c0ee, #dcefff |
| 5 | 15:30 | Finance | Running this month's depreciation | Month 7 of 36. Book value ₱58,000. | think 0, talk 2600 | 2850, 350 | 3050 | 2818, 238, left | #f2c58f, #fdebd0 |
| 6 | 17:05 | Offboarding | Collecting a leaver's equipment | Laptop, headset, badge. All 3 back. | search 0, idle 2500 | 3370, 340 | 3560 | 3404, 226, right | #f2a372, #ffd7a8 |

The bubble starts typing when the second mood starts (scene 2: 2200 ms). Depreciation figures are straight line, ₱72,000 over 36 months, month 7 → ₱58,000 (the receipt month counts as month 1, as in the app).

### 4.4 Loop and motion
- Each scene: travel, then 6.2 s at the station, then the next scene; after scene 6 it loops to scene 1. The day-log clock counts the minutes from the old time to the new one over the travel (wrapping forward past midnight on the loop).
- Travel time = `clamp(1.3 s, distance / 1100, 2.4 s)`; Cris trails the camera slightly (×1.12) and leans into the direction of travel. A scene picked while already at that station does not travel.
- Camera: centre the scene's focus x in the visible part of the room. On desktop that is the area left of the card (card left edge − 24 px); on narrow it is the banner's centre. Clamp so the world never shows past its ends.
- Station animations (scanner beam and kiosk flip, magnifier hunt and empty-slot blink, cursor click and status chip, dock door roll-up and boxes dropping with slot ten blinking, depreciation line drawing, kit items dropping and ticks drawing) restart each time Cris arrives. Their resting CSS is the **end state**, so a paused or reduced-motion room is complete.
- The sky colours ease between scenes; the wall clock's hands follow the day-log time.
- Ambient: lamp glow (dark only), dust motes in the window light, Cris's halo breathing.
- **Pause** when the tab is hidden (`visibilitychange`) and in focus mode. **Reduced motion** (`prefers-reduced-motion: reduce`): no autoplay, no travel or station animations, text appears without typing; the timeline buttons still switch scenes instantly.

### 4.5 Speech bubble (room)
Screen space (not scaled), 15 px text (13 px narrow), `max-width: min(300px, 100% − 24px)`, `width: max-content`, typed at 34 ms per character with a caret. Positioned at the scene's anchor, clamped inside the visible room (never under the card), tail pointing at Cris.

### 4.6 Day log
A small panel: the clock (mono, 28 px), the area (uppercase mono, accent) and the task; a pause/play icon button (`aria-pressed`, constant label "Pause the scene", `aria-pressed` true while paused); a timeline from 08:00 to 18:00 with one 24 px button per scene (label "08:40 Stockroom: Checking in a returned laptop", `aria-pressed` on the current one, earlier ones filled) and a fill bar up to the current time. It is the only interactive part of the scene and is a labelled `<section aria-label="Cris's day">`.

## 5. The sign-in card

### 5.1 Frame
Wordmark **Cris** (23 px, 700, tight tracking) with **IT INVENTORY** beside it (mono, uppercase, muted). No logo. A 3 px progress bar under it, hidden on the first step. Glass surface (`--surface` at ~84–90 % with backdrop blur), 16 px radius, the app's border and a deep shadow. Each step's `<h1>` is focusable (`tabindex="-1"`) and receives focus when the step changes (not on first load); the card's `aria-labelledby` follows the current heading. Steps slide in (18 px, 340 ms; from the left when going back); reduced motion drops the slide.

### 5.2 Steps and copy
**Welcome** (no progress bar)
- `h1` "Welcome to Cris"; lede "Laptops, headsets, purchases and leavers, tracked in one place."
- Two choice tiles, each a real link that the client intercepts once hydrated (before hydration the link simply navigates): **Log in** / "I already have an account" (primary, filled accent) → `/login?step=login`, keeping `next` if present; **Sign up** / "I'm new to Cris" → `/signup` (sign-up ignores `next`, as today).
- When Microsoft SSO is on (same rule as today): "OR" divider and **Continue with Microsoft** (existing server action).
- Quick sign-in, only when `QUICK_LOGIN_EMAILS` lists accounts (same rules as today): heading "Quick sign-in" with a "Staging" pill, hint "One click, no password. Turned on for this server only.", a `<select>` of the existing, enabled accounts (option text = role label, value = email, order = the env list) and a **Continue** submit button, inside one form posting to `quickSignIn` with `email` = the selected value and `next` if present. Under the row, the selected email in mono. `?quick=refused` shows today's fault banner here. If none of the listed accounts exists: today's "None of the listed accounts exists or is enabled." and no select.
- When `allowed_domain` is set: "Access is limited to @{domain} accounts."

**Log in · 1 of 2** (progress 50 %)
- Back (→ Welcome), `h1` "What's your work email?", field **Work email** (`type=email`, `autocomplete=username`, placeholder `name@{domain}` or `name@company.com` when no domain), **Continue**. Footer: "New to Cris? Sign up" (→ Sign up 1).
- Client checks, in order: empty → "Enter your work email."; not an email → "That doesn't look like an email address. Check for typos." Log in does not check the allowed domain (the server never has); only Sign up 1 does. Errors show under the field (`aria-live="polite"`, `aria-invalid`, focus moves to the field without scrolling).

**Log in · 2 of 2** (progress 100 %)
- Back (→ Log in 1), `h1` "Enter your password", a chip with initials (from the email's local part, up to two letters), the email, and **Change** (→ Log in 1). Field **Password** with **Show/Hide** (`aria-pressed`), a "Caps Lock is on." hint, **Log in** (shows a spinner and "Logging in…" while pending). Footer: "Forgot your password? Ask an admin for help."
- Empty → "Enter your password." Server error (wrong password, disabled, rate limited) → today's message, shown under the password field.
- Log in 1 and 2 are **one `<form>`** posting to the existing `signInWithCredentials` with `email`, `password` and `next`, so password managers see both fields; step 1 only hides the password group.
- Inputs are **controlled** (React 19 resets uncontrolled fields after a form action, which would wipe the hidden email on a wrong password). No `required` attributes (a hidden required field blocks submit); the client checks replace them. The form's `onSubmit` calls `preventDefault()` on step 1 and runs Continue instead, so Enter on step 1 advances rather than posting.

**Sign up · 1 of 3** (33 %)
- Back (→ Welcome), `h1` "Create your account", **Full name** (`autocomplete=name`, placeholder "Juan dela Cruz"), **Work email** (`autocomplete=email`), **Continue**. Footer "Already have an account? Log in" (→ Log in 1).
- Name empty or under 2 characters → "Enter your name."; email checks as Log in 1.

**Sign up · 2 of 3** (67 %)
- Back (→ Sign up 1), `h1` "Choose a password", **Password** (`autocomplete=new-password`) with Show/Hide and the Caps Lock hint, a 4 px strength bar (6.25 % per character, amber until 10 characters, green from 10), the rule "At least 10 characters" (circle, then tick when met), **Create account** ("Creating account…" while pending).
- Under 10 characters → "Use at least 10 characters."
- Sign up 1 and 2 are one `<form>` posting to `signUp`, with the same controlled-input and Enter-on-step-1 rules as Log in.

**Sign up · 3 of 3** (100 %)
- A green tick, `h1` "You're in, {first name}", lede "New accounts start as **Viewer**. An admin assigns your role, and your role decides which workspace you land in.", and **Go to Cris** linking to `ROLE_LANDING.viewer`.

### 5.3 Server errors on sign-up
`signUp` errors return the step they belong to (§7): name → Sign up 1 under Full name; email (invalid, domain, already exists) → Sign up 1 under Work email; password → Sign up 2. The client moves to that step and shows the message under the field.

## 6. Focus mode

Entering any step other than Welcome turns focus mode on; returning to Welcome turns it off.

**On:**
- the hero gets a `focus` state: the scene blurs (7 px) and desaturates slightly, scales to 1.04, and a veil dims it (light `rgba(240,243,247,.42)`, dark `rgba(8,10,14,.5)`); all scene animations pause; the room bubble hides;
- the day log fades out and stops taking clicks (narrow: removed from the layout);
- the card slides from the right to the horizontal centre of the hero (desktop only; 850 ms, `cubic-bezier(.5,0,.2,1)`);
- the **forward Cris** (a second `CrisOrb`, outside the blurred scene) appears exactly over the room Cris, which hides, then flies to beside the card while growing: desktop target x = `max(154, cardLeftCentred − 170)`, y = 54 % of the hero height, scale 1.3 (260 px); narrow target x = 28 % of the banner width, y = banner centre, scale `min(1, bannerHeight / 280)`. It leans while flying.
- Cris talks after arriving (820 ms after the flight starts; 120 ms on later step changes), in a bubble above Cris (desktop; clamped so its right edge stays 24 px left of the centred card, max width `min(300, cardLeft − 36)`) or to Cris's right (narrow).

**Lines** (`{name}` from the sign-up name's first word; `{first}` from the email's local part before `.`, `_` or `-`, capitalised):
| Step | Line |
|---|---|
| Log in 1 | Hi again! What's your work email? |
| Log in 2 | Thanks, {first}. Now your password. I won't peek. ("Thanks." when no first part) |
| Sign up 1 | Hi, I'm Cris! Let's set up your account. |
| Sign up 2 | Nice to meet you, {name}. Pick a password with at least 10 characters. |
| Sign up 3 | You're all set! An admin will give you a role soon. |

**Reactions:** typing in an email or name field → `search` for 800 ms; focusing a password field → a new **`shy`** mood (eye turned up and away, gentle bob; added to the `CrisMood` union and as `.cris-orb.m-shy` rules plus keyframes in `cris.css`, alongside the existing moods) until blur; a client or server error → `look` with the line "Hmm. {error message}"; while a form is pending → `think` and the bubble hides; after a line finishes typing → back to `idle` (or `shy`).

**Off** (Back to Welcome): everything reverses; the forward Cris flies back to the room Cris's current position and shrinks, then the room Cris shows again and the loop resumes (or, when paused, the current scene's line shows).

**Direct loads:** `/login?step=login` and `/signup` render already in focus mode with the forward Cris in place (no flight) and the step's line typed after 300 ms. `/login` with no `step` renders Welcome.

Resizing while focused re-places the card offset, Cris and the bubble without animating.

## 7. Server changes

- `AuthFormState` gains `field?: "name" | "email" | "password"` and `created?: boolean`.
- `signUp`: each validation error sets `field` (name, email for invalid/domain/exists, password). On success it no longer redirects: after the existing `signIn("credentials", { redirect: false })` it returns `{ created: true }` (the session cookie is set, so **Go to Cris** lands signed in). If that sign-in throws, keep today's `redirect("/login")`.
- `signInWithCredentials`, `quickSignIn` and the Microsoft action are unchanged.
- `/signup/page.tsx` renders the same login experience starting at Sign up 1; `/login/page.tsx` reads `step`, `next`, `quick`.

## 8. Accessibility

- The scene (world, room Cris, room bubble) and the forward Cris and its bubble are `aria-hidden`; nothing in them is focusable. The day log is the only interactive decoration and comes after `<main>` in the DOM.
- Every field has a visible label, the right `autocomplete`, `aria-invalid` and `aria-describedby` pointing at its error and Caps Lock hint. Errors are `aria-live="polite"`.
- Visible focus on every control; tiles and buttons are at least 40 px tall.
- axe: no serious or critical violations on `/login`, `/login?step=login` and `/signup`, light and dark (the HUD and card text must meet AA on their glass backgrounds).
- Reduced motion as §4.4 and §6 (no flight: Cris appears beside the card; no slide).

## 9. Performance

- The world SVG string is built once per server process (module-level constant) and sent as HTML; the client never rebuilds it.
- The client controller only sets transforms, a `data-at` attribute, class names and text; no per-frame work except the clock count during travel and the typing interval.
- The scene pauses when hidden and in focus mode (CSS `animation-play-state` plus cleared timers).
- No raster images, no new dependencies.

## 10. Testing

- **Unit (vitest):** the scene table and travel-time function; the world builder is deterministic (same string twice) and contains every station's key labels; the email check (empty, malformed, wrong domain, ok, no-domain mode); initials and `{first}`; the step machine (which step each action leads to, which step a server `field` maps to); `signUp` returns `field` per error and `{ created: true }` on success (existing action tests extended).
- **E2E:** the house rule stays (no helpers imported across spec files; each spec keeps its own copy). Every place that fills the old form (today the `getByLabel(/Email/)` / `getByLabel(/Password/)` / `"Sign in"` block, 58 sites in 54 files, most after `goto("/logout")`, two after a `?next=` redirect in `back.spec.ts` and `auth-shell.spec.ts`) is rewritten to the same block, which works from Welcome with or without `next`:
  ```ts
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(EMAIL);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  ```
  Specs asserting old copy are updated: `quick-login.spec.ts` (heading "Welcome to Cris"; the dropdown plus **Continue** instead of per-account buttons; the forged-account test sets a `<select>` option's value instead of a hidden input), `auth-shell.spec.ts` and any test of the old sign-up redirect. New `e2e/login-cris.spec.ts`: Welcome → Log in tile → focus mode on → wrong password shows the error on step 2 with the email still filled → right password lands on the role's page; Sign up 3 steps with a duplicate email bouncing to step 1 (name and email kept) and a new one reaching "You're in"; Back returns to Welcome and focus mode turns off; the timeline buttons switch scenes and Pause stops the clock; 375 px width has no horizontal scroll and the card comes first in tab order; reduced motion shows the line without typing. axe as §8.
- The card sets `data-login-ready="true"` after hydration; the block waits for it so Continue never races hydration.

## 11. Decided by the builder (Claude's calls, flag if wrong)

- Breakpoint 900 px; desktop hero is exactly one viewport tall.
- Gold Cris on the login page regardless of theme.
- Steps are not pushed to browser history; the in-card Back is the way back. Direct-load URLs exist for Log in and Sign up.
- Sign up ends on a "You're in" step instead of redirecting straight into the app.
- The page title stays "Sign in · Backroom IT" / "Create account · Backroom IT".
- Logged-out visitors with no `br.theme` cookie see light, as today (no `prefers-color-scheme` fallback).
- Narrow layout puts the card above the day log (the mockup had the day log first) so the form is higher on a phone.

## 12. Left to the builder

File layout under `src/app/(auth)/` and `src/components/login/`, how the controller is split into hooks, exact easing for the sky transition, and whether the station keyframes live in one CSS file or two.
