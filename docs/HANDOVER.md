# Inventory v2 — Session Handover

**Last updated:** 2026-10-24 (**USERS & ACCESS (admins add, edit, approve, reset and turn accounts on or off in Users & access; a temporary password leads to /welcome/password; Account settings for every role; sign-up always waits for approval; three wrong passwords pause sign-in for 15 minutes) is CODE-COMPLETE on branch `access-management` (2026-10-24): all 5 tasks, vitest 5,690, `tsc` clean, 158 browser tests in 14 files green, then the final review's fix wave (`3ef5987`, `cba1a98`; vitest 5,698; `access-management` and `login-cris` 25/25); NOT MERGED, NOT PUSHED, NOT DEPLOYED. Adds two migrations, `20261024090000_access_management` and `20261024091000_sign_in_attempt_created_index` (42; `main` and Supabase stay at 40), so the push takes a Supabase dump first. The owner kept existing accounts and the shared seed password as they are: see the 5 Nov risk in record (ba).** Before it: **WORKLIST SPLIT VIEW (H4) (the owner's mockup H4: /inventory/work is one screen - queue tabs, a sortable paged table and a details panel, decide then the next row, Undo for Keep as spare and Send to repair, bulk decisions, Cleared today) is MERGED (`728f754` --no-ff of `sent-back-notify`, then `742e592` --no-ff of `worklist-split`, which had been integrated with it and re-tested: vitest 5,329, `tsc` clean, the two new specs 22/22), PUSHED AND DEPLOYED to Vercel 2026-10-23 (no migration; still 40; secret scan zero). Live check as IT at 1440x900: the one-screen Worklist (no page scroll, Triage 20, 7 rows a page, the details panel with real last holder, facts and history); as admin: no red 'need correction' banner on Inventory; no migration (40 migrations). A page shows as many 52 px rows as fit, 6 to 10 (7 at 1440x900 and 6 at 1280x720 with Cris in the corner). vitest 319 files / 5,300; `tsc` and `eslint` clean; browser: the new `worklist.spec.ts` 14/14 and every spec that touches the Worklist, Home or a status banner, 178 tests in 17 files, green after re-runs; record (az).** Before it: **THE SENT BACK CHIP AND THE MISSING NOTIFICATIONS (Inventory's red "need correction" banner is gone; a quiet "Sent back · N" chip counts by team; an admin's bell reads every team; Finance's approvals and undos notify the team affected) are MERGED (`728f754`), PUSHED AND DEPLOYED with the Worklist (2026-10-23) (no migration; 40 migrations). vitest 312 files / 5,118; `tsc` and `eslint` clean; the new `sent-back-notify.spec.ts` 8/8 and the affected e2e, 216 tests in 18 files including axe-sweep, green; record (ay).** Before it: **DOCUMENT PREVIEW AND UPLOAD TIMES (any uploaded PDF, PNG or JPG opens in a Preview dialog in place; every listed file says "Uploaded <date time> · <name>") are MERGED (`0948a10`, --no-ff of `doc-preview`, tree = the tested tip), PUSHED AND DEPLOYED to Vercel 2026-10-23 (no migration; 40 migrations; secret scan zero); final whole-branch review: ready to merge, its 4 minors applied (`692c911`); live check as IT on the one stored file (an asset's Specs.png): Preview dialog named 'Photo', 'Uploaded 20 Oct 2026 23:13 · System Admin', image shown, no error, Esc closes; `?inline=1` 200 inline + nosniff, plain link 200 attachment. No PDF is stored on Supabase yet, so a live PDF preview is unchecked; branch and worktree removed. vitest 310 files / 5,083; `tsc` and `eslint` clean; the affected e2e, 238 tests in 19 files including the new `file-preview.spec.ts` and axe-sweep, green; record (ax).** Before it: **THE A3 PURCHASE ORDER FORM AND THE VENDOR WORDING (the owner's "A3 · Section rail with progress" board; Supplier is now Vendor in the UI; Registration no. is VAT REG. TIN) ARE MERGED (`2d4eda3`, --no-ff of `po-form-redesign`, tree = the tested tip), PUSHED AND DEPLOYED to Vercel 2026-10-22; migration 39 (`20261023090000_po_form_fields`, `20261023091000_po_form_defaults`) APPLIED on Supabase (40 migrations, none unfinished; dump `backups/supabase-before-po-form-20261022-2133.dump`, 47 tables, taken first; secret scan of the 29 outgoing commits zero). Checked after deploy: /login 200, worker tick 401 without secret; poNumber partial unique index present; 16 categories, 0 unconfirmed; 155 POs, all legacy (formV2 false); no anon/authenticated grants; signed in as Purchasing (quick sign-in behind the STAGING pill) at 1366x768: the A3 form shows its rail, cards, Sales invoice slot and TOTAL AMOUNT DUE with Save in view, the nav says Vendors, the Vendors page has no 'supplier'. `main` = `origin/main`; branch and worktree removed; record (aw).** Before it: **PURCHASE ORDERS + THREE-TEAM INTAKE + NOTIFICATION BELL AND THE CRIS LOGIN REDESIGN ARE MERGED (`ed56853`, --no-ff of `po-intake`), PUSHED AND DEPLOYED to Vercel 2026-10-22; migration 38 `20261022090000_purchase_orders` APPLIED on Supabase (38 migrations; dump `backups/supabase-before-po-intake-20261022-0320.dump`, 45 tables, taken first). Checked after deploy: states READY 71 (all completed), WITH_IT 42, SENT_BACK 26, CANCELLED 16; 155 PO- refs, 0 PR-; 1,002 assets; no anon/authenticated grants on Notification/NotificationRead; /login 200, worker tick 401 without secret; quick sign-in (STAGING pill) signs in all four roles to Home, bell on every page, Purchasing Home '26 purchase orders sent back to you' (the old drafts), Finance '100 to check' on /finance/review. Day one for the owner: 15 unapproved assets on old requests need an SI number on their PO before Finance can approve them. `main` = `origin/main`; branch and worktree removed.** Before it: **THE CRIS LOGIN REDESIGN (THE OWNER'S BLOB-STYLE SIGN-IN AND SIGN-UP, TASK 10) IS ALSO CODE-COMPLETE ON `po-intake`, SHIPPING WITH THE PURCHASE ORDERS WORK; NOT MERGED, NOT PUSHED, NOT DEPLOYED; NO MIGRATION; record (av).** Before it: (**PURCHASE ORDERS AND THE THREE-TEAM INTAKE (PURCHASE ORDERS REPLACE PURCHASE REQUESTS: NO DRAFTS, SAVING SENDS A PO ON; PURCHASING → IT → FINANCE WITH SEND-BACKS TO THE OWNING TEAM AND CROSS-TEAM FIXES WITH A REASON; REGISTER FROM A PO WITH PART DELIVERIES; FINANCE REVIEWS A REGISTRATION GROUP IN ONE GO WITH HOLD-BACK AND UNDO; A TEAM NOTIFICATION BELL, SENT BACK TABS AND HOME CARDS; NO PHASE NUMBER) IS CODE-COMPLETE ON `po-intake` (26 commits above `main` `7c48269`, docs commit last); NOT MERGED, NOT PUSHED, NOT DEPLOYED; ADDS MIGRATION 38 `20261022090000_purchase_orders` (lossy for SUBMITTED vs IT_REVIEWED: Supabase dump first); record (au).** Before it: (**PHASE 47 FOLLOW-UP (FINANCE SORTING BY DATE APPROVED, DATE ADDED, PURCHASE DATE AND COST WITH A DATE LINE; UNDO OF EVERY REVIEW ACTION FOR 15 MINUTES FROM THE TOAST OR AN UNDO BANNER, SAME PERSON ONLY, CHECKED ON THE SERVER; ADMIN REOPEN REVIEW WITH A REASON; CLEARER REVIEW TOASTS WITH A DETAIL LINE AND UNDO / OPEN BUTTONS; EVERY SIGN-IN LANDS ON HOME WITH `next` STILL WINNING; SEARCH AS YOU TYPE WITH STARTS-WITH FIRST AND AN EXACT TAG OPENING ONLY ON ENTER; EMPLOYEES SORT BY NAME, JOINED OR EMPLOYEE NO.) IS CODE-COMPLETE ON `finance-undo-sort` (14 commits above `main` `1fad8a4`, docs commit last), MERGED (`a591f8d`, --no-ff of `finance-undo-sort` after the final fix wave `44bc75a`..`ccc8602`), PUSHED AND DEPLOYED to Vercel 2026-10-21 (Supabase dump `backups/supabase-before-undo-20261021-1027.dump`, 45 tables, first; /login 200, worker 401 without secret); live-search production check PASSED (Playwright via quick sign-in on the welcome step: sign-in lands on /; Inventory "B"→"BR-"→"BR-L" and Employees "E" kept text, caret and URL with 0 fallback reloads; E-names first; a pasted exact tag only filters, Enter opens it, Back returns to the list); NO MIGRATION (37 stays); no phase number (client staff stays Phase 48); record (at).** Before it: (**PHASE 47 (FINANCE ASSETS REDESIGN: THE ASSETS LIST WITH MONEY CARDS, CATEGORY AND STATUS TILES, FINANCE-STATE TABS AND A LIFE COLUMN; THE ASSET PAGE, OPTION B, WITH A YEAR-BY-YEAR LEDGER, NOTES, ATTACHMENTS AND A FINANCIAL HISTORY; THE SAME NOTES AND ATTACHMENTS ON THE INVENTORY RECORD; AND FIVE SHELL FIXES: SIDEBAR ANIMATION, A DISPOSAL PAGE SHOWING THE ANIMATED "CRIS AT WORK" SCENE (TASK 10), THE "CRIS" NAME, SETTINGS THAT FOLLOW THE PERSON, CRIS CHATS CLEARED ON SIGN-OUT) IS CODE-COMPLETE ON `phase-47-finance` (22 commits above `main` `9192422`, tip `e9fcda0` (Task 10) plus its docs commit), MERGED (`ab75ba6`, --no-ff of `phase-47-finance` after the final review's fix wave `593801e`..`ccff6a8`: no BR mark in the phone top bar or setup page, attachment size checked in the browser, dead code, CSV guard), PUSHED AND DEPLOYED to Vercel + Supabase 2026-10-21 (Supabase dump `backups/supabase-before-phase47-20261021-0528.dump`, 44 tables, taken first; migration 37 applied, 37 migrations; AssetNote present; anon/authenticated grants 0; worker tick 200; sign-in page title "Sign in · CRIS"); vitest 246 files / 4,167; ADDED MIGRATION 37 `20261021090000_finance_notes` (37 migrations); before pushing, dump Supabase (`scripts/supabase/dump.ps1 -Image postgres:17-alpine`) because the push migrates; NUMBERING: client staff → Phase 48, deeper asset management → Phase 49; record (as).** Before it: (**CLOUD STAGING (VERCEL + SUPABASE) IS MERGED, PUSHED AND CUT OVER 2026-10-20: staging now runs on Vercel Hobby (production domain, kept out of this public repo because quick login is on) with Postgres + Storage on Supabase Free (Singapore); the laptop's web and worker are STOPPED (db kept; `docker compose start web worker` restarts it) after the final dump `backups/staging-cutover-20261020-2212.dump` (44 tables); restore into Supabase OK and row counts identical (44 tables, 48,765 rows); lockdown.sql re-run (0 anon/authenticated grants); pg_cron worker-tick (every minute) and worker-maintenance (hourly :05) answer 200; the owner verified sign-in, an approval and an upload; QUICK_LOGIN_PUBLIC=1 is ON for presentations (turn it off afterwards: delete it in Vercel and Redeploy); quick-login opt-in merged `90a014d`; every push to `main` now deploys to Vercel, so push only on the owner's word, and dump Supabase first when a push adds a migration; the owner's runbook is `docs/CLOUD-STAGING.md`; five new cloud-only env vars (`DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SIGNUP_REQUIRES_APPROVAL`); no migration; NUMBERING unchanged (client staff stays Phase 47); record (ar).** Before it: (**PHASE 46 (THE OVERVIEW HOME FOR EVERY WORKSPACE, A COLLAPSIBLE SIDEBAR RAIL AND THE SAME VIEWS IN EVERY WORKSPACE) IS MERGED, PUSHED AND DEPLOYED (`main` = `origin/main` = `735e3fe`, a --no-ff merge of `phase-46-home` `d2b0d30`, which had `main`'s `f7cdd71` merged in and re-tested: tsc clean, vitest 204 files / 3,633, phase-46/45/42 browser specs 39/39; secret scan zero; STAGING RUNS `735e3fe`, redeployed 2026-10-20, IP .193 matched, `pg_dump` snapshot `staging-before-phase46.dump` (43 tables) taken first, migration 36 applied (36 migrations), web healthy, /login 200 locally and over the LAN, the worker's first snapshot written for 2026-10-20); ADDED MIGRATION 36 `20261020090000_metric_snapshot` (the `MetricSnapshot` table, written by the worker's nightly snapshot with a 10-minute retry back-off and pruned after 400 days), so THE STAGING DEPLOY MUST APPLY IT (`prisma migrate deploy`, run by the compose `migrate` service); history tiles read "Collecting history" until about 8 nightly snapshots exist (`metricHistory` fails soft); every workspace's Home is now the Overview (six KPI tiles with sparklines and deltas, a trend chart, a make-up bar, a ranked breakdown and Needs you), the sidebar collapses to a 72 px rail (cookie `br.sidebar`, flyouts, the `[` key) and links open into views on click, and Purchasing, Finance and Admin gain the IT-style views, eight new count keys and three new filters (`?renewing=30`, `?disabled=0|1`, `?state=unavailable`); vitest 203 files / 3,629; NUMBERING: this phase is 46, so client staff and people flows is now Phase 47 and deeper asset management Phase 48; NEXT: time Home once on staging with `SLOW_QUERY_MS=200`, then Phase 47; record (aq).** Before it: (**PHASE 45 (THE INVENTORY AND EMPLOYEES LISTS REDESIGN) IS MERGED, PUSHED AND DEPLOYED (`main` = `origin/main` = `97974b5`; STAGING RUNS `97974b5`, redeployed 2026-10-20; NO migration (still 35), no schema change, no new dependency): Inventory gets six count tiles that filter, six calmer columns (Serial number added; Registration, Purchased and Warranty off by default) and a new `attention=1` filter, Employees gets underlined tabs with counts, calmer columns and a selection with Transfer... (all or nothing), Export by ids and Print IT forms, and both lists get zebra rows, a sticky toolbar, header and footer, Rows per page (`?per=` 25/50/100), three row sizes (Comfortable, Compact, Dense) and a floating bulk bar; browser battery green across all 57 e2e files after two real fixes (a popover under the sticky footer; light hover contrast) with one environment-dependent quick-login failure that is not a regression; vitest 3,348; the late focus-jump finding (window `scroll-padding`) FIXED in `ca09f62` with per-row `scroll-margin`; NUMBERING: this phase is 45, so client staff and people flows is Phase 46 and deeper asset management is Phase 47; NEXT: fix the open finding, then Phase 46; record (ap).** Before it: (**STAGING RUNS `23568a9`: PHASE 44 (THE CRIS LOGIN PAGE) AND THE FONT AND TABLE FIX ARE BOTH MERGED, PUSHED AND DEPLOYED; main = origin/main = `23568a9`; NO migration (still 35); FONTS AND TABLE ROWS FIXED (the owner asked "why is the font not the same on other devices? and text is not good on other displays and boxes"; their screenshot showed an office PC with a locally installed "Helvetica" that rendered heavy and blurry, and Inventory rows wrapping 3 lines at about 1280 px; the fix self-hosts Geist and Geist Mono with `next/font/google`, drops Helvetica from the font stacks, makes table cells `whitespace-nowrap` by default with long free-text columns truncating to a `title` tooltip, and restacks Inventory and Purchases so they fit at 1280 x 800; typecheck and lint clean, vitest 3,216, affected e2e 188 passed, axe sweep 9/9) IS MERGED `--no-ff` as `23568a9` (merged tree = tested tip `6149784`) and PUSHED 2026-10-19 (`89e3b5c..23568a9`; secret scan zero), and staging REDEPLOYED at `23568a9` (CI image pulled; snapshot `staging-before-fonts.dump` first; IP check .193 matched; no migration; web healthy; /login 200 locally and over the LAN; the font woff2 is served 200 from staging; owners on other PCs may need Ctrl+F5 once); NEXT: Phase 45 (client staff, with the client-ending rule), then Phase 46; record (ao).** Before it: (**PHASE 44 (THE CRIS LOGIN PAGE: the owner approved mockup v6 on 2026-10-19 and said to proceed until development; behind the sign-in card Cris works through a day in one illustrated back room; shipped: the room scene (Cris's day in one illustrated back room, six scenes, a camera and a day log) behind a stepped Log in / Sign up card that carries the "Cris" wordmark, a focus mode (the room blurs, the card centres and a forward Cris flies out and talks), the `signUp` `{ created }` contract, auth layout landmarks, the new `shy` mood, and an e2e sign-in block across 54 specs; battery green, every review clean: first pass 579 tests in 9 chunks with `--workers=1`, 569 passed, 9 failed, 1 skipped, and the two real issues (F1 tile sub-text contrast, F2 a domain check on Log in 1) were fixed and the flakes re-ran green) IS MERGED `--no-ff` as `89e3b5c` (merged tree = tested tip `39b2e48`) and PUSHED 2026-10-19 (`8c52d64..89e3b5c`, 19 commits; secret scan zero), and staging was REDEPLOYED at `89e3b5c` (CI image pulled; snapshot `staging-before-phase44.dump`, 2.4 MB, 43 tables, first; IP check .193 matched; NO migration, still 35; web healthy; /login, /login?step=login and /signup 200 locally, /login 200 over the LAN, the page shows "Welcome to Cris"; NOT exercised on staging: a real sign-in with a staging account, which needs the owner's passwords); NUMBERING: Phase 44 is the login page, so client staff (with the client-ending rule) is Phase 45 and deeper asset management is Phase 46; record (an).** Before it: (**STUCK SAME-PAGE FILTER LINKS FIXED (the owner reported (2026-10-19) "when clicking on the sidebar, sometimes it doesn't work … inventory, spare, setup, and there's a delay or sometimes no feedback"; root cause, found by systematic debugging on staging: in Next.js 15.5.23 (app router) a soft navigation that changes ONLY the query string of the current list page (sidebar views such as Inventory to Spare and Employees to Client staff, tabs, page 2, sort headers, filter chips) silently never committed about half the time on Inventory, Employees, Purchases and Reservations: the router fetched the page data (200, complete) and its reducer finished, but React's transition render suspended forever on a page-content Flight chunk (status resolved_model) with no error, so the URL and screen never changed; navigations to a different page always worked; it shows in the production build only; it is not a Phase 42 regression (the Phase 41 image failed at a similar rate); the dev server never shows it; Approvals and Equipment by client were unaffected in trials; Next.js 15.5.28 was tested through a CI image on a side container and does NOT fix it (8-click trials unchanged), so that upgrade was reverted; the fix is a production-only stuck-navigation guard, `src/lib/stuck-nav.ts` and `src/components/shell/stuck-nav-guard.tsx` mounted in the (app) layout, which falls back to a normal page load to the target after 1.2 s; verified 32/32 clicks on a side container of the CI image and 8/8 on staging after deploy; 33 new unit tests, vitest 3,141, the list-page browser tests pass) IS MERGED `--no-ff` as `b97cf62` (merged tree = tested tip `ee19267`) and PUSHED 2026-10-19 (`c7180b2..b97cf62`; secret scan zero), and staging REDEPLOYED 2026-10-19 at `b97cf62` (CI image pulled; snapshot `staging-before-stucknav.dump` first; IP check .193; NO migration, still 35; web healthy; /login 200 locally and over the LAN); STILL OPEN (owner's call): the DB connection pool size (Prisma's default pool of 57 per process against Postgres max_connections 100), prefetching of about 25 row record pages per list view, an occasional axe colour-contrast flake, and from before the "My drafts" wording, the Phase 44 client-ending rule, "Value at cost", the live Cris check and recreating neil.lucero@thebackroomop.com if needed; NEXT: Phase 44 (client staff), then Phase 45; record (am).** Before it: (**PHASE 43 (PERFORMANCE AT REAL SIZE: 1,000 ASSETS, 600 EMPLOYEES, 15 PEOPLE AT ONCE: the owner asked to "improve the performance of the webapp, e.g. 15 persons using it doing tasks and changes, 1000 assets and 600 employees; remove all seeded data and replace them with my requirement so we can test it". The owner chose "Replace staging data" and put this before client staff; then: "test it then fix the problems and gaps... no need for approval". Staging's data was REPLACED on 2026-10-19 (a `pg_dump -Fc` snapshot, `staging-before-scale.dump`, about 156 KB, 43 tables, was taken first): the normal seed, then the new `npm run db:seed:scale` - 1,000 assets (900 IT), 600 employees across 8 internal teams and 40 fictional clients, 150 purchase requests, about 3,000 executed approvals plus 40 open, 200 reservations, 1,500 notes, 43 policies and 40,000 audit rows over 6 months, with 20 accounts (the 5 role accounts plus perf01 to perf15@thebackroomop.com). A repeatable load harness (`scripts/loadtest`: 15 HTTP readers by role plus one headless browser with 3 writer contexts) measured the BASELINE on staging: every target was already met (1,301 page requests, 0 errors, worst page p95 395 ms, slowest request 519 ms, Home p95 270 ms; 239 writer steps, 0 failed, 34 assign/return/triage cycles; no P2024 connection timeouts). The fixes are results-identical and pinned by tests: ONE index migration (35, `20261019090000_perf_indexes`, 12 indexes), `requireUser` and the Cris flag read once per request, the IT nav Spare/Repairs/Missing counts in one query, the offboarding leavers read narrowed, the depreciation drill-down computed once, the Home age chart counted in SQL, and deterministic id tiebreaks on Home lists; a switchable slow-query log (`SLOW_QUERY_MS`) is new; vitest 3,108 tests, the full browser battery 55 files all passing on re-run, axe sweep with no moderate findings; the final opus review said "with fixes" (the docs plus the tiebreaks, both done)) IS CODE-COMPLETE on branch `phase-43-performance`, MERGED `--no-ff` as `27bc496` (merged tree = tested tip `3e62190`) and PUSHED 2026-10-19 (`29b015b..27bc496`; secret scan zero real secrets), and staging REDEPLOYED 2026-10-19 at `27bc496` (CI image pulled; snapshot `staging-before-phase43.dump` first; migration 35 applied, now 35 migrations; web healthy; slow-query log on at `SLOW_QUERY_MS=200`); AFTER-RUN on staging: all targets met, 1,331 page requests with 0 errors, writers 234 steps with 0 failed, slowest request 426 ms (519 before), overall p50 94 / p95 200 / p99 283 ms (before 96 / 219 / 366), 0 P2024 timeouts, 0 queries over 200 ms; the app already met the targets at this size, and the fixes trimmed the slow tail (p99 -22 %, slowest -18 %) and cut about 5 queries per IT page. STILL OPEN: the "My drafts" wording question, the client-staff question (may a client be ended while people still work for it), "Value at cost", the live Cris check once a key is added, and recreating neil.lucero@thebackroomop.com if it is still needed; STILL OWED: the owner's spot-check of the Home age chart (the automated equivalence tests cover it, but there is no manual check on staging yet); NUMBERING: Phase 43 is performance, so client staff is now Phase 44 and deeper asset management Phase 45; NEXT: Phase 44 (client staff and people flows), then Phase 45 (deeper asset management); record (al).** Before it: (**PHASE 42 (A SIDEBAR THAT STAYS PUT, WITH FEWER LINKS AND THE VIEWS UNDER THE PAGE YOU'RE ON: the owner's screenshot of /inventory scrolled down said "when scrolling down I still need to scroll up to see the other buttons or functions" and "too cluttered"; from 13 mockup boards on the canvas the owner chose board 12 (views under the page you're on, without the Today card) in the modern sleek look of board 9, with a fixed set of views, and rejected the Setup/Activity hub pages and the progress ring; the desktop sidebar is now sticky, a full-height inset panel whose nav scrolls inside it only when it does not fit (soft edge shadows; the account row always visible; the current link scrolled into view) while the window still scrolls the page; about 10 icon links per workspace with no headings (IT 17 to 10, Purchasing 25 to 9, Finance 12 to 8, Admin 4); the current link opens a fixed set of views with live counts (Inventory gets All, Spare, Repairs, Missing and Register assets; Employees gets Everyone, Client staff, Leaving and Policy gaps; Approvals gets Open, Mine, Purchase reviews and Closed; Setup gets Asset categories, Asset types, Departments & clients and Equipment policies; Activity gets Inventory activity, Employee activity and Audit log; Reports gets By client and Internal teams; Purchasing's Requests, Suppliers, Stock and Assets carry their sub-pages); IT's Approvals badge now counts open approvals plus purchase reviews; the "IT · 1 workspace" box became a small tag in the brand row (people with 4 workspaces get a menu button); Ctrl K still finds every page by name, including "Equipment by client", and repeated names read "Approvals › Closed"; the phone drawer shows the same nav; old URLs and bookmarks are unchanged) IS MERGED `--no-ff` as `4c2dd00` (merged tree = tested tip `821ddf0`) and PUSHED 2026-10-18 (`a20af50..4c2dd00`; secret scan zero) (code-complete 2026-10-18 on branch `phase-42-sidebar`, final code tree `a21e289`, 10 commits above plan commit `16e6627`); staging REDEPLOYED 2026-10-18 at `4c2dd00` (the CI image was pulled; the `pg_dump -Fc` snapshot `staging-before-phase42.dump`, about 156 KB, 43 tables, was taken first; IP check passed (.193); NO migration, so still 34 migrations; web healthy; /login answers 200 locally and over the LAN); the worktree and branch `phase-42-sidebar` are removed; `origin/main` = `4c2dd00` before this docs fix; spec `0018702` (approved) and plan `16e6627` sit on `main`, pushed with the merge; it added NO MIGRATION, so the redeploy was code-only; NUMBERING: Phase 42 is the sidebar, so the audit's client-staff phase is now Phase 43 and the deeper asset management phase is now Phase 44; vitest 160 files / 2960 tests, tsc and lint clean, the full Playwright battery 55 files, 575 passed with 2 expected quick-login skips (the new `e2e/phase-42-sidebar.spec.ts` has 9 cases), axe sweep with no moderate findings, the sidebar-related files re-run 64/64 after the final fix wave, the final opus whole-branch review's two Important findings fixed (one failing approvals read no longer breaks every page; Repairs stays highlighted on its stage chips) plus five minor polish items; STILL OPEN, the owner's call: "My drafts" counts every draft in the organisation, not just the user's own (rename it "Drafts", or count only the user's own?), the "Value at cost" question, and the Phase 43 question: may a client be ended while people still work for it - allowed, with Worklist chasing, or blocked until they are moved or offboarded? STILL OWED: the live Cris check once the owner adds the key; NEXT: Phase 43 (client staff and people flows), then Phase 44 (deeper asset management); record (ak).** Before it: (**COMPACT CRIS (a second follow-up to Phase 41, branch `cris-compact`: the owner's screenshot showed the 116 px Cris covering the "Register asset" button in the Register form's sticky action bar, and the owner asked "make Cris smaller, he sometimes blocks other inputs, forms or buttons"; Cris is now 64 px (56 px on phones), about 20 px from the corner, with the chat box still opening above and its pointer centred; only the glass body (about 44 px) catches clicks, and the rings and glow pass clicks through; while Cris is shown the corner is kept clear (`#main` gets extra bottom padding, there is a focus scroll padding, and the four sticky bottom action bars - Register, Edit asset, Edit employee and the Add employee wizard, marked `data-cris-avoid` - leave about 84 px on Cris's side); the hint hides after 8 s and never shows on a page with a sticky bar; a "–" Tuck away button (on hover or keyboard focus) turns Cris into a slim edge tab, "Bring Cris back", persisted per person as `CrisPrefs.tucked`, and Settings' "Put Cris back in the corner" also untucks; a saved old default position (72 px up) reads as the new default) IS MERGED `--no-ff` as `afcfeea` (merged tree = tested tip) and PUSHED 2026-10-18 (secret scan zero); staging REDEPLOYED 2026-10-18 at `afcfeea` (the CI image was pulled; the `pg_dump -Fc` snapshot `staging-before-compact.dump`, about 155 KB, 43 tables, was taken first; IP check passed (.193); NO migration, so still 34 migrations; web healthy; /login answers 200 locally and over the LAN); the worktree and branch `cris-compact` are removed; `origin/main` = `afcfeea` before this docs fix; vitest 156 files / 2865 tests, tsc and lint clean, the full Playwright battery passes (all 54 files, including 20 Cris cases; the new ones are 18 Register button clickable with Cris on screen, 19 tuck away persists, 20 clicks on the rings pass through; 2 expected quick-login skips), axe sweep clean (no moderate findings), reviewer findings fixed in one round; Cris is STILL IN PREVIEW (no key); STILL OWED: the live check once the owner adds the key (restart, one short lookup, then a second message after a page change, to confirm there is no 400; the owner should press New chat after adding the key); NEXT: Phase 42 (client staff and people flows), then Phase 43, with the "Value at cost" question still open; record (aj).** Before it: (**CRIS PREVIEW MODE (a follow-up to Phase 41, branch `cris-preview`: at the owner's request ("just make a mockup Cris, no API") branch `cris-preview` added preview mode: without `ANTHROPIC_API_KEY`, Cris is ON in preview - a "Preview" pill, the greeting "I'm still in development — for now I can only chat…", the starters "Say hello" and "What will you do?", and placeholder replies only; there are no AI calls, no cost, no lookups and no changes; Confirm and picks are refused, and Undo still works; preview turns are never replayed to the real model; Settings › Cris shows "No AI key on the server — Cris is in preview: placeholder replies only."; adding a key and restarting switches Cris to the real model) IS MERGED `--no-ff` as `a155f7b` (merged tree = tested tip `76a5bad`) and PUSHED 2026-10-18 (secret scan zero); staging REDEPLOYED 2026-10-18 at `a155f7b` (the CI image was pulled; the `pg_dump -Fc` snapshot `staging-before-preview.dump`, about 155 KB, 43 tables, was taken first; IP check passed (.193); NO migration, so still 34 migrations; web healthy; /login answers 200 locally and over the LAN); the worktree and branch `cris-preview` are removed; `origin/main` = `a155f7b` before this docs fix; vitest 156 files / 2852 tests, the Cris e2e passes 17 of 17, a reviewer approved it; STILL OWED: the live check once the owner adds the key (restart, one lookup, then a second message after a page change); the owner should press New chat after adding the key; NEXT: Phase 42 (client staff and people flows), then Phase 43, with the "Value at cost" question still open; record (ai).** Before it: (**PHASE 41 (CRIS, THE IN-APP IT ASSISTANT: a mascot bottom-right on every IT page that opens a chat box; Cris checks someone's items, assigns a spare by pick, scan or typed tag, replaces a laptop with outcome Defective, Triage or Missing, says who has a tag and lists the spares in stock; the AI never writes, it only proposes, and every change waits for the person's Confirm, with Undo for 60 s; plus Settings › Cris) IS CODE-COMPLETE 2026-10-17 on branch `phase-41-cris` (final code tree `ed6ce10`, 26 commits above plan commit `08d4f03`), MERGED to `main` via `37f1b00` (`--no-ff`, merged tree = tested tip; code tree `ed6ce10`, docs commit `e91d43d`) and PUSHED 2026-10-17 (33 commits; secret scan zero), with staging REDEPLOYED 2026-10-17 at `37f1b00` (CI image pulled, `pg_dump -Fc` snapshot taken first (`staging-before-mig34.dump`, about 149 KB, 40 tables), IP check passed (.193), migration 34 `20261018090000_cris` applied, now 34 migrations (tables `CrisConversation`, `CrisMessage`, `CrisPendingAction`); web healthy; /login answers 200 locally and over the LAN); spec commits `22a5115`, `6f7b289`, `99872f9` and `08d4f03` (approved) and plan commits `3ebc748` and `08d4f03` sit on `main`, pushed with the merge (`origin/main` = `37f1b00` before this docs fix); the worktree and branch `phase-41-cris` are removed; it adds MIGRATION 34 `20261018090000_cris` (additive: the `CrisConversation`, `CrisMessage` and `CrisPendingAction` tables), applied to staging by that redeploy, which took staging from 33 to 34 migrations; DEPLOY NOTES (as of that redeploy; since 2026-10-18 Cris runs in preview when there is no key, see above): staging's `.env` had no `ANTHROPIC_API_KEY` at that redeploy, and the owner adds it themselves (Settings › Cris then shows "Key: set on the server ✓"), after the key is added, restart the app (`deploy-staging.ps1 -Force`, or a compose restart of web and worker), then run one short live lookup and a second message after changing page, to confirm there is no 400; the default model is Claude Haiku 5.5 (admins can switch it to Sonnet 5.5 or Opus 5.5 in Settings › Cris), set a monthly spend cap in the Anthropic console; LOCAL NOTE: the owner's untracked folder "Claude outputs/" (Cris images and the voiceover script) is listed in the main checkout's `.git/info/exclude`, which keeps the deploy script's clean-tree check passing; never commit or delete it; `CRIS_MODEL=fake` is for dev and e2e only and is refused in production; NUMBERING: Cris took Phase 41, so the audit's client-staff phase is now Phase 42 and the deeper asset management phase is now Phase 43; tsc and lint clean, vitest 2831 / 155 files, the full Playwright battery green in chunks on `inventory_dev:3100` (all 54 files pass, plus 17 Cris cases on the fake model, 2 expected quick-login skips) with the affected specs re-run green after the final fix wave, axe sweep clean (no moderate findings), 34 migrations; NEXT: Phase 42 (client staff and people flows; the six mockups are already on the canvas), then Phase 43; record (ah).** Before it: (**PHASE 40 (FIX WHAT'S BROKEN, AND THE IT BASICS: a Keyboard shortcuts dialog and a phone top bar and drawer, search by serial and holder, readable asset History and Timeline, offboarding that removes IT access, a Purchase reviews worklist group, triage with a reason, page titles and dismissable toasts) IS CODE-COMPLETE 2026-10-17 on branch `phase-40-it-fixes` (final code tree `808e23a`, 27 commits above plan commit `fc16778`), MERGED to `main` via `2469068` (`--no-ff`, merged tree = tested tip; docs commit `110a4a3`) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `2469068` (CI image pulled, `pg_dump -Fc` snapshot taken first (`staging-before-mig33.dump`, 149 KB, 40 tables), IP check passed (.193), migration 33 `20261017120000_setup_removed` applied, now 33 migrations; web healthy; /login answers 200 locally and over the LAN, title "Sign in · Backroom IT"); spec `e3c9890` and plan `fc16778` sit on `main`, pushed with the merge; it adds MIGRATION 33 `20261017120000_setup_removed` (adds `REMOVED` to the `SetupState` enum; `SetupState` is now DONE, NOT_YET, NOT_NEEDED, REMOVED), applied to staging by that redeploy, which took staging from 32 to 33 migrations; DEPLOY NOTE: the migration is forward-only once anyone marks access "Removed", so do not roll staging back past `2469068` (an older image would break the employee pages that read the enum); restore the snapshot instead; WHAT IT FIXES: the accountability form's Issued date is the assignment date, employment changes only through offboarding (Edit is read-only plus "Start offboarding…", the server refuses any other move, new employees are always ACTIVE), the Help 404 is replaced by a Keyboard shortcuts dialog and the "/" shortcut, asset History and Timeline read in words, the Columns "Registration" label, and the label print confirm "Did the labels print correctly?"; WHAT IT ADDS: a phone shell (menu, Search, Scan a tag, a drawer with the workspace switch and Sign out), palette matching on serial and holder with hints and exact tag first, page titles "{Page} · Backroom IT", toasts with Dismiss (errors persist), a "Purchase reviews" worklist group with an IT nav badge, the A key running a row's main action, `STATUS_LABEL` for asset statuses everywhere, action words on /audit, offboarding that removes IT access (REMOVED, "Mark removed", "Remove their IT access first"), Overview showing OR no. / Covered by / Who to call for repairs, triage with no default and a reason for Dispose and Donate, and skeletons and a shared FilteredEmpty; tsc and lint clean, vitest 2459 / 132 files, the full Playwright battery green in chunks on `inventory_dev:3100` with every file rerun after the final fixes (2 expected quick-login skips) and the axe sweep clean, 33 migrations; NEXT: Phase 41 (client staff and people flows), then Phase 42 (deeper asset management); record (ag).** Before it: (**PHASE 39 (NO LONG SCROLLS: a tabbed profile side card, notes and purchase-conversation side panels, paged stocktake / On hand / Expiry tables, bounded lists, spare assets loaded on demand) IS CODE-COMPLETE 2026-10-17 on branch `phase-39-no-long-scrolls` (final code tree `4e79632`, 19 commits above plan commit `ee5a662`), MERGED to `main` via `8faf91b` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `1b502a1` (CI image pulled, `pg_dump -Fc` snapshot taken first, no migration, still 32 migrations); it adds NO MIGRATION; spec `3d033f4` and plan `ee5a662` sit on `main`, pushed with the merge; THE STANDING DESIGN RULE: a page never grows with the data (logs show the newest few with "View all" opening a side panel with search and paging; big tables page 50 at a time with search and filters; lists inside forms open one at a time or show "+N more"; no scroll box inside the page); the profile's right column is one card with tabs Notes, IT setup, Form and Transfers (remembered per browser), the purchase request conversation shows its newest 5 with "Earlier messages ({n}) →" in a side panel, the stocktake, On hand and Expiry tables page 50 with search and filters, title rules are an accordion, import failures show the first 20 with a CSV download, and the profile no longer ships every spare asset (pickers load on open); WHAT THE NEXT STAGING REDEPLOY DOES: no migration and nothing stored changes, the screens just stop growing with the data; merge, push and redeploy are the user's decisions; tsc and lint clean, vitest 2112 / 122 files, Playwright 525 / 50 files green on `989ef26` with the affected specs re-run green after the final-review wave, 32 migrations; record (af).** Before it: (**PHASE 38 (the Equipment by client report and export, and depreciation from the purchase month) IS CODE-COMPLETE 2026-10-17 on branch `phase-38-equipment-by-client` (final code tree `649767f`, 9 commits above plan commit `a7f80d8`), MERGED to `main` via `1b16921` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17, with staging REDEPLOYED 2026-10-17 at `a3cb693` (CI image pulled, `pg_dump -Fc` snapshot taken first, no migration, still 32 migrations; staging had 1 of 33 assets Finance-approved, so only its book value moved); it adds NO MIGRATION; spec `8391e22` and plan `a7f80d8` sit on `main`, pushed with the merge; it adds the page `/equipment-by-client` (IT People lifecycle and Finance nav: Clients and Internal departments tabs, stats, search, All / With gaps / No policy, a sortable table with Equipped bars, a detail panel, and "Export all (.xlsx)" with a per-group export; peso columns only for admin and finance_staff, never sent to other roles) and moves depreciation, everywhere (Finance register, asset page, year schedule, override dialog, Home Finance card, the new report and export), to start in the Manila month of purchase (counted in full as month 1) and to take the current month ("as of today"); WHAT THE NEXT STAGING REDEPLOY DOES: there is no migration and nothing stored changes, but every approved asset's book value DROPS, because depreciation now starts at the purchase month and takes the current month; the profile stat, held-item panel and offboarding now read "Value at cost" / "Value out at cost" (they always showed cost); merge, push and redeploy are the user's decisions, and the open question for the user is whether IT and viewers should see peso amounts on profiles and offboarding at all; tsc and lint clean, vitest 1998 / 118 files, Playwright 513 / 49 files green, 32 migrations; record (ae).** Before it: (**PHASE 37 (client staff, equipment policies per client or department, the profile redesign and a three-step Add employee) IS CODE-COMPLETE 2026-10-17 on branch `phase-37-clients-profile` (final code tree `b1f3c66`, 20 commits above plan commit `f5dec5d`), MERGED to `main` via `6050649` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; staging REDEPLOYED 2026-10-17 at `c8eca0e` (CI image pulled, `pg_dump -Fc` snapshot taken first, MIGRATION 32 applied, 32 migrations; all 5 departments read INTERNAL, the Finance standard kit's slots now read Laptop / Monitor / Docking Station / Headset / Phone / Monitor (shown "Monitor 2"), IT setup reads "Not recorded" for everyone, and no clients exist until added on Departments & clients); `main` = `origin/main` = `c8eca0e` (spec `0cafcf1`, plan `f5dec5d`, merge `6050649` and merge-docs `c8eca0e` all pushed); it adds MIGRATION 32 `20261016180000_clients_profile`, which also rewrites typed policy-slot and slot-exception names to category labels; the next staging redeploy leaves every department INTERNAL, renames the slots, shows IT setup as "Not recorded" for everyone and has no clients until they are added on Departments & clients; merge, push and redeploy are the user's decisions; tsc and lint clean, vitest 1936 / 117 files, Playwright 508 / 48 files green, 32 migrations; record (ad)).** Before it: (**WINDOWS LICENSE + DOCKS AND HUBS INTO OTHER + MODEL EXAMPLE PER CARD (branch `license-other-models`, merged to `main` via `36d4c06` and pushed 2026-10-16; staging REDEPLOYED 2026-10-16 at `36d4c06`, migration 31 applied, `pg_dump -Fc` snapshot taken first; staging now has 31 migrations; BR-DK-0033/0071 are Other / Docking Station and the Finance standard kit's dock slot follows): Register's "What" now shows eleven cards (Laptop, Workstation (PC), Monitor, Headset, Mouse, Keyboard, Webcam, UPS, Windows License, Laptop Bag, Other); Windows License has types OEM / Retail / Volume, its serial box reads "Licence / COA no." and points at the record's Secrets for the product key (the Secrets label hint now mentions "product key"); the Model box's example follows the chosen card on Register and Edit (Laptop ThinkPad T14 Gen 4, Monitor Dell P2422H, Webcam Logitech C920, UPS APC Back-UPS 650, Windows License Windows 11 Pro, … unknown categories "Model name"); MIGRATION 31 `20261016150000_license_and_other` (data only, guarded, re-runnable) adds Windows License and MOVES the Docking Station and Type C Hub type rows into Other renamed "Docking Station" / "Type C Hub" (same ids, so BR-DK-0033/0071 and the Finance standard kit's dock slot follow), then deletes the two emptied categories; seed and the assets-mixed import fixture match; vitest 1849, related e2e 167 passed (own-tags-types incl. new case 13, register-labels eleven cards, import-export, asset-classes, admin, employee-ux, it-gaps, custody, home-finance, finance-registration-depreciation, axe-sweep, it-core).** Before it: (**KEYBOARD, WEBCAM AND UPS are IT categories of their own (branch `it-categories-kb-cam-ups`, merged to `main` via `63ba685` and pushed 2026-10-16; staging REDEPLOYED 2026-10-16 at `63ba685`, migration 30 applied, `pg_dump -Fc` snapshot taken first; staging now has 30 migrations): Register's "What" shows twelve cards (Laptop, Workstation (PC), Monitor, Headset, Mouse, Keyboard, Webcam, Type C Hub, Docking Station, UPS, Laptop Bag, Other) with new icons; MIGRATION 30 `20261016120000_keyboard_webcam_ups` (data only, guarded, re-runnable) creates them with types Keyboard: Wired/Wireless, Webcam: USB webcam/Conference camera, UPS: Desktop UPS/Rack UPS, moves Other/Keyboard and Other/Webcam assets, policy slots and slot exceptions into them (BR-KB-0402 Logitech MX Keys → Keyboard/Wireless) and deletes the emptied Other types (Other keeps Phone, Printer, Speaker); seed matches; vitest 1847, related e2e 176 passed (own-tags-types incl. new case 12, register-labels case 1 now pins twelve cards, finance-registration-depreciation, admin, import-export, it-core, asset-classes, department-owned, axe-sweep, auth-shell, approvals-audit).** Before it: (**PHASE 36 (typed tags, Type always asked, Laptop types data fix, people search for the pickers and the Assigned filter, Schedule by category) IS CODE-COMPLETE 2026-10-16 on branch `phase-36-own-tags-real-types`, merged `033c061`, pushed and on staging 2026-10-16 (migration 29 applied) (not yet on `main` or staging); it adds MIGRATION 29 `20261016090000_laptop_types` (data only); staging deploys by pulling the CI image, and on that deploy staging's Laptop types are renamed and BR-LT-0201 moves to MacBook; 489 e2e / 46 files, 1842 unit; record (ac).** Before it: **PHASE 35 (registration review, Finance asset register, depreciation) IS CODE-COMPLETE on branch `phase-35-registration-depreciation`, MERGED to `main` via `2963bc7` (`--no-ff`, merged tree = tested tip `297dc26`) and PUSHED 2026-10-15; staging REDEPLOYED 2026-10-15 at `2963bc7` (CI-built image pulled; MIGRATION 28 applied, 28 migrations; a `pg_dump -Fc` snapshot was taken just before; 32 assets, 31 not yet Finance-confirmed now read With Finance / To review; no depreciation policy set yet, so book value = cost); 478 e2e / 45 files, 1844 unit; record (ab).** Before it: **STAGING REDEPLOYED 2026-10-15 at `07b1f32` (`http://192.168.1.193:3000`): Phase 34 is live and MIGRATION 27 applied cleanly (27 migrations; BR-PH-0287/0301/0312 in Other / Phone, BR-KB-0402 in Other / Keyboard, Dock renamed Docking Station, the Finance standard policy's slots on Docking Station / USB-C Dock and Other / Phone, 0 of 32 assets waiting to print; `/login` 200 locally and on the LAN; quick sign-in still on). A `pg_dump -Fc` snapshot was taken just before. THE STAGING LAPTOP NO LONGER BUILDS THE IMAGE: two local builds blue-screened it (bugchecks 0x12B, 0x3B, 0x0A on 2026-10-15 — every crash stack is core Microsoft code in unrelated processes, the first a memory-compression decompress failure, i.e. a hardware memory fault on the i7-14700HX / mixed Kingston + Samsung RAM; persists after BIOS QNCN38WW / microcode 0x136). Fixes on `main`: `4d2d102` (compose builds the image once, not three times in parallel; `next.config` caps `experimental.cpus` at 4) and `07b1f32` (`.github/workflows/image.yml` builds on every push to `main` and pushes `ghcr.io/neilluceromc/christianauditing:sha-<commit>` + `:main`, public; `scripts/deploy-staging.ps1` waits for that tag, pulls it, tags it `inventory-app:latest`, `up -d --no-build`; `-LocalBuild` only as a last resort). Never accept Docker Desktop's "Reset to factory defaults" (it deletes the staging database volume). Owed: a physical print-and-scan of the new label; RAM/CPU testing (MemTest86, one stick at a time) or a warranty claim.** Before it: **PHASE 34 (Register and Labels redesign — Register and Labels as two tabs of "New equipment", category cards, a model box that sets the type, the required IT serial, purchase and warranty with documents and a live total, a "Waiting to print" queue with a sheet preview, a redesigned label) IS CODE-COMPLETE 2026-10-15 on branch `phase-34-register-labels` (final code tree `f7c4f70` + docs), MERGED to `main` via `ffbc0e8` (`--no-ff`, merged tree = tested tip `cf39923`) and PUSHED 2026-10-15; staging NOT yet redeployed; it adds MIGRATION 27 `20261014090000_register_labels`, so the staging redeploy APPLIES a migration (the deploy script runs `prisma migrate deploy`); merge, push and redeploy are the user's decisions. Battery A 58 · B 87 (+2 skipped) · C 64 · D 70 · E1 61 · E2 56 · F 66 = 462 passed / 464 listed (the 2 are quick-login's on-only cases); 1786 unit / 106 files; 27 migrations. Owed: the physical print-and-scan check of the new label on a real A4 sheet. The record is (aa).** Before it: **2026-10-14: the laptop moved to a new network — staging's address is now `http://192.168.1.193:3000` (`.env` `APP_BASE_URL` switched by key at the user's choice; labels printed for `.79` no longer resolve). Staging was redeployed with Phase 33 (`5b16f8a`), then with the staging-only QUICK SIGN-IN merged via `ac82b5f` (`QUICK_LOGIN_EMAILS` in staging's `.env` lists the admin, IT, Finance and Purchasing accounts: one-click "Continue as {role}" buttons on `/login`, no password — anyone who can reach the LAN address can sign in as those accounts while it is set; remove the line and redeploy to turn it off; never set it in production). The same merge hardened the shared post-login redirect check (`safeNextPath`). Proof: unit 1742 / 101 files; e2e 445 tests / 43 files (new `e2e/quick-login.spec.ts`, in chunk B; its two on-only cases run with the variable set). No migration (26).** Before it: **PHASE 33 (Laws of UX on the IT queues and records — approvals with one-step Approve and Next in queue, labels from pasted or scanned tags with Start at label N, the rest of reservations, /audit and the four feeds searchable by tag, person and ref no, the older list toolbars) IS MERGED TO `main` via `9bc7785` (`--no-ff`, merged tree = tested tree + docs) and PUSHED 2026-10-01 (branch `phase-33-queues-records-uiux`, final tree `fd2ee57`); staging NOT yet redeployed (still `4a39db8`) — the code-only redeploy is the user's decision; NO new migration (26 stays); the record is (z).** Before it: **Staging REDEPLOYED 2026-09-25** at the laptop's NEW DHCP address `http://192.168.203.79:3000` (`.56` 2026-09-23 → 2026-09-25; the user chose to switch, `.env` `APP_BASE_URL` follows; every label printed for `.56` needs reprinting) — code-only `-Force`, runs `4a39db8` = Phases 19–32 plus the Phase 33 spec commit, 26 migrations, none pending; web healthy; `/login` 200 locally and on the LAN. At the user's request the staging passwords of admin@, it@, finance@ and purchasing@ were set directly on the staging database (no seed; the value is not recorded in these docs; viewer@ unchanged). **PHASE 33** (queues and records) spec written (`4a39db8`), awaiting review. Before it: **PHASE 32 (Laws of UX on the IT screens where the work gets done — offboarding end to end, the worklist and Home, the scan card, the reservations hand-over) IS MERGED TO `main` via `--no-ff` `853d13d` AND PUSHED (2026-09-24); the merged tree is byte-identical to the tested branch tip `c5afaf0` (final tree `e29e879` plus its docs commit; tree hashes matched); branch and worktree removed; NO new migration (26 stays), and **staging was REDEPLOYED 2026-09-24** (code-only `-Force`, runs `2e333ef` = Phases 19–32, 26 migrations, no pending migration; web healthy; `/login` 200 locally and at `http://192.168.203.56:3000`); the record is (y). Before it: PHASE 31 (the leftovers sweep — a derived sort orders only as the primary key, both exports follow the derived sorts, typed `revalidatePath` patterns on real file paths, disabled pager arrows that are not links) IS MERGED TO `main` via `--no-ff` `bcc7b16` AND PUSHED (2026-09-24); the merged tree is byte-identical to the tested branch tip `3d477c0` (final tree `7599d9e` plus its docs commit; tree hashes matched); branch and worktree removed; NO new migration (26 stays), and **staging was REDEPLOYED 2026-09-24** (code-only `-Force`, runs `7a479e1` = Phases 19–31, 26 migrations, no pending migration; web healthy; `/login` 200 locally and at `http://192.168.203.56:3000`); the record is (x). Before it: PHASE 30 (Laws of UX applied to the inventory area — the record's state-chosen primary with Return on held devices and Edit kept, one Register flow, a row menu and attention markers on the list, the role's own class by default) IS MERGED TO `main` via `--no-ff` `69f8545` AND PUSHED (2026-09-24); the merged tree is byte-identical to the tested branch tip `bba0f6c` (final tree `4e6fc7f` plus its docs commit; tree hashes matched); branch and worktree removed; NO new migration (26 stays), and **staging was REDEPLOYED 2026-09-24** (code-only `-Force`, runs `e07bef7` = Phases 19–30, 26 migrations, no pending migration; web healthy; `/login` 200 locally and at `http://192.168.203.56:3000`). Before it: PHASE 29 (Laws of UX applied to the employee area — the profile's state-chosen primary with Edit kept and a More menu, slot tiles that open an action menu with the ⋯ always visible, the New form's live checks with every error in one pass, the list as a worklist with a sortable Loadout column) IS MERGED TO `main` via `--no-ff` `d76903b` AND PUSHED (2026-09-23); the merged tree is byte-identical to the tested branch tip `e01923a` (final tree `9660e6e` plus its docs commit; tree hashes matched); branch and worktree removed; NO new migration (26 stays), and **staging was REDEPLOYED 2026-09-23** (`-Force`, runs `ccb0432` = Phases 19–29, **26 migrations** — Phase 27's migration 26 applied after the seven-statement duplicate check returned no rows) at the laptop's NEW DHCP address `http://192.168.203.56:3000` (`.183` before; the user changed location on 2026-09-23 and the laptop is on DHCP again, so every label printed before 2026-09-23 encodes the old URL and the address can move again without a reservation). Before it: PHASE 28 (a Back control on every page that has a parent — where the operator came from, else the breadcrumb's parent) IS MERGED TO `main` via `--no-ff` `7214066` AND PUSHED (2026-09-22); the merged tree is byte-identical to the tested branch tip `e8b48a4` (final tree `5a8bbcf` plus its docs commit; tree hashes matched); branch and worktree removed; NO new migration (26 stays), so it rode the 2026-09-23 `-Force` redeploy code-only** — a bounded change: no spec and no plan document, the design and the two rulings are in (u) below — battery, last run 2026-09-22 on the final tree `5a8bbcf`: `tsc` clean · `lint` clean · **26 migrations**, schema up to date (this phase adds none) · **1532 unit / 88 files** · **380 e2e / 37 files** by `--list`, across the same seven foreground chunks with explicit file paths (Phase 23's seven, composition unchanged apart from the new `e2e/back.spec.ts` joining **E2**), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (4.0m) · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 37 passed (5.9m) · E2 42 passed (4.1m) · F 66 passed (6.7m) = 380**, zero failed, zero flaky, zero skipped, zero did-not-run, every chunk green on its first pass, no re-run and no fix commit anywhere in the battery. `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. See §0 item 9 for the chunk commands and (u) below for what shipped.**) (**PHASE 27 (IT and quality leftovers sweep: `/audit` hides the approvals, categories and types of a class the role cannot see; reference names are unique whatever the case, with the existing row named before the write; the four activity feeds gain an Action facet, a sentence for every action that can reach them and human field names; the parked Minors of Phases 17–26) IS MERGED TO `main` via `--no-ff` `5dd3372` AND PUSHED (2026-09-22); the merged tree is byte-identical to the tested branch tip `0abf560` (final tree `66445ed` plus its docs commit; tree hashes matched); branch and worktree removed; the staging redeploy is the user's decision, not pre-authorised; it ADDS MIGRATION 26 `20260922010908_case_insensitive_names` (additive: one ordinary index on `AuditEntry (entityType, action)` plus seven `lower()` unique indexes; it FAILS LOUDLY on a database that already holds two names differing only by case — staging was checked clean on 2026-09-22 (11 categories, 19 types, 5 departments, 1 policy, 2 vendors, 0 stock categories); run the duplicate-check SQL in (t) before any redeploy), so the next staging redeploy after the merge is a `scripts/deploy-staging.ps1 -Force` that applies it** — spec `2026-09-22-leftovers-sweep-design.md`, plan `2026-09-22-phase-27-leftovers-sweep.md` (7 tasks, `D-1`…`D-10` — the pre-flight rulings R1–R4 are `D-1`, the final whole-branch review added `D-8`, the fix wave `D-9`, the final battery `D-10`) — battery, last run 2026-09-22 on the final tree `66445ed` (after the final-review fix wave): `tsc` clean · `lint` clean · **26 migrations**, schema up to date (migration 26 is this phase's; `main` and staging stay at **25** until the merge and the first `-Force` after it) · **1528 unit / 87 files** · **377 e2e / 36 files** by `--list`, across the same seven foreground chunks with explicit file paths (Phase 23's seven, composition unchanged apart from the new `e2e/activity.spec.ts` joining **E2** — the first phase to grow E2 rather than F), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.5m) · B 67 passed (3.9m) · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 37 passed (5.8m) · E2 39 passed (3.6m) · F 66 passed (6.6m) = 377**, zero failed, zero flaky, zero skipped, zero did-not-run, every chunk green on its first pass, no re-run and no fix commit anywhere in the battery. `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. The push also carried the two docs commits that had sat on local `main` — `385b484` (the spec) and `8c24c3b` (the plan). See §0 item 9 for the chunk commands and (t) below for what shipped.**) (**PHASE 26 (holds that work: reserve from the asset record or a profile slot, release, hourly expiry sweep, `/reservations` list parity; `Asset.repairEndedAt` stamped by the lifecycle preparer) IS MERGED TO `main` via `--no-ff` `a5883ad` AND PUSHED (2026-09-22); the merged tree is byte-identical to the tested branch tip `6175af3` (final tree `1442289` plus its docs commit; tree hashes matched); branch and worktree removed; ADDS MIGRATION 25 `repair_end_and_holds` (additive: one nullable column; its backfill fills `repairEndedAt` only where an audit row moved status off DEFECTIVE) — **staging redeployed 2026-09-22 with `scripts/deploy-staging.ps1 -Force`** — migration 25 applied (25 found, all applied; the backfill filled `repairEndedAt` on one of staging's two closed repairs, the other has no audit transition and keeps its dash), web healthy within 25 s, local and LAN `/login` answer 200 at `http://192.168.203.183:3000`, `/reservations` redirects to login when signed out; the worker's first hourly sweep expired staging's one long-dead seeded hold (`[worker] expired 1 hold`), as designed** — spec `2026-09-21-holds-and-repair-end-design.md`, plan `2026-09-21-phase-26-holds-and-repair-end.md` (6 tasks, `D-1`…`D-10` — the spec corrections before the plan are `D-2`, the final whole-branch review added `D-8`, the fix wave `D-9`, the final battery `D-10`) — battery, last run 2026-09-21 on the final tree `1442289` (after the final-review fix wave): `tsc` clean · `lint` clean · **25 migrations**, schema up to date (migration 25 is this phase's; `main` and staging both carry it since the 2026-09-22 redeploy) · **1511 unit / 85 files** · **364 e2e / 35 files** by `--list`, across the same seven foreground chunks with explicit file paths (Phase 23's seven, composition unchanged apart from the new `e2e/holds.spec.ts` joining F), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.5m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 66 passed (6.6m) = 364**, zero failed, zero flaky, zero skipped, zero did-not-run, every chunk green on its first pass, no re-run and no fix commit anywhere in the battery (only F's count moved, 55 → 66, for the eleven new holds cases). `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. The push also carried the two docs commits that had sat on local `main` — `2bed93b` (spec) and `611d91f` (plan and spec corrections). See §0 item 9 for the chunk commands and (s) below for what shipped.**) (**PHASE 25 (IT navigation sweep: start offboarding from the profile, every reference a link, new-hire finish line, employees list parity, safety nets) IS MERGED TO `main` via `--no-ff` `bb577f8` AND PUSHED (2026-09-21); the merged tree is byte-identical to the tested branch tip `641e96f` (final tree `fab0780` plus its docs commit; tree hashes matched); branch and worktree removed; NO new migration (24 stays), so the staging redeploy was a code-only `-Force` — **run 2026-09-21: staging serves `5727572`** (Phase 25 merge + merge-docs), 24 migrations found, none pending, web healthy, local and LAN `/login` answer 200 at `http://192.168.203.183:3000`** — spec `2026-09-21-it-navigation-sweep-design.md`, plan `2026-09-21-phase-25-it-navigation-sweep.md` (8 tasks, `D-1`…`D-12` — the final whole-branch review added `D-10`, the fix wave `D-11`, the final battery `D-12`) — battery, last run 2026-09-21 on the final tree `fab0780` (after the final-review fix wave): `tsc` clean · `lint` clean · **24 migrations**, schema up to date (this phase adds none) · **1493 unit / 84 files** · **353 e2e / 34 files** by `--list`, across the same seven foreground chunks with explicit file paths (Phase 23's seven, composition unchanged apart from the new `e2e/it-nav.spec.ts` joining F), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (4.0m) · C 63 passed (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 55 passed (5.6m) = 353**, zero failed, zero flaky, zero skipped, zero did-not-run, every chunk green on its first pass, no re-run and no fix commit anywhere in the battery (only F's count moved, 42 → 55, for the thirteen new it-nav cases). `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. `main` also carries three unpushed docs commits beyond `origin/main` `a9970ad` — `9dd7ba5` and `98a94a1` (spec) and `5acb5fd` (plan). See §0 item 9 for the chunk commands and (r) below for what shipped.**) (**PHASE 24 (IT gaps 2: Replace groups, repairs view paged in SQL, worker retention) IS MERGED TO `main` via `--no-ff` `48c37f7` AND PUSHED (2026-09-21); the merged tree equals the tested branch tip `40a11b6` (final tree `7601cab` plus its docs commit) except the three lines of the same-day IP renumbering commit `efd6d9e`; branch and worktree removed; NO new migration (24 stays); **staging redeployed 2026-09-21 with `scripts/deploy-staging.ps1 -Force`** — code-only (24 migrations found, none pending), web and worker recreated, web healthy, local and LAN `/login` answer 200 at the laptop's new address `http://192.168.203.183:3000` (renumbered from `.153` the same day, so every QR label now encodes `.183` and any label printed earlier is dead)** — spec `2026-09-17-it-gaps-2-design.md`, plan `2026-09-17-phase-24-it-gaps-2.md` (6 tasks, `D-1`…`D-10` — the final whole-branch review added `D-8`, the fix wave `D-9`, the final battery `D-10`) — battery, last run 2026-09-17 on the final tree `7601cab` (after the final-review fix wave): `tsc` clean · `lint` clean · **24 migrations**, schema up to date · **1485 unit / 84 files** · **340 e2e / 33 files** by `--list`, across the same seven foreground chunks with explicit file paths (Phase 23's seven, composition unchanged — it-gaps stays in F), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.5m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 42 passed (4.4m) = 340**, zero failed, zero flaky, zero skipped, zero did-not-run, every chunk green on its first pass, no re-run and no fix commit anywhere in the battery (only F's count moved, 39 → 42, for the three new it-gaps cases). `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. See §0 item 9 for the chunk commands and (q) below for what shipped.**) (**PHASE 23 (Parkinson sweep: quick forms and complete-by dates) IS MERGED TO `main` via `--no-ff` `18228b0` AND PUSHED (2026-09-17); the merged tree is byte-identical to the tested branch tip `6994752` (final tree `09bf0a5` plus its docs commit; tree hashes matched); branch and worktree removed; **staging redeployed 2026-09-17 with `scripts/deploy-staging.ps1 -Force`** — migration 24 `parkinson_deadlines` applied (24 found, all applied; the backfill gave staging's one OFFBOARDING employee a complete-by date of start + 7 d, already past, so that row reads overdue by design; no stocktakes existed), web healthy, the local and LAN URLs answer** — spec `2026-09-17-parkinson-sweep-design.md`, plan `2026-09-17-phase-23-parkinson-sweep.md` (10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`) — battery, last run 2026-09-17 on the final tree `09bf0a5` (after the final-review fix wave and one test-only battery fix): `tsc` clean · `lint` clean · **24 migrations**, schema up to date · **1476 unit / 82 files** · **337 e2e / 33 files** by `--list`, across seven foreground chunks with explicit file paths (Phase 22's seven, with `e2e/quick-forms.spec.ts` joining chunk D and `e2e/deadlines.spec.ts` joining chunk F), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (5.8m) · C 63 passed (5.9m) · D 47 passed (4.7m) · E1 36 passed (8.9m) · E2 31 passed (4.1m) · F 39 passed (4.8m) = 337**, zero failed, zero did-not-run, after one test-only fix (chunk B's `e2e/department-owned.spec.ts` case 9, which relied on the new-employee form's old auto-defaulted department — commit `09bf0a5`); that chunk's first two passes on `dbc93a0` were each **64 passed, 2 failed, 1 did not run**, the second failure a consequence of the first (a failing serial case retires the worker, so the file's `beforeAll` reseed re-runs and Purchasing Home's three stat links all read "1"). `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. See §0 item 9 for the chunk commands and (p) below for what shipped.**) (**PHASE 22 (Stock control D2: FIFO lots and costing, expiry, reports, receipt documents) IS MERGED TO `main` via `--no-ff` `26aaf82` AND PUSHED (2026-09-16); the merged tree is byte-identical to the tested branch tip `2a0f388` (product tree `2eeabf7`, final battery tree `a4b57b5`, plus its docs commits; tree hashes matched); branch and worktree removed; **staging redeployed 2026-09-17 with `scripts/deploy-staging.ps1 -Force`** — migration 23 (`stock_lots_and_allocations`, with its asserted plpgsql backfill of D1 history) applied (23 found, all applied; staging's stock tables were empty, so the backfill had nothing to convert), web healthy, the local and LAN URLs answer** — spec `2026-09-16-stock-control-d2-design.md`, plan `2026-09-16-phase-22-stock-control-d2.md` (10 tasks, `D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`) — battery, last run 2026-09-16 on the final tree `a4b57b5` (after the final-review fix wave): `tsc` clean · `lint` clean · **23 migrations**, schema up to date · **1404 unit / 79 files** · **319 e2e / 31 files** by `--list`, across seven foreground chunks with explicit file paths (chunk E split into E1/E2 per spec §9.3, since the combined chunk would have carried 67 tests), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.3m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 30 passed (3.3m) = 319**, zero failed, zero did-not-run, all first pass after one test-only fix (chunk A's `e2e/it-core.spec.ts` documents-upload case, a missing hydration guard, commit `a4b57b5`); Task 10's earlier close ran on the branch tip `dfb1a0f` (2026-09-16) as **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.7m) · E1 36 passed (5.6m) · E2 31 passed (3.0m) · F 30 passed (3.2m) = 319**, zero failed, zero did-not-run, no fix commits. `npm run db:seed` run last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or after the last. See §0 item 9 for the chunk commands and (o) below for what shipped.**) (**PHASE 21 (Approvals oversight: direct IT changes made visible, plus five correctness and quality items) IS MERGED TO `main` via `--no-ff` `b716767` AND PUSHED (2026-09-15); the merged tree is byte-identical to the tested branch tip (product tree `2ae8738` plus its docs commits; tree hashes matched); branch and worktree removed; **staging redeployed the same day with `scripts/deploy-staging.ps1 -Force`** — migration 22 applied, web healthy, the local and LAN URLs answer** — spec `2026-09-14-approvals-oversight-design.md`, plan `2026-09-14-phase-21-approvals-oversight.md` (8 tasks, 16 amendments `D-1`…`D-16` — the final-review fix wave added `D-11`…`D-13`, the final battery `D-15` and `D-16`) — battery, last run 2026-09-15 on the final tree `2ae8738` (after the final-review fix wave and ruling R7's Manila-date fix): `tsc` clean · `lint` clean · **22 migrations** · **1317 unit / 77 files** · **305 e2e / 29 files** by `--list`, across six foreground chunks with explicit file paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 (3.4m) · B 67 (3.9m) · C 63 (4.1m) · D 38 (2.6m) · E 53 (7.4m) · F 30 (3.2m) = 305**, zero failed, zero did-not-run, all first pass, no fix commits; Task 8's earlier close ran on the branch tip `562587f` (2026-09-14) as **A 54 (3.4m) · B 67 (3.9m) · C 63 (4.0m) · D 38 (2.6m) · E 53 (7.4m) · F 30 (3.3m) = 305**, zero failed, zero did-not-run, **1312 unit / 77 files**; the fix wave's own battery on `b6b4e2a` reproduced chunk F's `transfers.spec.ts` UTC-midnight failure (Phase 20's parked M-5) at 01:00 Manila — 25 passed, 1 failed, 4 did not run, chunks A–E green — before ruling R7 fixed it in product code. `npm run db:seed` run last, clean. See §0 item 9 for the chunk commands and (n) below for what shipped. **Merged and pushed 2026-09-15 (`b716767`); staging redeployed the same day with `-Force` (migration 22 applied, web healthy); nothing remains for this phase.**) (**PHASE 20 (IT side: department transfers, offboarding attribution and facets, directory quality, six known gaps) IS MERGED TO `main` via `--no-ff` `e48b457` AND PUSHED (2026-09-10); the merged tree is byte-identical to the tested branch tip `9e05553` (product tree `4d54382` plus its docs commits; tree hashes matched); branch and worktree removed; **staging is NOT yet redeployed** — migrations 20 and 21 apply together at the next `scripts/deploy-staging.ps1 -Force`** — spec `2026-09-10-it-people-and-gaps-design.md`, plan `2026-09-10-phase-20-it-people-and-gaps.md` (9 tasks, 30 amendments `D-1`…`D-30` — the final-review fix wave added `D-23`…`D-29`, the final battery `D-30`) — battery, last run 2026-09-10 on the final tree `4d54382` (after the final-review fix wave, rulings R14/R15): `tsc` clean · `lint` clean · **21 migrations** · **1295 unit / 75 files** · **296 e2e / 27 files** by `--list`, across six foreground chunks with explicit file paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 (3.4m) · B 67 (3.8m) · C 63 (4.0m) · D 38 (2.6m) · E 53 (7.3m) · F 21 (2.0m) = 296**, zero failed, zero did-not-run (chunk A's first pass was 53 + 1 failed on `it-core.spec.ts:302`, a `toBeVisible` 5 s timeout, and passed 54/54 on the immediate as-is re-run — the cold-compile/headroom class §7 documents, not a regression); Task 9's earlier close ran on the branch tip `f6ec5e1` with chunk C read by the bare pattern `offboarding` (also matching `offboarding-v2.spec.ts`) as **54 (3.3m) · 67 (3.9m) · 68 (4.4m) · 38 (2.6m) · 53 (7.3m) · 21 (2.0m)** = 301 run / 296 unique, zero failed, zero did-not-run on the recorded runs, after four test-only fixes — chunk A (`fe4295c`), chunk C (`63df64a`), chunk D twice (`0b463b1`, `f6ec5e1`); `npm run db:seed` run last both times. See §0 item 9 for the chunk commands and (m) below for what shipped, the final review's findings, the fix wave, and each fix's diagnosis.) (**PHASE 19 (Stock control, part D1 — the ledger core) IS MERGED TO `main` via `--no-ff` `d311e26` AND PUSHED (2026-09-10); the merged tree is byte-identical to the tested branch tip `a185729` plus its docs commit (tree hashes matched); branch and worktree removed; **staging is NOT yet redeployed** — migration 20 applies at the next `scripts/deploy-staging.ps1 -Force`** (9 tasks, 30 amendments `D-1`…`D-30` — the final-review fix wave added `D-21`…`D-30`) — spec `2026-09-09-stock-control-design.md`, plan `2026-09-09-phase-19-stock-control.md` — battery, last run 2026-09-09 on the final tree `a185729` (after the fix wave, ruling R14 and the re-review minors): `tsc` clean · `lint` clean · **20 migrations** · **1224 unit / 72 files** · **275 e2e / 23 files** by `--list`, across five foreground chunks — re-run on the final tree as **54 (3.4m) · 67 (3.8m) · 63 (4.0m) · 38 (2.5m) · 53 (7.1m) = 275**, zero failed, zero did-not-run (chunks A and B on `ad19921`, C–E on `a185729`; the delta is a comment, a test title and one e2e assertion); Task 9's close ran the same list as **54 (3.3m) · 67 (3.9m) · 63 (4.0m) · 38 (2.6m) · 53 (7.3m) = 275**, zero failed, zero did-not-run on the first pass of every chunk, no re-run needed; the fix wave itself re-ran only `stock.spec.ts` + `stocktake.spec.ts` (17/17, 1.6m, `E2E_PORT=3100 --workers=1 --global-timeout=540000`) since no other stock file changed. See §0 item 9 for the chunk commands and (l) below for what shipped, what the wave fixed, and why.) (**PHASE 18 (Purchasing: suppliers and request extensions) IS MERGED TO `main` via `--no-ff` `d4b95bb` AND PUSHED (2026-09-09); the merged tree is byte-identical to the tested branch tip `3298abf` (tree hashes matched); branch and worktree removed; **staging redeployed the same day with `scripts/deploy-staging.ps1 -Force`** — migration 19 applied, web healthy, the LAN URL answers; the final-review fix wave (`D-18`/`D-19`) is included** — spec `2026-09-08-purchasing-suppliers-design.md`, plan `2026-09-08-phase-18-purchasing-suppliers.md` (10 tasks, 19 amendments `D-1`…`D-19`) — battery, last run 2026-09-09 on the final tree `3298abf` (the tree that was merged): `tsc` clean · `lint` clean · **19 migrations** · **1113 unit / 64 files** · **258 e2e / 21 files** across five foreground chunks, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **54 (3.3m) · 67 (3.9m) · 63 (4.0m) · 38 (2.5m) · 36 (5.6m) = 258**, zero failed, zero did-not-run (Task 10's 74-test last chunk split in two to fit the ten-minute foreground cap); `npm run db:seed` re-run after. The full 258/21 four-chunk battery from Task 10's close (below) was not re-run in the wave — only the four files whose code the fix wave touched. See §0 item 9 for the chunk commands and (k) below for what shipped and what the wave fixed.) (**Prior, at Task 10's close (`38a3b02`, 2026-09-08):** `tsc` clean · `lint` clean · **19 migrations** · **1110 unit / 64 files** · **258 e2e / 21 files** across four foreground chunks — **54 (3.4m) · 67 (3.9m) · 63 (4.0m) · 74 (8.0m) = 258**, zero failed, zero did-not-run on the recorded runs (chunk A's one non-reproduced failure — a full re-run and an isolated `it-core.spec.ts` run both came back clean — is the documented cold-compile/headroom class, not a regression; see plan `D` block, "Measured at close").) (**PHASE 17 (the scale sweep) IS MERGED TO `main` via `--no-ff` `aef53fa` AND PUSHED (2026-09-08); the merged tree is byte-identical to the tested branch tip `4f7b29e` (tree hashes matched); branch and worktree removed; staging redeployed the same day with `scripts/deploy-staging.ps1 -Force` — migration 18 (seven indexes) applied** — spec `2026-09-08-scale-sweep-design.md`, plan `2026-09-08-phase-17-scale-sweep.md` (9 tasks, 12 amendments `D-1`…`D-12` — the final-review fix wave added `D-10`/`D-11`, the final battery `D-12`) — battery, last run 2026-09-08 on the final tree (`4f7b29e`, the tree that was merged): `tsc` clean · `lint` clean · **18 migrations** · **1056 unit / 58 files** · **239 e2e / 19 files** across four foreground chunks — **54 (3.4m) · 67 (3.9m) · 63 (4.0m) · 55 (5.9m) = 239**, zero failed, zero did-not-run — after one test-only fix: chunk D failed `custody.spec.ts` case 7 twice because the test waited on a toast the previous add had left showing (`D-12`); it now waits on the slot chip, and the chunk passed 55/55. See §0 item 9 for the chunk commands.) (**PHASE 16 (registration, policy exceptions, loans, bulk assign and the signed accountability form) IS MERGED TO `main` via `--no-ff` `83643b4` AND PUSHED (2026-09-08); the merged tree is byte-identical to the tested branch tip (tree hashes matched); branch and worktree removed; **staging was redeployed the same day with `scripts/deploy-staging.ps1 -Force`** — migrations 16 and 17 applied (17 found, schema up to date), web and worker recreated and healthy, the LAN URL answers; `-Force` is required whenever the merge happened on the laptop, because the plain run sees local `main` already level with origin and skips** — spec `2026-09-07-it-registration-custody-design.md`, plan `2026-09-07-phase-16-registration-custody.md` (16 tasks, 20 amendments `D-1`…`D-20` — the final-review fix wave added `D-19`/`D-20`) — battery, last run 2026-09-08 (final-review fix wave): `tsc` clean · `lint` clean · **17 migrations** · **1040 unit / 56 files** · **227 e2e / 18 files** by `--list` (case 7 added to `registration.spec.ts`; every other addition was an axe assertion inside an existing case) — see §0 item 9 for the foreground chunk breakdown.) (**PHASE 15 (direct IT lifecycle) IS MERGED TO `main` via `--no-ff` `c087f8d` AND PUSHED (2026-09-07)** (10 tasks, 9 amendments `D-1`…`D-9`; the merged tree is byte-identical to the tested branch tip — `git diff phase-15-direct-it-lifecycle..main` was empty and the two tree hashes matched — so the branch battery below is the battery of this tree; `phase-15-direct-it-lifecycle` and its worktree were removed after the merge; **staging is NOT yet redeployed** — migration 16 `asset_returned_at` applies at the next `scripts/deploy-staging.ps1` run) — battery, last run 2026-09-07: `tsc` clean · `lint` clean · **16 migrations** · **993 unit / 54 files** · **214 e2e / 16 files** by `--list` — the full battery last ran at 213 across five foreground chunks, 31 · 67 · 46 · 36 · 33, before plan D-9 added one scanner case; `scanner` + `offboarding` (23 cases) re-ran green.) (**PHASE 14 (department-owned classes) IS MERGED into `main`** (merge `dc0121d`, 2026-09-07; 16 tasks; phase branch deleted) — `main` is UNPUSHED; spec `2026-09-07-department-owned-classes-design.md`. Battery, last run 2026-09-07: `tsc` clean · `lint` clean · **15 migrations** · **971 unit / 52 files** · **203 e2e / 15 files** across five foreground parts — **36 · 46 · 54 · 34 · 33 = 203**.) (**PHASE 13 (asset classes) IS MERGED TO `main` via `--no-ff` `6bcf4e8` AND PUSHED (2026-09-07)** — 12 tasks, 19 amendments (`D-1`…`D-19`); the merged tree is byte-identical to the tested branch tip (`git diff phase-13-asset-classes..main` is empty), `tsc` and the unit suite were re-run on `main` before the push, and the push diff was secret-scanned (only `.env.example` is tracked). `phase-13-asset-classes` stays local, like every phase branch. Battery: `tsc` clean · `lint` clean · **908 unit / 51 files** · `npm run build` compiled (route table printed) · `docker compose --profile prod build` completed earlier the same night (the run that produced the rebuilt `inventory-app:latest` image was interrupted before it could report, and was not repeated) · **187 e2e / 14 files** across five foreground parts, `--workers=1 --global-timeout=540000` — **52 (3.1m) · 47 (5.2m) · 59 (6.8m, then 6.2m on repeat) · 23 (2.0m) · 6 (3.9m) = 187**. Part 3 ran twice: the first pass was 58/59 with `e2e/purchases.spec.ts:90` failing, then 59/59 on repeat — recorded as one non-reproduced failure of the cold-compile/headroom class §7 already documents, not a Phase 13 regression. See §0 items 4f and 9. **PHASES 1–11 ARE ALL MERGED AND PUSHED.** Phase 11 merged via `--no-ff` `b6aa5e2` and pushed the same day; Phase 10 on 2026-08-27. **PHASE 12 IS MERGED TO `main` (2026-09-03) AND NOT PUSHED.** Two `--no-ff` merges: `f368344` (Phase 12) and `09a54ba` (phase-12a deployment hardening). **It is NOT “receiving” any more:** amendment `C-5` replaced it with **registering already-purchased assets**, and `C-11` then deleted the receiving code outright — see §0 item 4e. **`main` IS LEVEL WITH `origin/main` at `6bcf4e8`** (pushed 2026-09-07 — 112 commits: the Phase 12 backlog plus Phase 13; count yourself with `git rev-list --count origin/main..main` before trusting this line, since every correction to it is itself a commit) · **Phases 1–9 ALL MERGED to `main`** (Phase 9 via `--no-ff` `7284c10`; `phase-9-import-export` deleted). · **PHASE 10 (polish) IS COMPLETE AND MERGED TO `main`** via `--no-ff` `bd78813` on 2026-08-27, after a green battery on the merged result. `phase-10-polish` was deliberately NOT deleted. The label sheet and the offboarding scanner both ship end to end; the axe sweep covers 46 of 47 routes; `README.md` is a deployment document that has actually been executed. · **BATTERY, AND EXACTLY HOW FAR IT GOT.** On `phase-12-receiving` at code-complete (2026-09-03), FULL and green: `tsc` · `lint` · **843 unit / 50 files** · `npm run build` (38 static pages) · `docker compose --profile prod build` (3 images) · **167 e2e / 13 files in five parts, zero failed, zero did-not-run**. **11 migrations; `main` has 8.** ⚠️ **The “153 e2e” this line used to claim for `main` was wrong by one — Phase 12 added exactly one e2e file (13 tests) and a one-line axe change, so `main`’s real baseline is **154 / 12 files**. Verified with `npx playwright test --list`, which counts without running; use it rather than trusting any number in this doc.** · **THE FULL BATTERY IS GREEN ON THE MERGED `main` (2026-09-04):** `tsc`, `lint`, **843 unit / 50 files**, 11 migrations, and **167 e2e / 13 files across five parts — 52 · 47 · 39 · 23 · 6, zero failed, zero did-not-run**. The merged tree is **byte-identical** to the tested branch tip (`git diff phase-12a-deploy-hardening..main` is empty), and no source file has changed since the last proven `docker compose --profile prod build` — only docs. **The risk that run existed to test was the `SEED_PASSWORD` change desynchronising the seed from every spec's login; all 13 files log in and all pass.** · **ONE ENTRY CRITERION REMAINS AND NO AGENT CAN CLOSE IT: Task 11 Step 4 — print a real label sheet and measure the 100 mm calibration bar with a tape measure.** It needs a physical printer and a human. · **`main` IS PUSHED and level with `origin/main` at `b6aa5e2`** (180 commits on 2026-08-27, then 30 more carrying Phase 11 on 2026-09-02). **All three phase branches are local only and have NEVER been pushed** — deliberately; only `main` is ever authorised. `phase-10-polish` and `phase-11-label-qr` are now fully contained in `main` and safe to delete. Count before trusting this line: `git rev-list --count origin/main..main`. · **Merging and pushing are the user's decisions; do neither unprompted.** · **NEW 2026-09-02: §9 records FOUR unplanned subsystems from an Admin stakeholder meeting (inventory digitization, vendor master data, purchasing extensions, consumables/stock control). Read §9 before scoping anything — one of the four cannot be modelled as an `Asset` and would break four existing surfaces if it were.**

This is the pick-up doc for a fresh session. Read this first, then the spec
(`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`) and the two design-handover files
(`design_handover/original-brief.md` = what each screen does; `design_handover/README.md` = how it
looks + tokens). The client's 39 routes are enumerated in the brief §7; 38 pages (35 under the
`(app)` group, 3 auth) + 4 route handlers exist today — `/dev/kitchen-sink` not counted, since it
404s in prod.

---

## 0. Start here (next session, in order)

> **On a new device?** Read [`PICKUP.md`](PICKUP.md) first — it is the short front door (setup, decisions,
> what is next) and points back here for depth. Added 2026-09-07 when development moved machines.

**Phases 1–11 are all merged into `main` and pushed. PHASE 12 is CODE-COMPLETE on
`phase-12-receiving` — all 8 tasks, battery green, UNMERGED and UNPUSHED. That branch is where the
live work is.** What remains is the merge and push decisions (separately), plus the two physical checks
no agent can perform. ⚠️ **`main` also carries 3 unpushed documentation commits of its own.**
One physical check remains that no agent can perform: a tape measure on the 100 mm calibration bar.
(The printed QR **has** been read on a phone — the user confirmed it, which closed Phase 11's
least-evidenced assumption.) Read items 1–4 below, then stop and ask.

1. **`git checkout phase-11-label-qr`** — that is where the live work is; `main` carries Phases 1–10
   only. The branch is ~17 ahead of `main` and 0 behind, and **has never been pushed**. `main` itself
   was pushed on 2026-08-27 and is level with `origin/main`. **Count both yourself**
   (`git rev-list --count origin/main..main` and `git rev-list --count main..phase-11-label-qr`) —
   every correction to this line is itself a commit, so it is stale the moment it is written.
   **The user treats merging and publishing as separate decisions and asks for each explicitly. Never
   push or merge unprompted.** The repo is public — never commit `.env` or any real secret, and
   secret-scan before any push (§0 item 4c records what that scan covered last time).

2. **Bring the environment up:** `docker compose up -d db` → `npx prisma migrate deploy` →
   `npm run db:seed`. **8 migrations, none pending**; Phase 10 adds none. `npm run db:seed` runs freely.

   ⚠️ **Docker Desktop cannot be started from a terminal.** It needs the interactive desktop session and
   an elevation prompt. If `docker info` fails with
   `npipe:////./pipe/dockerDesktopLinuxEngine … cannot find the file specified`, **ask the user to start
   it** — `Start-Process "Docker Desktop.exe"` launches and silently exits. This cost twenty minutes.

3. **Read the PHASE 11 plan and spec first** — `docs/superpowers/plans/2026-08-26-phase-11-label-qr.md`
   and `docs/superpowers/specs/2026-08-26-label-qr-design.md`. That is the live work. Its banner carries
   **B-1 through B-16**, six of which were defects in the plan rather than in the implementations.
   Phase 10's plan (`2026-08-25-phase-10-polish.md`, amendments **A-1…A-44**) is history now, but worth
   reading for the same reason. **In both, read the `AMENDED` banner BEFORE the task body** — in several
   cases the banner reverses the body outright.

4. **There is no next CODING task. Everything below is either a user decision or a physical act no
   agent can perform.** Six items; (b) and (c) are done for Phase 10 and **open again for Phase 11**.
   **(a2) is newly DECIDED and needs building — as its own piece of work, not on this branch.**

   **(a) TWO physical checks, on one sheet of paper. No agent can do either.** Print a label sheet at
   **Scale 100%, A4, Margins None**, then (i) measure the 100 mm calibration bar with a tape measure and
   (ii) scan one of its QR codes with a phone. Record the browser, the printer and all three print
   settings in §8 alongside the numbers.
   - Both hinge on that one setting: at "Fit to page" the QR modules and the ruler shrink **together**,
     so a failure there is a print-settings problem, not a software one.
   - The bar is proven in software — 100.0 mm in the rendered DOM, and 99.97–100.01 mm measured inside a
     real Chrome-generated PDF. It silently shipped at 89.38 mm once, which is why it exists at all. If
     the printed bar is short **at 100% scale**, spec §5's PDF escape hatch stops being speculative.
   - The QR has never been read off paper by anything. `QR_PREFERRED_MODULE_MM` (0.5) and
     `QR_MIN_MODULE_MM` (0.4) are a judgement about phone optics, not a measurement — this scan is what
     replaces the guess. Record the result against those two constants.
   - ⚠️ **CORRECTED 2026-09-03: check (ii) is NOT blocked — `APP_BASE_URL` has been set all
     along.** `.env` carries `http://192.168.202.141:3000`, the host's LAN address, so labels have been
     printing a real QR. An earlier revision of this bullet asserted the variable was unset and the
     check therefore impossible; that was **inferred from the placeholder in `.env.example` and never
     verified against `.env`**, which is gitignored and so had never been read by any agent. The
     general claim is still true — no QR prints while the variable is unset — the premise was wrong.
     **§6a rule 95: check the artefact, not the document that describes it.**

   **(a2) DECIDED 2026-09-03 — the `APP_BASE_URL` hostname, after ten sessions of deferral.**
   ⚠️ **SUPERSEDED THE SAME DAY — read (a3) below.** The user reframed the question ("this is a
   prototype"), and a domain purchase plus a nameserver migration plus Cloudflare Access is a
   production answer. The tunnel plan below is kept because it is still the right shape **when this
   stops being a prototype**; it is not what is being built.

   The value would be **`https://inventory.thebackroomop.com`**, served by a **Cloudflare Tunnel**
   beside the compose stack.
   - **Why a hostname on a domain the user owns:** `.env.example`'s own argument — a hostname can be
     repointed, an IP cannot, and the value is baked permanently into every sticker physically applied
     to a device. Owning the name means the plumbing behind it can change later without reprinting one
     label.
   - **Why a tunnel:** phones must reach the app. A LAN-only DNS record works on office Wi-Fi and
     nowhere else, and some routers refuse public DNS records that answer with a private IP
     (rebinding protection). The tunnel needs no port forwarding and no certificate work.
   - ⚠️ **The scheme and the port are part of the baked string.** Printing `http://…:3000`
     now and moving to `https://…` later kills every sticker already on a device. Build the plumbing
     to match the final URL rather than baking whatever is easiest today.
   - ⚠️ **Do NOT set `APP_BASE_URL` until that hostname actually resolves from a phone.** The
     code refuses unset/scheme-less/loopback values and prints a note instead, but a value that is
     merely *unreachable* passes every check and prints a **dead QR** — strictly worse than the
     current no-QR behaviour, which was a deliberate design choice.
   - **A tunnel makes the app internet-reachable, which turns changing the seeded passwords from
     advice into a hard prerequisite** — README already says so under "Scanning a label with a phone".
   - **Measured, 2026-09-03** (`qrMatrix` + `qrFit`, tag `BR-LT-0211`): the chosen URL is **61 bytes
     → v4, 33×33, 20.5 mm at 0.5 mm/module** — one byte under the 62-byte v4 ceiling at ECC-M.
     Adding `:3000` (65 B) crosses to v5, 37×37, **22.5 mm**. Crossing does **not** reduce
     scannability: the module stays pinned at 0.5 mm until the symbol exceeds 48 modules, so a longer
     URL buys a physically bigger QR, not a finer one.

   **(a3) DECIDED 2026-09-03, and it SUPERSEDES (a2) for now: the prototype uses the host's LAN IP.**
   `APP_BASE_URL=http://192.168.202.141:3000`, already set in `.env`. The user's framing was decisive:
   **this is a prototype, so the stickers are disposable** — which removes the whole reason the
   permanence argument existed.
   - **Why this is low-regret:** switching to any other option later costs **exactly one environment
     variable**. No code, no schema, no rebuild. The only sunk cost is reprinting a sheet, which a
     prototype would reprint anyway. Measured at 50 bytes → v4, 33×33, 20.5 mm.
   - ⚠️ **That address is DHCP-assigned** (`PrefixOrigin: Dhcp`, /16, on **Wi-Fi**), so it WILL
     move. **The open task is a DHCP reservation on the router**, which needs router admin access —
     not something an agent can do. Until then, every printed label is one lease renewal from dead.
   - ⚠️ **Test phone → host reachability BEFORE printing anything.** Many office Wi-Fi networks
     enable **client isolation**, which blocks phone-to-laptop traffic outright and would defeat this
     option regardless of the URL. Open `http://192.168.202.141:3000` in a phone browser first.
   - ⚠️ **Logins cross the LAN in cleartext** on plain HTTP. Accepted deliberately for a
     prototype on a trusted network; it is the reason `(a2)`'s HTTPS options exist for later.
   - **Rejected for the prototype, with reasons, so nobody re-litigates:** `.local`/mDNS (**Android
     support is unreliable, and phones are the entire point**); a `trycloudflare.com` quick tunnel (the
     URL changes every restart, so it cannot be baked into a sticker — fine for a demo-day reprint);
     Tailscale (free, HTTPS, works off-site, but every scanning phone needs the app installed and
     signed in); a named tunnel on the company domain (see (a2) — **the nameserver move would put
     `thebackroomop.com`'s MX records at risk, and company email lives there**).

   **(b) Merging — done for PHASE 10, OPEN for Phase 11.** `phase-10-polish` was merged to `main` on 2026-08-27 via `--no-ff`
   `bd78813`, the user having chosen that explicitly. `tsc`, `lint` and 797 unit tests were re-run on
   the merged result and the merged tree is byte-identical to the branch. **The branch ref was kept.**
   Deleting it now would strand nothing — its tip is reachable from `main` — but there is no need.

   **(c) Pushing — done for PHASE 10, OPEN for Phase 11 (its branch has never been pushed).** 180 commits went up on 2026-08-27, the user having asked for it separately
   from the merge, as this project always does. **A secret scan ran first and is worth repeating before
   any future push, because this repo is PUBLIC:** no `.env` was ever committed in those 180 commits, no
   `uploads/`/`backups/` content leaked in, the only `.sql` files are legitimate migrations, and no
   secret-shaped assignment appears in any added line. The one credential that IS public is
   `SEED_PASSWORD = "admin123"` (`prisma/fixtures.ts:31`) — deliberate, documented in `README.md`, and
   safe only while the app stays on localhost. **Never push unprompted; still ask each time.**

   **(d) Two deferred items, both real, neither blocking.** **Entra SSO does not work** — the provider
   registers when three env vars are set but no `signIn` callback maps an Entra profile to a `User`, so
   a successful login arrives with no role (`src/server/auth/index.ts`, and its own TODO says so). It is
   documented in `README.md` under "What does not work". And **`./uploads` is not covered by the daily
   `pg_dump`** — asset documents are plain host files bind-mounted into `web`, so a database backup
   alone does not restore them.

   **(e) PHASE 11 IS MERGED. PHASE 12 IS IN FLIGHT — that branch is where the live work is.**

   Phase 11 (the label QR and the compact scan card) merged to `main` via `--no-ff b6aa5e2` on
   2026-09-02 and was pushed the same day, after a green battery on the merged result: 818 unit / 49
   files, 153 e2e / 12 files, both builds. Sixteen amendments, **six of them defects in the plan**.
   `phase-11-label-qr` is fully contained in `main` and safe to delete.

   **PHASE 12 — CODE-COMPLETE on `phase-12-receiving`, battery green, UNMERGED and UNPUSHED**
   (30 ahead of `main`, 0 behind, **843 unit / 50 files**, **167 e2e / 13 files**, 11 migrations).

   ⚠️ **It is not "purchase → asset receiving" any more, whatever the branch name and the spec
   filename say.** Two premise changes from the user rewrote it mid-flight:

   - **`C-5`** — *"we are not doing purchase request; these assets are already purchased and we are
     registering them to our system."* The receive screen was dropped for **`/inventory/register`**:
     batch registration with auto-numbered tags, no purchase request required (one is accepted as
     optional provenance, and must be `COMPLETED` if given).
   - **`C-7`** — Finance confirmation needed a way back. IT registers, **Finance confirms or sends it
     back with a reason**, IT marks it corrected.

   **What shipped:** `TAG_SHAPE` hoisted to one definition (it was written out three times);
   `Asset.purchaseUnitId`; `/inventory/register` + `register-form.tsx`; the tag arithmetic in
   `src/lib/receiving.ts` (`nextTags`, `preferredPrefix`); `registerAssets`; and on `Asset`, two
   nullable pairs — `financeConfirmedAt`/`ById` and `financeReturnedAt`/`ById` plus
   `financeReturnReason` — driving a three-state pill on the asset record.

   ⚠️ **Finance confirmation is a LABEL, not a GATE, and the user chose that deliberately.** An
   unconfirmed or returned asset is a completely normal, live asset — assignable, deployable. Nothing
   in the app reads `financeConfirmedAt` except the pill and the action that sets it. **Do not "fix"
   this into a hold without asking.**

   ⚠️ **It is deliberately NOT an `AssetStatus` member and NOT an approval** (`C-5`). Those eight
   status values are a partition of custody/physical state and an asset can be `SPARE` *and*
   unconfirmed at once; all five `ApprovalType` values are lifecycle changes to an existing asset,
   while this is data verification. An `UNCONFIRMED` status would break `statusFamily`, the status
   chips, the facet counts and `buildAssetWhere`.

   ⚠️ **Read the amendment banner — `C-1` through `C-12`, nine of them defects in the plan.** The
   three that generalise past this phase:

   - **`C-10` is the most expensive lesson in this project.** `/inventory/register` **never worked, at
     any quantity, from the day it shipped**, and stayed broken through three later tasks. Every layer
     below it was green. See §6a rules **97** and **98**.
   - **`C-4`** — the receive transaction could **commit a half receipt** (Prisma commits when the
     callback RESOLVES, rolls back only when it THROWS, and refusals sat *after* writes). The code it
     guarded is now deleted by `C-11`, but the trap is live anywhere else: **`runTransition` uses the
     identical return-don't-throw shape SAFELY, because all its refusals precede its single write. The
     pattern is not wrong; interleaving it with writes in a loop is.**
   - **`C-11`** — `C-5` deleted the receive screen and nobody walked the call graph down, so
     `receiveUnits`, `receivableUnits`, `outstanding` and `isFullyReceived` sat with **no caller at
     all** for four tasks, reading as a working feature. The user chose to delete them (264 lines).
     `NoteKind.RECEIVE` survives in the enum on purpose — dropping a Postgres enum value means
     recreating the type.

   **Still open from the original brief:** card `1m` promises labels printed "from a bulk selection
   **or a completed purchase**". Assets created from a purchase now exist and carry an optional
   `purchaseRequestId`, so they can be labelled from the bulk selection — but there is still **no
   "pick a completed purchase, print its labels" flow**. Half-closed, honestly.

   **If the user wants different work rather than a decision, there is no plan for it.** Start with
   `superpowers:brainstorming`, then `superpowers:writing-plans` — do not improvise changes onto a
   branch that is being held for a merge decision.

   **(f) PHASE 13 (asset classes) IS CODE-COMPLETE on `phase-13-asset-classes` — spec
   `docs/superpowers/specs/2026-09-06-asset-classes-design.md`, plan
   `docs/superpowers/plans/2026-09-06-phase-13-asset-classes.md`.** Read the plan's amendment banner
   (`D-1`…`D-19`) before the task bodies, same rule as Phase 11/12.

   Two premise-level facts: **Purchasing assets carry their OWN status vocabulary** —
   `OPERATIONAL STORED REPAIRING RETIRED SOLD LOST`, disjoint from IT's eight — and there is **ONE
   register with a class column**: `AssetClass { IT, PURCHASING }` lives on `AssetCategory.cls` and is
   copied onto `Asset.cls` at creation, never chosen per item.

   Two accepted defaults, both presented to the user for pushback and kept: **approvers stay `admin` /
   `it_staff` for both classes** — `purchasing_staff` cannot reach `/approvals` today, and
   Purchasing-owned approvals is the first follow-up (§8); **categories are created by `admin` /
   `it_staff` only**, not by `purchasing_staff`.

   Two triggers make the class dimension a database property, not an application discipline:
   `asset_class_invariants` (class↔status, plus `Asset.cls = category.cls` under a **`FOR SHARE`** lock
   on the category row so a concurrent class flip cannot slip between the read and the write — D-3),
   and `category_class_frozen` (refuses to change a category's class once any asset references it).

   The user's naming decision, on the record so nobody builds a third meaning: *"remember admin =
   purchasing"* — the business's **Admin department IS Purchasing**; in the codebase `admin` is the
   sysadmin role, and Purchasing is the `purchasing` workspace / `purchasing_staff` role. §9 below is
   corrected accordingly.

   What remains: the merge and push decisions, the user's and separate as always (§0 items 4b/4c above
   apply the same way); and the deferred follow-ups now recorded in §8.

   **(g) PHASE 14 (department-owned classes) IS MERGED into `main` (2026-09-07, merge `dc0121d`) — spec
   `docs/superpowers/specs/2026-09-07-department-owned-classes-design.md`, plan
   `docs/superpowers/plans/2026-09-07-phase-14-department-owned-classes.md`.** Read the plan's amendment
   banner (`D-1`…`D-9`) first, same rule as Phases 11–13.

   Three maps in `src/lib/asset-class.ts` now decide every class question: **`VISIBLE_CLASSES`** (IT and
   the viewer see IT only; Purchasing, Finance and admin see everything), **`REGISTRABLE_CLASSES`**
   (Purchasing registers both classes, IT its own) and **`MANAGEABLE_CLASSES`** (edits, approvals,
   assign/return, documents, categories, labels — each department its own). Invariant, pinned by a test:
   `MANAGEABLE ⊆ REGISTRABLE ⊆ VISIBLE`. `src/lib/approval-access.ts` scopes the approvals queue the same
   way; a class-less approval is any approver's to reject.

   The register flow is the user's: **Purchasing registers → IT checks a Purchasing-registered IT asset
   (`Asset.itVerifiedAt`, migration 15, backfilled for every IT asset that existed) → Finance confirms.**
   Finance's IT tab lists an IT asset only once checked, and confirm / send-back refuse an awaiting one.
   `canEditAsset`: Purchasing keeps editing its registration until IT checks it. Assign / return moved
   onto the asset record (`HolderControl`); person-centric pages render an invisible class's tag as text
   (`TagRef`). `/employees/new` is the first manual employee create. Two Phase 13 defaults reversed on the
   user's instruction: approvers are no longer `admin`/`it_staff` for both classes, and Purchasing creates
   categories and types of its own class.

   Reversed decision, on the record: the first Phase 14 draft kept reads shared for every role; the user
   set **"IT can only see their assets"** and the spec was rewritten the same day. The **depreciation
   module** the user chose is Phase 15, its own brainstorm; Phase 14 guarantees its inputs.

   What remains: the push decision (the user's, as always); the merge-time residuals in PICKUP §5; the
   Phase 15 candidates in PICKUP §4.

   **(h) PHASE 15 (direct IT lifecycle) IS CODE-COMPLETE on `phase-15-direct-it-lifecycle` — spec
   `docs/superpowers/specs/2026-09-07-direct-it-lifecycle-design.md`, plan
   `docs/superpowers/plans/2026-09-07-phase-15-direct-it-lifecycle.md`.** Read the plan's amendment
   banner (`D-1`…`D-9`) first, same rule as Phases 11–14.

   **The core shape:** one map `DIRECT_LIFECYCLE_CLASSES = ["IT"]` and one predicate `isDirectLifecycle(role, cls)` decide who bypasses the approval queue. The worker's live guards and asset write move into `src/server/modules/lifecycle/apply.ts` as `prepareLifecycle` (guards → planned updates + diff) and `commitLifecycle` (the write); the worker and the new direct actions both call them, so the rules cannot drift. Direct actions live in `src/server/modules/lifecycle/actions.ts` and record each change as an `EXECUTED` approval row (created in state `EXECUTED`, `requestedBy = claimedBy = actor`, `refNo` allocated as today), an asset audit entry with one of five `lifecycle.*` action strings, and the `approval.executed` webhook. `Asset.returnedAt` (migration 16, additive) plus `isAssignable()` keep an untriaged device out of the spare pool everywhere. `src/lib/worklist.ts` groups Home rows into fixed sections; IT's Home is now an ordered worklist with a full `/inventory/work` page. Purchasing keeps its approval queue. **Replace** (`replaceAsset` retires the old device by a chosen outcome and assigns the spare in one transaction; both legs roll back together, and the two audit entries cross-reference (`replacedBy` / `replaces`). **Offboarding** decisions on IT devices apply on confirm through the same executor and are recorded as EXECUTED returns, so the wizard's Continue gate and the farewell report read them unchanged; a leaver's car still queues for Purchasing.

   **Why EXECUTED rows, not audit-only:** History, Timeline, the offboarding wizard, the farewell report, the `approval.executed` webhook and the Closed tab all read approval rows; the row is a record of a decision never a request: keeping it keeps every one working with no rewrite, and gives each change a refNo to quote. The spec's row 3 (§1) justifies it.

   What remains: Phase 15b depreciation. (Staging received this code with the Phase 16 redeploy on 2026-09-08; migration 16 applied then.)

   **(i) PHASE 16 (registration, policy exceptions, loans, bulk assign and the signed form) IS MERGED TO `main` via `--no-ff` `83643b4` AND PUSHED (2026-09-08; branch and worktree removed) — spec
   `docs/superpowers/specs/2026-09-07-it-registration-custody-design.md`, plan
   `docs/superpowers/plans/2026-09-07-phase-16-registration-custody.md`.** Read the plan's amendment
   banner (`D-1`…`D-18`) first, same rule as Phases 11–15.

   **The core shape:** one additive migration (`20260907110000_it_registration_custody`, 16 → 17: three nullable `Asset` columns, a `PolicySlot.loaner` flag, one enum, two tables). `src/lib/loadout.ts` gains `effectiveSlots` (ADD/WAIVE exceptions layered on the resolved policy, applied before the loadout is computed) and the loaner rule (a loaner slot fills only from a `TEMPORARY` device, a standard slot only from a non-`TEMPORARY` one, an unmatched `TEMPORARY` device reads `onLoan`, never an extra). `loanDueAt` threads through the shared lifecycle executor (`prepareLifecycle`/`commitLifecycle`, `assignAsset`) and the new metadata-only `setLoanDue` (audit entry, no approval row). `bulkAssign` sits beside `bulkChangeStatus` — one person, Deployed or Loan, one transaction, the 200 cap, a per-tag skip list. `src/server/uploads.ts` extracts the upload rules (type/MIME/size/checksum/sanitised path) once and is reused by the single-asset, batch and acknowledgement upload actions. `Acknowledgement` is an employee-level row (signing date, scanned file, recorder, a snapshot of the items covered) with its own safe-content-disposition download route and an "issued since last signature" hint.

   **Why:** spec §1 decisions 7–11 — per-person exceptions (7), loaner slots (8), loan due date (9), bulk assign (10), signed acknowledgement (11).

   **Phase 17** (the scale sweep — pagination everywhere, the employees list in SQL, cursor paging on the merged timelines) followed the same day — see (j). Staging ran this code from the first 2026-09-08 forced redeploy until the Phase 17 redeploy later that day (`scripts/deploy-staging.ps1 -Force` — the plain run skips when the merge happened on the laptop).

   **(j) PHASE 17 (the scale sweep) IS MERGED TO `main` via `--no-ff` `aef53fa` AND PUSHED (2026-09-08);
   branch and worktree removed; staging redeployed — spec
   `docs/superpowers/specs/2026-09-08-scale-sweep-design.md`, plan
   `docs/superpowers/plans/2026-09-08-phase-17-scale-sweep.md`.** Read the plan's amendment
   banner (`D-1`…`D-12` — the final-review fix wave added `D-10`/`D-11`, the final battery `D-12`) first, same rule as Phases 11–16.

   **The core shape:** one pure paging rule, `pageOf(total, requested, size): Page {page, pageCount, skip, take, total}` in `src/lib/paging.ts`, naming the app's two page sizes once (`ENTITY_PAGE_SIZE` 25, `LOG_PAGE_SIZE` 50) so no other page-size constant survives. Every paged `findMany` orders by its primary key(s) then `id` and clamps an out-of-range page to the last page on the server (extended, D-5, to the inventory and audit pages too). Five lists gain `skip`/`take` and `<Pagination>` (approvals, offboarding, reservations, users, deliveries), on top of the ones already paged. The employees list splits into a SQL-paged plain path and a narrow-select gaps path that reads only `id, title, departmentId` and each candidate's `HeldAssetLike` asset scalars (D-2) — never a full employee row outside the current page. The two merged timelines (asset history, employee history) gain a `?before=<ISO>&skip=<n>` cursor via a pure `mergeTimeline`, whose `skip` now accumulates across pages at the same boundary instant so a tie group longer than one page is never truncated (D-8, `timelineTake`). `groupWork` learns which Worklist sections hit their cap and renders "See all 50+"; `headcountByPolicy` replaces the policies page's full employee read with one grouped query. One additive migration, `20260908100000_scale_indexes` (17 → 18), adds seven indexes for the new orderings.

   **Why:** spec §1 — every list that can grow pages in the database with a stable order at 1000 assets and 600 employees, without changing filters, facets, sort keys, tab semantics or `Pagination`'s markup.

   **Battery, measured on the final tree `4f7b29e` (2026-09-08, after the fix wave and `D-12`):** `tsc` clean ·
   `lint` clean · **18 migrations** · **1056 unit / 58 files** · **239 e2e / 19 files** across four foreground
   chunks — **54 (3.4m) · 67 (3.9m) · 63 (4.0m) · 55 (5.9m) = 239**, zero failed, zero did-not-run. Chunk D
   (`admin`, `direct-lifecycle`, `scanner`, `registration`, `custody`, `axe-sweep`, `kitchen-sink`) first
   failed `custody` case 7 twice — a test-only race on a stale toast, `D-12` — and passed 55/55 after the
   fix. Task 9's earlier run on `c2b4c9f` (five chunks, 52 · 63 · 69 · 49 · 6 = 239, 1055 unit) is in §0
   item 9.

   Done after that battery, under the user's standing authorisation of 2026-09-08: the merge (`--no-ff`
   `aef53fa`, tree hash identical to `4f7b29e`), the push, the worktree and branch removal, and the staging
   redeploy with `scripts/deploy-staging.ps1 -Force` (migration 18 applied). What remains beyond this
   phase: the §9 stakeholder subsystems and Phase 15b depreciation as next-phase candidates.

   **(k) PHASE 18 (Purchasing: suppliers and request extensions) IS CODE-COMPLETE on
   `phase-18-purchasing-suppliers`, INCLUDING THE FINAL-REVIEW FIX WAVE (2026-09-09) — spec
   `docs/superpowers/specs/2026-09-08-purchasing-suppliers-design.md`,
   plan `docs/superpowers/plans/2026-09-08-phase-18-purchasing-suppliers.md`.** Read the plan's amendment
   banner (`D-1`…`D-19`, `D-18`/`D-19` from the fix wave) first, same rule as Phases 11–17.

   **What shipped, by spec section:** **§2** one additive migration, **19** `purchasing_suppliers` —
   `Vendor` is extended in place (registered name, category, contact, address, registration no., a
   `VendorContractStatus` enum with dates and terms, `archivedAt`) and gains `VendorBankAccount` (the
   account number encrypted with `encryptSecret`, AAD `${vendorId}:${label}`, only the last four digits
   and the label/bank/holder clear) and `VendorDocument`; `PurchaseRequest` gains `vendorId` and
   `departmentId`; `Asset.importedAt` is added and backfilled for every pre-existing asset with no
   purchase request, so provenance is never ambiguous between "predates the feature" and "no PR". **§3**
   `src/lib/supplier-access.ts` — pure predicates (`canManageSuppliers`, `canRevealBank`,
   `canAttachToRequest`) gate every write; reading a profile needs only a signed-in
   user; a bank number is never rendered server-side, only returned by an audited `revealBankAccount` call.
   **§4** a new Suppliers area under `/purchases/suppliers` — list (search, category/contract/archived
   facets), profile (contact, contract, bank accounts, documents, the requests and assets that name this
   supplier), new/edit (one zod schema shared by form and action, a duplicate name refused by name),
   import (`ImportWizard` reusing the generic header matcher, a file-level refusal for any bank column, and
   the append-only causes `bad-contract-status` / `bad-email` / `contract-dates-order` /
   `duplicate-supplier-name`), a command-palette group, and audit-log resolution for entityType `vendor`.
   **§5** every purchase request now carries a required **department** (list column and filter, including
   `department=none` for the pre-phase rows) and an optional **supplier** (a picker that never drops the
   currently-set supplier even if it is later archived, a Supplier card and list column, audit
   `supplier-set`), plus request **attachments** (`RequestDocument`, role-gated upload, a download route
   copying the asset route's guards, visible in every state including CANCELLED), and the register page
   prefilling the Vendor select from a chosen request's supplier without ever overwriting one already
   picked. **§6** asset **provenance** is derived, never stored — `PURCHASE_REQUEST` / `DIRECT` /
   `HISTORICAL` from `purchaseRequestId` and `importedAt` alone — and surfaces as an inventory facet with
   derived counts, a detail-page badge, an export/finance column, and the importer's `importedAt` stamp on
   every row it creates.

   **Why:** HANDOVER §9 items **B** (vendor / supplier master data) and **C** (purchasing workflow
   extensions) from the 2026-09-02 Admin stakeholder meeting — see the spec's own §0 for the brainstorm
   that turned those two bullet points into ten tasks.

   **Battery, measured on the branch tip `38a3b02` (2026-09-08):** `tsc` clean · `lint` clean ·
   **19 migrations** · **1110 unit / 64 files** · **258 e2e / 21 files** across four foreground chunks —
   **54 (3.4m) · 67 (3.9m) · 63 (4.0m) · 74 (8.0m) = 258**, zero failed, zero did-not-run on the recorded
   runs. Chunk A (`it-core`, `import-export`, `purchases`) first ran 53/54 — one `it-core.spec.ts` case
   failed on a fault-banner text mismatch — then passed 54/54 on an immediate re-run, and `it-core.spec.ts`
   alone passed 21/21 including that exact case: a non-reproduced failure of the documented
   cold-compile/headroom class (§7, and Phase 13's close), not a Phase 18 regression — `it-core.spec.ts`
   is untouched by this phase and this exact chunk composition already ran clean at Phase 17's close.
   Chunk D (74 tests — Phase 17's own closing chunk D plus the two new files) ran under a raised
   `--global-timeout=900000`. See plan `D` block, "Measured at close", and §0 item 9 for the chunk commands.

   **Final-review fix wave (2026-09-09, plan `D-18`/`D-19`):** the whole-branch review
   (`.superpowers/sdd/2026-09-08-phase-18-purchasing-suppliers/reviews/final-review.md`) found two
   Important findings and twelve Minors; the wave landed both Importants and eight Minors in one pass —
   **I-1** archived suppliers left the three inventory vendor pickers (`register`/`new`/`edit`), with the
   edit page and the register prefill keeping the same "never blank a real value" guard the request
   picker already had; **I-2** `storeUpload` failures in both new document actions now return
   `conflict("Could not store the file")` with nothing written; plus `archive-controls` clearing its
   error/retryAfter on reopen, `BANK_HEADER` normalising `_`/`-`/`.`/`/` and gaining an `acct`
   alternative, two stale/missing comments corrected (`bank-actions.ts`, the D-17 risk comment on the
   export route and finance query), the historical badge's spec-exact suffix, one seeded asset (BR-LT-0148)
   registered against PR-0188, the two new download routes importing the shared `UPLOAD_TYPES`, and two
   e2e assertions (`suppliers.spec.ts` case 1 name search, `purchasing-ext.spec.ts` case 6's three
   provenance labels). M-3 (edit-save stays on the form rather than redirecting) was recorded as `D-19`
   and the spec's §4.3 line reworded instead of changing the behaviour — see the plan's `D-18`/`D-19` for
   the full reasoning, cost and lesson on each, and its "minors landed vs. deferred" line for what stays
   open (M-9, M-12a, M-12b). Verify: `tsc`/`lint`/full `vitest` clean (**1113 unit / 64 files**, +3 from
   the new `BANK_HEADER` cases), the four touched e2e files 47/47 foreground, `--list` unchanged at
   **258 / 21 files**, `npm run db:seed` re-run. Report:
   `.superpowers/sdd/2026-09-08-phase-18-purchasing-suppliers/reports/final-fix-wave-report.md`.

   Done after that, on the user's instruction "1 and push to github" (2026-09-09): the full battery re-ran on
   the final tree `3298abf` (54 · 67 · 63 · 38 · 36 = 258/258 e2e, 1113 unit / 64, `tsc`/`lint` clean), then the
   merge (`--no-ff` `d4b95bb`, tree hash identical to `3298abf`), the push, and the worktree and branch
   removal. Then, on "redeploy staging", **staging was redeployed with `scripts/deploy-staging.ps1 -Force`**:
   the migrate container applied migration 19 (`20260908111902_purchasing_suppliers`, additive plus the
   `importedAt` backfill; 19 found, schema up to date), web and worker were recreated and are healthy, the
   local and LAN URLs answer 200, and `/purchases/suppliers` redirects to login when signed out. What
   remains: Purchasing's cleaned supplier list goes in through `/purchases/suppliers/import`; item D is next.

   **(l) PHASE 19 (Stock control, part D1 — the ledger core) IS CODE-COMPLETE on
   `phase-19-stock-control` — spec `docs/superpowers/specs/2026-09-09-stock-control-design.md`, plan
   `docs/superpowers/plans/2026-09-09-phase-19-stock-control.md`.** Read the plan's amendment banner
   (`D-1`…`D-30` — the final-review fix wave added `D-21`…`D-30`) first, same rule as Phases 11–18.

   **What shipped, by spec section:** **§2** one additive migration, **20** `stock_control` — six new
   models beside the asset register (`StockCategory`, `StockItem`, `StockLot`, `StockMovement`,
   `Stocktake`, `StocktakeLine`), two enums (`StockMovementKind`, `StocktakeState`) and a
   `stocktake_ref_seq` sequence; every balance is derived (`SUM(quantity)` via one grouped query per
   page/item, never a stored column); `StockMovement` is append-only — the trigger
   `stock_movement_append_only` calls the same `forbid_mutation()` function the asset/approval tables
   already use — and two check constraints enforce sign by kind (`stock_movement_quantity_sign`:
   OPENING/RECEIPT positive, ISSUE negative, ADJUSTMENT nonzero) and a positive lot quantity
   (`stock_lot_quantity_positive`). **§3** `src/lib/stock-access.ts` — `canManageStock` gates every write
   to `admin`/`purchasing_staff`; every signed-in role reads; `PATH_RULES` gains the four `/stock`
   write-route patterns ahead of any generic rule, plus a Stock section in the Purchasing nav and one
   Finance read link. **§4** pure rules in `src/lib`: stock codes (`stock-code.ts`, codes parse at
   four-or-more digits per R1), balances and the low flag (`stock-balance.ts`, plus the pack-to-units
   conversion and `unitsLabel`'s pluralisation, R8), the list where-builder and sortable-by-code/name
   config (`stock-list.ts`), movement sign and issue-guard rules (`stock-movement-rules.ts`), the
   stocktake post plan (`stocktake.ts`), and the zod schemas for every action boundary. **§5** the server
   module `src/server/modules/stock/` — paged items with one grouped-balance query, a narrow-select
   candidate pass for the Low filter (the employees-gaps pattern), item detail with paged history;
   category and item creation under a counter `UPDATE … RETURNING` that serialises concurrent code
   assignment; receive (lots + pack conversion), issue (a row lock, an over-issue refusal naming exactly
   how much is left), adjust (delta or set-to, under the same lock); stocktakes — open (one OPEN per
   scope), count (one line per save, no batch, P-3), post (re-reads current balances under lock, writes
   one ADJUSTMENT per real variance, skips uncounted, rolls back a mid-transaction refusal by throwing
   rather than returning, D-5), cancel; a balances export and a palette/audit-resolver hookup. **§6** a
   spreadsheet importer at `/stock/import` — `planStockImport`/`applyStockImport` through the shared
   `ImportWizard`, matching a code to an existing item for UPDATE or minting the next series code for
   CREATE, new block causes (`unknown-stock-category`, `bad-stock-code`, `bad-unit`,
   `opening-on-existing`, plus the missing-required fix from D-11), a `unitCost` column accepted but
   ignored on opening rows with its own notice, `.xlsx` fixtures generated the same way every other
   importer's are (P-2). **§7** the Stock area under `/stock` — the items list (search, category facet, a
   Low-stock toggle, an Export link), item detail (balance, history, an adjust dialog), new/edit forms,
   Receive and Issue forms (the pack helper, the on-hand line, an over-issue banner), the Stocktakes
   list/new/count/review/post/cancel flow (a genuinely blind count screen — no book quantity anywhere in
   its table, D-12), and a Categories page with inline create/rename and prefix-locked-once-used
   protection.

   **The final-review fix wave landed** (`D-21`…`D-30`, commit `4c4eb94`, docs `0910dc4`; ruling R14 then
   closed `D-29`'s cancel-after-post hazard inside `cancelStocktake`, and the wave's re-review minors — the
   action-count wording and a frozen-review assertion in `stocktake.spec.ts` case 4 — landed in `a185729`,
   the tested tip): every in-transaction refusal in
   `movement-actions.ts` now throws the module's `ActionFailure` instead of returning from inside
   `$transaction` (I-1); `openStocktake` serialises its one-open-per-scope check behind a transaction-scoped
   Postgres advisory lock (`pg_advisory_xact_lock` via `$executeRaw` — `$queryRaw` cannot deserialize its
   `void` result, a runtime-only bug the e2e run caught, D-22) (I-2); `countStocktakeLine` and
   `postStocktake` both lock the `Stocktake` row `FOR UPDATE` first and re-read state/lines under that lock,
   so a count can no longer land on a stocktake mid-post with no adjustment and no refusal (I-3); a
   POSTED/CANCELLED review is now a frozen record — `getStocktake` loads the stocktake's own posted
   `ADJUSTMENT` movements instead of a live balance, a new `postedReviewRows()` (`lib/stocktake.ts`, tested)
   renders Book/Counted/Adjustment with a link to every adjusted item, and the OPEN review is untouched
   (I-4); the balances export's plain branch now honours the requested sort (M-1); three stale "Unit cost
   not matched" comments were corrected and the now-dead `STOCK_KNOWN_UNIMPORTED_COLUMNS` emptied (M-2);
   `auditSentence` gained one case per stock/stocktake action instead of the raw-verb default (M-3, 14
   cases against what the code actually writes, not the review's own "twelve"). Eight further Minor items
   and the pre-existing deferred-minor triage stay deferred, per the review's own recommendation — see plan
   D-30.

   **Why:** HANDOVER §9 item **D** (consumables and stock control) — the first half, D1: items, the
   ledger, derived balances, stocktake, import. D2 (FIFO costing, expiry, reports) is deliberately out of
   scope; the lots this phase records are what D2 will consume oldest-first.

   **Battery at Task 9's close, branch tip `2f26ac1` (2026-09-09):** `tsc` clean · `lint` clean ·
   **20 migrations** · **1212 unit / 72 files** · **275 e2e / 23 files** across five foreground chunks,
   `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **54 (3.3m) · 67 (3.9m) · 63 (4.0m) · 38 (2.6m) ·
   53 (7.3m) = 275**, zero failed, zero did-not-run on the first pass of every chunk — no re-run was
   needed anywhere in the battery. Two new e2e files, `stock.spec.ts` (11 cases) and `stocktake.spec.ts`
   (6 cases); no pre-existing e2e spec file changed — the only pre-existing e2e file touched was the
   shared fixture helper `e2e/fixtures/make.ts` (plan P-2's export/import-template columns and two new
   fixtures, `stock-clean.xlsx`/`stock-mixed.xlsx`).

   **Battery after the final-review fix wave (2026-09-09; the whole battery then re-ran on the final tree `a185729` — 54 · 67 · 63 · 38 · 53 = 275/275, see the header):** `tsc` clean · `lint`
   clean · **20 migrations** (unchanged) · **1224 unit / 72 files** (12 new: 2 for `postedReviewRows`, 10
   for the fourteen new `auditSentence` cases, both RED before the fix and GREEN after) ·
   `E2E_PORT=3100 npx playwright test e2e/stock.spec.ts e2e/stocktake.spec.ts --workers=1
   --global-timeout=540000` → **17/17 passed (1.6m)**, zero failed, zero did-not-run (port 3100 free before
   and after) · `npx playwright test --list` → **275 e2e / 23 files**, unchanged. `npm run db:seed` run
   last, clean. See plan `D-1`…`D-30`, "Measured at close of the final-review fix wave", and §0 item 9 for
   the chunk commands.

   **Done after that, on the user's "Merge to main and push to GitHub" (2026-09-10): the merge (`--no-ff`
   `d311e26`, tree hash identical to the tested tip), the push, and the worktree and branch removal.
   Staging is NOT yet redeployed — migration 20 (`stock_control`: six tables, the append-only trigger, sign
   checks, `stocktake_ref_seq`) applies at the next `scripts/deploy-staging.ps1 -Force`. What remains: that
   redeploy; D2 (FIFO costing, expiry, reports) is next; Purchasing's opening stock goes in through
   `/stock/import`.**

   **(m) PHASE 20 (IT side: department transfers, offboarding attribution and facets, directory quality,
   six known gaps) IS CODE-COMPLETE on `phase-20-it-people-and-gaps` — spec
   `docs/superpowers/specs/2026-09-10-it-people-and-gaps-design.md`, plan
   `docs/superpowers/plans/2026-09-10-phase-20-it-people-and-gaps.md`.** Read the plan's amendment banner
   (`D-1`…`D-30`; the final-review fix wave added `D-23`…`D-29`, the final battery `D-30`) first, same rule
   as Phases 11–19.

   **What shipped, by spec section:** **§2** one additive migration, **21** `employee_transfers` — one new
   model, `EmployeeTransfer` (from/to department and title, effective date, reason, actor), sitting beside
   the existing tables with no other schema change; the employee row updates in the same transaction a
   transfer writes, so a wrong transfer is corrected by recording another one, never edited or deleted;
   seed adds one transfer for `EMP-0099` (HR → Operations, 90 days ago, title unchanged). **§3**
   `transferEmployee` (`admin`/`it_staff` only): zod refuses the same department ("Already in this
   department"), a future effective date ("That date is in the future"), and an OFFBOARDED employee ("A
   leaver cannot be transferred"); one transaction writes the transfer row, updates
   `Employee.departmentId`/`title`, and audits `employee.transferred`. A **Transfer** button on the
   employee page header opens the dialog; a "Transferred from HR on 12 Jun 2026" line shows under the
   department line while the newest transfer is within 90 days; an unpaged **Transfers** card lists every
   transfer newest-first; transfers join `mergeTimeline` as a fourth source. The edit form drops its
   Department select entirely — one path for one fact — with a hint linking to Transfer; the loadout
   re-evaluates on its own because `resolvePolicy` reads the employee's current department. **§4** every
   `ApprovalLike`/`Decision` now carries `decidedBy`/`decidedAt` (the executing approval's claimer and
   resolved time, both null while PENDING); the wizard's Review and step-4 tables, the printable farewell
   report and `FAREWELL_EXPORT_COLUMNS` all show "Decided by"/"Decided on". `OFFBOARDING_LIST_CONFIG` adds
   Department and Progress facets and sortable columns (name/started/undecided); `progress`
   (`undecided > 0` → "open", else "complete", relabelled client-side as "Has undecided items"/"All
   decided") and the undecided sort are both computed over the OFFBOARDING candidate set — bounded by how
   many people are mid-offboarding at once, never the whole roster — then the kept ids are paged, the same
   discipline the employees-gaps filter already uses. **§5** `findSameName` blocks a same-name-same-
   department create behind a deliberate "This is a different person" confirm, and an import row behind
   the new cause `same-name-in-department` (fix option `allowSameName`); `/employees` excludes OFFBOARDED
   from the default view unless an explicit `employment` facet or the new "Show leavers" toggle
   (`leavers=1`) says otherwise — the `employment` facet itself still offers OFFBOARDED; every employee
   page gets an **Export holdings** link (`GET /employees/[id]/holdings`, one `.xlsx` sheet: held assets,
   then a blank row, then a "Reservations" block). **§6**, the six recorded gaps: `bulkChangeStatus` now
   returns `{ changed, skipped }` with named reasons and the bulk drawer renders the skipped list like
   `bulkAssign` already does; `checkIdentifiers({ tags, serials, cls })` queries `where: { cls }` only, so
   the register and single-asset forms' live hint never leaks a same-tag/serial existence check across
   IT/Purchasing (a genuine cross-class collision still surfaces as the pre-existing neutral P2002 conflict
   copy at submit); `computeLoadout` marks a standard slot left empty by a remaining `TEMPORARY` device of
   its type `coveredByLoan` — excluded from `missingRequired`, the tile reads "on loan" instead of "policy
   gap"; the Replace picker's spare options carry "Same type"/"Other spare" notes even when the list is all
   one kind; the asset record header shows "Last change: `<sentence>` · `<date>` · by `<actor>`" from the
   newest `lifecycle.*`-or-`register` audit entry whenever nothing is pending; `repairStageIds` now runs
   the stage rules as one raw-SQL `CASE` scoped by class and the repair candidate predicate, intersected
   with the Prisma-side candidate ids when other filters are active — a 12-row unit fixture proves the JS
   rule and an e2e parity check (`it-gaps.spec.ts` case 6) proves the SQL cut agrees with it over every
   seeded asset, since vitest has no database (plan P-1).

   **Why:** the user's own pick after Phase 19 closed — "the IT side first"
   (`docs/HANDOVER-PENDING.md` §6, 2026-09-10) — a routine HR event that had no record before (transfers),
   an accountability gap on decisions already stored but never shown (Phase 9, HANDOVER §8), directory
   hygiene the user asked for by name, and the six gaps this phase's own spec §0 decision 7 pulled from
   PICKUP §5 and HANDOVER §8.

   **Battery at Task 9's close, branch tip `f6ec5e1` (2026-09-10):** `tsc` clean · `lint` clean ·
   **21 migrations** · **1291 unit / 75 files** · **296 e2e / 27 files** by `--list`, across six foreground
   chunks (kept ≤ 70 tests each), `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 (3.3m) · B
   67 (3.9m) · C 68 (4.4m) · D 38 (2.6m) · E 53 (7.3m) · F 21 (2.0m)** (chunks C and F both include
   `offboarding-v2.spec.ts`'s 5 cases by the brief's own chunk lists, so the six totals sum to 301 against
   296 unique), zero failed, zero did-not-run on the runs recorded below. Four test-only fixes, every one
   found re-running a chunk whose first pass failed on a case this phase's own behaviour change made
   stale — none a regression:
   - **Chunk A**, first pass **53 passed, 1 failed**: `it-core.spec.ts`'s "list shows loadout gaps" case
     expected Marites Bautista's row at "2 missing"; gap 3's `coveredByLoan` now excuses her loan-covered
     phone slot, so the true count is 1. Reproduced on an immediate re-run; fixed by updating the
     expectation and its comment (`fe4295c`); chunk re-ran **54/54**.
   - **Chunk C**, first pass **61 passed, 1 failed, 6 did not run** (`paging.spec.ts` is
     `test.describe.serial`, so the one failure skipped cases 7–12 behind it): case 6's
     `db.employee.count()` counted the fixture's base-seed OFFBOARDED employee (Faith Mercado, EMP-0093)
     that §5's leavers-hidden default now excludes from the `/employees` toolbar. Reproduced on an
     immediate re-run; fixed by scoping the count to `employment: { not: "OFFBOARDED" }` to match the
     page's own query (`63df64a`); chunk re-ran **68/68**.
   - **Chunk D**, first pass **33 passed, 1 failed, 4 did not run** (`registration.spec.ts` is also
     `test.describe.serial`): case 3 filled Serial with no Category chosen, but gap 2's class-scoped
     `checkIdentifiers` now skips the live check entirely until a category names the class (a
     category-less guess could flag a collision that only exists in the OTHER class). Reproduced on an
     immediate re-run; fixed by choosing Laptop first (`0b463b1`). The full-chunk re-run then surfaced a
     **second**, previously-masked failure in the same serial block: case 5 stamped its collision serial
     onto `BR-LT-0166` (IT class) while registering a Vehicle (Purchasing class) batch as Purchasing — a
     cross-class match that is exactly the leak gap 2 closed, so it stopped colliding. Fixed by stamping
     the serial onto `BR-VH-0002` (STORED, unassigned) instead, matching the batch's own class
     (`f6ec5e1`); chunk re-ran **38/38**.
   - Chunks **B**, **E** and **F** passed clean on the first try — **67/67**, **53/53**, **21/21**.

   `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk,
   between any two chunks, or after the last, and no node process was left running. See plan `D-1`…`D-30`
   and §0 item 9 for the chunk commands.

   **What the final review found and the wave fixed** (`D-23`…`D-29`; final whole-branch review, read-only
   on `94b8466..2641af5`, Approve with fixes — 0 Critical, 5 Important, 11 Minor; one fix wave, rulings
   R14/R15): I-1 was already fixed by Task 9's own battery (`63df64a`) before the review reported it. The
   employment facet's `OFFBOARDED (n)` count read 0 by default because its `groupBy` ran under the
   leavers-hidden `where`; that one groupBy now forces the leavers toggle on, so it counts all three
   employment values as spec §5 requires (`directory.spec.ts` case 3 asserts it; `f001cfb`, I-2). `it-
   gaps.spec.ts` case 6 previously compared JS against JS; it now runs `REPAIR_STAGE_CASE_SQL` through
   `$queryRaw` and asserts the SQL stage equals `repairStage()` per seeded IT asset — the parity proof spec
   §6.6/P-1 promised (`87dd879`, I-3). Two overlapping transfers could both record `from = A` on the
   append-only `EmployeeTransfer` table; `transferEmployee`'s employee write is now conditional on the
   department it read (`updateMany` by id + `departmentId`), and a zero-row match throws so the loser of
   the race gets "Someone else just transferred this person — reload and try again." instead of a silently
   wrong record (`4b97cbd`, I-4). An employee-import UPDATE row could still move a department with no
   `EmployeeTransfer` row, against spec §0 decision 3's "one path for one fact"; resolved like `employment-
   via-import` with a new block cause `department-via-import` and the option `keepCurrentDepartment`
   (ruling R15; unit total 1291 → 1295) (`3910991`, I-5). Transfer reads now select `actor.name` only
   instead of the whole `User` row (`4d54382`, M-3, rode along). Eleven parked Minors — display-only facet
   shapes, a stable-sort tiebreak, cosmetic re-reads and the like — stay deferred per the review's own
   recommendation; see plan `D-29`.

   **Battery after the final-review fix wave, final tree `4d54382` (2026-09-10; the whole battery then
   re-ran on this tree, see §0 item 9):** `tsc` clean · `lint` clean · **21 migrations** (unchanged) ·
   **1295 unit / 75 files** (4 new: 3 planner cases plus 1 vocabulary totality case for `department-via-
   import`) · **296 e2e / 27 files** by `--list` (unchanged) — six foreground chunks with explicit file
   paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 (3.4m) · B 67 (3.8m) · C 63 (4.0m) ·
   D 38 (2.6m) · E 53 (7.3m) · F 21 (2.0m) = 296**, zero failed, zero did-not-run. Chunk A's first pass was
   53 + 1 failed (`it-core.spec.ts:302`, a `toBeVisible` 5 s timeout) and passed 54/54 on the immediate
   as-is re-run — the cold-compile/headroom class §7 documents, not a regression; no test or product code
   was touched. `npm run db:seed` ran last, clean. See plan `D-1`…`D-30`, "Measured at close", and §0 item 9
   for the chunk commands.

   **What remained at close — merge, push and the staging redeploy — was done on 2026-09-10 (merge `e48b457`, pushed, staging redeployed with migrations 20 and 21);
   `docs/HANDOVER-PENDING.md` holds the parked work.**

   **(n) PHASE 21 (Approvals oversight: direct IT changes made visible, plus five correctness and quality
   items) IS CODE-COMPLETE on `phase-21-approvals-oversight` — spec
   `docs/superpowers/specs/2026-09-14-approvals-oversight-design.md`, plan
   `docs/superpowers/plans/2026-09-14-phase-21-approvals-oversight.md`.** Read the plan's amendment banner
   (`D-1`…`D-16` — the final-review fix wave added `D-11`…`D-13`, the final battery `D-15` and `D-16`)
   first, same rule as Phases 11–20.

   **What shipped, by spec section:** **§2** one additive migration, **22** `approval_applied_directly` —
   `Approval.appliedDirectly` (default false, indexed with `resolvedAt`), set by `createApproval` at write
   time (`input.executed !== undefined`) and backfilled once for every already-EXECUTED row whose
   `claimedAt` equals its `resolvedAt` (the one instant a direct write, not a worker, produces); the seed
   adds three direct rows (`APR-2036`/`2037`/`2038`) so the fresh-seed Closed count moves from 2 to 5.
   **§3** `src/lib/approvals-list.ts` gains `CLOSED_VIA`/`parseVia`/`viaWhere`/`CLOSED_VIA_LABEL` and
   `DIRECT_WINDOW_DAYS`/`DIRECT_KIND_LABEL`; `listApprovals` takes a `via` alongside `tab` and marks each row
   `direct: boolean`; a `role="group" aria-label="Closed by route"` chip row (`All`/`Applied directly`/
   `Through the queue`, with counts) appears on the Closed tab only, the active chip carrying
   `aria-current="true"`, and only the chips' own hrefs carry `via` — the tab links and pagination links to
   other tabs never do; a direct row's State cell carries a `DIRECT` pill; the detail page of a direct row
   swaps "What the system checked" for "How it was applied" (who, when, a link to the asset's history) and
   drops the "requested by"/SLA lines a direct change never had. **§4** an admin-only Home section, "Applied
   directly · last 7 days" (`directChanges`, two `groupBy`s over `{ appliedDirectly: true, resolvedAt: {
   gte: since } }`, by kind and by actor, count desc then label/name), rendered on both landings an admin can
   reach — the admin branch and the IT branch's default landing — behind the same focus toggle the IT
   branch already had (`SHOWS_FOCUS_TOGGLE.admin` flips to `true`, the one-word change a Phase 6 comment had
   reserved); and `worklist(..., { excludeOwnClaims })`, which Home alone passes, so an SLA-breached row the
   viewer has already claimed shows once, in "Claimed by you", not a second time in the Worklist's queue
   section — `/inventory/work` is unchanged. **§5** `pagedSnapshot(size, requested, count, rows, client?)` —
   one `RepeatableRead` transaction reading a list's total and its page from one snapshot — adopted by the
   twelve lists the plan named (approvals, audit, admin users, webhook deliveries, purchases, suppliers,
   stock items, stocktakes, employees, inventory, reservations, asset history) plus three further groups
   spec §5 also required that the plan's own list had omitted (finance assets with its cost aggregate, the
   offboarding plain branch, and the four activity pages), closing Phase 17's deferred "count then fetch
   can shift" note for every list in scope; in-memory paths (repair stage, gaps, derived offboarding
   progress, cursor timelines) stayed out of scope by the same spec section — **Phase 24 then closed the
   repair-stage one: `listAssets` pages `repairStageIds`' SQL id set through `pagedSnapshot`, so the
   repairs view is a normal count/skip/take list; gaps, derived offboarding progress and the cursor
   timelines are still the in-memory paths that sentence names** — and facet queries beside a list
   now run after the snapshot rather than alongside it. **§6** `src/lib/reason.ts` — `cleanReason` strips
   Unicode format (`\p{Cf}`) and control (`\p{Cc}`) characters, including zero-width space/joiner, before
   trimming; `reasonRequired`/`reasonOptional` wrap it with zod 4's `.overwrite()` so the cleaned value is
   what every length check runs against, and every reason field in the app — approvals, employees,
   exceptions, inventory, offboarding, purchases, stock, transfers, lifecycle — now goes through one of the
   two, each site keeping its own min/max/message. **§7** the axe sweep's four tolerated rules
   (`empty-table-header`, `page-has-heading-one`, `heading-order`, `landmark-unique` — tolerated since
   Phase 10, tallied 12/2/1/1 by the time this phase measured them) are attributed to their root causes,
   fixed, and promoted to `PROMOTED_RULES` (failing regardless of impact); `AXE_DETAIL=1` now prints
   per-node detail for whatever the sweep still counts. **§8**
   `e2e/rate-limit.spec.ts` proves the rate limiter end to end for the first time: a mutation cap (60
   `RateEvent` rows) blocks a status change with `RateLimitNotice`'s default message and leaves the DB
   untouched, and an import cap (10 rows) blocks an employee import with the importer's own message,
   verified against its source text.

   **Why:** the post-Phase-20 IT survey's approvals-visibility cluster — Phase 15 (§2.5) chose "applies now,
   no pending row" deliberately for a direct IT change, and the gap that left was oversight, not a missing
   queue entry (`docs/HANDOVER-PENDING.md` §6, 2026-09-10); alongside it, four small correctness and quality
   items already on record — the "possible approvals double-count" and the "count then fetch can shift"
   note Phase 17's final review left undecided, a three-character reason minimum that accepted invisible
   characters (recorded in HANDOVER §8 since Phase 7), and the axe sweep's four-rule tail that has sat
   unchanged since Phase 10 — plus first coverage for a rate limiter no spec in the suite had ever seen
   render.

   **Battery, last run 2026-09-14 on the final tree `562587f`:** `tsc` clean · `lint` clean · **22
   migrations**, schema up to date · **1312 unit / 77 files** · **305 e2e / 29 files** by `--list`, across
   six foreground chunks with explicit file paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000` —
   **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.4m)
   · F 30 passed (3.3m) = 305**, zero failed, zero did-not-run, no re-run needed anywhere in the battery.
   Two pre-existing e2e files changed this phase: `e2e/approvals-audit.spec.ts` (Task 1, the fresh-seed
   Closed count moved from 2 to 5) and `e2e/axe-sweep.spec.ts` (Task 6, the four promoted rules). `npm run
   db:seed` ran last, clean; port 3100 carried no listening process before the first chunk, between any two
   chunks, or after the last. See plan `D-1`…`D-16`, "Measured at close", and §0 item 9 for the chunk
   commands.

   **What the final review found and the wave fixed** (`D-11`…`D-13`; final whole-branch review, read-only
   on `8817488..562587f`, Approve with fixes — 0 Critical, 2 Important, 5 Minor; one fix wave, ruling R6):
   `cleanReason`'s `\p{Cc}` strip was deleting tab, LF and CR along with every other control character, so
   a multi-line textarea reason (routine — thirteen dialogs use one) was glued into one sentence with no
   separator and no way to recover the original text; the strip now exempts `\t`/`\n`/`\r` and `.trim()`
   still refuses a whitespace-plus-zero-width-only reason (`D-11`). `pagedSnapshot` inherited Prisma's
   2 s `maxWait` / 5 s `timeout` on all eighteen adopted lists, which now each pin one pooled connection for
   the whole count-then-page window — a burst on a small pool would 500 with `P2024` and a slow list on a
   cold database would 500 at 5 s where it used to just render slowly; the helper now names its own budgets,
   `PAGED_MAX_WAIT_MS = 10_000` / `PAGED_TIMEOUT_MS = 20_000` (`D-12`). Five Minors were parked with rulings
   — a `byActor` key collision that needs a spec amendment, a redundant COUNT, a trivial test-quality gap,
   a cosmetic import split, and an already-ruled serial-facet-query ordering — see plan `D-13`. Commit
   `b6b4e2a`.

   **The battery re-ran on the final tree, twice** (`D-15`, `D-16`; ruling R7): the full six-chunk battery
   on `b6b4e2a` passed chunks A–E clean but failed chunk F at 01:00 Manila — `transfers.spec.ts` case 1,
   25 passed/1 failed/4 did not run (`test.describe.serial` skipped the rest), reproduced identically on an
   immediate as-is re-run. Cause: the Transfer dialog defaulted its effective date to the UTC calendar date
   (`toISOString`) and the schema's "not in the future" check compared against UTC today too, so between
   00:00 and 08:00 Manila a transfer was recorded on yesterday's date while the test's own expectation
   (`fmtDate`, Asia/Manila) read today — Phase 20's parked M-5, now proven a real defect for local users.
   Fixed in product code: a shared `localDateISO(now)` in `src/lib/format.ts` (the Asia/Manila calendar
   date) is what the dialog defaults to and caps at and what the schema calls today; `isRecentTransfer`
   gains a one-day grace below zero, since a same-day transfer stored as UTC midnight sits up to eight hours
   ahead of `now`; `transfers.spec.ts` case 4's own "tomorrow" now computes on the same calendar. Commit
   `2ae8738`.

   **Battery, final run 2026-09-15 on the final tree `2ae8738`:** `tsc` clean · `lint` clean · **22
   migrations**, schema up to date · **1317 unit / 77 files** · **305 e2e / 29 files** by `--list`, across
   six foreground chunks with explicit file paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000` —
   **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.6m) · E 53 passed (7.4m)
   · F 30 passed (3.2m) = 305**, zero failed, zero did-not-run, all first pass, no fix commits this run —
   `transfers.spec.ts` itself passed clean, all 5 tests. A third pre-existing e2e file changed after Task
   8's close: `e2e/transfers.spec.ts` (ruling R7, plan `D-15` — case 4's "tomorrow" now computed on the
   Asia/Manila calendar; no case added or removed, 305/29 unchanged). `npm run db:seed` ran last, clean;
   port 3100 carried no listening process before the first chunk, between any two chunks, or after the
   last. See plan `D-11`…`D-16`, "Measured at close", and §0 item 9 for the chunk commands.

   **Merged and pushed 2026-09-15 (`b716767`); staging redeployed the same day with `-Force` (migration 22 applied, web healthy); nothing remains for this phase;
   `docs/HANDOVER-PENDING.md` holds the parked work.**

   **(o) PHASE 22 (Stock control D2: FIFO lots and costing, expiry, reports, receipt documents) IS
   MERGED TO `main` via `--no-ff` `26aaf82` AND PUSHED (2026-09-16; branch and worktree removed; staging
   redeployed 2026-09-17 with `-Force`, migration 23 applied) — spec
   `docs/superpowers/specs/2026-09-16-stock-control-d2-design.md`, plan
   `docs/superpowers/plans/2026-09-16-phase-22-stock-control-d2.md`.** Read the plan's amendment banner
   (`D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`) first, same
   rule as Phases 11–21.

   **What shipped, by spec section:** **§2** one additive migration, **23**
   `stock_lots_and_allocations` — `StockLot` gains `expiresAt DateTime?` and `origin StockLotOrigin`
   (`RECEIPT`/`OPENING`/`ADJUSTMENT`); the new append-only `StockAllocation` table (movement → lot,
   quantity, guarded by a trigger and a CHECK so an edit is a loud database error) is the only source of
   a lot's remaining quantity, which is never stored; a new `StockLotDocument` mirrors `AssetDocument`.
   The migration's own plpgsql backfill walks every item's history — a lot for every D1 inflow that had
   none, allocations for every outflow, two passes per movement (lots dated on or before the movement
   first, any remainder from the rest) — and asserts the result before committing: every negative
   movement's allocations sum to `-quantity`, every positive movement has a lot, and Σ remaining equals
   the balance for every item; verified 0 failures over 25 movements / 19 lots on `inventory_dev`, and
   `PN-0001`'s D1 history replays as plain FIFO by lot date. **§3** the three report pages and the
   lot-document download route join the Purchasing workspace's Stock section; `WORKSPACE_NAV` gains a
   `Reports` entry, and the command palette's Stock group (unchanged as a search over items) reaches the
   reports through that nav entry (ruling R2). **§4–§5** `stock-allocation.ts`'s `allocate()` is the one
   function every consumer calls: FIFO by lot date, undated lots last, an "expired skipped" policy for
   issues and an "expired first" policy for write-offs/adjustments, a null cost when only uncosted lots
   are drawn from, `expiryLabel` on the Asia/Manila calendar. `ledger.ts`'s `recordOutflow`/
   `recordInflowLot` are the only writers of allocations and non-receipt lots — issue, adjust, write-off
   and stocktake posting all route through them, and so does the importer's opening stock; `writeOffLot`
   refuses an expired-units shortfall by name (`Only N unexpired {unit} of {code} — write off the expired
   lot first`) and a plain over-issue with D1's own message; `setLotCost` refuses a lot that already has
   one (`This lot already has a cost`); lot documents attach and download through a role-gated pair
   mirroring the request-document one. **§6** the item page's Lots card (write-off, set-cost and attach
   dialogs; History gains a Cost column); the receive form's `Expires` field; the `/stock` list's
   `EXPIRING`/`EXPIRED` pill, "Show expiring only" toggle and stat line; three report pages under
   `/stock/reports` — on hand and value (category subtotals, an uncosted toggle), consumption by
   department and month (a grid, a flat export), and expiring/expired lots (window chips, wired to the
   real write-off dialog) — each with an xlsx export; two Purchasing Home tiles, "Below reorder level"
   and "Expiring within 30 days". **§8** all six D1 leftovers close here: the importer refuses an
   archived category (planner and apply path) and closes its two-key duplicate check; the unused
   `SupplierOption.archived` prop, `stocktake-review.tsx`'s redundant `state === "OPEN"` re-check, and
   `stocktake-count.tsx`'s always-true `canCount` prop are all removed; the import's unit cost is
   honoured on CREATE rows and the "Unit cost is ignored" notice removed.

   **Why:** HANDOVER §9 item **D**'s second half — D1 (Phase 19) recorded items, categories and an
   append-only ledger with balances always derived, but left FIFO costing, expiry and reporting for D2
   (spec `2026-09-09-stock-control-design.md` §1 "Out"); the D1 brainstorm's own note that "D2 will
   consume lots oldest-first" is decision 2 here. Requisitions, the one open question D1 parked, were
   decided no in this phase's own brainstorm (2026-09-16) — nobody has used the ledger on staging yet, so
   there is no evidence for a request lifecycle; revisit only if Purchasing asks after using it.

   **Battery, last run 2026-09-16 on the final tree `dfb1a0f`:** `tsc` clean · `lint` clean · **23
   migrations**, schema up to date · **1404 unit / 79 files** · **319 e2e / 31 files** by `--list`,
   across seven foreground chunks with explicit file paths (chunk E split into E1/E2 per spec §9.3, since
   the combined chunk would have carried 67 tests), `E2E_PORT=3100 --workers=1 --global-timeout=540000`
   — **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.7m) · E1 36 passed
   (5.6m) · E2 31 passed (3.0m) · F 30 passed (3.2m) = 319**, zero failed, zero did-not-run, all first
   pass, no fix commits anywhere in the battery. Two new e2e files, `stock-lots.spec.ts` (8 cases) and
   `stock-reports.spec.ts` (6 cases); no pre-existing e2e spec file changed this phase. `npm run db:seed`
   ran last, clean; port 3100 carried no listening process before the first chunk, between any two
   chunks, or after the last. See plan `D-1`…`D-20`, "Measured at close", and §0 item 9 for the chunk
   commands.

   **What the final review found and the wave fixed** (`D-16`…`D-19`; final whole-branch review, read-only
   on `0c4d103..dfb1a0f`, Approve with fixes — 0 Critical, 2 Important, 6 Minor; one fix wave): the expiry
   report's `computeExpiryLots` counted every dated lot with units remaining, archived items included,
   while the Home tile (`stockHomeSignals`) and the on-hand report both already excluded them — archiving
   an item with an expiring lot made the tile read 0 while the report it links to still listed the lot with
   a live Write off button; the expiry report and its export now exclude archived items too (`D-16`). The
   importer's opening-stock inflow (added beyond the brief in D-9) never revalidated the three report
   pages, the same omission R6 had already fixed in the other two writers; the six revalidation calls now
   live in one shared `revalidateStockReads` helper beside `ledger.ts` that every stock writer calls
   (`D-17`). The expired-shortfall advice ("write off the expired lot first") fired under the `"first"`
   policy too, where the expired units were already consumed and the advice was a no-op, and `expiryLabel`
   rendered "1 days"; both are fixed (`D-18`). Four further Minors were parked with rulings — see plan
   `D-19`. Commit `2eeabf7`; the fix-wave re-review found all four addressed, 0 new findings.

   **Battery, final run 2026-09-16 on the final tree `a4b57b5`:** `tsc` clean · `lint` clean · **23
   migrations**, schema up to date · **1404 unit / 79 files** · **319 e2e / 31 files** by `--list`, across
   seven foreground chunks with explicit file paths, `E2E_PORT=3100 --workers=1 --global-timeout=540000` —
   **A 54 passed (3.3m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E1 36 passed
   (5.7m) · E2 31 passed (3.1m) · F 30 passed (3.3m) = 319**, zero failed, zero did-not-run. Chunk A's
   first pass on `2eeabf7` was 53 passed, 1 failed (`e2e/it-core.spec.ts:302`, the documents-upload
   PNG-rejection case, a `toBeVisible` 5 s timeout), reproduced identically on an immediate as-is re-run —
   not the cold-compile/headroom class, since `2eeabf7` touches none of the files this case exercises.
   Diagnosis: `setInputFiles` fires its native `change` event the instant the server-rendered `<input>`
   exists, before React's delegated `onChange` is wired up on a freshly-navigated page; the file's own
   `waitForHydration()` helper (already guarding one call site) was never wired to this test's upload call.
   Fixed test-only — `await waitForHydration(page.getByLabel("Upload document"));` before the first
   `setInputFiles()` — verified in isolation, then chunk A re-ran 54/54 clean (3.3m). Commit `a4b57b5`.
   `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first chunk,
   between any two chunks, or after the last. See plan `D-16`…`D-20`, "Measured at close", and §0 item 9
   for the chunk commands.

   **What remains: merging to `main`, pushing, and the staging redeploy are the user's decisions, not
   pre-authorised — migration 23's backfill asserts itself, so it either applies cleanly or the deploy
   fails loudly; `docs/HANDOVER-PENDING.md` §5.1 is shipped and its requisition question decided no.**

   **(p) PHASE 23 (Parkinson sweep: quick forms and complete-by dates) IS MERGED TO `main`
   via `--no-ff` `18228b0` AND PUSHED (2026-09-17; final tree `09bf0a5`; branch and worktree removed;
   staging redeployed the same day with `-Force`, migration 24 applied) — spec
   `docs/superpowers/specs/2026-09-17-parkinson-sweep-design.md`, plan
   `docs/superpowers/plans/2026-09-17-phase-23-parkinson-sweep.md`.** Read the plan's amendment banner
   (`D-1`…`D-20` — the final-review fix wave added `D-16`…`D-19`, the final battery `D-20`) first, same
   rule as Phases 11–22.

   **What shipped, by spec section:** the phase takes both readings of Parkinson's Law at once (spec §0
   decisions 1 and 3): shrink the time a task takes, *and* put a clock on the two pieces of work that
   had none. **§2** one additive migration, **24** `parkinson_deadlines` — `Employee.offboardingDueAt
   DateTime?` and `Stocktake.dueAt DateTime NOT NULL`, each added nullable, backfilled by a plain
   `IS NULL`-guarded `UPDATE` (every OFFBOARDING employee gets `offboardingAt + 7` calendar days, which
   is exactly 5 working days from any weekday start; every stocktake gets `openedAt + 3` days), then
   `SET NOT NULL` on the stocktake column. A backfilled date may already be in the past and is shown
   overdue, which is the truthful reading (decision 4). **§4** three new pure modules with their tests
   first — `deadlines.ts` (working days Mon–Fri, defaults 5 wd / 3 d, the two floors, `dueStatus`,
   `isPastDue`, `offboardingCompletionText`), `reason-chips.ts` (one reviewable list per site, plus
   `chipsForOutcome`) and `recent-picks.ts` (`pushRecent`/`recentOptions`/`parseRecent`) — and
   `worklist.ts`'s `leaverRow`, the offboarding `due` facet and sort, and `stocktakeOpenSchema.dueAt`.
   **§5** the employee form and the importer resolve `offboardingDueAt` on every OFFBOARDING entry so
   the change lands in the existing `update` audit with old and new values (decision 5); `openStocktake`
   floors, stores and audits `dueAt`, set at open only (decision 6); `rememberPicks` writes
   `recent:<kind>` to `UserPreference` at seven sites, best effort, after the transaction, never audited
   (decision 7) — the helper lives in the plain module `src/server/recent-picks.ts` because a
   `"use server"` file may export only async actions (P-1). **§6** shared components: `ReasonField`
   (chips that fill the box and never submit, decision 8), `EntityCombobox`'s Recent/All groups with
   `autoFocus`, the two-tone `DuePill` on the existing `Pill` tones with the distinction in the text
   (decision 9), and a focus trap that prefers the first form control in a dialog (P-4). The clocks
   surface as the offboarding list's Due column, facet and sort, the wizard header pill, a completion
   line on the farewell report, the stocktake list's and page's "Close by", the IT Home worklist's
   leaver row, and a ninth Purchasing Home tile "Stocktakes past close-by" (the stat grid goes from
   `lg:grid-cols-8` to `sm:grid-cols-3 lg:grid-cols-5`, P-8). **§8** the shrink list, one row per file:
   the stock issue form's employee `<Select>` becomes a typeahead with a Recent group and its Purpose a
   `ReasonField`; the receive form gains "Same item again" and a supplier combobox; the adjust dialog
   prefills the counted balance; a purchase draft line adds the next line on Enter; the new-employee
   form's department starts blank ("Choose a department") instead of silently defaulting to whatever
   sorts first; the supplier form warns on a same name with a link to the existing record; the asset
   form's vendor combobox gets Recent; the blind count focuses its first cell. Two new e2e files,
   `e2e/deadlines.spec.ts` (9 cases) and `e2e/quick-forms.spec.ts` (9 cases).

   **Why:** the survey of 2026-09-17 found both readings of the law failing here — every required "why"
   was free text, nothing remembered a last-used vendor, employee or item, no operational form focused
   its first field, and the issue form picked a person from a full-roster dropdown; meanwhile an
   offboarding or an open stocktake could sit forever with nothing on Home saying so, while approvals
   already carry a 48-hour SLA and loans a due date. Out, and recorded as such: email or chat reminders,
   a public-holiday calendar, deadlines on purchase requests or approvals, editing a stocktake's date
   while OPEN, a Recent group for spare assets, and making any required field optional.

   **The nine rulings (plan `D-1`…`D-20` carries each with its cost-if-wrong):** **R1** — spec §9.1's
   employee-schema unit test is dropped, since `employeeSchema` is module-private in a `"use server"`
   file; e2e `deadlines.spec.ts` cases 2 and 7 cover the floor and the blank-department refusal
   (`D-1`). **R2** — the spec's "every chip ≥ 5 characters" rule was over-strict (every chip site's
   minimum is 3, and the only min-5 field has no chips), so the approved wording "Lost" stays and the
   unit invariant is ≥ 4 (`D-2`). **R3** — the date inputs carry `min`, so the browser refuses a past
   date and the server floors are unreachable through the UI by design; the e2e strips `min` and
   asserts the server text, and both layers stay (`D-4`). **R4** — no `/employees/<id>/history` route
   exists (employees have a Timeline of actor + action; only `/audit` renders diff field names), so
   `/audit?entity=employee` is the accepted surface for field-level employee history and no History tab
   is owed this phase (`D-13`). **R5** — chips are disabled while a form is pending, at the seventeen
   `ReasonField` sites that had a pending flag and did not pass it (`D-19`). **R6** — `ReasonField`'s
   chip group reads "Quick picks" and the chips carry no `aria-label`, because `getByLabel(text)`
   matches `aria-label` by case-insensitive substring and the old names collided with
   `getByLabel("Reason")`/`("Purpose")` at 21 pre-existing sites in 13 spec files; product-side naming
   rather than 13 edited spec files (`D-18`). **R7** — `enterKeyHint` (a spec §6.1/§8 requirement that
   never reached the plan or any brief — the final review's one Critical) is implemented once as a
   default in the shared `Input` component, and the "done on a dialog's last field" nuance is dropped
   (`D-16`). **R8** — an overdue leaver's employee form could not be saved at all: `min={today}` blocked
   the stored past date natively and the server floor was unconditional. The `min` is now the earlier of
   today and the stored value, and the floor applies only to a *changed* date (`D-17`). **R9** — the
   receive form's Quantity focus uses a forwarded ref instead of a render-phase ref write (`D-19`).

   **Battery, last run 2026-09-17 on the final tree `09bf0a5`:** `tsc` clean · `lint` clean · **24
   migrations**, schema up to date · **1476 unit / 82 files** · **337 e2e / 33 files** by `--list`,
   across seven foreground chunks with explicit file paths — Phase 22's seven, with
   `e2e/quick-forms.spec.ts` added to chunk D and `e2e/deadlines.spec.ts` to chunk F —
   `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (5.8m) ·
   C 63 passed (5.9m) · D 47 passed (4.7m) · E1 36 passed (8.9m) · E2 31 passed (4.1m) · F 39 passed
   (4.8m) = 337**, zero failed, zero did-not-run. Chunk B's first pass on `dbc93a0` was **64 passed,
   2 failed, 1 did not run**, reproduced identically on an immediate as-is re-run — and the two
   failures were one bug. `e2e/department-owned.spec.ts` case 9's second create (the case-variant
   duplicate) never picked a department, relying on the form's old auto-default; with the blank default
   this phase ships, it is refused on "Pick a department" before it can reach the duplicate check the
   case exists to prove. Its failure then retires the Playwright worker (it sits in a
   `test.describe.serial`), so the file's own `beforeAll` reseed runs again before case 11 and wipes the
   approvals cases 2 and 4 leave pending — Purchasing Home then reads Approvals 1 / Below reorder level
   1 / Expiring within 30 days 1, and case 11's `getByRole("link", { name: "1", exact: true })` matched
   three stat links instead of one. Fixed test-only, one line plus its reason
   (`selectOption({ label: "IT" })`), commit `09bf0a5`; chunk B then ran **67 passed (5.8m)** and chunk
   A was re-run on the final tree so every chunk's number above is post-fix. `npm run db:seed` ran last,
   clean; port 3100 carried no listening process before the first chunk, between any two chunks, or
   after the last. See plan `D-1`…`D-20`, "Measured at close", and §0 item 9 for the chunk commands.

   **What the final review found and the wave fixed** (`D-16`…`D-19`; final whole-branch review,
   read-only on `8b2dfd7..a16ad8c`, 71 files, Approve with fixes — 1 Critical, 2 Important, 11 Minor;
   one fix wave, commits `27479ad` product and `dbc93a0` e2e): the Critical was `enterKeyHint`, a spec
   requirement that never reached the plan or any brief, so no task review could have seen it missing
   (R7). Important 1 was the chip `aria-label` collision with the 21 pre-existing `getByLabel("Reason")`
   / `("Purpose")` sites, plus four `selectOption` calls now addressing comboboxes (R6). Important 2 was
   the overdue leaver's unsaveable form (R8) — seeded by Dennis Ong, and guaranteed on staging by
   migration 24's own backfill, which is what made it worth a Critical-adjacent fix rather than a park.
   The wave also landed R5's seventeen `disabled={pending}` sites, Task 4's four polish Minors, the
   seed's two new dates floored to the Manila calendar day (a wall-clock value produced a phantom
   `offboardingDueAt` audit diff on the first save of a date nobody touched), `updateEmployee`'s missing
   revalidation of the offboarding pages, the worklist and Home, and R9's render-phase ref write. The
   scoped re-review of `a16ad8c..dbc93a0` found all eight ADDRESSED with no new breakage.

   **What is parked, with a home:** six deferred Minors from the final review live in
   `docs/HANDOVER-PENDING.md` §5.3 and plan `D-15` — the Purchasing tile's accent tone when > 0, a
   visible "No supplier" clear on the receive combobox, the dropdown auto-opening on `autoFocus`,
   offboarding facet counts not narrowing each other, the wizard header's `DuePill` for an already
   OFFBOARDED employee, and two spec §5.4/§8 wording reconciliations. Two more were accepted as
   designed rather than deferred: `rememberPicks` is non-atomic by design (best effort, after the
   commit), and `revalidateStocktake` still does not revalidate `/` — inert today, since every `(app)`
   route is dynamically rendered.

   **What remains: merging to `main`, pushing, and the staging redeploy are the user's decisions, not
   pre-authorised.** Migration 24 is additive and its backfill is two guarded `UPDATE`s, so it applies
   on the next `scripts/deploy-staging.ps1 -Force`; every leaver already on staging will acquire a
   complete-by date and some will read overdue on the first render, which is decision 4's intent.
   `main` also still carries two unpushed docs commits, `39f73a3` (spec) and `8b2dfd7` (plan).

   **(q) PHASE 24 (IT gaps 2: Replace groups, repairs view paged in SQL, worker retention) IS
   MERGED TO `main` via `--no-ff` `48c37f7` AND PUSHED (2026-09-21; final tree `7601cab`, docs `40a11b6`);
   it adds NO migration — 24 stays — and staging was redeployed the same day with a code-only
   `-Force` (24 found, none pending; runs `48c37f7` at `http://192.168.203.183:3000`) — spec `docs/superpowers/specs/2026-09-17-it-gaps-2-design.md`, plan
   `docs/superpowers/plans/2026-09-17-phase-24-it-gaps-2.md`.** Read the plan's amendment banner
   (`D-1`…`D-10` — the final whole-branch review added `D-8`, the fix wave `D-9`, the final battery
   `D-10`) first, same rule as Phases 11–23.

   **What shipped, by spec section:** the three IT-side items Phase 23 left open, all under spec §0
   decision 3's "approach A — reuse what exists". **§2** no schema change and no migration: the phase
   deletes rows, it does not model anything new. **§4** two new pure modules with their tests first —
   `src/lib/combo-groups.ts` (`GroupedOption`, `headingBefore(shown, i, recentCount)`: the heading to
   render *before* row `i`, or `null`) and `src/lib/retention.ts` (`RETENTION_DAYS` 90, `PRUNE_BATCH`
   1000, `PRUNE_INTERVAL_MS` one hour, `retentionCutoff`, `pruneDue`, and `RETENTION_NOTE`, the page's
   sentence built out of the constant so the copy can never drift from the rule) — 9 unit tests across
   2 files. **§6.1** `ComboOption` gains `group?: string` and `EntityCombobox` renders a
   `role="presentation"` heading row wherever `headingBefore` says the group changed, generalising the
   two hard-coded Recent/All branches into one; the Replace picker therefore reads SAME TYPE, its
   spares, OTHER SPARES, the rest — and only OTHER SPARES when no same-type spare exists, which is the
   gap. Decision 4 drops the per-row note, which under a heading said the same thing twice. **§5.1**
   `spareOptions` emits those groups and no `note`; `listAssets`' repair branch pages `repairStageIds`'
   SQL id set through `pagedSnapshot` (`count` + `findMany` on `id in ids`) instead of loading every
   repair-candidate row with its includes and paging the array in memory — the stage *cut* has been SQL
   since Phase 20, the *paging* is SQL now. Facet counts deliberately stay on the candidate set
   (decision 5). **§5.2–§5.4** `src/worker/retention.ts`'s `pruneRetention` deletes finished rows older
   than the cutoff in id batches of 1000 — `DELIVERED`/`DEAD` deliveries by `createdAt`, `DONE`/`DEAD`
   jobs by `updatedAt` (plan P-4: a terminal job never updates again) — called by `src/worker/index.ts`
   once after `recoverStale` at start and hourly thereafter via `pruneDue`, never fatally (`safePrune`
   logs and the loop carries on), and by the `src/worker/prune.ts` one-shot behind `npm run
   worker:prune`. **§6.3** the deliveries page carries `RETENTION_NOTE` under its header, so the screen
   states the rule the constant owns. One e2e case rewritten and three added in `e2e/it-gaps.spec.ts`
   (9 cases now): the grouped picker, the picker with no same-type spare, the repairs view's total and
   rows against the SQL cut, and the prune removing exactly its two 91-day fixtures and nothing else.

   **Why:** these were the last three genuinely open entries on the IT list `docs/HANDOVER-PENDING.md`
   §6 carried — the other three on it (bulk-status skip reasons, the cross-class identifier leak, and
   the loaner rule versus an on-loan device) turned out to have been closed in Phase 20 and were still
   shown as open, so the list itself was a defect (`D-2`; §6 is corrected here). Out, and recorded as
   such: a raw-SQL list query with its own ORDER BY/LIMIT for the repairs view, a partitioned deliveries
   table with a cron, stage facet counts on the exact cut, a retention setting in the admin UI (the
   constant is the policy), and pruning `AuditEntry` (permanent by design) or `RateEvent` (which already
   deletes its own old rows on every check).

   **The four rulings (plan `D-1`…`D-10` carries each with its cost if wrong):** **R1** — Tasks 2 and 3
   ran in parallel and `ComboOption.group?: string` is a type-only addition, so whichever task reached
   it first added the identical line and the other reconciled trivially; in the event Task 2 carried it
   and nothing had to be reconciled (`D-1`). **R2** — e2e case 8's `?page=2` clamps on today's seed (the
   largest stage cut is 3 rows against `ENTITY_PAGE_SIZE = 25`), so the second-page branch is present
   but not exercised; accepted rather than manufacturing ~25 defective assets inside an e2e, because
   cases 6 and 8 prove the SQL-versus-screen parity and `e2e/paging.spec.ts`'s 1000-asset `?page=41`
   already drives the *same* `pagedSnapshot` helper's skip/take at depth (`D-7`, confirmed by the task
   reviewer and again by the final review). **R3** — the final review's Important 2: a
   `role="presentation"` heading row is out of the accessibility tree, so the same-type signal the
   per-row note used to carry was announced to nobody. Fixed with the minimal additive change — each
   heading `li` gets an `id`, and every option under a *grouped* heading gets `aria-describedby`
   pointing at it; the synthetic Recent/All headings are deliberately not described, so the five
   recent-enabled callers announce exactly as before, accessible names are untouched, and every existing
   assertion still holds (`D-9`; spec §6.1 amended to match). **R4** — the contents of the fix wave
   itself: the Important findings plus six of the eleven Minors, with four recorded only (`D-9`).

   **Battery, last run 2026-09-17 on the final tree `7601cab`:** `tsc` clean · `lint` clean · **24
   migrations**, schema up to date (this phase adds none) · **1485 unit / 84 files** · **340 e2e / 33
   files** by `--list`, across the same seven foreground chunks with explicit file paths, composition
   unchanged from Phase 23 — `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m)
   · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.5m) · E1 36 passed (5.7m) · E2 31 passed
   (3.1m) · F 42 passed (4.4m) = 340**, zero failed, zero flaky, zero skipped, zero did-not-run. Every
   chunk was green on its first pass: no chunk was re-run and there is no test-only fix commit in this
   phase, the first close since Phase 21 with none. Only F's count moved, 39 → 42, for the three new
   it-gaps cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the
   first chunk, between any two chunks, or after the last. See plan `D-1`…`D-10`, "Measured at close",
   and §0 item 9 for the chunk commands.

   **What the final review found and the wave fixed** (`D-8`/`D-9`; final whole-branch review,
   read-only on `32e6959..42f50ff`, Approved with fix wave — 0 Critical, 2 Important, 11 Minor; one fix
   wave, `7601cab`, six files): Important 1 was the retention delete identifying its rows by id alone,
   so the predicate held at *select* time only — an admin's Replay landing in the millisecond gap flips
   a `DEAD` delivery to `PENDING` and creates a live job, and the prune would then delete that row
   anyway, dead-lettering the job and silently voiding the replay. Both deletes now repeat the
   status-and-cutoff predicate, which is what makes spec §7's "impossible by predicate" literally true
   rather than true-at-select. Important 2 was the accessibility regression R3 closed — worth naming as
   a **spec-level** one: the implementation was faithful to decision 4 and §6.1, and all five
   task-scoped reviews passed it, which is exactly the class of defect §0 item 5 says the reviews exist
   to catch. The wave also landed the `where` that was computed above the repair branch and unused
   inside it, two stale comments that still described the in-memory cut, the now-producerless
   `ComboOption.note` field and its render, a fixture-facts sentence that listed a reserved spare as
   offered, an assertion pinning the one-shot's stdout line, and a `.catch` on the one-shot's
   `$disconnect`. The scoped re-review of `42f50ff..7601cab` found all nine ADDRESSED and no new
   findings.

   **What is parked, with a home:** the fuller ARIA shape for grouped options — `role="group"` with an
   `aria-label` per block — is a new candidate in `docs/HANDOVER-PENDING.md` §6; it contradicts §6.1's
   flat-`li` instruction and would change the DOM e2e cases 4 and 7 assert on, so it goes in only if AT
   feedback asks for it. Four findings were recorded rather than fixed: case 8's page-2 clamp is a
   coverage boundary rather than a hole (R2 above, and `e2e/paging.spec.ts` proves skip/take);
   **`npm run worker:once` now prunes as a side effect**, and four specs shell out to it
   (`approvals-audit.spec.ts`, `asset-classes.spec.ts` twice, `department-owned.spec.ts`) — harmless
   while the seed holds nothing older than 90 days, and a trap the day it does; the stage cut travels as
   bind parameters twice (count, then `findMany`), which is approach A's explicitly accepted trade and
   would bite only a fleet with tens of thousands of simultaneously defective assets; and it-gaps cases
   1 and 3 keep their pre-existing no-`finally` shape, which the file's `beforeAll` reseed is written
   around. Two things were accepted as-is: case 9's new regex spells "90 days" because spec §5.4 spells
   the log line verbatim, and the Recent/All heading rows carry an `id` nothing points at, so the markup
   stays uniform. The three IT items that remained open and unchanged were `/audit` class scoping of
   approval, category and type rows; case-insensitive uniqueness for reference data; and the activity
   page's action facet and import-update sentences — **✅ CLOSED in Phase 27 —** all three shipped on
   `phase-27-leftovers-sweep` (see (t)): `invisibleAuditRefs` hides the approvals, categories and types
   of a class a role cannot see; migration 26's seven `lower()` unique indexes plus a named pre-write
   check make every reference name unique whatever the case; and the four feeds gained an Action facet
   with human field names in their `import-update` sentences.

   **Done on 2026-09-21: merged to `main` via `--no-ff` `48c37f7` and pushed (the push also carried the two
   docs commits `0aeb8ce` (spec) and `32e6959` (plan) and the same-day IP renumbering commit `efd6d9e`);
   staging redeployed with a code-only `scripts/deploy-staging.ps1 -Force` — 24 migrations found, none
   pending, web healthy, `/login` answers 200 locally and at `http://192.168.203.183:3000`.** The laptop was
   renumbered from `.153` to `.183` the same day, so every QR label now encodes the new address and any
   label printed earlier is dead.

   **(r) PHASE 25 (IT navigation sweep: start offboarding from the profile, every reference a link,
   new-hire finish line, employees list parity, safety nets) IS CODE-COMPLETE on
   `phase-25-it-navigation-sweep` at final tree `fab0780` (after the final-review fix wave); MERGED TO
   `main` via `--no-ff` `bb577f8` AND PUSHED (2026-09-21; tree hashes matched the tested tip `641e96f`) — and it
   adds NO migration, so 24 stays and the staging redeploy was a code-only `-Force` (run 2026-09-21; staging serves `5727572`) — spec
   `docs/superpowers/specs/2026-09-21-it-navigation-sweep-design.md`, plan
   `docs/superpowers/plans/2026-09-21-phase-25-it-navigation-sweep.md`.** Read the plan's amendment
   banner (`D-1`…`D-12` — the final whole-branch review added `D-10`, the fix wave `D-11`, the final
   battery `D-12`) first, same rule as Phases 11–24.

   **What shipped, by spec section.** The phase is an audit-first sweep: the whole IT surface was mapped
   for dead ends and unwired affordances before anything was chosen, and what could not be done without a
   schema change was split off into Phase 26 (spec §0 decisions 1 and 2). **§3** `startOffboarding`
   (`src/server/modules/employees/actions.ts`) is a faithful twin of the Edit-form path — role guard,
   `checkRate`, zod, `conflict` on a missing or non-ACTIVE employee, the `minOffboardingDue` floor, then
   one `prisma.$transaction` holding one `employee.update` and one `writeAudit`, and the same seven
   `revalidatePath` calls — driven by a new `StartOffboardingDialog` on the profile header for admin/IT
   when the employee is ACTIVE, with **Complete by** prefilled to `defaultOffboardingDue` (five working
   days, not "+7 days" — `D-2`). When the employee is no longer ACTIVE the button is absent and the
   frozen banner in `LoadoutView` carries the date as a `DuePill`. The wizard's three request links now
   point at `/approvals/{id}` (`Decision` and `WizardItem.blockedBy` gained `id`), and its header pill
   reads `closed` via the new `DuePill.override` once the employee is OFFBOARDED. **§4** eight
   reference sites became links: the asset record's pending banner ("Open request"), the asset timeline's
   ref, the employee timeline's refs and asset tags, both IT activity feeds (`ActivityItem.entity`, a
   trailing chip; the four Purchasing callers pass none and are unchanged), the `HOLD` pill's holder
   (`AssetRow.hold`, `stopPropagation` inside a clickable row), the profile's five newest open requests
   with `+N more`, the Home fleet bar (`FleetSlice.href` → `/inventory?status=<STATUS>`, segments and
   legend both links), and `department` in the audit page's `entityLabels` (name resolved, no link — no
   department route exists). **§5** creating an employee now redirects to `?created=1` and the profile
   shows an `EmployeeCreatedNotice` with "Assign devices" (to a focusable `id="loadout"` anchor) and
   "Accountability form"; the Name field takes `autoFocus`; and `/employees` gained the sort headers its
   config has always honoured — a new client `EmployeesTable` builds `sortHrefs` exactly as
   `/inventory` does, and its rows are focusable and open on click or Enter, with the selection guard and
   the link-stops-propagation rule the house uses. **§6** the safety nets: `(app)/error.tsx` (digest,
   Try again, Home — inside the shell, never printing `error.message`), four `loading.tsx` skeletons
   plus a fifth for the wizard, `offboarding/[employeeId]/not-found.tsx`, the offboarding `progress` and
   `due` facets now narrow each other through the pure `narrowedFacetCounts`, and `/offboarding` gained
   an Export button and route mirroring `/employees/export` row for row.

   **Why:** the audit ranked every gap by clicks saved on the four daily IT paths — new hire,
   swap/repair, move/reassign, leaver. Starting an offboarding took a trip through the Edit form; a
   reference shown on screen (a ref number, a tag, a holder's name) was a dead end that had to be
   retyped into a search; a newly created employee landed on a profile with no next step; the employees
   list honoured `sort` in SQL but rendered plain headers, so sorting was reachable only by editing the
   URL. **Out, and recorded as such:** creating, releasing and expiring reservations, and recording when
   a repair actually ended — both need schema work and are Phase 26 (`docs/HANDOVER-PENDING.md` §6,
   `PICKUP.md` §5).

   **The four rulings (plan `D-1`…`D-12` carries each with its cost if wrong):** **R1** — the
   worktree was branched from LOCAL `main` (`5acb5fd`), not the harness's `origin/main` base, so the spec
   and plan commits sit in the branch's history as in Phases 20–24 (`D-1`). **R2** — the fleet bar's
   segments are real links, so the wrapper's `role="img"` had to go; the design stands and Task 7 rewrote
   `e2e/home-finance.spec.ts`'s assertion in its own test-only commit rather than weakening the markup
   (`D-6`). **R3** — `AuditEntry` is append-only at the database (a trigger refuses deletes), so no
   e2e case deletes audit rows: every mutating case restores mutable fields only and relies on the file's
   `beforeAll` reseed (`D-8`). **R4** — the contents of the fix wave: the five Important findings plus
   three Minors and one parked Minor, with five Minors recorded only (`D-11`).

   **Battery, last run 2026-09-21 on the final tree `fab0780`:** `tsc` clean · `lint` clean · **24
   migrations**, schema up to date (this phase adds none) · **1493 unit / 84 files** · **353 e2e /
   34 files** by `--list`, across the same seven foreground chunks with explicit file paths, composition
   unchanged from Phase 23 apart from the new `e2e/it-nav.spec.ts` joining F — `E2E_PORT=3100
   --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (4.0m) · C 63 passed
   (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 55 passed (5.6m)
   = 353**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on its first
   pass: no chunk was re-run and there is no test-only fix commit in this phase, the second close in a row
   with none. Only F's count moved, 42 → 55, for the thirteen new it-nav cases. `npm run db:seed` ran
   last, clean; port 3100 carried no listening process before the first chunk, between any two chunks, or
   after the last. See plan `D-1`…`D-12`, "Measured at close", and §0 item 9 for the chunk commands.

   **What the final review found and the wave fixed** (`D-10`/`D-11`; final whole-branch review,
   read-only on `5acb5fd..77f03c5`, Approved with fix wave — 0 Critical, 5 Important, 8 Minor; one fix
   wave, `fab0780`, seven files): nothing was a correctness or data defect. Three were user-visible
   polish defects the walk could not have caught by looking at one page — the asset-record `loading.tsx`
   drew a second header and tab strip *under* the real ones, because a record-level skeleton renders
   inside its own layout (I-1); `offboarding/loading.tsx` also covered the wizard and the farewell report,
   so both flashed a ten-row list skeleton (I-2); and the fleet bar's new segment links had no visible
   focus ring, because the global outline is clipped by the `overflow-hidden` wrapper, while a zero-share
   status was a zero-width focusable link (I-3). One was a comment that had become false —
   `updateEmployee` was no longer the only writer of `offboardingDueAt` (I-5). And two e2e assertions sat
   below the spec's own §8 list: case 1 asserted only the audit row's *count*, never the three diff
   fields, which is the one check that makes parked **M-P25-1** (the hand-built audit diff with raw
   `Date`s) safe to park; and case 9 clicked the legend, never a segment (I-4). The wave also landed the
   employee-record skeleton's phantom tab strip (M-1), a raw `<a>` for an internal route (M-2), a tighter
   facet assertion (M-P25-5) and case 12 restoring the value it read rather than a literal `null` (M-8).
   The scoped re-review of `77f03c5..fab0780` found all nine ADDRESSED plus M-P25-5, and no new findings.

   **What is parked, with a home:** **Phase 26 — holds that work, and a repair end-date** was the
   next IT candidate this audit named (`docs/HANDOVER-PENDING.md` §6, `PICKUP.md` §5), and it is now
   DELIVERED on `phase-26-holds-and-repair-end` — see (s) below: `reserveAsset`/`releaseHold` place and
   release holds from the asset record, an empty profile slot and `/reservations`, the worker expires them
   hourly, and `Asset.repairEndedAt` (migration 25) closes `downDays`' interval so a returned-OK asset
   reads its real downtime instead of a dash. Also parked: the Home age
   histogram's buckets stay unlinked (the fleet bar got links, the histogram did not — its buckets have
   no facet to point at), list keyboard shortcuts beyond row Enter, the `role="group"` ARIA shape from
   Phase 24, and the three IT items still open at the time (`/audit` class scoping of approval,
   category and type rows; case-insensitive uniqueness for reference data; the activity page's action
   facet and its import-update sentences) — **✅ CLOSED in Phase 27 —** all three shipped on
   `phase-27-leftovers-sweep`; see (t). Five findings were recorded rather than fixed: the HOLD holder link
   dead-ends for `finance_staff`, which is the house's existing assignee-link behaviour and not something
   this phase introduced (M-3); `autoFocus` on the dialog's date input is redundant with the focus trap's
   own `initialFocus`, and spec §3.2 asked for it (M-4); a focusable `<tr>` carries no role, which spec
   §5.2 chose deliberately with the name link carrying the affordance (M-5); `startOffboarding` writes
   `offboardingAt = now` where the Edit path preserves it, an unreachable difference since an ACTIVE row
   carries `null` (M-6); and the profile's frozen banner shows the due pill for OFFBOARDING only, because
   an unoverridden pill would read "overdue" on a closed case — the wizard header carries the `closed`
   pill instead (M-7). Five Minors parked during the tasks stand on the reviewer's reasoning:
   **M-P25-1** the hand-built audit diff serialises a `Date` exactly as `diffOf` does and e2e case 1 now
   pins it; **M-P25-2** the read-before-transaction TOCTOU is inherited verbatim from `updateEmployee`
   and worth a phase across the module, not a one-off; **M-P25-3** the activity chip repeats the entity
   name already in the sentence, which is what spec §0 decision 5 priced in to avoid linking a substring
   of a generated sentence; **M-P25-4** e2e case 6 has no `try`/`finally` because under R3 its only write
   is an append-only audit row; and **M-P25-5** was folded into the wave. One thing accepted as-is: case
   9's tightened facet check asserts `facetCounts("Status").DEPLOYED === rowCount`, which is exact while
   the seed's DEPLOYED set fits one 25-row page and would need revisiting if a future seed outgrows it.

   **What remains: merging to `main`, pushing, and the staging redeploy are the user's decisions, not
   pre-authorised.** There is no migration, so whenever the merge happens the redeploy is a code-only
   `scripts/deploy-staging.ps1 -Force` (24 found, none pending). `main` also still carries three unpushed
   docs commits beyond `origin/main` `a9970ad` — `9dd7ba5` and `98a94a1` (the spec and its corrections)
   and `5acb5fd` (the plan) — plus this phase's own docs commit.

   **(s) PHASE 26 (holds that work: reserve a spare from the asset record or from an empty profile
   slot, release it, an hourly sweep that expires it, `/reservations` list parity; `Asset.repairEndedAt`
   stamped by the lifecycle preparer) IS MERGED TO `main` via `--no-ff` `a5883ad` AND PUSHED (2026-09-22); the
   merged tree is byte-identical to the tested branch tip `6175af3` (final tree `1442289` plus its docs
   commit; tree hashes matched); branch and worktree removed; it ADDS MIGRATION 25 `repair_end_and_holds`,
   **applied on staging by the 2026-09-22 `-Force` redeploy** (25 found, all applied; web healthy, local and LAN
   `/login` 200; the worker's first sweep expired the one long-dead seeded hold) —
   spec `docs/superpowers/specs/2026-09-21-holds-and-repair-end-design.md`, plan
   `docs/superpowers/plans/2026-09-21-phase-26-holds-and-repair-end.md`.** Read the plan's amendment
   banner (`D-1`…`D-10` — the spec corrections before the plan are `D-2`, the final whole-branch
   review added `D-8`, the fix wave `D-9`, the final battery `D-10`) first, same rule as Phases 11–25.

   **What shipped, by spec section.** The phase closes the two lines Phase 25's audit split off because
   both needed schema work. **§3** migration 25 `20260921072537_repair_end_and_holds` is a bare
   `ALTER TABLE … ADD COLUMN` for the nullable `Asset.repairEndedAt` plus a commented backfill that
   fills it **only** where an audit row actually moved a status off DEFECTIVE — it invents nothing, so
   the seeded RETURNED OK fixture `BR-MN-0911` keeps its dash. `src/lib/holds.ts` (new, pure, 8 tests)
   owns the defaults (`HOLD_DEFAULT_DAYS = 7`, `defaultHoldExpiry`, `minHoldExpiry`), `holdStatus`,
   `isHoldExpired`, the hourly gate, `HOLDS_LIST_CONFIG`, `buildHoldWhere`/`buildHoldOrderBy` and the
   `RESERVATION_TABS`/`parseReservationTab` pair moved verbatim out of the server module (§8's
   “one list parser with no test” note, closed); `downDays` closes its interval on `repairEndedAt`;
   `HoldPill` renders the status; the hold reason chips and the `reservation.placed` /
   `reservation.released` activity sentences and dots came with it. **§4** `prepareLifecycle` stamps
   `repairEndedAt` on every path that leaves DEFECTIVE and clears it on entry, both in the audit diff, so
   direct, bulk, triage and worker-executed approvals record it identically; `reserveAsset` and
   `releaseHold` (new `src/server/modules/reservations/actions.ts`) are direct admin/IT actions with the
   house guard order, the pinned refusal copy, one `writeAudit` each inside the same transaction and six
   revalidations; `listReservations(tab, state)` counts each tab over `buildHoldWhere` inside the paged
   snapshot and returns Employee and Department facets; `activeHoldFor` feeds the record; `AssetRow.hold`
   carries `expiresAt`; and `src/worker/holds.ts`'s `expireHolds` flips ACTIVE holds past the start of
   today (Asia/Manila) to EXPIRED once at start and hourly after, logging `[worker] expired N hold(s)`
   and writing no audit row (decision 7). **§5** the asset record gains a **Reserve** control
   (`HolderControl` `mode: "reserve"` — For, Expires prefilled to today + 7 with a `min`, Reason
   chips), a `Banner` “Held for {name}” carrying the pill, the reason and `ReleaseHoldButton`, and
   a preselected holder plus a held caption on Assign; the profile's empty policy slot leads its `⋯`
   menu with **Reserve a spare…** and its holding area shows the pill and Release; the inventory
   HOLD cell appends the expiry text after the existing pill and holder link; and `/reservations` was
   rebuilt on `parseListState(HOLDS_LIST_CONFIG)` — `HoldsToolbar` (search, Employee and Department
   facets, total) and `HoldsTable` (sortable Asset/For/Expires/Created, whole-row click with the
   selection guard and Enter, inner links stopping propagation, Release on ACTIVE rows for admin/IT),
   three empty states and pagination that keeps tab, search and facets. **§6** the record's Repair
   card reads “N d out of service”, “down N d, back since {date}”, “down N d, closed
   {date}” for a closed-family status, and “clock stopped” only when no end was recorded.

   **Why:** `/reservations` had promised a control that did not exist since Phase 7 — nothing in
   `src/server` ever called `reservation.create`, `HolderControl` exposed only `assign`/`return`, and
   `RELEASED`/`EXPIRED` sat in the enum with nothing transitioning to them, so every seeded hold was
   permanent and a long-expired one still rendered as live; and a finished repair could not be reported
   at all, because `downDays` returned `null` for anything not DEFECTIVE and nothing recorded when the
   repair ended. Both needed the schema, which is why Phase 25 (no migration) deliberately left them.

   **The five rulings (plan `D-1`…`D-10` carries each with its cost if wrong):** **R1** — the
   worktree was branched from LOCAL `main` (`611d91f`), not the harness's `origin/main` base, so the spec
   and plan commits sit in the branch's history as in Phases 20–25 (`D-1`). **R2** — Task 1 also
   edited two type-only lines of `e2e/it-gaps.spec.ts`, outside its file list, because `tsc` must be green
   at the end of every task; accepted and disclosed (`D-3`). **R3** — Task 3's review found the Assign
   dialog preselecting a holder who might no longer be an assignable employee, leaving the combobox blank;
   the fix preselects only when the holder is present in the options and the held caption stays
   unconditional (`D-5`). **R4** — the contents of the fix wave: the three Important findings, the
   re-scoped Minors and the one-liners, with `M-3` and `M-9` recorded only and two Minors declined
   (`D-8`). **R5** — `e2e/paging.spec.ts`'s 30 scale-fixture holds were the last writer of a
   wall-clock `expiresAt`, so they were closed inside the wave as a separate commit rather than left as a
   violator of the invariant `schema.prisma` now declares (`D-9`).

   **Battery, last run 2026-09-21 on the final tree `1442289`:** `tsc` clean · `lint` clean ·
   **25 migrations**, schema up to date (migration 25 is this phase's) · **1511 unit / 85 files**
   · **364 e2e / 35 files** by `--list`, across the same seven foreground chunks with explicit file
   paths, composition unchanged from Phase 23 apart from the new `e2e/holds.spec.ts` joining F —
   `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.5m) · B 67 passed
   (3.9m) · C 63 passed (4.1m) · D 47 passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed
   (3.0m) · F 66 passed (6.6m) = 364**, zero failed, zero flaky, zero skipped, zero did-not-run.
   Every chunk was green on its first pass: no chunk was re-run and there is no test-only fix commit in
   this phase, the third close in a row with none. Only F's count moved, 55 → 66, for the eleven new
   holds cases. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the
   first chunk, between any two chunks, or after the last. See plan `D-1`…`D-10`, “Measured at
   close”, and §0 item 9 for the chunk commands.

   **What the final review found and the wave fixed** (`D-8`/`D-9`; final whole-branch review, opus,
   read-only on `611d91f..f1979b0`, Approved with fix wave — 0 Critical, 3 Important, 9 Minor; one
   wave in two commits, `bbaec18` then `1442289`): **I-1** `reserveAsset` had no `P2002` branch although
   the partial unique index `Reservation_one_active_hold_per_asset` (migration `20260814090100`) enforces
   one live hold per asset — a concurrent reserve threw past the action instead of returning the
   pinned conflict copy, and spec §0 decision 8's premise (“the codebase has never had a partial
   unique index”) was simply wrong; the catch now re-reads the winner's row and answers “{tag} is
   already held for {employeeNo} — release that hold first.” **I-2** the `/reservations` tab badges
   counted unfiltered while the tab links carried the search and facets; each tab now counts over
   `buildHoldWhere(t.id, state)` inside the paged snapshot. **I-3** `holdStatus` compared Manila calendar
   days while the sweep compared raw instants against Manila midnight — equal only for UTC-midnight
   rows, and the seed wrote wall-clock values; the wave declared day-precision `expiresAt` in
   `schema.prisma` and made every writer honour it (seed through `dayFloor`, the paging fixture through
   `dayFromISO` under R5), routed `holdStatus.expired` through `isHoldExpired` so one rule has one
   consumer, and deleted the unreferenced `HOLDS_SWEEP_INTERVAL_MS` — no migration and migration 25's
   applied SQL untouched, since the only pre-existing rows were seed rows written in Manila working hours
   where the two rules agree. The wave also landed the closed-repair copy (M-1), a stale `AssetRow.down`
   comment (M-2), e2e cleanup by id with a `createdAt` fallback (M-4), `activeHoldFor` gated on IT
   records (M-5), a visual cue on disabled held-spare radios (M-6), `isDirectLifecycle` on the list page
   (M-7), the Department facet's zero counts (M-8), the Actions column gated on `canRelease` (M-P26-6)
   and the redundant `!isReserve` conjunct (M-P26-5). The scoped re-review (sonnet) came back CLEAN:
   every finding addressed, nothing new.

   **What stays parked, with a home:** the three IT items still open at the time (`/audit` class
   scoping of approval, category and type rows; case-insensitive uniqueness for reference data; the
   activity page's action facet and its import-update sentences) — **✅ CLOSED in Phase 27 —** all
   three shipped on `phase-27-leftovers-sweep`, which is what that phase was for; see (t).
   Still parked: the `role="group"` ARIA shape from Phase 24; the Home
   age histogram's unlinked buckets and list keyboard shortcuts beyond row Enter from Phase 25; the
   deferred Minors of Phases 23–25; and two deliberate non-goals of this phase — **no Export on
   `/reservations`** and **no approval step for holds** (a hold is a direct IT action, like the rest of
   the direct lifecycle). Two Minors were declined outright: **M-P26-1**, because a value import plus a
   re-export is the right shape when the module both uses the tabs and must re-export them for its
   callers, and **M-P26-4**, because dimmed zero counts are information — the asymmetry it named was
   fixed instead as M-8. Two were recorded rather than changed: **M-3**, `holdStatus` also says
   “expires tomorrow” at one day, mirroring `dueStatus`, so the pill copy is “expires in N
   d” / “expires tomorrow” / “expires today” / “expired N d ago”; and
   **M-9**, `holdFacets` runs its four queries after the paged snapshot and lists every employee with a
   hold in the tab without a `take`, correct at team scale and the shape every faceted list here uses.
   Two long-standing §8 notes stay TRUE and were re-worded rather than closed:
   `Reservation_one_active_hold_per_asset` still lives only in raw migration SQL, not in
   `schema.prisma` — and it is now load-bearing for a WRITE path, translated by `reserveAsset`'s
   `P2002` catch (**extended in Phase 27:** there are now **twelve** raw-SQL-only invariants, none
   mirrored in `schema.prisma` — eight `lower()` unique indexes, `User_email_lower_key` plus migration
   26's `AssetCategory_name_lower_key`, `AssetType_category_name_lower_key`, `Department_name_lower_key`,
   `EquipmentPolicy_name_lower_key`, `Vendor_name_lower_key`, `StockCategory_name_lower_key` and
   `StockCategory_prefix_lower_key`, and four partial unique indexes or CHECK constraints,
   `Reservation_one_active_hold_per_asset`, `Job_one_live_execute_per_approval`,
   `Job_one_live_deliver_per_delivery` and `Job_deliver_payload_shape`; the seven new ones are
   load-bearing for WRITE paths too, each translated by its module's `P2002` catch — see (t)); and **`downDays` counts elapsed 24 h periods, not `Asia/Manila` calendar days**, which
   now governs BOTH ends of the interval, so a repair running from late evening to early morning can read
   one day short.

   **What remains: merging to `main`, pushing, and the staging redeploy are the user's decisions, not
   pre-authorised.** Unlike the last two phases this one is NOT code-only: migration 25
   `repair_end_and_holds` applies on the first `scripts/deploy-staging.ps1 -Force` after the merge
   (staging serves `5727572` at 24 migrations today), and its backfill only fills rows whose audit
   history shows a transition off DEFECTIVE. `main` also carries two unpushed docs commits beyond
   `origin/main` `6530623` — `2bed93b` (the spec) and `611d91f` (the plan and the spec's
   corrections) — plus this phase's own docs commit.

   **(t) PHASE 27 (IT and quality leftovers sweep: `/audit` hides the approvals, categories and types
   of a class the role cannot see; reference names are unique whatever the case, with the existing row
   named before the write; the four activity feeds gain an Action facet, a sentence for every action
   that can reach them and human field names; the parked Minors of Phases 17–26) IS CODE-COMPLETE on
   `phase-27-leftovers-sweep` at final tree `66445ed` (after the final-review fix wave), **MERGED TO
   `main` via `--no-ff` `5dd3372` AND PUSHED (2026-09-22)** — the merged tree is byte-identical to the tested
   tip `0abf560` (tree hashes matched), branch and worktree removed; it ADDS MIGRATION 26
   `20260922010908_case_insensitive_names`, which is PENDING on staging until the next
   `scripts/deploy-staging.ps1 -Force` (the user's decision; run the duplicate check first) —
   spec `docs/superpowers/specs/2026-09-22-leftovers-sweep-design.md`, plan
   `docs/superpowers/plans/2026-09-22-phase-27-leftovers-sweep.md`.** Read the plan's amendment banner
   (`D-1`…`D-10` — the pre-flight rulings R1–R4 are `D-1`, the final whole-branch review added
   `D-8`, the fix wave `D-9`, the final battery `D-10`) first, same rule as Phases 11–26.

   **What shipped, by spec section.** The phase closes the three IT items every phase since 24 carried
   forward, pays down the parked Minors of Phases 17–26 that were cheap or user-visible, and records
   three design decisions. **§3.1** migration 26 `20260922010908_case_insensitive_names` adds the
   ordinary index `AuditEntry (entityType, action)` (the only line `schema.prisma` gained) and seven
   raw `lower()` unique indexes; it is additive and fails loudly on a case-duplicate database — the
   check to run first is below. **§3.2** `src/server/prisma-errors.ts`, which already existed with
   `asActionResult`, gained `isUniqueViolation` and `uniqueTarget` (both `meta.target` shapes) with a
   unit test, and the five independent `P2002` helper copies in the reference, policy, stock-item,
   supplier and inventory modules were replaced by that one pair (inventory's weaker local
   `uniqueTarget` deleted). **§3.3** `src/lib/audit-list.ts` gained `HiddenAuditRefs`/`NO_HIDDEN_REFS`
   and `buildAuditWhere(state, hidden)`, which emits one `NOT: { OR: […] }` branch per non-empty id
   list and none at all for an all-class role, plus the four entity types the page already rendered
   (`vendor`, `stock-item`, `stock-category`, `stocktake`). **§3.4** `src/lib/activity-list.ts` (new,
   pure, unit-tested) owns the four feeds' predicates — `ACTIVITY_LIST_CONFIG`, `feedWhere` (the
   finance predicate moved here) and `buildActivityWhere`. **§3.5** `src/lib/activity.ts` gained nine
   sentences (documents attached and signed, the loan due date, a secret, an acknowledgement, three
   policy exceptions, supplier set/cleared), `ACTION_LABELS`/`actionLabel` for the facet and
   `FIELD_LABELS`/`fieldLabel`, so an `update` or `import-update` sentence prints human field names
   (“department, join date”) instead of raw column keys, sorted on the label so jsonb's storage
   order never shows. **§3.6** `parseIntParam` in `src/lib/paging.ts` is used by both `parsePage` and
   `parseTimelineCursor`, and `byWhenDesc` carries the cuid byte-order comment that explains why the
   JS tiebreaker matches Postgres' `id desc`. **§4.1** `invisibleAuditRefs(role)` builds the four id
   lists from the SEE map (`canSeeClass`, not the manage map — decision 8), calls `invisibleAssetIds`
   for the asset list so the asset rule lives once, never hides a class-less approval, and runs no
   query at all for an all-class role; `listAudit(state, hidden)` and `listActivity(feed, state,
   hidden)` consume it, the latter running the action `groupBy` inside the paged snapshot's count
   closure so rows, total and facet counts come from one RepeatableRead snapshot. `entityLabels`
   resolves `asset-category` and `asset-type` to names (linked to `/admin/asset-categories` and
   `/admin/asset-types`). **§4.2** every create and rename in the reference, policy, stock-category and
   supplier modules does one case-insensitive lookup inside its own transaction, before the write, and
   names the row it clashes with — `That name is already taken by “…”`, `That policy name is
   already taken by “…”`, `A supplier with this name already exists: “…”`, `A category with this
   name already exists: “…”`, `That prefix is already in use by “…”`; a rename excludes its own row,
   types are scoped by category, and the `P2002` catch after the write stays as the race net.
   **§5.1** `/audit` and its export look the same, except that IT and viewer no longer see Purchasing
   approvals, categories or types, and the Entity dropdown lists Supplier, Stock item, Stock category
   and Stocktake. **§5.2** one server component, `ActivityListPage`, does parse → refs → `listActivity`
   → `ActivityToolbar` → feed → pagination for all four feeds, behind four five-line pages; the toolbar
   carries the Action facet, a Clear link while a selection is on and a live entry count, and a filter
   that matches nothing reads “No entries match this filter”. **§5.4** `rowOpenProps` in
   `components/ui/table.tsx` is spread by the inventory (new Enter support), employees and holds tables.
   **§5.5** `EntityCombobox` opens on click, typing or ArrowDown but never on focus alone (so
   `/stock/issue` and `/stock/receive` no longer render a second listbox on mount), the receive form's
   Supplier options lead with “No supplier”, `Stat` gained `tone` (`text-accent` on the value plus
   `data-tone`) and Purchasing Home's “Stocktakes past close-by” tile turns accent when overdue, and
   the work page's capped note counts the rows it actually rendered. **§5.6** the one-liners: the
   supplier runner's two unused setters, supplier documents tie-breaking on id, the seed's `CM-0002`
   issue moved to day −11, and `e2e/it-gaps.spec.ts` cases 1 and 3 wrapped in `try`/`finally`.

   **Why:** these were the three items Phases 24, 25 and 26 each named out of scope and carried
   forward. `/audit` excluded only `asset` rows of the other class, so an IT account still read
   Purchasing approvals, categories and types — and printed truncated cuids for the last two, because
   `entityLabels` had no branch for them. `reference-actions.ts` had no case-insensitive check at all,
   so “Laptop” and “laptop” could both exist, while `resolvePolicy` case-folds when it matches — a
   collision that reads as two distinct rows. And the four activity feeds had no facet, so one import
   of up to 2,000 rows buried everything else, with `import-update` sentences printing raw column
   names. None of the three needed a schema change beyond one index, which is why they waited.

   **The six rulings (plan `D-1`…`D-10` carries each with its cost if wrong):** **R1** — the worktree
   was branched from LOCAL `main` (`8c24c3b`), not the harness's `origin/main` base, so the spec
   (`385b484`) and plan (`8c24c3b`) commits sit in the branch's history as in Phases 20–26 (`D-1`).
   **R2** — Task 1's end gate accepted exactly three `tsc` errors in the audit path (`audit/queries.ts`,
   `audit/page.tsx`, `audit/export/route.ts` — `string[]` where `HiddenAuditRefs` was now expected),
   cleared by Task 2 first, because pulling the server fix into the rules task would have blurred the
   review surface (`D-1`). **R3** — the plan's `T2 ∥ T3` ran sequentially, T2 first: both gates run
   whole-tree `tsc` and T3 walks a dev server (`D-1`). **R4** — the plan's
   `parseIntParam("page=0", "page", 1)` expectation was wrong: `0 || 1` is 1, because `||` reads 0 as
   absent — exactly what both hand-rolled parsers already did (`D-1`). **R5** — Task 3's grep gate
   (“`P2002` only in `prisma-errors.ts`”) was wider than the spec: six pre-existing inline `P2002`
   checks outside the five named modules stay, recorded for a later mechanical swap (`D-4`). **R6** —
   the contents of the fix wave: I-1, I-2, M-1, M-3, M-4, M-5, M-6 fixed; M-2 and the six inline checks
   recorded only (`D-8`).

   **The ten plan decisions (P-1…P-10), recorded because each is a shape a later phase will meet
   again.** P-1 the execution order (T1 → T2 → T3 → T4 → T5 → T6 → T7, only one walking a dev server at
   a time). P-2 **one** server component for the four feeds rather than four copies of the wiring.
   P-3 `Stat`'s accent is coloured text (`text-accent`), not pill chrome — a stat number is not a pill.
   P-4 the activity e2e writes the audit rows it renders (`db.auditEntry.create`) and leaves them,
   because the sentence renderer is the unit under test and `AuditEntry` is append-only. P-5 the
   combobox blast radius, corrected from the spec: the nine specs that actually drive an
   `EntityCombobox`. P-6 `e2e/activity.spec.ts` joins chunk **E2**, the lightest. P-7
   `financeActivityWhere` was removed outright — its one caller was the finance feed. P-8
   `invisibleAssetIds` stays and gains `invisibleAuditRefs` as a caller. P-9 the facet `groupBy` runs
   inside the paged snapshot's count closure. P-10 the `/audit` entity-facet label for `vendor` is
   “Supplier” through a one-entry override before `humanize`.

   **Battery, last run 2026-09-22 on the final tree `66445ed`:** `tsc` clean · `lint` clean ·
   **26 migrations**, schema up to date (migration 26 is this phase's) · **1528 unit / 87 files** ·
   **377 e2e / 36 files** by `--list`, across the same seven foreground chunks with explicit file
   paths, composition unchanged from Phase 23 apart from the new `e2e/activity.spec.ts` joining **E2**
   — `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.5m) · B 67 passed (3.9m)
   · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 37 passed (5.8m) · E2 39 passed (3.6m) · F 66 passed
   (6.6m) = 377**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was green on
   its first pass: no chunk was re-run and there is no test-only fix commit in the battery, the fourth
   close in a row with none. Thirteen cases are new — `e2e/activity.spec.ts` (7) plus admin +3,
   approvals-audit +1, stock +1 and suppliers +1 — so 364 → 377, and this is the first phase whose
   growth landed in E2 (31 → 39) rather than F. `npm run db:seed` ran last, clean; port 3100 carried
   no listening process before the first chunk, between any two chunks, or after the last. See plan
   `D-1`…`D-10`, “Measured at close”, and §0 item 9 for the chunk commands.

   **What the final review found and the wave fixed** (`D-8`/`D-9`; final whole-branch review, opus,
   read-only on `8c24c3b..2505d7d`, 6 commits / 47 files / +1162 −436; Approved with fix wave — 0
   Critical, 2 Important, 6 Minor; one wave, `66445ed`): **I-1** the approvals worker writes five
   `<lifecycle.*> executed` asset actions that reached `/inventory/activity` with no label and no
   sentence, so the new Action facet listed a raw `lifecycle.assign executed` beside “Assigned” and
   choosing “Assigned” silently dropped every queue-executed assign; the five now route through the
   lifecycle sentence bodies with the suffix “ (approved request)” and carry facet labels, and
   `lifecycle.transfer` gained its own sentence and label. **I-2** `entityLabels` had no
   `asset-category`/`asset-type` branch, so `/audit` and its export printed truncated cuids for exactly
   the two entity types this phase class-scopes; both now resolve to names with links, the file's
   majority convention for admin rows. The wave also sorted `fieldList` on the label so a diff's fields
   print in one stable order whatever jsonb stored (M-1; two pre-existing unit assertions re-pinned),
   dropped a stray `?q=` from the feeds' pagination and facet hrefs (M-3), moved `e2e/it-gaps.spec.ts`
   case 3's fixtures inside its `try` (M-4), gave the `""` clear option a real id and key of `none`
   (M-5) and commented the `document.signed` single-key contract at both the writer and the reader
   (M-6). The scoped re-review (sonnet) came back CLEAN: every finding addressed, nothing new. One
   out-of-scope note it recorded: the asset history tab still prints the raw `lifecycle.assign
   executed` string, correctly — that is a raw-trail path, not one of the four feeds.

   **The database-only invariants — now twelve, none mirrored in `schema.prisma`.** Eight are
   `lower()` unique indexes: `User_email_lower_key` (migration `20260814090100_integrity_constraints`)
   and this phase's `AssetCategory_name_lower_key`, `AssetType_category_name_lower_key`,
   `Department_name_lower_key`, `EquipmentPolicy_name_lower_key`, `Vendor_name_lower_key`,
   `StockCategory_name_lower_key` and `StockCategory_prefix_lower_key` (migration 26). Four are partial
   unique indexes or CHECK constraints: `Reservation_one_active_hold_per_asset`,
   `Job_one_live_execute_per_approval`, `Job_one_live_deliver_per_delivery` and
   `Job_deliver_payload_shape`. Prisma cannot express a functional index, so `prisma db pull` still
   would not reproduce the schema this app depends on — read the migration SQL, not only
   `schema.prisma`, before changing any of these tables.

   **Run this before any redeploy that applies migration 26** (spec §3.1). Each statement must return
   zero rows; a row is a pair of names that differ only by case, which the migration will refuse:

   ```sql
   select 'AssetCategory',   lower(name),               count(*) from "AssetCategory"   group by 2    having count(*) > 1;
   select 'AssetType',       "categoryId", lower(name), count(*) from "AssetType"       group by 2, 3 having count(*) > 1;
   select 'Department',      lower(name),               count(*) from "Department"      group by 2    having count(*) > 1;
   select 'EquipmentPolicy', lower(name),               count(*) from "EquipmentPolicy" group by 2    having count(*) > 1;
   select 'Vendor',          lower(name),               count(*) from "Vendor"          group by 2    having count(*) > 1;
   select 'StockCategory',   lower(name),               count(*) from "StockCategory"   group by 2    having count(*) > 1;
   select 'StockCategory',   lower(prefix),             count(*) from "StockCategory"   group by 2    having count(*) > 1;
   ```

   Staging was checked clean on 2026-09-22 — 11 categories, 19 types, 5 departments, 1 policy, 2
   vendors, 0 stock categories — but it is a live database and the check is cheap, so run it again at
   the redeploy rather than trusting this line.

   **What stays parked, with a home** (spec §2, and three items this phase recorded rather than fixed).
   From the reviews: **M-2** — `/audit`'s entity pill still renders the raw `vendor` while the facet
   and the chip say “Supplier”; the one-line `humanize` is easy, but the pill is CSS-uppercased and an
   existing e2e asserts `ASSET` on it, so it needs its own e2e pass. **The six inline `P2002` checks
   outside the five consolidated modules** (`suppliers/bank-actions`, `admin/webhook-actions`,
   `approvals`, `employees`, `offboarding`, `receiving`/`reservations` actions) — each is correct and
   carries its own module's message, and none touches a `lower()` index; swapping them in is mechanical
   work for whoever next opens those files (R5). **M-P27-1** the doc comment in `activity-list.ts` names
   the removed `financeActivityWhere`, kept as provenance — a reader grepping the old name lands on the
   sentence that says where the predicate went. **M-P27-2** `renameRefRow`'s type-scoping
   `findUniqueOrThrow` can throw P2025 in a tiny window, a pre-existing exposure of the `update` that
   follows it. **M-P27-3** the worklist note's `rows.length` is a no-op for today's one capped caller,
   kept because the note now states what it literally renders. From the spec's non-goals: the
   **depreciation module** and the **Purchasing bulk import** (the next phases' candidates); a rolling-age
   facet on `/inventory` and links from the Home age histogram; the `role="group"` combobox shape and
   the richer j/k keyboard layer; the `worker:once` prune split; `holdFacets` inside the paged snapshot
   and the Employee facet narrowed by Department; bind-parameter dedupe in the repair-stage branch;
   `createEmployee`'s unconditional due-date floor; `revalidateStocktake` not revalidating `/`; the
   importers' `refKey` collision guards (they answer a different question from a write-time index); and
   search or sort on the activity feeds — the feeds stay newest-first and the one facet is the feature.
   **Three decisions were recorded rather than built:** no `role="group"` rewrite of the grouped
   combobox (Phase 24's shape already names the group to assistive technology, and a wrapper would only
   change the DOM `e2e/it-gaps.spec.ts` cases 4 and 7 assert on — revisit only on AT feedback); the Home
   age histogram stays unlinked (its buckets are rolling years since purchase and `/inventory` knows
   only calendar purchase years, so an honest link needs a new facet); and keyboard support stays at
   Enter on a focused row, with `/inventory` gaining it this phase through one shared helper. One more
   ruling, recorded instead of a change: the lapsed-contract banner on the supplier page keeps
   `tone="attention"` — a lapsed contract is a heads-up, not a fault.

   **What remains: merging to `main`, pushing, and the staging redeploy are the user's decisions, not
   pre-authorised.** This phase is NOT code-only: migration 26 `case_insensitive_names` applies on the
   first `scripts/deploy-staging.ps1 -Force` after the merge (staging serves `e96fb2a` at 25 migrations
   today), and it fails loudly rather than guessing if the duplicate check above returns a row. `main`
   also carries two unpushed docs commits beyond `origin/main` `8dc21a1` — `385b484` (the spec) and
   `8c24c3b` (the plan) — plus this phase's own docs commit on the branch.

   **(ba) USERS & ACCESS (admin access management; no phase number) - CODE-COMPLETE on branch `access-management` (2026-10-24): all 5 tasks, Tasks 1-4 reviewed (each clean after its fix rounds), Task 5's browser tests green; NOT MERGED, NOT PUSHED, NOT DEPLOYED, awaiting the owner's word. Adds two migrations, `20261024090000_access_management` and `20261024091000_sign_in_attempt_created_index` (42 migrations; `main` and Supabase stay at 40 until the merge and push), so the push migrates: take a Supabase dump first.**
   Spec `docs/superpowers/specs/2026-10-24-access-management-design.md` (binding; the owner's decisions are its §2), plan `docs/superpowers/plans/2026-10-24-access-management.md`; ledger, briefs, reports and reviews in `.superpowers/sdd/2026-10-24-access-management/` (worktree `.claude/worktrees/access-management`). Branch `access-management` is 21 commits above `main` `97e6da0` (after the final review's fix wave), plus two docs commits.
   - **What changed.** `/admin/users` is **Users & access**: a list (role tabs with counts, a status select, search; cards below 700 px) and one person's details beside it from 1180 px, in a drawer below, full screen on a phone. Admins **add** an account (role cards, an optional employee record; a temporary password `Word-NNNN-word` shown once, with Copy), **edit** name, email, role and employee link (one Save bar; a role change says who it moves where and signs them out), **reset** a password (a new temporary password, shown once), **turn an account off** (the "Account active" switch asks inline) and **approve or decline** sign-ups (a "Waiting for approval · n" chip and nav view; approve with a role and the employee record pre-searched by name). The permanent admin's panel is locked. Every role gets **Account settings** (`/settings/account`, from the account menu and the phone drawer): their facts, and Change password. A temporary password sends the person to **`/welcome/password`** ("Choose your own password") before anything else. **Sign-up always waits for approval** ("Wait for an admin to approve your account." / "You can sign in once it's approved."), and the old `SIGNUP_REQUIRES_APPROVAL` switch is retired (ignored if still set on Vercel; the owner may delete it). **Three wrong passwords** for one email within 15 minutes pause it for 15 minutes, whether or not the account exists. A session version on every account signs the person out everywhere on a reset, a role or email change, or turning the account off.
   - **The owner's choice: existing accounts and the shared seed password stay as they are.** The migration keeps every existing account APPROVED (only a sign-up still waiting, turned off with a `signup` entry and never enabled, becomes PENDING), owes no one a new password and leaves every password valid, and the seed's five accounts keep the one shared seed password (`prisma/seed.ts`; the seed also adds `pending@thebackroomop.com`, a sign-up waiting for approval, for the demo). **The risk:** today quick sign-in carries the presentations; once it is removed on **5 Nov**, every staging account that still has the shared seed password can be opened by anyone who knows it, the permanent admin included, and the README of this public repository publishes the local default. Before 5 Nov each person should change theirs in Account settings, or an admin resets each account (each then chooses their own at the next sign-in).
   - **The recovery command.** If the permanent admin is locked out: `npm run admin:recover -- --email <permanent admin's email>` with `DATABASE_URL` in the environment (for Supabase, the session pooler URI, never printed). It refuses any other account, sets a temporary password (printed once), owes a new one at the next sign-in, signs the account out everywhere, clears its sign-in pause, and writes a `password.reset` audit entry with source `cli`. Never run it from a test, or against staging without the owner.
   - **Task 5 (this block's last task).** Carried items: `setUserRole` retired (only Save changes a role); "pepper" became "button" (copper/pepper read as twins; 72 words); the seed truncates `SignInAttempt` (no spec inherits a paused email) and pins the five accounts APPROVED; `SIGNUP_REQUIRES_APPROVAL` left `docs/CLOUD-STAGING.md`; `login-cris` test 4 signs up with a password that has a number and ends at the waiting step. New `e2e/access-management.spec.ts` (11 cases): create → first sign-in (a deep link waits) → choose a password → Finance; reset (the other browser signed out); role change IT → Finance; turn off; sign-up → PENDING copy → approve with a role and employee → signs in, decline → DECLINED copy; the pause for a real and an unknown email, lifting after the window; Account settings; the locked permanent admin; focus moves (the inline confirms, Edit, Reset's ask step, the temporary password, the discard prompt, Change password after a save); closing Add user or Reset early keeps the password; layout at 1440, 1024, 834 and 375 px with 44 px panel targets and no sideways scroll; axe on Users & access, Add user, Account settings and `/welcome/password` in light and dark at 1440 and 375 px. Repaired: `admin.spec.ts` (the users block on the panel's controls), `phase-46-home.spec.ts` (`?status=DISABLED`, "No one matches").
   - **Five product fixes from the browser run** (each with a unit test): `1124597` Done, Escape and ✕ did nothing on Add user and Reset until the selection or refresh after the call finished (`closeBlocked`); `2205b70` a sign-in that owes a password landed on the first-sign-in page with `/` in the address bar (now redirected to `/welcome/password` by name); `c15038b` **changing your own password signed this device out**, against its own "You stay signed in here" (Next re-renders the page after an action that sets cookies, and Auth.js's `auth()` read the old Cookie header; `own-session.ts` marks the request with the refreshed values, on `globalThis` because Next bundles the action and the render apart; the same hit an admin changing their own email); `9959d45` at 1440 px the Person column was about 100 px beside the panel (names cut to an initial, the Permanent pill over Role): the Employee record column now gives way below 900 px of list; `420938c` the Password card's empty status region left a 12 px gap.
   - **Final review and its fix wave** (`.superpowers/sdd/2026-10-24-access-management/final-review.md`: ready to merge with fixes, 0 critical, 1 important, 9 minor). `3ef5987`: the sign-in and current-password buckets now only TRY the per-email advisory lock (`pg_try_advisory_xact_lock`); a try that finds it busy is answered as paused (the same reply as a pause), so a burst never parks pooled connections (M-3); `refreshOwnSession` never throws after the commit, logging the failure and leaving this device to sign in again rather than reporting a saved change as an error (M-1); `lastSignInAt` is stamped only once the session is issued (M-7); the first admin's password (`createBootstrapAdmin`) follows the shared rules (M-8); "ember" gave way to "pelican" (amber/ember, M-2); the discard prompt is a labelled group announced assertively, not an `alertdialog` (M-6); the phone card list is "User cards" (M-5); and, from the controller's look at the 1440 screenshot, the side panel is sized to end above Cris's corner wherever its top is, its scroll area carries Cris's clearance and its bottom bars are `data-cris-avoid`, with an e2e check that no panel control sits under Cris at 1440x900. `cba1a98`: the e2e's screenshots go to the test's output folder under `test-results/` (or `E2E_SHOT_DIR`), not a machine-specific temp path (I-1). After the wave: vitest **341 files / 5,698**, `tsc` and `eslint` clean; `access-management` 11/11 and `login-cris` 14/14 re-run (port 3100, `--workers=1`, reseeded first and last).
   - **Known limits (recorded, not fixed).** An error after the sign-in reservation counts as a failure (the safe side); two parallel tries on one email answer the second as paused (the lock is tried, not waited for), which a person signing in once never meets. The "Choose your own password first" refusal uses a Next internal (`work-unit-async-storage.external`; a public `refused()` helper is parked), and so does `own-session.ts`; the review suggests pinning `next` exactly as a cheap guard. Decline and Reset carry no `updatedAt` (ruled: a reset is a deliberate overwrite). The stale-refresh prompt can take focus from the search box; a Save while leaving drops the pending move (harmless). In the Hide state the Show/Hide button's visible text differs from its fixed name (ruled). The first-sign-in checklist's "not the temporary password" row reads "Checked when you save" (the browser never has it). The Employee record column shows only where the list is 900 px or wider (about 1650 px screens with the panel); the panel always shows the record. **Local only (M-9):** migration `20261024090000` was edited in place in Task 1's fix round, so a local database that applied the first copy keeps it (`migrate deploy` won't re-apply it) and a local sign-up waiting from before then may be `disabled = false`; Supabase never saw the first copy.
   - **Tests.** vitest **341 files / 5,690**; `tsc` clean; `eslint` clean on every changed file. Browser (foreground, `--workers=1`, port 3100, `CRIS_MODEL=fake`, reseeded first and last, chunks of at most 4 files under `--global-timeout=540000`): **158 tests in 14 files, green** - `access-management` 11/11, `admin`, `login-cris`, `phase-46-home` (54 in that chunk), `axe-sweep` 9/9 (alone, in two runs: the first was cut by the 540 s limit after 6), `auth-shell`, `quick-login` (off, and on a server restarted with `QUICK_LOGIN_EMAILS`), `oversight`, `paging`, `phase-40`, `phase-42-sidebar`, `phase-47-finance`, `back`, `finance-undo`. `phase-40` case 10 (Approvals' Clear filters, unrelated) failed once in its chunk and passed alone.
   **Next (the owner's decisions, not pre-authorised):** the final whole-branch review, then the merge (`--no-ff`, secret scan first) and push. **The push migrates: take the Supabase dump first** (`scripts/supabase/dump.ps1 -Image postgres:17-alpine`). After the deploy, check on staging that existing accounts still sign in and that Users & access lists them as Active, and tell the owner about the 5 Nov risk above. **The deploy window (M-4):** a sign-up made through the previous deployment while the new one builds (after the migration ran) is created by the old code, as a viewer, APPROVED by the column default and turned off while Vercel still has `SIGNUP_REQUIRES_APPROVAL=1`; Users & access lists it under **Disabled**, not Waiting for approval, and the admin lets them in by turning "Account active" on (the switch works on any approved account) or leaves it off. (With the variable unset, the old code makes an enabled viewer and signs them in.) So check `?status=DISABLED` for viewers created during the deploy.

   **(ay) THE SENT BACK CHIP AND THE MISSING NOTIFICATIONS (no phase number) - DEPLOYED 2026-10-23 (merges `728f754`, `742e592`; see line 3). Earlier status follows: 2 tasks, Task 1 reviewed (spec compliant, approved, 0 critical / 0 important / 7 minor; minors #1 and #2 applied in Task 2), browser tests green; CODE-COMPLETE on branch `sent-back-notify` (2026-10-23): NOT MERGED, NOT PUSHED, NOT DEPLOYED, awaiting the owner's word. No migration (40 migrations).**
   The owner asked (2026-10-23) about the red banner on Inventory: "fix these, why this is here? looks awful, also this is not showing in my notifications or whenever we sent or return back or sucessfully changes correction", and chose "A 'Sent back' chip (Recommended)". Plan `docs/superpowers/plans/2026-10-23-sent-back-chip-and-notifications.md` (no separate spec: its header records the request, what Supabase showed and the builder's calls); ledger, briefs, reports and the Task 1 review in `.superpowers/sdd/2026-10-23-sent-back-chip-and-notifications/`. Branch `sent-back-notify` is 3 code commits plus this docs commit above `main` `97e6da0` (worktree `.claude/worktrees/sent-back-notify`).
   - **Why the owner saw nothing.** The one sent-back asset on Supabase, BR-LT-1175, was returned on 21 Oct, before the bell shipped on 22 Oct, so no SENT_BACK notification was ever written for it. An admin's bell had no count and no items by design. And several of Finance's steps wrote no notification at all (below).
   - **The chip.** The banner and its class-based count are gone from `src/app/(app)/inventory/page.tsx`. `SentBackChips` (`src/components/inventory/sent-back-chips.tsx`) sits in the view-switch row after Repairs: the neutral pill plus the small amber attention dot, nothing red, no `role=status`, label `Sent back · {n}`. Its count is `readSentBackChips` (`src/server/modules/home/nav-counts.ts`), which reuses the sidebar's own nav counts (`itSentBack`, `assetsSentBackPurchasing`) and links (`/inventory?reg=needs-correction&to=TEAM`), so the chip and the sidebar can't disagree, and it counts by the team the asset was returned to, never by class: Purchasing never counts IT's. IT and Purchasing see their own; an admin sees one chip per team, each followed by `· IT` / `· Purchasing`; Finance and the viewer see none and run no query. Selected (`aria-current="page"`, a tick) while its view is open; a second click clears it. `PillLink` moved to `src/components/inventory/pill-link.tsx`.
   - **The admin's bell.** `readableTeams` (`src/server/notifications/queries.ts`) is the one place that widens reads: a team member always reads their own team, an admin every team or the one asked for, a viewer none. The admin's count sums every team, the tabs are the same, each item carries a small team pill (IT / Purchasing / Finance), and Mark all read writes reads for that admin only (`NotificationRead` is per person: no schema change). `/notifications` gives an admin "All teams" or one team through a Team select; the "Admins aren't notified" line is gone.
   - **The new notifications** (all `CHANGED`, all through `notify(tx, ...)` inside the action's own transaction, after its guarded writes, so a refused or rolled-back action writes none; the actor's own team is still never rung). Helpers in `src/server/modules/finance/review-notify.ts`: `correctionTeams` (reads the audit trail, newest first: the latest return-or-resubmit decides, a send-back Finance undid is skipped; the team is the resubmitter's, an admin's falls back to the team it was returned to, then the class's), `notifyAssetsByTeam` (collapses past 3 assets to one team) and `FINANCE_WORDS`, the one definition of every string:
     - Finance approves a corrected asset (`confirmAssetDetails`, `approveGroup`): `{tag}: Finance accepted the correction` to the correcting team, on the asset; past 3 to one team, `{n} corrections accepted by Finance` on `/inventory`.
     - A PO's last asset approved (`emitIfPoFullyApproved`, once, behind the `completedAt` stamp): `{ref}: Finance approved all its assets` to Purchasing, on the PO. Purchasing closing the last units short is not news to Purchasing.
     - `undoFinanceAction` / `undoGroupAction` of a send-back: `{tag}: Finance took back the send-back` (collapsed `{n} send-backs taken back by Finance`) to the team it was sent to.
     - Undo of an approval of a corrected asset, `reopenFinanceReview`, `reopenGroup`: `{tag}: Finance reopened its review` (collapsed `{n} reviews reopened by Finance`) to the correcting team, the reason as the body. A plain approval undone notifies nobody; no notification is ever deleted.
     - `undoPoSendBack`: `{ref}: the send-back was taken back` to Purchasing, on the PO.
   - **Rulings worth keeping** (ledger): the group undo and reopen notify too, with the collapse copy above (the builder's call, accepted); an undone approval notifies only for a corrected asset (only the team that heard "accepted" hears "reopened"); an admin gets one chip per team. Task 2 applied review minors #1 (`FINANCE_WORDS.poApproved` / `poSendBackUndone` were dead while the same strings were written inline: both sites use them now) and #2 (the three hand-rolled single-asset notify blocks go through `notifyAssetsByTeam`) in `d2194f0`, with a new `review-notify.test.ts`.
   - **Open minors (parked).** #3 `/inventory` re-reads the two sent-back counts the layout already read for the sidebar (one or two cheap indexed counts). #4 the correcting team is the resubmitter's current role, not their role at the time (the audit row stores none). #5 an approval undone or reopened and then given again sends "accepted the correction" a second time (consistent with the "reopened" in between). #6 one unit test calls `notify()` directly rather than a new call site. #7 when the open Sent back view's team drops to 0 the chip, and its "click again to clear", disappear (the sidebar and class pills still leave the view).
   - **Browser tests.** New `e2e/sent-back-notify.spec.ts` (8 cases): Finance sends BR-HS-0502 back to IT through its asset page; IT's bell (Sent back tab) has it and the chip `Sent back · 1` opens IT's Sent back view, selected there, cleared by a second click; Purchasing (on `/inventory` and `?cls=IT`), Finance and the viewer get no chip; IT marks it corrected, the chip goes, Finance's To check has "... corrected by IT, to check again"; Finance approves and IT's Changed has "BR-HS-0502: Finance accepted the correction" (once, on the asset); the admin's bell reads 3, All holds 3 and Sent back, To check and Changed one each, every item with its team pill; `/notifications` defaults to All teams and filters to IT; the admin's Mark all read ("3 notifications marked read") writes no one else's reads and IT stays at 2, Finance at 1; a group of 4 corrected IT laptops approved in one go gives IT exactly one "4 corrections accepted by Finance" (no per-asset row); approving PO-0991's last laptop stamps `completedAt` and gives Purchasing "PO-0991: Finance approved all its assets" on the PO; the chip counts by team (an IT-class asset sent to Purchasing is Purchasing's chip, a Purchasing-class one sent to IT is IT's; the admin sees `Sent back · 1 · IT` and `Sent back · 1 · Purchasing`); axe (moderate and above, plus the promoted rules) on Inventory with the chip and on the admin's open bell, light and dark. `finance-registration-depreciation` case 14's title no longer names the removed banner's "Show them" link. No e2e asserted the banner's words, so nothing else needed repair.
   - **Tests.** vitest **312 files / 5,118**; `tsc` and `eslint` clean. Browser (foreground, `--workers=1`, port 3100, `CRIS_MODEL=fake`, reseeded first and last, chunks of at most 4 files, each bounded by `--global-timeout=540000`): the new spec 8/8; `po-intake`, `po-form`, `purchases`, `finance-undo` 52/52; `finance-registration-depreciation`, `phase-47-finance`, `home-finance`, `phase-46-home` 54/54; `inventory-ux`, `registration`, `it-work-ux`, `direct-lifecycle` 47/47; `asset-classes`, `phase-42-sidebar`, `scanner`, `stock-lots` 46/46; `axe-sweep` 9/9: **216 tests in 18 files**. Two runs crossed a dev-server memory restart (`phase-46-home`'s sidebar case timed out on `page.goto` and the chunk's last 7 didn't run; `asset-classes` case 17 likewise); each file then passed alone, 13/13 and 20/20. The rest of the battery was not run. No product bug turned up.
   **Next:** the owner's word; then the controller merges `sent-back-notify` (`--no-ff`, secret scan first), pushes (no migration, so no dump is needed), smoke-checks staging (the chip, an admin's bell), and this block and line 3 say "deployed".
   **(az) WORKLIST SPLIT VIEW (H4) (no phase number) - DEPLOYED 2026-10-23 (merges `728f754`, `742e592`; see line 3). Polish deployed the same day (merge `ca812c2`): action buttons never break their labels, a single 'Category: All' menu replaces the clipped chips, the queue description wraps to two lines, and return history reads '{holder} returned it · recorded by {actor}'; checked live as IT at 1440x900. Earlier status follows: CODE-COMPLETE on branch `worklist-split` (2026-10-23): all 4 tasks, Tasks 1-3 reviewed (each clean after one fix round), final whole-branch review "approve" (0 critical, 1 important, 8 minor; all fixed in its fix wave), browser tests green; NOT MERGED, NOT PUSHED, NOT DEPLOYED. No migration (40 migrations); the one new audit action code is `lifecycle.triage.undone`.**
   The owner asked (2026-10-23) to "improve the work list ui", then "all is cluttered and too many distractions", "i dont want infinite or scrolling much", and approved mockup H4 ("okay lets do it"; board `H4 · H3 with more information`, file `Split4.dc.html`, artifact `WsCCYGzni68cjY9Fc1tfsA`). Plan `docs/superpowers/plans/2026-10-23-worklist-split-view.md` (no separate spec: its header records the request and the builder's 14 calls); ledger, briefs, reports and reviews in `.superpowers/sdd/2026-10-23-worklist-split-view/`. Branch `worklist-split` is 17 commits above `main` `97e6da0` (worktree `.claude/worktrees/worklist-split`).
   - **What changed.** `/inventory/work` is one screen (`src/components/worklist/`): the header ("Worklist", "{n} waiting on IT", "{n} overdue" in red only when some are, "Cleared today {n}"), eight queue tabs that are links with counts (Triage, Repairs, IT check, Purchase reviews, New hires, Loans, Missing & records, Approvals & leavers; "50+" when capped), the open queue's summary stats, filters (category chips, Over 90 days, "Search tag, model, person") that give way to a bulk bar while rows are ticked, a sortable table of 52 px rows, as many a page as fit (6 to 10: measured on the table's box, so 7 at 1440x900 and 6 at 1280x720 while Cris shows, 9 and 6 with Cris tucked away, 10 at 1920x1080 and on phones), with the cap note "Showing the first 50 — clear some to see more" and "See all →" (to the queue's own list) on a capped queue's last page, Purchase reviews also linking "Open in Purchase orders →" beside its title, and a details panel (identity, the hand-back or request note, real facts, the last 3 lifecycle events, the queue's actions, "Open the full record →", "Hide until tomorrow"). Triage decides in the panel (Keep as spare the one primary, Send to repair, Dispose and Donate with an inline reason and Confirm); IT check has Mark checked; Loans has Set due date ("Set the due date for {tag}"); other queues keep their link as the panel's primary. A decision takes the row off and selects the next one, with focus on its first action (or the empty state). Keep as spare and Send to repair carry Undo from the toast, for the same person within 15 minutes and only while the asset is unchanged since. `?q=&page=&sel=` hold the place (replaceState). Below 1100 px the panel is a Drawer; below 640 px the rows stack with each value under its column's name. A viewer sees facts and links, no ticks or buttons. Home's Needs you is unchanged.
   - **Server (Task 2).** `undoTriage` / `undoTriageMany` (row lock first, `updatedAt` must equal the decision's recorded `version`, no later blocking audit entry, no open request; writes `lifecycle.triage.undone`), `triageMany` and `verifyMany` (one transaction per item, at most 100, "{done} done, {failed} couldn't (changed by someone else)"), `clearedToday` (this person's worklist decisions since Manila midnight, undo-adjusted). `triageAsset` and `verifyAssetDetails` return the audit id. Two assets are locked in id order; a deadlock reads as "Changed by someone else since — try again". The toasts' live region is `role="status"` (each fault toast its own `role="alert"`).
   - **Task 4 (this block's last task).** `3d98388` the carried fixes: a refused row the refresh drops (the last one) sends focus to the empty state; a decision's answer never pulls focus out of a text field; stacked labels read "Waiting: 200 days" (an sr-only colon); the drawer closes for good when the last row clears, so an Undo doesn't reopen it; bulk bar buttons are `aria-disabled` with a guard while busy. New `e2e/worklist.spec.ts` (14 cases, its own 60 fixture spares `BR-WL-0001…0060`): one screen at 1440x900; Keep as spare → the next row and its focused Keep as spare, the toast's Undo restoring the row, its selection and Cleared today (which also proves the decision's `updatedAt` survives the real Postgres round trip); focus on the empty state; Dispose gated on a reason; two rows sent to repair with one Undo; filters, sort (the first Status click puts the late loan first), paging, URL `sel` through a reload and a stale `sel` falling back to the first row; the 1024 px drawer (Enter focuses its first action, Escape returns to the row, decide → next inside it, the last row closes it); the 375 px stacked list; a viewer; a decision refused after another session's triage (toast "Changed by someone else since — try again", the selection and focus moving on, also on the last row); Undo after a later change refused with "Changed by someone else since — open the record" and nothing written; axe in light, dark and at 375 px. Repaired: `it-work-ux` 8-11, `direct-lifecycle` 8, `paging` 9, `phase-40-work` 1 (the old group heading's link became "Open in Purchase orders →" beside the queue title in the fix wave; the spec reaches the list directly), `custody` 10, `oversight` 6, `home-finance` (See all, then the Approvals & leavers tab; hiding a new hire), `offboarding`, `deadlines` 3, `department-owned` 13c.
   - **Product fix from the browser run.** `96c3f9d` while Cris shows, `#main` ends with Cris's 88 px clearance (`cris-widget.css`), so the "one screen" scrolled the document by exactly 88 px at 1440x900; the screen and row heights now give that room up (`var(--cris-clear,0px)`), and the chrome estimate is 404 px (400 left the table 2 px short).
   - **Timing.** The largest bulk the page can tick is the queue's cap, 50 (Triage reads at most 50; the server takes up to 100): 50 Keep as spares in about 0.9 s from click to toast, and their Undo in 0.9-1.1 s (three runs, local Postgres, dev server).
   - **Final review fix wave (`0a7b25e`, `ae4e808`).** Rows per page (ruled): rows are a constant 52 px and a ResizeObserver on the table's box sets the page size with the pure `rowsThatFit` (6-10); `paginate` and `pageOfKey` take it; on arrival the URL's `sel` wins over its `page`, and a size change recomputes the page index (the URL follows). I1: focus after a decision is a `useReducer` counter, and a changed-elsewhere refusal's refresh moves focus again only when the refused row was still the selected one or focus fell to the body, so ↑/↓ afterwards stay in the table. M1: `triageAsset`, `triageMany`, `undoTriage` and `undoTriageMany` refuse a role that can never triage IT before any lock or rate check (the per-item gate stays). M2: explicit `table`/`rowgroup`/`row`/`cell` roles (WebKit drops the implicit ones when the rows stack). M3: the toast region is named "Notifications", and the banner `getByRole("status")` lookups in `holds`, `po-intake`, `purchases`, `transfers` and `direct-lifecycle` are scoped to `main`. M4 (ruled: restore the path): "See all →" from `SEE_ALL_HREF` beside the cap note, and "Open in Purchase orders →" on Purchase reviews; `paging` 9 asserts the href again. M5: Oldest is computed from the live rows. M6/M7 (ruled): bulk items read "Changed by someone else since — try again" whichever core threw, and every deadlock read as changed-since logs `console.warn("[lifecycle] deadlock read as changed-since", { action, assetId })`.
   - **Known limits (recorded, not fixed).** Undoing Send to repair emits no webhook (the repair's EXECUTED approval stays; the undo is an audit entry only). The IT Overview's "To repair" trend still counts a repair that was undone. Three older bulk writers still lock nothing in id order: `bulkAssign`, `bulkChangeStatus` and `assignReserved` (`src/server/modules/lifecycle/actions.ts`). Rows per page are 6 to 10, as many as fit; at 1280x720 while Cris shows in the corner the table's box holds only four 52 px rows (231 px under its head), so the six shown scroll about 82 px inside the table (the document never scrolls); with Cris tucked away six fit exactly (`worklist.spec.ts` 1b). Two changed-since sentences remain by design: "— open the record" for an Undo, "— try again" for a decision or a bulk item.
   - **Tests after the final fix wave.** vitest **319 files / 5,300**; `tsc` clean; `eslint` clean on every changed file. Browser (same rules; reseeded first and last): **178 tests in 17 files, green** - `worklist` 14/14 (1b a real pass at 1280x720), `holds`, `po-intake`, `purchases`, `transfers`, `direct-lifecycle`, `paging`, `phase-46-home`, `home-finance`, `it-work-ux`, `custody`, `deadlines`, `offboarding`, `oversight`, `department-owned`, `phase-40-work`, `axe-sweep` 9/9 (no moderate findings). Re-run alone after slow-machine timeouts (none reproduced): `holds` 1, `transfers` 1, `home-finance` (2 cases cut by the chunk's 540 s limit), `offboarding` 1, axe-sweep's last case (cut by the 540 s limit); the dev server was restarted twice when it reached about 6.8 GB. 50-item bulk Keep as spares 0.9-1.5 s, its Undo about 0.9 s.
   - **Tests before the fix wave.** vitest **319 files / 5,286**; `tsc` clean; `eslint` clean on every changed file. Browser (foreground, `--workers=1`, port 3100, `CRIS_MODEL=fake`, reseeded first and last, chunks of at most 4 files, `axe-sweep` alone): **152 tests in 14 files, green** - `worklist` 14/14, `it-work-ux`, `direct-lifecycle`, `paging`, `phase-40-work`, `custody`, `oversight`, `home-finance`, `offboarding`, `deadlines`, `department-owned`, `phase-46-home`, `holds`, `axe-sweep` 9/9 (no moderate findings). Re-runs: `direct-lifecycle` and `phase-40-work` after a test-side regex fix; `home-finance` after repairing its See all case; `offboarding` and `holds` 9 failed only across a dev-server memory restart and passed alone. The rest of the battery was not run (by grep, no other spec touches the Worklist; the unscoped `getByRole("status")` lookups in `po-intake`, `purchases` and `transfers` assert right after a page load, with no toast showing).
   **Next (the owner's decisions, not pre-authorised):** the merge (`--no-ff`, secret scan first) and push; no migration, so no Supabase dump is needed; then a live check of `/inventory/work` on staging.

   **(ax) DOCUMENT PREVIEW AND UPLOAD TIMES (no phase number) - 3 tasks, Tasks 1-2 reviewed (Task 2 clean after one fix round), affected browser specs green; MERGED (`0948a10`, --no-ff of `doc-preview`, tree = the tested tip), PUSHED AND DEPLOYED to Vercel 2026-10-23 (no migration; 40 migrations; secret scan zero); final whole-branch review: ready to merge, its 4 minors applied (`692c911`); live check as IT on the one stored file (an asset's Specs.png): Preview dialog named 'Photo', 'Uploaded 20 Oct 2026 23:13 · System Admin', image shown, no error, Esc closes; `?inline=1` 200 inline + nosniff, plain link 200 attachment. No PDF is stored on Supabase yet, so a live PDF preview is unchecked; branch and worktree removed
   The owner asked (2026-10-23) to preview uploaded images and documents without downloading them, and to see when each was uploaded, "proceed until deployment". Plan `docs/superpowers/plans/2026-10-23-document-preview.md` (no separate spec: its header records the request and the builder's calls); ledger and reports in `.superpowers/sdd/2026-10-23-document-preview/`.
   - **What changed.** One shared Preview dialog (`src/components/files/file-preview-dialog.tsx`: `FilePreviewDialog`, `PreviewButton`, `HeldPreviewButton`) on all 11 surfaces that list files: the PO page's four slots and Other documents, the PO form's slots (saved and held), the Finance review viewer and plain table, vendor documents, the inventory Documents tab, the asset Attachments tab and `DocPreview`, a stock lot's documents, and the employee Form tab (latest and History). A PDF shows in a frame and a PNG or JPG as an image, fitted to a dialog that fills a phone and is about 90vw x 85vh from `sm` up; the header (title, file name, "Uploaded 22 Oct 2026 09:41 · A. Reyes", Open in new tab, Download, Close) never scrolls away. Anything else says "This file type can't be shown here" with Download. A file held on the PO form opens through an object URL made on open and revoked on close, with "Not saved yet".
   - **Server.** `fileResponse` in `src/server/uploads.ts` serves all five download routes (PO, vendor, inventory, stock lot, acknowledgement): `inline` only for `?inline=1` on a PDF, PNG or JPG, else `attachment`, always `nosniff`, the name through `contentDisposition`. Every route's auth, ownership and class checks are unchanged. Each list's query carries `uploadedAt` (ISO) and `uploadedBy` (a name or null); the "system" and "Unknown" stand-ins are gone.
   - **Load errors.** An image uses its `error` event. A frame fires none for an HTTP error, so on load the dialog reads the same-origin frame (`frameLoadFailed` in `src/lib/file-preview.ts`): a `text/plain` document (the routes' own 404 text) or a different path (a sign-in redirect) shows "Couldn't load this file" with Download; an unreadable frame (Firefox's pdf.js) or any other document counts as loaded, so a working PDF is never hidden.
   - **Task 3 (this block's last task).** New `e2e/file-preview.spec.ts` (11 cases): one file uploaded through each route's own page, then inline and attachment headers with `nosniff` on all five; on each surface a modal dialog named by the title, described by the "Uploaded …" line, focus inside, the file loaded inline with a 200, a real PDF never shown as failed, Esc and Close returning focus to Preview; a missing stored object (a PDF and an image, the rows pointed elsewhere and put back) shows the failure and Download; a held file's object URL revoked on close; Open in new tab and Download on screen at 375 px; axe on the open dialog in light, dark and at 375 px. Repaired: `po-form` (the held and stored Preview are the dialog), `stock-lots` (the lot document's Download link), `department-owned` (the file name is a button); `suppliers` and `purchasing-ext` asserted "No vendor matches." by text, which has matched twice (the list line and the combobox's sr-only status) since the PO form redesign; they now assert the list's line.
   - **Product fix from the browser run.** `e74ee9a` a stock lot document's kind showed raw ("delivery-receipt") on its pill and as its Preview's name: the Server Component `lots-card.tsx` imported the labels from the Client Component `lot-document-dialog.tsx`, which a server module sees only as a reference. The labels moved to `src/lib/stock-schema.ts`; `lots-card.test.tsx` pins the import.
   - **Known limits.** Headless Chromium has no PDF viewer: the frame stays blank (a readable empty page at the file's path), which the dialog correctly treats as loaded; a real PDF render was not seen in a browser here. Android Chrome has no in-frame PDF viewer either: Open in new tab and Download stay in the header. Esc does nothing while focus is inside a PDF viewer's frame (the viewer owns the keyboard); Tab out or use Close.
   - **Tests.** vitest **310 files / 5,083**; `tsc` and `eslint` clean. Browser (foreground, `--workers=1`, port 3100, `CRIS_MODEL=fake`, reseeded first and last, chunks of at most 4 files): the new spec 11/11 and every spec that touches documents, **238 tests in 19 files**, green (`file-preview`, `po-form`, `stock-lots`, `department-owned`, `suppliers`, `custody`, `phase-47-finance`, `purchasing-ext`, `asset-classes`, `finance-registration-depreciation`, `registration`, `rate-limit`, `register-labels`, `it-core`, `directory`, `import-export`, `no-long-scrolls`, `stock`, `axe-sweep` 9/9). Two cases failed only across a dev-server memory restart and passed alone; the first axe-sweep run was cut by the laptop sleeping and passed in full on re-run. The rest of the 687-test battery was not run (by grep, no other spec touches a document surface).
   **Next:** the controller merges `doc-preview` (`--no-ff`, secret scan first), pushes (no migration, so no dump is needed) and runs the smoke check plus a live Preview check on staging; then this block and line 3 say "deployed".

   **(aw) THE A3 PURCHASE ORDER FORM AND THE VENDOR WORDING (no phase number) - CODE-COMPLETE on branch `po-form-redesign` (2026-10-22): all 9 tasks, every task review clean, browser battery green; NOT MERGED, NOT PUSHED, NOT DEPLOYED. Adds migration 39 as two files, `20261023090000_po_form_fields` and `20261023091000_po_form_defaults` (40 migrations; `main` and Supabase stay at 38 until the merge and push).**
   Spec `docs/superpowers/specs/2026-10-22-po-form-redesign-design.md` (the owner picked board A3 on the "New Purchase Order Redesign" canvas, artifact `1p5iEzQu1s3rZ3jDXc8n5Y`; calls marked "my call" are the builder's), plan `docs/superpowers/plans/2026-10-22-po-form-redesign.md` (Tasks 1-9; Task 9, the browser tests and these docs, ran last). Branch `po-form-redesign` is 27 commits above `main` `f57c4cc` (worktree `.claude/worktrees/po-form`; about 130 files). The SDD ledger, `.superpowers/sdd/2026-10-22-po-form-redesign/progress.md`, with every brief, report and review beside it, lives in that worktree: this block records the results, rulings and open minors.
   - **What changed.** `/purchases/new` and `/purchases/[id]/edit` are one A3 form: a sticky "On this page" rail (Vendor, Invoice & payment, Items, Documents, Totals; a tick per finished section and "N of 5 sections done"), the cards, and a sticky Invoice totals card with "When you save", "Before you save" and Save ("Save and send to IT" with IT gear on it, else "Save and register"). No native selects: vendor, category, unit and department are `EntityCombobox`es (groups, icons, tags and a footer slot, Task 4). Vendor card: the seller block (Owned & operated by, VAT REG. TIN or an amber "Not on file", Address) with Add / Edit vendor opening in a new tab. Invoice & payment: PO number (required, unique among non-cancelled POs case-insensitively; refusal `PO 2025-0418 is already used on PO-0212`), SI number, invoice date, OR number, Paid by (Credit card / Debit card only), For department. One card per item: description, specs, category (grouped IT gear / Office & facilities, with **Create "X" as… IT gear / Office item** when nothing matches: an office item is confirmed at once, IT gear is usable straight away but "New · IT confirms" until IT confirms it or swaps it at Register; an other-class name is refused), qty with − / +, unit (`pc, box, set, pack, roll, m, unit`), unit price, amount, Duplicate / Remove. Four document slots (sales invoice required on a new PO; official receipt, delivery receipt, warranty slip) with thumbnails, Preview / Replace / Remove and drop zones; the files save with the PO in one request and never get deleted (Replace adds, Remove marks `supersededAt`). The seven totals are typed, never computed, and only checked (Σ qty × unit price, ±₱0.01, blank discount = 0); the result is stored as `totalsConsistent`, never blocks a save, and the PO page and Finance's group review show the totals ladder with "Totals didn't add up on the PO". Legacy POs (`formV2` false) keep the new fields optional. IT's Register page asks "New category 'X' — Confirm or choose another"; the admin categories page tags unconfirmed ones "New · from a PO". New audit codes `category.create`, `category.confirm`, `category.replace`, `document.superseded`. **Supplier is Vendor** in every UI string (routes, identifiers and tables unchanged), and the vendor's `registrationNo` shows as **VAT REG. TIN**; `src/lib/vendor-copy.test.ts` guards the copy.
   - **Rulings worth keeping** (ledger): legacy = `formV2` false; the totals check is Σ qty × unit price even after close-short; migration 39b sets `confirmedAt` default now() (IT categories from a PO pass null explicitly), a `supersededById` FK and CHECKs on the totals and unit; CSV import counts as direct Register (ignores unconfirmed categories); reusing a category writes no audit; the edit form shows no Remove for a document already on file (removal is on the PO page); `MONEY_FIX_LABEL.purchasedAt` stays "purchase date"; the xlsx fixtures keep the old "Registration no." header (an accepted alias).
   - **Task 9 (this block's last task).** New `e2e/po-form.spec.ts` (14 cases): the owner's PCWORX invoice copied end to end (PO 2025-0418, SI 44511, 2025-11-22, Credit card, 1 box Belden Cat6 305 m, "Network cable" created as IT gear, totals 9,100.00 / 975.00 / 8,125.00 / – / 8,125.00 / 975.00 / 9,100.00 going green, a PNG sales invoice; lands With IT with the ladder, IT's bell 1); the duplicate PO number; totals ₱1 off (amber, saves, "Totals didn't add up"); IT confirms Network cable at Register and the admin tag goes; a stale form reusing it and the Office-item refusal; the rail ticks and its Totals link; axe light and dark plus 375 px; the Vendors nav and VAT REG. TIN; then the browser-only checks carried from Tasks 4-7: the totals status (neutral while right but incomplete, amber only when a line is wrong, green when complete), document slots on the form (thumbnail, drop, the highlight holding over the zone's icon, Preview, Replace, Remove, a refused type) and on the PO page (Preview inline, Replace, Remove, two uploads at once each keeping its own spinner), focus after a failed save (the qty input, the server-refused file's Replace, the rate-limit notice in view), the layout at 1280 and 1366 px, and the category footer by keyboard (Tab, Shift+Tab, Escape, Enter). Shared steps in `e2e/fixtures/po-form.ts` (`fillMinimalPo`, `pickCombo`, `fillItem`, `savePo`, …) beside `login.ts`, holding no data, plus `e2e/fixtures/sales-invoice.png`. Repaired against the new form: `po-intake`, `purchases`, `purchasing-ext` (case 5 attaches the sales invoice through its slot; "Document kind" no longer offers it), `suppliers` case 6, `quick-forms` case 5, and `stock` case 7 (the empty-list words now sit beside the listbox).
   - **Two product fixes from the browser run.** `a2dadf1` the form cards' flex basis 540 → 420 px, so the totals column stays beside the cards at 1280-1366 px with the app sidebar and rail (it wrapped under the documents, ~1,900 px down, which spec §2.1 doesn't allow above phone width). `3cb9ccc` `EntityCombobox` puts "No … matches." beside the empty listbox instead of as an `<li>` in it (axe: aria-required-children critical, listitem serious) - this touches every combobox in the app, not only the PO form; unit test in `entity-combobox.test.tsx`.
   - **Open minors (not fixed, owner's call).** The sticky totals card is about 1,070 px tall, so on an 800 px-high screen its Save button comes into view only at the bottom of the form (the totals inputs stay in view while scrolling). The "server refuses a held file" focus case is reached in the test by retyping the file in the page (the browser's own check passes the same rules), so it proves the focus path, not a real refusal. Preview of a held PDF is checked only for a PNG (headless Chromium downloads PDFs instead of showing them). Carried from the ledger: `createdById` on a category can lose its user (SET NULL); the PO register model imports a client component's type; a reused category writes no audit row.
   - **Tests.** vitest **297 files / 4,980**; `tsc` and `eslint` clean. Battery: **674 tests in 62 files**, foreground chunks of at most 4 files, `--workers=1`, port 3100, `CRIS_MODEL=fake`, reseeded first and last (the new spec first, then the repaired specs, then the rest, `axe-sweep` alone): **673 passed, 1 skipped (quick-login's environment-dependent case), 0 failed** after re-runs. Failures that passed alone, all environment: the dev server restarted itself 7 times at its memory threshold during the run, and the tests caught mid-restart timed out in `page.goto` or the sign-in prefs sync (`purchasing-ext` 8, `stocktake` 4, `approvals-audit` 2 cases, `back` 3, `deadlines` 3, `finance-undo` Undo, `it-nav` 1, `own-tags-types` 1, `receiving` 2 cases); `auth-shell` was cut off by one chunk's 540 s limit and re-run in a smaller chunk.
   - **Final fix wave (2026-10-22, after the final review; still CODE-COMPLETE, NOT MERGED, NOT PUSHED, NOT DEPLOYED, no new migration).** `e1be8df` I1 the totals card is capped to the screen and scrolls inside itself with Save pinned to its bottom edge (Save in view on load at 1366x768; stacked under 900 px unchanged) and I2 the combobox's empty words are a `role=status` the input's `aria-describedby` names; `57f3d5d` M1-M7 (edit page revalidated on upload/replace, Send back offers Fees only on a legacy PO with a fee, a new PO's id minted first so its files sit under `requests/<poId>/`, a category gone mid-save named on each line, `formatTypedMoney` shared by the edit form and Fix dialog, "iPhone case" keeps its case, `PoRegisterLine` in `src/lib`); `fb0e6d7` e2e: the stock no-match check scoped to its popup, the held-file refusal labelled SIMULATED with a `finally` restore. vitest 298 files / 4,992; tsc and eslint clean; browser re-run (port 3100, `--workers=1`, reseeded first and last): po-form, stock, po-intake, purchases, purchasing-ext, suppliers, no-long-scrolls, axe-sweep - 89 passed, 0 failed (one axe-sweep case re-run after the dev server restarted on its memory threshold). The open minor about Save below the fold is fixed. A residual round after the re-review (`085764c`): the sticky, capped totals card now follows the form row's width (a container query), so a card that wraps under the item cards (about 900-1290 px with the sidebar, or 125% display scaling) is never capped to nothing and Save stays reachable (browser cases at 1000x768, 1100x768 and 1366x768); every picker has one always-present visually-hidden status that says when nothing matches; new POs mint a plain UUID before their files are stored (the hand-rolled cuid is gone); the cap re-measures on content resize. vitest 297 files / 4,990; browser re-run 86 passed, 0 failed.
   **Next (the owner's decisions, not pre-authorised):** the final review of `po-form-redesign`, then the merge and push. The push migrates: take a Supabase dump first, as for (au).

   **(av) THE CRIS LOGIN REDESIGN (the owner's blob-style "Cris Login Redesign" artboard, 2026-10-21; Task 10 on `po-intake`, no phase number) - CODE-COMPLETE on branch `po-intake` (2026-10-22), shipping with the Purchase Orders work (au); NOT MERGED, NOT PUSHED, NOT DEPLOYED. No migration.**
   Brief, analysis and the owner's decisions: `.superpowers/sdd/2026-10-21-purchase-orders-intake/task-10-brief.md` and `task-10-analysis.md`; report `task-10-report.md`. Commits `8a6b4ad` (feature), `c1b491c` (fix: a refused sign-in's error reaches Cris), `b8bf606` (e2e), then this docs commit.
   - **What changed.** /login and /signup are one hero: soft glows drifting behind, a stage on the left (a desk vignette inside a goo "liquid blob", Cris as the app's gold `CrisOrb` with a gold-to-blue halo, the six scenes of her day with stations and a laptop or paper flying to her side, a three-line day log: area, task, six dots) and a glass card on the right. Welcome and Log in 1/2 became **one "Welcome back" form** (Microsoft on top when on, "or sign in with email", Work email, Password with Show and a "Forgot password?" toggle for the admin hint, Log in, "New to Cris? Create an account", the domain line); no wordmark; Sign up 1/2/3 keep their copy with segment bars. Using the form (or any sign-up step) is focus mode: the room melts away, Cris moves beside the card and talks the person through it, her eye follows the caret in text fields (`--cr-look`, a small addition to `cris.css`) and looks away in password fields; leaving the untouched form sends her back. After 9 s idle, or a tap on her, she tells a fact. Phones (<720 px): she sits big and blurred behind a thinner card and peeks over its top edge in focus mode. Quick sign-in is a dashed STAGING pill bottom-left that opens a glass popover (keyboard: Enter opens and moves into the picker, Escape closes back to the pill); a `?quick=refused` load opens it with the banner, and "None of the listed accounts exists or is enabled." stays.
   - **Owner decisions (binding).** The signed-in sequence ("Checking your badge…" → "Opening your dashboard…", a status every 1.25 s, a progress bar, Cris in the middle) plays **only while a sign-in request is in flight** (credentials, Microsoft or quick sign-in; after 300 ms) and never holds the redirect; a refused sign-in brings the card straight back with its error. **Idle lines naming real people are gone**: of the artboard's seven, two remain (Raphael in Tensura; "My creator is always late too, honestly."). The label stays **Work email**.
   - **Accessibility over the artboard.** The primary gradient runs accent-hover → accent in light (the artboard's `#3b82f6` end put white text at 3.7:1) and accent → `#9cc9f0` with dark text in dark; the STAGING pill is full-strength `text-secondary` (the artboard's 40% opacity was ~1.7:1); a visible **Pause motion** button (bottom-right, `aria-pressed`) stops the blob, the glows, the day and the room's loops, and `prefers-reduced-motion` never starts them; inputs keep the kit's focus ring; the stage is `aria-hidden` with nothing focusable in it; the heading still takes focus on a step change.
   - **Kept as before:** all four server actions, the field names (`email`, `password`, `name`, hidden `next`), the client checks (sign-in still skips the domain check), the sign-up steps with admin approval, `card-props.ts`, `data-login-ready`, the always-present `aria-live` error regions, and "You'll start on Home".
   - **Calls where the artboard met the server:** the sequence follows `useActionState` / `useFormStatus` pending (no `{ok,to}` action change); the artboard's "Back to sign in" after the sequence is dropped (a pending request can't be cancelled); the monitor's purchase screen reads PURCHASE ORDER / PO-1042 (the artboard still said PR-1042); the placeholder stays `name@<domain>`; the artboard's Viewer sentence is not used; `?step=login` focuses the email field (scrolling it into view where the stage stacks above the card); the stage sits beside the card down to ~940 px (the artboard stacked them below ~1140 px).
   - **Retired:** `world.ts`, `room-scene.tsx`, `use-room-loop.ts`, `focus-layout.ts`, `forward-cris.tsx`, `day-log.tsx`, `use-typewriter.ts` and their tests. New: `blob-stage.tsx`, `room-svg.ts` (the artboard's room markup, prefixed `lw-`), `use-day-loop.ts`, `use-stage-loop.ts`, `quick-sign-in.tsx`.
   - **e2e: one shared sign-in helper.** `e2e/fixtures/login.ts` (`login`, `submitSignIn`, `waitForPrefsSync`) replaces the 59 per-spec copies; it holds no data and reseeds nothing, so it is the one exception to "never import helpers across spec files". `login-cris.spec.ts` is rewritten (12 cases) and `quick-login.spec.ts` drives the STAGING pill by keyboard and now loads `.env` like the dev server, so it runs the right cases in either environment.
   - **Tests.** vitest **280 files / 4,696** (the retired files' tests went with them); `tsc` and `eslint` clean. Battery: 658 tests in 61 files, 27 foreground chunks of at most 4 files, `--workers=1`, port 3100, `CRIS_MODEL=fake`, reseeded first and last: green except `phase-47-finance` "ledger: year tabs…" (**date-dependent, not login:** BR-LT-0148 is seeded `purchasedAt: day(-720)`, which from 2026-10-22 lands in November 2024, so 2024 shows "2 mo" not "3 mo"; the five serial cases after it did not run). Flakes that passed alone: `deadlines` 8 and `offboarding` 1 (`goto /offboarding` load timeouts right after a sign-in), `finance-undo` (Undo), `it-core` (a save toast), `purchases` (viewer prefs sync, activity list).
   **Next:** the final review of `po-intake` with this task, then the merge and push per (au)'s checklist.

   **(au) PURCHASE ORDERS AND THE THREE-TEAM INTAKE (Purchasing → IT → Finance), FINANCE'S GROUP REVIEW AND THE TEAM NOTIFICATION BELL (no phase number yet; client staff stays Phase 48) - CODE-COMPLETE on branch `po-intake` (2026-10-21): all 9 tasks, every task review clean, browser battery green (environment-dependent exceptions below); NOT MERGED, NOT PUSHED, NOT DEPLOYED. Adds migration 38 `20261022090000_purchase_orders` (38 migrations; `main` and staging stay at 37 until the merge and push).**
   Spec `docs/superpowers/specs/2026-10-21-purchase-orders-intake-design.md` (the owner's answers in chat 2026-10-21; calls marked "my call" are the builder's), plan `docs/superpowers/plans/2026-10-21-purchase-orders-intake.md` (Tasks 1-9; Task 9, the browser tests and these docs, ran last). Branch `po-intake` is 26 commits above `main` `7c48269` (the spec and plan commits; this docs commit last; worktree `.claude/worktrees/po-intake`; about 225 files, +14,000 / -3,550 lines). The SDD ledger (`.superpowers/sdd/2026-10-21-purchase-orders-intake/progress.md`, with every task brief, report and review beside it) lives in that worktree, so treat this block as the record of the results, rulings and deferred minors.
   **What changed** (by task).
   - **Task 1, the rules (`98d868b`).** Pure `src/lib/intake-rules.ts` (who owns which field: Purchasing the money, IT the device, Purchasing the device of non-IT gear; `canEditField(role, field, cls, stage)` with the money stage `with-purchasing` / `with-it` / `with-finance` / `approved`; `EDIT_REASON` 5-300 characters) and `src/lib/po-flow.ts` (PO states and labels, line progress, `canRegisterLine`, `stateAfterSave`).
   - **Task 2, migration 38 and the rename (`86fe3e3`, `2dc2973`).** `model PurchaseOrder @@map("PurchaseRequest")` and `PurchaseOrderLine @@map("PurchaseUnit")` (the tables keep their names); new enum `PurchaseOrderState { WITH_IT SENT_BACK READY CANCELLED }` mapped from the old states (DRAFT → SENT_BACK, SUBMITTED and IT_REVIEWED → WITH_IT, COMPLETED → READY with `completedAt` kept, CANCELLED stays); refs `PR-` → `PO-` (sequence `purchase_request_ref_seq` kept); new PO columns (SI and OR numbers, purchase date, fees, the open send-back's who/team/fields/note), a category and `closedShort` per line, `Asset.financeReturnedTo`, `PurchaseRecord.purchaseOrderId`, and the `Notification` / `NotificationRead` tables. Every reader and the seed moved over; audit writes now use `entityType: "purchase-order"` and readers accept the old `"purchase-request"`.
   - **Task 3, the PO actions (`a8f2082`, `7ebdd16`).** `savePurchaseOrder` (no drafts, no autosave: saving sends it; IT gear → With IT and IT's bell, non-IT → Ready to register), `sendBackPurchaseOrder` (IT or Finance, ticked fields and a note → Sent back to Purchasing, Purchasing's bell), `fixPurchaseOrder` (a cross-team money fix with a reason that flows to every asset from the PO, approved ones included, and reopens an approved no-cost asset that gains a cost), `cancelPurchaseOrder`, `closeLineShort`; every action locks the PO row first and writes its notification in the same transaction.
   - **Task 4, the PO pages (`0183837`, `1d22089`).** "Purchase orders" everywhere (sidebar, breadcrumbs, titles, palette, exports, Home, login scene); "New purchase order" replaces "Register purchase"; the PO page (Purchase card, lines with "3 of 5 registered", progress stepper, the sent-back banner with Fix and reply, the missing-SI notice, documents, thread) and the send-back, fix, cancel and close-short dialogs.
   - **Task 5, register from a PO (`5f8db40`, `472d9b6`).** `/purchases/[id]/register`: one card per line with units left, "How many arrived now" (part deliveries), tags and serials per unit, money copied from the PO; each submit is one registration group and rings Finance once. IT registers IT lines, Purchasing the others; the direct `/inventory/register` is now IT's and an admin's only (`/inventory/new` too).
   - **Task 6, Finance's group review (`2e9a0c3`, `1e7620c`, `cf61f66`).** `/finance/review` lists registration groups (a PO's registered lines, or a direct batch); the group page shows the money, documents with a preview, every asset and the totals, and approves N with per-asset Hold back (to the team Finance picks) and "Not capitalised" per group with a per-asset override. Undo (15 minutes, same person) covers Approve and the PO send-back as one action each; an admin reopens a whole group. The single-asset send-back became "Send back…" with a team picker.
   - **Task 7, the bell (`1b30947`, `22f42cf`, `858f63c`).** A team bell in the top bar ("Notifications, N unread", tabs Sent back · To check · Changed · All, newest 8, See all), read state per person, polled on navigation and every 60 s while visible, arrivals announced politely; `/notifications` with Mark all read (admins pick a team); 90-day pruning (`NOTIFICATION_DAYS`). Sent back tabs and red counts (Purchasing's POs and assets, IT's assets) and Home cards "N sent back to you" / "N to check", all counted from state, never from the bell.
   - **Task 8, audit wording (`4d670a9`).** Sentences, history verbs and webhook labels for every new code; `purchase_order.approved` (`{ purchaseOrderId, refNo }`) fires once with `purchase_request.completed` when every line is registered or closed short and every asset approved.
   - **Task 9, browser tests, fixes and docs.** New `e2e/po-intake.spec.ts`; `purchases.spec.ts` and `receiving.spec.ts` rewritten; 21 other specs repaired; five app fixes (below).
   **Rulings** (from the ledger; each with its cost if wrong).
   - **R1** `fieldOwner` takes no "other"; callers pass the user's team for it (a type tweak). **R2** Task 2 kept the old new/edit pages compiling under the new states until Task 3 replaced them (throwaway code). **R3** receiving's "request must be COMPLETED" became "order must not be CANCELLED" until Task 5 removed it (nothing lasting). **R4** Task 3 added ACTION_LABELS and the `asset.money.fixed` verb, Task 8 the sentences (avoids a red suite between tasks). **R5** Task 6 added `purchase_order.approved` to `WEBHOOK_EVENTS` because it emits it. **R6** Task 6 owns the `finGroupsToReview` badge, Task 7 the sent-back counts.
   - "Nothing registered on an IT line" applies per line: registered lines can't be removed, re-categorised or shrunk below what is registered, but money stays editable while the PO is with Purchasing (spec §2 lets Purchasing fix a PO Finance sent back after registration) — a guard tweak if wrong.
   - The not-capitalised reopen (spec §5) belongs to `fixPurchaseOrder` (the spec's carve-out wins over the brief) — moving it to Task 6 if wrong.
   - Home's "Requests by state / per week / N requests completed" and the login scene's "PR-1042" counted as spec §3 "everywhere" wording gaps (the brief's grep missed them) and were folded into Task 4's fix round 1 — a few label edits if wrong.
   - `fixPurchaseOrder` carries prices as `lines[{ id, unitPrice }]`: a PO has no cost of its own.
   - On a mixed PO only an IT-line registration (or no IT/unclassified units left) moves With IT → Ready, so IT lines stay in IT's queue; once anything is registered the money stage is with-finance, so IT loses money send-back and fix on a mixed PO after Purchasing registers its chairs, and Finance can still fix or send money back (reconsider if the owner objects).
   - Direct Register (way 3) rings Finance once per submit; an admin's mixed-class single submit files one IT purchase record (rare, admin only).
   - Approval webhooks fire once through one helper, from Approve or from closing the last line short, guarded by setting `completedAt`; `completedAt` stays set after an undo, so receivers get one completion event per PO.
   - Finance's PO send-back has its own 15-minute undo (one action). `approveOne` lives in a plain (not "use server") module and `approveGroup` requires the asset ids, so the writer isn't callable from the browser and stale pages are detected.
   - Purchasing loses device-field edits on IT assets awaiting IT's check (IT owns the device, spec §2); money on such an asset stays Purchasing's with no reason.
   - Purchasing's "To register" (count, view, Home tile, the `pr.itReviewed` snapshot) = POs in READY or WITH_IT, not completed, with a line Purchasing can register and units left, so a mixed PO still with IT shows once its chairs can be registered.
   - One shared "sent back to team T" predicate (returned to T, or the legacy class rule; assets on a sent-back PO excluded): IT's count and view span both classes; Purchasing has separate PO and asset counts, views and Home cards.
   - The PO thread records `PO_FIXED` ("Fixed the …: reason") and `PO_SENT_BACK` notes (controller ruling, Task 8).
   - **After approval only Finance can add a cost to an approved not-capitalised asset** (spec §5's money lock: IT and Purchasing can no longer change it); doing so, with a reason, reopens the asset for review — the old reopen path stays, now Finance-driven (controller ruling, Task 9; `finance-registration-depreciation` cases 2 and 13 test it).
   - **A cancelled PO no longer accepts document uploads** (the page hides the upload and the server refuses): a cancelled PO is closed. This reverses Phase 18 §5.3, which let a cancelled request take more files; the ones it has stay readable (controller ruling, Task 9).
   **App bugs found by the battery and fixed in Task 9** (each its own `fix(` commit, for review).
   - `8b1e472` the bell is announced as a dialog, but opening it left focus on the bell: focus now moves to the selected tab (See all for an admin); Escape returns it. Covered by `po-intake.spec.ts` (fails without it).
   - `269926d` the PO page's missing-SI, sent-back and not-sent-yet banners were `role="alert"` on every load; `Banner` takes `live="status" | "alert"` and these three are statuses (`banner.test.tsx`).
   - `e724df9` Purchasing activity's empty state still said "Drafts, submissions and decisions" (`po-copy.test.ts`).
   - `0b34ef1` a Finance send-back's history value now carries `team` (Task 6), which fell through to "note: …; team: IT; fields: …" on the record's History tab; it reads "Cost, Sales invoice — note · to IT" (`history.test.ts`; `phase-40.spec.ts` case 5 caught it).
   - `97ac896` the PO form had lost Phase 23's quick-form key (Enter in the last line's price adds a line when it has a description); restored (`quick-forms.spec.ts` case 5).
   - `da4b97f` (review fix round 1) the group review's "can't approve yet" message (no SI number, the PO with Purchasing) was an alert on every load too; it is a status, and an action's error stays an alert (`group-review.test.tsx`; `po-intake.spec.ts` case 8).
   **Tests.** `tsc` clean, `eslint` clean on `e2e/` and every changed file, vitest **281 files / 4,714**.
   **Browser battery** (Task 9, foreground, `--workers=1`, port 3100, the dev server started with `CRIS_MODEL=fake`, the local DB reseeded first and last; 658 tests in 61 files, run in chunks of at most 4 files, each under 590 s, with the repaired files re-run).
   - **New `e2e/po-intake.spec.ts`, 12/12:** Purchasing saves a mixed PO (5 laptops + 2 chairs) and IT's bell shows 1 for the whole PO; IT sends it back over the unit price, Purchasing's bell and Sent back tab have it; Purchasing fixes the price with a reply ("Flagged: Unit price" in words) and it is With IT again; IT registers 3 of 5 laptops ("3 of 5 registered") and Finance's bell rings; Finance holds one back to IT and approves 2 (toast "Approved 2 from PO-… · 1 held back"), Undo restores all three; Finance fixes the SI number with a reason, Purchasing's Changed tab has it and the asset's Financial history reads "SI number from SI-77001 to SI-77010" with the reason; Purchasing registers the chairs and `/inventory/register` sends it away; a legacy PO with no SI can't be approved ("No SI number yet. Add it before approving.", the button disabled) and its PO page says so as a status; Mark all read for one IT person leaves a second IT person's unread; axe (moderate and above) on the PO page (sent back and ready), the group review page and the open bell panel, light and dark: clean; bell focus on open and Escape; at 375 px the top bar with the bell fits with no sideways scroll on Home, `/notifications` and a PO page.
   - **Rewritten:** `purchases.spec.ts` 11/11 (tabs and sidebar views, PR- search, the sent-back PO page, axe, saving with centavos, Purchasing's edit while with IT, cancel with a reason, the viewer, the audit trail) and `receiving.spec.ts` 13/13 (direct registration, Finance's per-asset review with the team picker, Purchasing turned away from the direct Register).
   - **Repaired (test-side):** wording and states (`home-finance`, `phase-42-sidebar` 6, `auth-shell`, `phase-40` palette, `suppliers`, `phase-40-work` 1, `phase-46-home`'s count readers and Finance's queue); Finance's "Send back…" with the team picker (`finance-registration-depreciation`, `finance-undo`, `phase-40` 5, `receiving`, `asset-classes` 16); money locks on approval, so "IT's cost reopens Finance's review" became Finance's fix with a reason (`finance-registration-depreciation` 2 and 13); Purchasing registers only from a PO (`registration` 4, 5 and 7, `asset-classes` 1, 2, 10 and 18, `register-labels` 7 and 14, `department-owned` 13a as a legacy fixture, `queues-records-ux` 10, `purchasing-ext` rewritten); IT's Approvals badge no longer adds purchase reviews (`auth-shell`, `approvals-audit`); the bell's polite live region made bare `[aria-live="polite"]` toast locators ambiguous (`custody`, `no-long-scrolls`, `offboarding`, `policies-per-group` now use `div[…]`); a hydration wait before the page clock runs (`finance-undo`); longer timeouts on multi-sign-in cases (`asset-classes` 18, `department-owned` 10, `finance-registration-depreciation` 1 and 2).
   - **Result:** every file green except **`quick-login.spec.ts`** (environment: this worktree's dev env has `QUICK_LOGIN_EMAILS`, so the default case fails and the two opt-in cases skip, or run when another spec loaded the env first). `labels.spec.ts:287` passed this time. Flakes that passed on a re-run: `offboarding` (a decision toast under load), `phase-40` 9 (kitchen-sink hydration), `asset-classes` 21. `phase-47-finance`'s Cris case needs the dev server started with `CRIS_MODEL=fake` (a reused server keeps its own env).
   - **Not checked in a browser:** Finance's per-group "Not capitalised" switch and per-asset overrides beyond the default, admin Reopen of a group, close-short, the PO send-back's Undo banner.
   **Deferred minors and follow-ups** (owner's call; none blocks a merge).
   - Task 1: `assetMoneyStage`'s FINANCE-return branch untested; the po-flow SENT_BACK / CANCELLED refusal strings not asserted. (Resolved, not open: "`poProgress` is null when every line is closed short and nothing was registered" was pinned by Task 5's test in `po-flow.test.ts` — it stays null.)
   - Task 3: an asset audit is written even when its guarded `updateMany` hit 0 rows; the resubmit state ignores edited line classes (Finance's resubmit adding an IT line → READY without IT's bell; IT's resubmit removing every IT line → WITH_IT); a closed-short-only line gets "has assets registered"; IT gets Finance's "Fix it yourself" message; a test title overclaims; the cancel reason is now 5-300.
   - Task 4: Close short shows on every legacy line; the fix dialog's aria-label drops the line description; the send-back "Other" note isn't marked required and its error isn't tied to the fieldset; the fix dialog trims the SI for the compare but sends it untrimmed; the cancel dialog keeps stale input on reopen; the lines' required columns are unmarked; `queries.ts` `findUnique` indentation; "Edit it and save to send it on" shows to IT and Finance.
   - Task 5: the bell title "1 office chairs" (use "1 × office chairs"); serial duplicates checked across classes in one admin submit; a float sum for the `purchase.recorded` total (use centavos).
   - Task 6: `updateAsset` reads permission outside its transaction and its write isn't guarded on `financeConfirmedAt` (an approval race lets Purchasing change money without a reason); the single `returnAsset` takes no `lockPo` and can overwrite a PO-level return while SENT_BACK; the undo audit scan is capped at 500 entries; `sendBackSchema` is test-only and `returnSchema` / `holdBackSchema` untested; hold-back notifications stay after a group undo; the SENT_BACK bell stays after a PO send-back undo (the tab counts state, so it clears); `TimedUndoBanner`'s `mb-4` doubles spacing in the group review; Finance send-backs from before the deploy have no batch id, so their undo is refused; the undo action tests weren't written red first.
   - Task 7: the layout re-render raising the initial count isn't announced; a route-change poll doubles function calls (consider a GET route and a throttle; check the StuckNavGuard interaction); `purchasingToRegisterIds` runs twice per page (wrap in `cache()`); a stray `to` chip without the reg filter; the bell is unit-tested only as static markup; the announce timeout isn't cleared on unmount; an unused reads array in the nav-counts test; IT can read every tab of a Purchasing-class asset sent back to IT but can't edit it or download its documents; IT's export from the Sent back view leaves out Purchasing-class rows; the Registration facet's Needs-correction count in the Sent back view is one class.
   - Task 8: the `asset.money.fixed` history row says the change twice (verb and chips; chip "cost" vs verb "unit price"); `po.save`'s sentence has no subject with `omitEntity`; straight vs curly quotes; `FIELD_LABELS` invoiceRef / receiptRef now read "SI / OR number" in older update sentences too.
   - Task 9: the `/purchases` list's five state tabs are wider than a 375 px phone (as the old six were: the Tabs component doesn't scroll); carried: make `labels.spec.ts:287` and `quick-login.spec.ts` independent of the environment.
   **Deploy checklist** (merging, pushing and deploying are the owner's decisions; a push to `main` deploys to Vercel and applies migration 38).
   1. **Take the Supabase dump first** (`scripts/supabase/dump.ps1 -Image postgres:17-alpine`; URL from `$env:SUPABASE_DB_URL`, never printed). Migration 38 is lossy: SUBMITTED and IT_REVIEWED both become WITH_IT and can't be told apart afterwards, so the dump is the only way back.
   2. **Before the push, count staging's legacy rows:** `SELECT count(*) FROM "PurchaseRequest" WHERE state = 'COMPLETED' AND "completedAt" IS NULL;` (after the migration they would read `state = 'READY' AND "completedAt" IS NULL` and show in Purchasing's To register). Decide with the owner before pushing if any exist.
   3. Merge `--no-ff` after the final review, run the pre-push secret scan (the repo is public), push, and watch the Vercel build (no local `next build`; the laptop crashes under build load).
   4. **After the deploy:** 38 migrations applied; re-run `lockdown.sql` and check 0 anon/authenticated grants (the new `Notification` and `NotificationRead` tables); worker tick 200; check old refs read `PO-`, old drafts read Sent back to Purchasing, and old completed requests read Registered or Approved.
   5. Verify on staging with Playwright (never Browser-pane sign-in): save a PO, see IT's bell, register from it, review the group as Finance.
   6. Tell the owner: there are no drafts (saving sends a PO on), Purchasing registers only from a PO, Finance reviews groups at To review, and the bell rings per team.
   **Next:** the final review of `po-intake` (with the six `fix(` commits above), then the merge, the Supabase dump and the push; then Phase 48 (client staff and people flows) and Phase 49 (deeper asset management).

   **(at) PHASE 47 FOLLOW-UP (Finance sorting, Undo and clearer notifications; plus the owner's same-day additions: every sign-in lands on Home, search as you type, Employees sort; no phase number) - CODE-COMPLETE on branch `finance-undo-sort` (2026-10-21): all 7 tasks, every review approved, browser battery green (one environment-dependent failure, below); MERGED (`a591f8d`, --no-ff of `finance-undo-sort` after the final fix wave `44bc75a`..`ccc8602`), PUSHED AND DEPLOYED to Vercel 2026-10-21 (Supabase dump `backups/supabase-before-undo-20261021-1027.dump`, 45 tables, first; /login 200, worker 401 without secret); live-search production check PASSED (Playwright via quick sign-in on the welcome step: sign-in lands on /; Inventory "B"→"BR-"→"BR-L" and Employees "E" kept text, caret and URL with 0 fallback reloads; E-names first; a pasted exact tag only filters, Enter opens it, Back returns to the list). `main` = `origin/main` = `a591f8d`. NO MIGRATION (37 stays).**
   Spec `docs/superpowers/specs/2026-10-21-finance-sort-undo-notify-design.md` (the owner's answers in chat 2026-10-21: an Undo button in the toast plus 15 minutes on the asset page for the person who did it; all review actions; the sorts; §7 holds the same-day additions), plan `docs/superpowers/plans/2026-10-21-finance-sort-undo-notify.md` (Tasks 1-7; Task 4, the browser tests and these docs, ran last). Branch `finance-undo-sort` is 14 commits above `main` `1fad8a4` (spec and plan included, this docs commit last; worktree `.claude/worktrees/finance-undo`; about 100 files, +5,300 / -330 lines). The SDD ledger (`.superpowers/sdd/2026-10-21-finance-sort-undo-notify/progress.md`, with the task briefs, reports and reviews beside it) lives in that worktree, so treat this block as the record.
   **Numbering:** a follow-up to Phase 47 with no number of its own, so client staff and people flows stays **Phase 48** and deeper asset management **Phase 49**.
   **What shipped** (by task).
   - **Task 1, sorting (`96010ed`).** Finance → Assets' Sort select: Book value high/low, Cost high/low, Date approved newest/oldest, Date added newest/oldest, Purchase date newest/oldest, Life used, Tag (`sort=book|book-asc|cost|cost-asc|approved|approved-asc|added|added-asc|purchased|purchased-asc|life|tag`; unknown falls back to `book`). Rows with no value for the key (not approved, no cost, no purchase date) sit last in tag order in both directions. A small date line under the Finance pill follows the sort: "Added 16 Oct 2026" / "Bought 16 Oct 2026" on those sorts, otherwise "Approved 17 Oct 2026" when approved (Manila dates, `data-date-line`). The export follows the list.
   - **Task 2, Undo and admin Reopen on the server (`25e823c`, `dfacb72`).** `src/lib/finance-undo.ts` (pure: `undoCheck` / `undoState`, `UNDO_WINDOW_MS` 15 min) and `src/server/modules/finance/undo-actions.ts`: `undoFinanceAction({ assetId, kind })` for `approve` (Approve and Approve as not capitalised), `send-back` and `settings` (override set or cleared): same person, within 15 minutes by server time, and the action must still be the asset's latest finance-relevant change; otherwise "Can't undo: …" with the reason (for example "Can't undo: Ivan Tan resubmitted the asset to Finance at 10:44."). It locks the asset row (`FOR UPDATE`), re-reads and re-checks inside the transaction, applies the reversal with a state-guarded write and appends `finance.confirm.undone` / `asset.return.undone` / `depreciation.override.undone` (`source: "web"`; the original entry stays). `reopenFinanceReview({ assetId, reason })`: admin only, approved assets only, reason 5-300 characters, any time; writes `finance.confirm.reopened` with the reason. The original writers now record their before-values (`notCapitalised`, the hidden `resubmitNote`, an overwritten send-back, a cleared override's values), and the override writers read and guard inside their transaction. New codes are in `AUDIT_ACTIONS`, `ACTION_LABELS`, the Financial history verbs ("undid the approval", "undid the send-back", "undid the depreciation settings change", "reopened the review") and `auditSentence`.
   - **Task 3, toasts, the banner and Reopen (`9a98a50`, `392ca03`).** The toast takes a detail line and up to two buttons (`push(message, tone, { detail, actions })`; the old single-button call is unchanged for every caller); action toasts live 10 s (was 8 s), pause while hovered or focused, errors stay until dismissed. Copy (`src/lib/finance-review-ui.ts`): "Approved BR-LT-0201" with "Depreciation starts Oct 2026 · ₱2,131.11 a month" (the figure is the engine's `depreciate()`, never re-derived) and "Next: BR-LT-0204 · 3 left to review" or "Nothing left to review", buttons Undo and "Open BR-LT-0201"; "Approved X as not capitalised"; "Sent X back to IT" with "Flagged: …"; "Saved X's depreciation settings" with "48 months, ₱0.00 salvage" or "Cleared X's depreciation settings"; a successful Undo says "Undid the approval of X" and opens the asset; a refused one is an error toast with the server's reason. **The Undo banner** at the top of the Finance asset page, for the person who did it, for 15 minutes: "You approved this at 10:42 · Undo (12 min left)" (also "You sent this back at …", "You changed the depreciation settings at …"); the minutes are re-read every 30 s and a timer at the deadline removes it; not a live region; the button is real. **Reopen review** in the header for admins on approved assets: a dialog with a reason, the confirm button danger-styled, Cancel disabled while pending, and focus lands on the review box that replaces the button. Activity-feed dots for the new codes.
   - **Task 5, sign-in lands on Home (`c0c8160`).** Credentials, quick sign-in, sign-up ("Go to Cris") and bootstrap go to `/`; a safe `next` link still wins (a label QR scanned while signed out still opens its asset). A signed-in visit to `/login` or `/signup` goes to Home. `ROLE_LANDING` stays only for a page guard's bounce. Microsoft SSO is not wired (flag off), so nothing changed there.
   - **Task 6, search as you type (`7c11b62`, `69706ea`).** Every house `SearchBox` (Inventory, Finance → Assets, Employees, Approvals, Activity, Audit, Holds) filters about 300 ms after the last keystroke or paste with `router.replace` (Enter at once; × clears; one letter is enough); the box is controlled and never remounts, so focus and the caret stay. Starts-with matches come first, each group in the list's sort: Inventory and Finance by tag, model, serial, holder; Employees by name first, then employee no., then contains. **Exact tags:** typing or pasting a full tag only filters; **Enter** asks the server (`findExactTag`, role visibility, not class-scoped) and on a hit PUSHES the record, so Back returns to the list with the search kept (the USB scanner contract). `?q=<tag>&go=1` still redirects for direct links and the e2e shortcuts only. Each keystroke cancels a pending stuck-navigation watch, and a fallback reload restores the box's text and caret. Placeholders lost "· Enter".
   - **Task 7, Employees sort (`35ff056`).** A Sort select beside Works for: Name A–Z (default), Name Z–A, Recently joined, Earliest joined, Employee no. (the list's own `sort` keys); the joined sorts show "Joined 3 Mar 2025" (Manila) under the name; a header-click sort the options don't name shows a disabled "Column order". The select is the shared `LabelledSelect` (finance markup unchanged).
   **Rulings** (from the ledger; each with its cost if wrong).
   - **No phase number** (client staff stays 48); **no separate builder check** (small spec, known code paths; the task reviews are the net).
   - **What blocks an undo:** an approval, review, cost or settings change on the asset or its purchase record, and any undo (an undo cannot be undone). Documents, attachments and notes added after the action never block it (spec §3's examples list only resubmit, cost, review and settings changes).
   - **Final at once:** a send-back that replaced an earlier send-back, and a settings removal saved before this change (no earlier values recorded).
   - **Approve-undo restores IT's resubmit reply** (the approval had cleared it): "exactly as before". Entries written before this deploy carry no `resubmitNote`, so undoing one restores a null reply; the 15-minute window makes that moot.
   - **The banner is a hint:** it is computed from the asset page's audit query; the server re-checks every Undo.
   - **`next` wins over Home** (my call in the spec, so a scanned label still opens its asset).
   - **Employees rank names, then employee numbers, then contains:** every number starts "EMP-", so one tier would bury the E-names under "E"; Employee has no email field, so email is not ranked.
   - **`findExactTag` is not class-scoped:** a scanned label opens its asset from any view the person may see (role visibility enforced).
   - **`next build` was NOT run** (the laptop crashes under build load); Vercel's build is the check at deploy. `tsc --noEmit` and the full vitest stand in.
   - **The owner said 2026-10-21 "merge push and deploy once finished"** (ledger): merge `--no-ff` and push only after the final review is clean; there is no migration, but take a Supabase dump anyway as a precaution.
   **Tests.** `tsc` clean, vitest **262 files / 4,371**.
   **Browser battery** (Task 4, foreground, `--workers=1`, port 3100, `inventory_dev` reseeded first and last; all 60 spec files in 20 runs of at most 4 files plus 2 single-test retries, each under 590 s; the axe-heavy specs alone; 645 passed (two of them on the retry), 1 known failure, 2 skips).
   - **New `e2e/finance-undo.spec.ts`, 13/13:** Date approved newest and oldest first with the "Approved …" line, unapproved rows last in tag order, Date added's "Added …"; Approve → the page moves to the next asset → the toast's Undo (scoped to `[data-toast-id]`) brings it back to To review and opens it, its history reads "undid the approval"; Approve, go elsewhere, come back, the banner's Undo (`[data-undo-banner]`); the banner goes at the deadline (Playwright's page clock run 15 minutes forward); a send-back's banner Undo refused after IT resubmitted in another browser (an error toast that is still there after 11 s, nothing written); Send back → Undo; a settings change → Undo (back to the category policy; Finance has no Reopen review); admin Reopen (a 3-character reason refused, then done; focus lands on the review box); axe on the asset page with the banner, light and dark; a sign-in lands on Home and a `next` deep link wins; Employees "E" filters without Enter with E-names first, focus and caret kept through "El"; Inventory: a pasted exact tag only filters (still the list after the pause), Enter opens the record, Back returns to the list with the search kept; Employees "Recently joined" newest first with "Joined …" lines, gone again on Name A–Z.
   - **Repaired (test-side):** the old toast copy (`finance-registration-depreciation` 1, 2 and 6; `phase-40` 5; `receiving` ×3; `asset-classes`; `department-owned`), now scoped to `[data-toast-id]`; sign-in landing on Home (`admin` re-login, `auth-shell` "every role lands on Home" and the `/login` bounce, `login-cris` 3 and 4, `quick-login`'s skipped case); the `it-core` scanner comment. `phase-40` 14 (the phone drawer at 375 px) failed once: the menu click raced the post-sign-in refresh, which is heavier on Home than on the old landing pages; it retries the click now.
   - **Result:** every file green except **`labels.spec.ts:287`** (the label QR; the worktree's `APP_BASE_URL` is loopback, refused by design; environment-dependent) and the usual 2 `quick-login` skips. One flake: `approvals-audit`'s axe case read the sidebar's current link mid colour transition (contrast 3:1) once and passed on the retry. No app bug found.
   - **Not checked in a browser:** the stuck-navigation fallback's text-and-caret restore (it only fires in a production build) and the busy state while Enter looks a tag up.
   **Deferred minors and follow-ups** (owner's call; none blocks a merge).
   - The Inventory and Employees **exports are not re-ranked** starts-with first (the Finance export is, through `computeFinance`).
   - `approvedAt` on Finance rows duplicates `financeConfirmedAt`; dates read "Sept" app-wide (en-GB).
   - Enter on a tag with no match costs one server lookup before the list search.
   - Tests that click straight after a sign-in now land on Home, whose post-sign-in refresh is heavier: if a new flake shows there, retry the click (as `phase-40` 14 does) or `goto` the page first.
   - Carried: make `labels.spec.ts:287` and `quick-login.spec.ts` independent of the environment.
   **Deploy note.** Merging and pushing follow the owner's word above, after the final review. A push to `main` deploys to Vercel; there is no migration (37 stays), but take a Supabase dump first anyway (`scripts/supabase/dump.ps1 -Image postgres:17-alpine`; URL from `$env:SUPABASE_DB_URL`, never printed), merge `--no-ff`, run the pre-push secret scan (the repo is public), push, watch the Vercel build (no local `next build`), and verify on staging with Playwright, never Browser-pane sign-in. Tell the owner: every sign-in now lands on Home, and a pasted tag no longer opens its record without Enter.
   **Next:** the final review of `finance-undo-sort`, then the merge and push, then Phase 48 (client staff and people flows, with the client-ending rule) and Phase 49 (deeper asset management).

   **(as) PHASE 47 (Finance assets redesign — the Assets list and the asset page, Option B — shared notes and attachments, and five shell fixes) - CODE-COMPLETE on branch `phase-47-finance` (2026-10-21): all 9 tasks plus the owner's Task 10 (the Disposal scene, `e9fcda0`), every review approved, browser battery green (one environment-dependent failure, below); MERGED (`ab75ba6`, --no-ff of `phase-47-finance` after the final review's fix wave `593801e`..`ccff6a8`: no BR mark in the phone top bar or setup page, attachment size checked in the browser, dead code, CSV guard), PUSHED AND DEPLOYED to Vercel + Supabase 2026-10-21 (Supabase dump `backups/supabase-before-phase47-20261021-0528.dump`, 44 tables, taken first; migration 37 applied, 37 migrations; AssetNote present; anon/authenticated grants 0; worker tick 200; sign-in page title "Sign in · CRIS"); vitest 246 files / 4,167. `main` = `origin/main` = `ab75ba6`. Adds migration 37 `20261021090000_finance_notes` (37 migrations).**
   Spec `docs/superpowers/specs/2026-10-21-finance-assets-and-shell-design.md` (written from the owner's approved mockups: the "Finance Assets Redesign" canvas, boards *Finance · Assets list* and *Option B · Ledger*; the owner's answers on notes, Disposal and settings are in its §1), plan `docs/superpowers/plans/2026-10-21-phase-47-finance.md` (9 tasks). Branch `phase-47-finance` is 20 commits above `main` `9192422` (spec and plan included; tip `c72854e` before this docs commit; worktree `.claude/worktrees/phase-47-finance`; 178 files, about +10,700 / -800 lines). The SDD ledger (`.superpowers/sdd/2026-10-21-phase-47-finance/progress.md`, with the task briefs, reports and reviews beside it) lives in that worktree, so treat this block as the record of the results, rulings and deferred minors.
   **Numbering changed again.** The owner asked for this work next, so it is Phase 47: client staff and people flows (with the client-ending rule) is now **Phase 48** and deeper asset management is **Phase 49**.
   **What shipped** (by spec section).
   - **§3 Finance → Assets list (`/finance/assets`).** Class tabs with counts (switching class clears every filter); four money cards (At cost, Accumulated depreciation with "% of cost written off", Book value "as of today", Depreciation this month with the depreciating count), scoped to class, category and status; **category tiles** (All categories plus one per category with assets: count and book value, cost on hover; 6 / 4 / 2 columns, the smallest categories folded into "Other" so the rows stay full, `?category=<id>|other`, pressing the lit tile clears it); the Phase 45 **status tiles** with a book-value line, scoped to the category; one table card with the **finance-state tabs** (All, To review amber, Sent back red, Waiting for IT on IT only, Approved, Not capitalised, No cost), a sticky **toolbar** (search, Category, Life — 6 months or less left / Fully depreciated / Not depreciating yet — and Sort — book value high first, life used most first, tag — with "N assets shown · ₱ book value" on the right), active-filter chips with "Clear all", and the **table** (Asset tag + model · holder, Category, Status, Finance, Cost, Accum. dep., Book value, Life used bar or state text; zebra, sticky head, row menu kept, a totals row for every row shown) over the Phase 45 footer. URL state `cls, category, status, fin, q, life, sort, page, per`; the Excel export honours all of them. The old status chip row, the finance chips and the old footer line are gone.
   - **§4 Finance → one asset (`/finance/assets/[id]`), Option B.** A left panel (the tag is the h1; model · category, status and finance pills; the life-used ring, book value today, "N of M months left · ends Mon YYYY", the cost-versus-depreciated bar and Cost / Depreciated / Book value / Per month; the Asset card; the Documents card whose uploaded slots open a **preview** at the top of the main column, missing ones dashed "not uploaded"); stacked above the main column on a phone. The main column has four underlined tabs in the URL (`?tab=ledger|notes|files|history`): **Depreciation ledger** (year tabs with months, total and Done / In progress / Upcoming plus All years, `?year=2027|all`; one year is an opening / charged / closing strip over a month table with this month highlighted, projected rows muted and the rounding month marked `*`; All years is one row per year whose year is a link; then the Purchase, Cost breakdown — price, delivery and fees "for the whole delivery of N", salvage, depreciable base, no taxes line — and Depreciation cards; no schedule shows today's "why" message), **Notes**, **Attachments** and **Financial history** (kinds with counts, person select, Export log CSV of the filtered entries, the lock note, entries grouped by Manila day with "Name (Role) verb", kind pill, change chips old → new, the reason in quotes, the source pill — Web app / Import / Cris assistant / Nightly job — and a Details toggle with `AUD-yyyymmdd-XXXXXX`, exact time, source, signed-in account and what it relates to; one derived System line per counted depreciation month; 10 per page). Header actions: Depreciation settings and Export on every tab. The download route gains `?inline=1` (inline for PDF, PNG and JPG only; auth unchanged).
   - **§4.2a-4.4 Shared notes and attachments.** One set per asset, on the Finance page and on **new Notes and Attachments tabs of the Inventory record** (`/inventory/[id]/notes|attachments`, badges match, no money). Read on `canSeeClass`; post, reply, resolve and upload through one `canPostOnAsset(role, cls)`: admin and finance_staff on any class, it_staff on IT, purchasing_staff on Purchasing, viewers never, refused on the server too. Notes: compose (2,000 characters, Post disabled while empty), threads newest first with one level of replies, Mark resolved / Reopen (a resolved thread reads "Resolved" on a quieter card), no edit or delete. Attachments: kind (Proof of payment, Quotation, Photo, Other) then a PDF, PNG or JPG (4 MB, the same validation and storage driver), kind filters with counts, the list (name, kind, uploader, date, size) and an inline preview; stored as `AssetDocument` kind `attachment:<kind>` with `size`, and grouped under "Attachments" in the record's Documents tab (never signable). Every write audits with `source: "web"`; focus returns to the box, the toggle or "Choose file" after each result.
   - **§5 Shell.** (1) The sidebar's width animates over 260 ms with the labels fading out before it shrinks and in after it grows (`data-sidebar-anim` on the shell only while it runs: never on the first paint, one instant step under reduced motion). (2) **Disposal** in the Finance sidebar after Assets: `/finance/disposal`, admin and finance_staff; its body is the animated **"Cris at Work"** scene (Task 10, below; it replaced the first "Still in development" empty state). (3) **"CRIS"**: the sidebar brand and the rail's switcher mark read "CRIS" with the BR mark gone, and tab titles read "{Page} · CRIS"; printed forms and labels keep "Backroom IT". (4) **Settings follow the person:** theme, density, sidebar, Home focus and workspace are saved to `UserPreference` `ui:prefs` by each toggle and by `switchWorkspace`, and a `br.uid` cookie records whose settings the browser holds; when it differs from the signed-in person, `UiPrefsSync` (in `(app)/layout.tsx`) calls `restoreUiPrefs()`, which rewrites all six cookies from their prefs (or the defaults) and refreshes once — one mechanism for every way in. (5) **Cris chats clear on sign-out (TEMPORARY, owner 2026-10-21):** `signOutAction` stamps `CrisConversation.clearedAt` and deletes the person's `CrisPendingAction` rows; the box lists and resumes only uncleared chats, while the daily limit and the admin's monthly usage still count every message. The stale-session `/logout` route is unchanged.
   - **§6 Migration 37 `20261021090000_finance_notes` (additive, no data rewritten):** table `AssetNote` (`assetId` and `parentId` Restrict, `authorId`, `authorLabel`, `body`, `resolvedAt`, `resolvedById`, `createdAt`; indexes `(assetId, createdAt)` and `(parentId)`); `AuditEntry.source` and `AuditEntry.reason`; `AssetDocument.size`; `CrisConversation.clearedAt`. All nullable. `writeAudit` takes `source` / `reason`, and `storeUpload` returns `size`. AssetNote's immutability is enforced in the app (no DB trigger, unlike `AuditEntry`).
   **Rulings** (from the ledger and the spec's builder checks; each has its cost if wrong).
   - **Numbering 47** (client staff → 48, deeper assets → 49): the owner asked for this next; cost: renumbering again.
   - **Execution subagent-driven, as Phases 45 and 46:** the owner said proceed.
   - **Settings: "defaults if none"** (spec): adopting the browser's cookies would hand person A's settings to whoever signs in first; cost: **everyone's theme, density, sidebar, focus and workspace reset once on their first page after the deploy** (owner told).
   - **Sign-in rewrite is one mechanism** (`br.uid` + `UiPrefsSync` + `restoreUiPrefs`) for credentials, quick login, sign-up, bootstrap and Entra; cost: one refresh on the first page after a different person signs in on that browser.
   - **Cris clear is soft** (`clearedAt`, rows kept): a delete would reset the daily limit and the monthly usage on every sign-out.
   - **Printed company documents keep "Backroom IT" and the BR mark** (accountability form, farewell report, asset labels); the owner named the sidebar and tab titles only.
   - **Cost breakdown has no taxes/duties line and no "total acquisition cost":** it agrees with the engine (`Asset.cost − salvage`; fees never depreciate).
   - **Asset has no location field,** so the Purchasing list shows the holder too.
   - **Sort replaces "To review first" on All;** the To review tab covers that need.
   - **Category fold:** the fewest-assets categories fold first (then book value, then name) and empty categories are dropped before the fold; tiles are about counts, as in the mockup. Expensed (not capitalised) assets are not "not depreciating yet" for the Life filter; the last-charge month counts as used.
   - **Ledger and history:** `*` only when the last charge differs from the regular one; legacy rows infer their source from the action (`import-*`, `cris`) and otherwise read "Web app"; derived depreciation lines use `DEP-yyyymm` references; the Notes badge counts threads and is amber while one is unresolved; the person filter is by actor id.
   - **A note's author role is the author's CURRENT role** (no role-at-post column; the spec is silent); cost: a role change relabels old notes (owner told).
   - **A resolved thread shows Reopen and no Reply;** the "Who to call" row was dropped (not in the spec's list); note forms submit by hand so a refused note keeps its text.
   - **Hand-rolled URL state for the closed Sort set** (accepted), and the Inventory-style table behaviour kept where Inventory has it.
   - **`next build` was NOT run** (controller ruling: the laptop crashed under build load on 2026-10-15); Vercel's build is the check at deploy. `tsc --noEmit` and the full vitest stand in. The client/server boundary moved this phase (the Attachments tab passes a function prop and must stay a Server Component), so **watch the first Vercel build**.
   **Task 9 findings (real, fixed in `dde12ad`).** (1) Tailwind v4 emits arbitrary `min-[…]` variants **before** the named breakpoints, so `sm:grid-cols-4` beat `min-[1001px]:grid-cols-6` at every width and the category tiles showed 4 columns at 1440 px; both widths are arbitrary now (`min-[640px]` / `min-[1001px]`). Any class list mixing `sm:`/`md:`/`lg:` with an arbitrary `min-[…]` on the same property has the same trap; a grep of `src/` found no other `grid-cols` doing it. (2) A resolved note was dimmed with `opacity-70`, which took its muted text below AA (axe color-contrast, serious); it is a quieter card now.
   **Task 10 (owner, 2026-10-21): the Disposal page shows "Cris at Work"** (`e9fcda0`). The owner's Design Component (an animated SVG: Cris the gold orb at her desk inside a moving liquid shape, cycling coding / debugging / reading / coffee / Claude-limit every 6 s with a speech bubble, "Currently working on it" and "Cris is {doing}.") ported to `src/components/cris/cris-at-work.tsx` (client), its script's pure parts in `cris-at-work-logic.ts` and its CSS in `cris-at-work.css` (every selector under `.caw`, classes and keyframes `caw-`, so the app's animating `cris.css` never reaches it). Same SVG, words and timing; ids per instance (`useId`, sanitised for `url(#…)`); the theme mirrors `<html data-theme>` (MutationObserver; before hydration the CSS reads the html attribute); reduced motion stops all CSS motion, never starts the phase cycle (reading stays up) and draws one still frame; nothing runs while the tab is hidden; everything stops on unmount; it scales to 375 px (the bubble in container units). The heading is an h2 under the page's h1 "Disposal"; the changing line is plain text (no live region); a muted "Recording disposals and their value will come here." sits under it; the source's "IN DEVELOPMENT" badge is kept. The source's props (pace, motion, scene) keep their defaults. **The axe sweep checks `/finance/disposal` under reduced motion:** the words cross-fade every 6 s and axe reads a mid-fade line as low contrast (the same trap as Task 9's paging case). Tests: unit (markup, unique ids across two instances, the cycle under fake timers: no timer under reduced motion, stop clears every timer, a hidden tab pauses), the page test, and the spec's Disposal case (words cycle, theme follows live, reduced motion holds on reading, no sideways scroll at 375 px, the sidebar still navigates to Depreciation); `phase-47-finance.spec.ts` 15/15 in 189 s, reseeded first and last.
   **Tests.** `tsc` clean, lint clean, vitest **243 files / 4,139** (after Task 10: **244 files / 4,153**).
   **Browser battery** (Task 9, foreground, `--workers=1`, port 3100, `inventory_dev` reseeded first and last; 59 files in 23 runs of at most 4 files, each under 590 s; axe-sweep and the new spec alone).
   - **New `e2e/phase-47-finance.spec.ts`, 15/15:** list (category tile scopes cards, status tiles, count and table; Purchasing has no Waiting for IT tab; Life filter; Life and Tag sorts; grid 6 / 4 / 2 columns, no sideways scroll at 1440 / 1000 / 375), asset page (year tabs, All years, a year link; a 120-month Building numbers 11 years and 11 All-years rows; Finance posts, replies, resolves and reopens with focus back each time; IT posts on the record's Notes and Finance sees it; PDF and PNG upload, list, kind filter and inline preview — the iframe's route answers `inline` 200; the record's Documents groups them; history notes with source, Details, the person select navigating, Export log CSV; the panel above the tabs at 375 px with no sideways scroll), shell (Disposal and IT kept out; "CRIS" in the sidebar, rail and titles, no BR mark; collapse animates with a width transition and is instant under reduced motion; person A's dark never reaches person B and comes back for A; Cris's chat gone after Sign out and back in, messages kept), and axe (moderate and above plus the promoted rules) on both Finance pages with every tab, Disposal and the record's Notes, Attachments and Documents, light and dark.
   - **Repaired for the new pages:** `finance-registration-depreciation` 3, 5, 7; `home-finance` (the register test); `asset-classes` 4; `department-owned` 13b; `phase-46-home` `pageCount()` (the toolbar's "N assets shown"). **Every `login()` helper now waits for the `br.uid` cookie** to equal the signed-in user (ruling from the Task 2 review: `UiPrefsSync` restores and refreshes on the first page after a sign-in, which raced cookie seeding and the next click — it broke `home-finance`'s breakdown link once before the wait). `phase-46-home` and the new spec start each case with no `ui:prefs` rows (a collapse saved by one case followed IT into the next case's sign-in — the settings-follow-the-person behaviour, test-side); `paging`'s axe helper settles 700 ms first (the current link's views fade in and axe read them mid-fade).
   - **Result:** every file passes except **`labels.spec.ts:287` (the label QR), environment-dependent:** the worktree's `APP_BASE_URL` is a loopback address, which `src/lib/label-qr.ts` refuses by design, so no QR renders; unrelated to this phase. `quick-login.spec.ts` skips 2 as usual (`QUICK_LOGIN_EMAILS` unset). One "Page crashed" in `home-finance`'s Focus case on the first run passed on every later run.
   - **Not checked by eye:** the Task 2 review's "the fade hides every span" (the e2e sees the hide/show steps and the width transition, not the pixels).
   **Deferred minors and follow-ups** (owner's call; none blocks a merge).
   - **No rate limit on settings saves** and `saveUiPref`'s read-merge-write is racy across two quick toggles (last write wins); the rail switcher is 44 px wide.
   - **Dead code:** `parseAssetStatus` in `src/server/modules/finance/queries.ts`.
   - **`note-forms.tsx`'s module-level `refocusAfterRefresh`** survives a tab switch mid-resolve (rare, harmless).
   - **AssetNote immutability is app-enforced only;** a DB trigger like `audit_entry_append_only` would make it a database rule. Task 1's test strictness minor is parked too.
   - **e2e cleanup rule:** a spec that posts notes on a throwaway asset or user must delete `AssetNote` rows (replies first) before the asset or user (Restrict foreign keys).
   - **Remove the Cris sign-out clear** when the owner wants history to persist (search for `TEMPORARY (owner, 2026-10-21)`).
   **Deploy note (staging is Vercel + Supabase now).** Merging and pushing are the owner's decisions, none pre-authorised. **A push to `main` deploys to Vercel and `vercel-build` runs `prisma migrate deploy`, so take a Supabase dump first: `scripts/supabase/dump.ps1 -Image postgres:17-alpine`** (URL from `$env:SUPABASE_DB_URL`, never printed), then merge `--no-ff`, run the pre-push secret scan (the repo is public) and push on the owner's word. After it: confirm migration 37 applied (37 migrations), watch the first Vercel build (no local `next build` this phase), and expect **everyone's UI settings to reset once** on their first page and **Cris chats to clear on sign-out** (temporary). Verify on staging with Playwright, never Browser-pane sign-in.
   **Next:** the owner's merge-and-push decision, then Phase 48 (client staff and people flows, with the client-ending rule) and Phase 49 (deeper asset management).

   **(ar) CLOUD STAGING (Vercel + Supabase; infrastructure track, no phase number) - CODE-READY (2026-10-20): all 4 tasks, MERGED AND PUSHED (`main` = `origin/main` = `69fb87c`, a --no-ff merge of `cloud-staging` `6dc8358`; secret scan clean) AND CUT OVER 2026-10-20: staging now runs on Vercel Hobby (production domain, kept out of this public repo because quick login is on) with Postgres + Storage on Supabase Free (Singapore); the laptop's web and worker are STOPPED (db kept; `docker compose start web worker` restarts it) after the final dump `backups/staging-cutover-20261020-2212.dump` (44 tables); restore into Supabase OK and row counts identical (44 tables, 48,765 rows); lockdown.sql re-run (0 anon/authenticated grants); pg_cron worker-tick (every minute) and worker-maintenance (hourly :05) answer 200; the owner verified sign-in, an approval and an upload; QUICK_LOGIN_PUBLIC=1 is ON for presentations (turn it off afterwards: delete it in Vercel and Redeploy); quick-login opt-in merged `90a014d`; every push to `main` now deploys to Vercel, so push only on the owner's word, and dump Supabase first when a push adds a migration. 36 migrations on both sides. NO migration, NO schema change, NO new dependency.**
   Spec `docs/superpowers/specs/2026-10-20-cloud-staging-vercel-supabase-design.md` (approved by the owner in chat 2026-10-20), plan `docs/superpowers/plans/2026-10-20-cloud-staging.md` (4 tasks). **The owner's runbook is `docs/CLOUD-STAGING.md`**: the spec's §6 steps in order, where each value comes from in the Supabase and Vercel dashboards, the env table, the dump rule and how to bring the laptop back. The SDD ledger (`.superpowers/sdd/2026-10-20-cloud-staging/progress.md`) lives in worktree `.claude/worktrees/cloud-staging`.
   - **What shipped.** The worker's step functions moved to `src/worker/run.ts` (`npm run worker` unchanged) and two routes call them: `POST /api/worker/tick` (stale leases, then jobs until none is due or 45 s is spent; `maxDuration = 60`) and `POST /api/worker/maintenance` (prune, hold expiry, today's snapshot if missing), both requiring `Authorization: Bearer <CRON_SECRET>` (401 otherwise); `kickWorker()` runs a tick via `after()` right after a job is queued, on Vercel only. Uploads go through a storage driver: local disk, or the private Supabase Storage bucket `documents` when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set (`readUpload` in all five download routes); the stated upload cap is now **4 MB** everywhere (was a wrong "10 MB"). With `SIGNUP_REQUIRES_APPROVAL=1` a self sign-up creates a disabled account that an admin enables in Admin → Users (the Disabled view). Ops: `scripts/vercel-build.mjs` (`npm run vercel-build`: `prisma migrate deploy` only when `VERCEL_ENV=production`, through `DIRECT_URL`), `vercel.json` (`sin1`, deploys `main` only), and `scripts/supabase/` `lockdown.sql`, `schedule.sql` (pg_cron + pg_net, secrets in Vault), `restore.ps1`, `dump.ps1` (both through `inventory-db-1`, or for `dump.ps1 -Image postgres:17-alpine` a throwaway container; URL from `$env:SUPABASE_DB_URL`, never printed), `counts.ps1` (exact per-table row counts, `-Target laptop|supabase`) and `smoke.mjs`.
   - **Five new env vars, cloud only:** `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SIGNUP_REQUIRES_APPROVAL`. Unset (local dev, e2e, the laptop), the app behaves exactly as before. Never set `QUICK_LOGIN_EMAILS` on Vercel; `SECRET_ENCRYPTION_KEY` must be the laptop's exact value.
   - **Not yet done (each on the owner's word):** merge and push, then the runbook's seven steps. Claude's parts: stop the laptop's `web` and `worker` and take the dump before step 3, compare row counts after step 4, run `node scripts/supabase/smoke.mjs https://<project>.vercel.app` after step 6. After the cutover every push to `main` deploys to Vercel (replacing `deploy-staging.ps1`), and the backup rule becomes: run `scripts/supabase/dump.ps1` before any push that adds a migration.
   **Numbering unchanged:** this track has no phase number, so client staff and people flows stays **Phase 47** and deeper asset management **Phase 48**.

   **(aq) PHASE 46 (Overview home for every workspace, a collapsible sidebar rail and the same views in every workspace) - CODE-COMPLETE on branch `phase-46-home` (2026-10-20): all 8 tasks, every review clean, the final review's three findings fixed and re-reviewed, browser battery green; MERGED `735e3fe`, PUSHED AND DEPLOYED 2026-10-20 (staging runs `735e3fe`, 36 migrations). Adds migration 36 `20261020090000_metric_snapshot` (36 migrations).**
   Spec `docs/superpowers/specs/2026-10-20-home-overview-sidebar-design.md` (approved by the owner in chat 2026-10-20; the decisions marked "my call" and "Builder-check rulings" are the builder's, not the owner's), plan `docs/superpowers/plans/2026-10-20-phase-46-home.md` (8 tasks). Branch `phase-46-home` is 19 commits above `main` `b0a9054` (spec and plan included; tip `d46fea7` before this docs commit; worktree `.claude/worktrees/phase-46-home`; 121 files, about +7,700 / -1,570 lines). `main` is still `f7cdd71` and staging still runs `f7cdd71`. The SDD ledger (`.superpowers/sdd/2026-10-20-phase-46-home/progress.md`, with the task and fix reports beside it) lives in that worktree, so treat this block as the record of the results, rulings and deferred minors.
   **Numbering changed again.** This phase became Phase 46, so the client-staff and people-flows phase (with the client-ending rule) is now **Phase 47** and deeper asset management is **Phase 48**.
   Why: the owner looked at five dashboard designs and picked "Overview" for every workspace: headline numbers with a trend line and the change since last week, what needs you beside the main trend, and the make-up with the biggest breakdown. They also asked for the sidebar to be collapsible in every workspace, and for Purchasing, Finance and Admin to use the IT sidebar's style (links that open into views with counts).
   **What shipped** (by spec section).
   - **§2 Nightly snapshot (migration 36).**
     - **Table** `MetricSnapshot` (`day` is the Manila calendar day, `key`, `value` BigInt: counts, or centavos for money; unique `(day, key)`, index `(key, day)`). The migration is additive and changes no data.
     - **24 keys** in `SNAPSHOT_KEYS` (`src/lib/snapshot.ts`): `it.spare/deployed/defective/missing/attention`, `approvals.open.{it,purchasing,none}`, `approvals.pastSla.{it,purchasing,none}`, `pr.submitted`, `pr.itReviewed`, `stock.low`, `stock.expiringLots`, `stock.stocktakesOverdue`, `fin.waitingC`, `fin.waitingCount`, `fin.toConfirm.{it,purchasing}`, `fin.bookC`, `admin.activeUsers`, `admin.disabled`, `admin.deadDeliveries`. Each key reads through the same query the live tile and its link use (`collectSnapshot` in `src/server/modules/metrics/snapshot.ts`), so a snapshot and the live number cannot disagree. A failed read throws and the whole snapshot is retried; a made-up 0 is never stored.
     - **Taking it:** the worker snapshots on start and whenever `snapshotDue(lastDay, now)` says the Manila day changed; the writer upserts all 24 rows in one transaction (idempotent). **A failing snapshot is retried at most every 10 minutes** (pure gate `snapshotAttemptDue`), not on every loop. Rows older than **400 days** are pruned by the existing hourly prune (`METRIC_SNAPSHOT_DAYS`).
     - **Reading it:** `metricHistory(keys, now)` returns 8 weekly points per key, oldest first (today minus 7 x k days; a missing day uses the nearest earlier row within 3 days, else null). **It fails soft:** a failed history read logs `[metric history] read failed:` and returns 8 nulls, so Home never blanks and the tiles read "Collecting history".
     - **STAGING MUST APPLY MIGRATION 36.** The first staging deploy after the merge must run `prisma migrate deploy` (the compose `migrate` service does this on `scripts/deploy-staging.ps1`, and `web` and `worker` do not start unless it exits 0; staging is at 35 today). Take the `pg_dump -Fc` snapshot first, as always.
     - **History tiles start empty.** The table is empty until the worker's first nightly run. A sparkline needs 2 collected points and a "vs last week" delta needs the row from 7 days earlier, so the snapshot-backed tiles read **"Collecting history"** until about **8 nightly snapshots** exist. Tiles built from dated rows (spend, approvals, completed requests, capitalized) have history from day one.
   - **§3 The Overview.** One layout for IT, Purchasing, Finance and Admin (`src/components/home/overview/`, model in `src/server/modules/home/overview.ts`; `src/app/(app)/page.tsx` picks the builder per workspace and runs it as one `safeSection("Overview")` with Retry; a viewer resolves to IT, read-only). The page keeps "Hello, {first name}", the viewer pill and `FocusToggle`; focus mode (`br.focus`) shows only the KPI row and Needs you. Below it: **six KPI tiles** (11 px label, 26 px value, 84x28 sparkline of 8 weekly points, delta in words with an arrow, a hint; green, red or neutral by whether up is good; a tile with a `href` is one link, without one a plain card); **Needs you** (up to 6 items from the workspace's own queue, each with an icon, title, meta and one action, "See all"); the **trend chart** (hand-made SVG, up to 3 series in new tokens `--chart-1/2/3`, hover crosshair and tooltip, direct end labels, legend, "Show table"); the **make-up bar** (segments link to their filter); and the **ranked breakdown**. Six KPI columns from 1280 px, three from 560, two below; rows stack below 1100 px.
     - **IT:** tiles Spare, Deployed, In repair, Missing, Need attention (each equals the matching `/inventory` tile) and Approvals open (hint "N past SLA"); Needs you is the flattened worklist plus claimed by you; trend Assigned / Returned / To repair per week from `AuditEntry`; make-up is the fleet; breakdown is people missing required kit by client (new `kitGapsByGroup`).
     - **Purchasing:** Awaiting IT, Awaiting finance, Spend this month (₱), Below reorder, Lots expiring, Stocktakes overdue; trend requests created / completed per week; make-up requests by state; breakdown spend this month by supplier (top 7 plus Other).
     - **Finance:** Waiting on you (₱), Requests waiting, Approved this month, Capitalized this month, Book value, To confirm (hint "N IT · N Purchasing", links to the IT view); trend capitalized ₱ per month over 12 months; make-up book value by category; breakdown approved spend this quarter by department.
     - **Admin:** Active accounts, Webhook deliveries failed, Direct changes (7 days), Flags on ("x of y"), Approvals open (all classes), Disabled accounts; Needs you is failing endpoints, unavailable flags, disabled admins and dead deliveries; trend direct changes per day by class over 14 days; make-up webhook deliveries in 7 days by status; breakdown accounts by role.
   - **§4.1 Sidebar rail (every workspace).** A "Collapse sidebar" button above the account row and the `[` key (ignored in fields, with Ctrl/Meta/Alt, or while an overlay is open; listed in the keyboard shortcuts dialog) switch between `full` (236 px) and `rail` (72 px). **The state is the cookie `br.sidebar=rail|full`**, read in `(app)/layout.tsx` and passed to `SidebarShell`, so the first paint is right with no flash; anything other than `rail` reads as `full`. The rail shows the workspace logo only (with several workspaces the mark is the switch button), icon links named by `aria-label` (plus the badge words), corner pills for badges (red for faults, "99+" cap), and **flyouts** on hover or keyboard focus (`position: fixed` so the nav's scroll cannot clip them; an 11 px hover bridge; Esc dismisses; the flyout lists the link's views with their counts as links). The content column is `flex-1`, so list pages take the extra width and `useFitsCard` re-measures. The mobile drawer is unchanged. The aside is raised (`z-40`) only while a flyout shows.
   - **§4.2 Click to open.** The chevron is now a separate `button` (`aria-expanded`, `aria-label="{Link} views"`) that opens or closes any link's views without navigating. The current link still opens on its own; closing it holds until another link becomes current. The opened set is kept per workspace in `sessionStorage["br.nav.open.<ws>"]` (pure state in `src/lib/nav-open.ts`). Closed views are not rendered, so Tab never visits hidden links.
   - **§4.3 New views, count keys and filters.**
     - **Purchasing:** Suppliers gains **Renewing soon** (`?renewing=30`, `contractEnd` within 30 days inclusive, Manila today); Stock gains **Below reorder** (`?low=1`) and Stocktakes carries the overdue count; Approvals gains Open / Mine / Closed; Employees gains Everyone / Client staff (`?kind=CLIENT`) / Internal staff (`?kind=INTERNAL`).
     - **Finance:** Assets gains All assets / To confirm · IT / To confirm · Purchasing / Capitalized; Depreciation gains Schedule / Policies; Approvals Open / Mine / Closed; Suppliers All / Active contracts / Expired contracts; Stock Items / Stocktakes / Reports.
     - **Admin:** Users & roles gains All users / **Disabled** (`/admin/users?disabled=1`; `?disabled=0` also parses, for the Overview's Active accounts tile); Webhooks gains Endpoints / **Failed deliveries** (`?state=DEAD`, red dot) / All deliveries; Feature flags gains All flags / **Unavailable** (`?state=unavailable`); and a **new "Audit log" link** (`/audit`, `records` group).
     - **New `CountKey`s:** `stockLow`, `stocktakesOverdue`, `suppliersRenewing`, `finToConfirmIt`, `finToConfirmPurchasing`, `usersDisabled`, `deadDeliveries`, `flagsUnavailable`. Each count reuses its page's own filter (new shared helpers `stockLowCount`, `financeViewWhere`, `deliveryTabWhere`, `usersWhere`, `filterFlags`), and `nav-counts.test.ts` asserts every counted view's href (15 views now). `stocktakesOverdue` is the one exemption (`NAV_COUNT_UNFILTERED`): no overdue filter exists on `/stock/stocktakes`.
   - **Tidy.** The old Home's dead code was deleted in `d223114` (16 files, -857 lines: `admin-home`, `age-histogram`, `direct-changes`, `fleet-bar`, `jump-to`, `warranty-runway`, the old `purchasingHome`/`financeHome` queries and the `src/lib/home.ts` helpers, with their tests); `worklist`, `claimedByYou`, `coverageLine` and the work components stay.
   **Decisions marked "my call" in the spec** (the owner never saw these; each is cheap to revisit).
   - **Month-to-date money tiles** (Spend, Approved, Capitalized this month) use the **Manila** month (`monthStartManila`, and the existing Purchasing and Finance month starts were switched to it too); the sparkline is the last 8 weekly totals and the delta compares this week's total with last week's, labelled "this week vs last week".
   - **Finance "To confirm" is split by class** (IT and Purchasing) to match the one-class `/finance/assets` page; the tile sums both and links to the IT view, and the sidebar has one view per class.
   - **Admin:** "Active accounts" links to a new `?disabled=0` filter; "Jobs waiting" is replaced by **Approvals open** (all classes); **"Direct changes" is not a link** (no page lists them; follow-up).
   - **Tiles without a link render as a plain card**, not a button.
   - **Dropped from the sidebar** because the data does not exist: Finance "Disposals to record" (Asset has no disposal value or date), "Bank details to verify" (no verified field; it became the contract views), Admin "Invited, not signed in" (no last-sign-in field; a follow-up could add one). "Book value / Monthly runs" became the existing Schedule / Policies tabs.
   - **Charts are hand-made SVG** (no chart library); the light aqua `--chart-3` is below 3:1 on white, so direct labels and the table view are required, and both exist. Series colours are never used for text, and status colours stay reserved for status.
   **Rulings from the ledger** (each has its cost if wrong in the ledger).
   - **A failing snapshot retries at most every 10 minutes**, not "on the next loop" as the spec said (that floods the log and throttles the other jobs); cost: up to 10 minutes' delay recovering a transient failure.
   - **IT trend counts `lifecycle.replace` as one Returned plus one Assigned, and triage to DEFECTIVE as To repair** (transfer excluded); the numbers differ slightly from a literal spec reading.
   - **Finance "Book value" is an unlinked plain card:** `/finance/depreciation` shows no matching all-class total.
   - **Money week-over-week deltas are percent** (unit `pct`), count ones absolute; **a zero base shows "new this week"**, not "collecting history" (history exists, it was just zero).
   - **"Stocktakes overdue" stays unlinked** (no overdue filter on `/stock/stocktakes`).
   - **The Webhooks link keeps its red failed-deliveries badge while closed**, as in the owner-approved mockup; one line to remove.
   - **"All assets" also matches `/finance/assets?cls=PURCHASING`** so `aria-current` stays set for screen readers; the IT-class Finance views match on the default `cls`, so `?cls=PURCHASING&fin=approved` lights no IT view.
   - **The Admin "Active accounts" tile linked `?disabled=0` before Task 6 added the filter** (harmless in between; counts are reconciled in the e2e).
   - **`phase-42-sidebar` case 9 viewport went from 900 to 1000 tall:** the collapse row is new by design and the nav already scrolls inside the sidebar on shorter screens; cost: case 9 no longer guards 900 px laptops.
   - **The KPI row is 6 columns from 1280 px, not 1100:** it was the money-overflow fix; at 1100-1279 three columns keep ₱ values whole. A CSS breakpoint change if wrong.
   - **"Renewing soon" counts any contract status** (matches the spec wording); an EXPIRED contract with a future end date is a data oddity. A where-clause change if wrong.
   - **`worker:once` keeps snapshotting** (about 14 reads, harmless); the seed's TRUNCATE now includes `MetricSnapshot`, which removes the e2e collision.
   - **`adminHome` and `monthBuckets` / `monthLabels` are kept** (live in `overview.ts`); `DIRECT_KIND_LABEL` and `DIRECT_WINDOW_DAYS` in `src/lib/approvals-list.ts` pre-date this phase and are two tiny unused constants.
   - **The three fix-wave commits carry a "Claude Sonnet 5.5" trailer** instead of the standing "Claude Opus 5.5" text; left as is (amending is forbidden); cosmetic only.
   **Tests.** `tsc` clean, lint clean, vitest 203 files / 3,629 tests (at Task 6 it was 204 files / 3,649; the dead-code deletion removed the tests of the deleted code).
   **Browser battery** (run by the controller at the end, foreground, `--workers=1`, port 3100; the new `phase-46-home.spec.ts`, 14 existing specs updated, chunks of at most 7 files, then an axe sweep).
   - First pass: `phase-46-home` 11/11 and its axe 2/2; chunks 1 to 14 green except the findings below; the axe sweep 9/9.
   - **Real findings, all test-side and fixed in `6c6774a`:** `approvals-audit:161` used the locator `li > a[href=/approvals]`, which the new toggle markup broke (and `:347` cascaded from it); six more loose locators collided with the new "{Link} views" toggle names (`getByRole('button',{name:'Employee'})` also matched "Employees views", `getByLabel('Supplier')` matched "Suppliers views", `getByLabel('Reorder level')` matched the "1 below reorder level" count): scoped to `main` or made exact (`holds:523`, `leftovers:112`, `purchasing-ext:182`, `quick-forms:158`, `stock-lots:118`, `stock:132`, plus `suppliers:299` and `import-export:476/486`); and the Finance Needs-you registrations test now matches Chromium's accessible name ("Review : ..."). **Convention from now on:** a form-field or button locator beside the nav must be exact or scoped to `main`.
   - After the fix round the affected files were green (suppliers + import-export 34/34).
   - **Flakes, none a regression:** `it-core:363` (a toast window against a slow dev compile; failed twice, passed on the third run); `finance-registration-depreciation` test 1 (a cold-start login timeout on a cold dev server; passes on retry or in a batch); `quick-login:37` (environment-dependent, as in Phase 45).
   - **The final fix wave's e2e change (`3f92e9c`: the history test sets aside and restores its six IT keys' snapshot rows) was NOT run in a browser** (no browser runs were allowed); run `phase-46-home.spec.ts` first in the next chunk.
   **Reviews.** Every task's review was clean after at most one fix round. The final review (`b0a9054..6c6774a`) said "Ready with fixes": no Critical; Important (1) the history e2e collided with a `worker:once` snapshot row and the seed's TRUNCATE lacked `MetricSnapshot`, (2) this docs task, (3) the old Home's dead code; Minor `metricHistory` should fail soft. `3f92e9c`, `d223114` and `d46fea7` fixed them and the scoped re-review approved all three (two theoretical minors in the history test left as is). A trial merge with `main` `f7cdd71` was clean (tsc, vitest 3,654 pass).
   **Deferred minors worth knowing** (none blocks the merge; the full list is in the ledger).
   - **Home reads (watch on staging):** `stockLow` reads every stock item twice per Purchasing Home load (a full-items read plus an IN list; a SQL `HAVING` would be O(1)); `stockHomeSignals` keeps its own low predicate; `kitGapsByGroup` is a full-table read on every IT Home render (cache it or snapshot it); the Overview fails as one section.
   - **Sidebar:** the rail's tab order visits every view (4x the tab stops; owner note); two flyouts can show at once (hover plus focus; cosmetic); the aside stays `z-40` while a rail link keeps focus after click or Esc; `useNavToggles` has no jsdom test and the workspace-toggle reset and filter-aware empty copy are covered only by the battery.
   - **Charts and tiles:** a non-integer money value in [999,999.5, 1M) may round to ₱1,000,000 uncompacted; the neutral make-up segment is 1.5:1 against its neighbour; one frame at a 640 px letterbox before the chart measures; the 40% label gutter cap can clip long three-series labels; Direct changes uses a count delta (+N from a zero week).
   **Follow-ups (owner's call).**
   - **Direct changes page:** the Admin "Direct changes" tile is unlinked because nothing lists applied-directly approvals.
   - **"Renewing soon" counts any contract status** (see the ruling): restrict it to ACTIVE contracts if the owner wants.
   - **The rail's 4x tab stops** (every view is its own stop).
   - **`stockLow` as SQL `HAVING`** and **`kitGapsByGroup` cache or snapshot** (Purchasing reads every stock item twice per Home load; kit gaps is a full-table read).
   - **Run Home once on staging with `SLOW_QUERY_MS=200`** after the deploy (staging's `.env` already carries it) and read the slow-query log for `kitGapsByGroup` and `stockLow`.
   - **Make the flaky tests robust:** `it-core:363`'s toast wait, `finance-registration-depreciation` test 1's login timeout, and `quick-login:37` (independent of the environment).
   - **Delete `DIRECT_KIND_LABEL` and `DIRECT_WINDOW_DAYS`** (two unused constants that pre-date this phase).
   **Not yet done:** the branch is NOT merged, `main` is still `f7cdd71`, and staging still runs `f7cdd71` (35 migrations). Merging, pushing and deploying are the owner's decisions, none pre-authorised. When they say go: merge `--no-ff`; run the pre-push secret scan (the repo is public); before redeploying, compare `ipconfig` against the `.env` IP and QR-code counts (the staging IP is `.193`; ask before changing it) and take a `pg_dump -Fc` snapshot; deploy with `scripts/deploy-staging.ps1` (it pulls the GitHub Actions image; never build on the staging laptop) and confirm the `migrate` service applied `20261020090000_metric_snapshot`. Verify on staging with Playwright, never Browser-pane sign-in.
   **Next:** Phase 47 (client staff and people flows, with the client-ending rule) and Phase 48 (deeper asset management).

   **(ap) PHASE 45 (Inventory and Employees lists redesign) - MERGED, PUSHED AND DEPLOYED (2026-10-20): browser battery green, every review clean; the one late finding (focus jump on the sticky bars) FIXED in `ca09f62`; staging runs `97974b5`. NO migration (still 35), NO schema change, NO new dependency.**
   Spec `docs/superpowers/specs/2026-10-20-inventory-employees-lists-design.md` (approved by the owner in chat 2026-10-20; the decisions marked "my call" are the builder's, not the owner's), plan `docs/superpowers/plans/2026-10-20-phase-45-lists.md` (11 tasks). Branch `phase-45-lists` is 20 commits above `main` `2113501` (spec and plan included; tip `dd1cc41` before this docs commit; worktree `.claude/worktrees/phase-45-lists`; 85 files, about +5,600 / -800 lines). The SDD ledger (`.superpowers/sdd/2026-10-20-phase-45-lists/progress.md`) lives in that worktree, so treat this block as the record of the results, rulings and deferred minors. The spike branch `spike-inventory-lab` stays a throwaway and is never merged.
   **Numbering changed again.** This phase became Phase 45, so the client-staff and people-flows phase (with the client-ending rule) is now Phase 46 and deeper asset management is Phase 47.
   Why: the owner reviewed Inventory and Employees across many mockups and a spike inside the real app. Their complaints: Inventory had too many columns and did not read as a good table; Employees showed things nobody needs (initials avatars with no photos, the M365 column, the EMP number on every row, a ragged Client tag) and repeated its filters; long lists meant scrolling "20 times" to reach the page controls; rows took too much height.
   **What shipped** (by spec section).
   - **§4 Shared list behaviour.**
     - **Row sizes.** The density setting gained `dense`: the `br.density` cookie and `data-density` can be `comfortable`, `compact` or `dense`. On these two lists body rows are 56 / 48 / 36 px and headers 40 / 32 / 32 px; every other table treats `dense` like `compact`. Dense collapses every two-line cell to one line. The top-bar button still toggles Comfortable and Compact (from Dense it reads "Comfortable"); the footer's Row size control sets all three.
     - **Zebra.** New `--zebra` / `--row-hover` tokens (light `#f7f8fa` / `#f2f4f7`, dark `#1b1f26` / `#232831`) and a `striped` prop on `Table`; only these two lists pass it. A hovered striped row also gets a 2 px accent edge on its first cell.
     - **Sticky parts.** The window is the scroller. The toolbar is `sticky top-0` (a border only while stuck), the column header sticks under it (toolbar height measured into `--list-sticky-top`), and the footer is a bar pinned to the bottom: "Rows a-b of N", Row size, Rows per page and the existing Pagination. At 1280 px and wider the table wrapper is `overflow-visible` (the new `useFitsCard` hook decides); below that the header scrolls with the rows.
     - **Rows per page.** New `?per=` (25 / 50 / 100, default 25 and omitted from the URL; changing it resets to page 1). `listAssets` and `listEmployees` take it; export ignores it. Other lists carry the param in their links but ignore it.
     - **New shared parts** in `src/components/patterns/`: `count-tiles.tsx`, `list-tabs.tsx`, `floating-bulk-bar.tsx`, `sticky-list.tsx`, `list-footer.tsx` (server-safe), `use-fits-card.ts`.
   - **§2 Inventory.**
     - **Six count tiles** (In stock, Deployed, On loan, In repair, Missing, Need attention) that filter. Each count is what clicking the tile shows (current class, search and every facet except status and attention); one is pressed at a time; links inside a `nav` named "Filter by status". Purchasing gets its own five (In use, Stored, Repairing, Lost, Need attention). The Repairs view (any `stage`) hides the tiles.
     - **New `attention=1` facet.** `buildAssetWhere` ANDs it with `attentionWhere(now)`, so "Need attention" is a real filter. The count line's "N need attention" link keeps `sort=attention`.
     - **Toolbar:** Search (300 px), Category, a **More filters** popover (Status, Type, Assigned to, Provenance, Registration, Purchased; the same components and URL params, with a badge when any is set), Columns, and the count line on the right.
     - **Columns:** checkbox, Tag, **Serial number (new: `AssetRow.serial`)**, Model, Category, Assigned, Status, row menu. Registration, Purchased and Warranty are off by default (still in the Columns chooser). Saved column sets keep working; a one-time step in `getInventoryColumns` adds `serial` for a user who saved a set before it existed. Assigned has no avatar.
     - **Floating bulk bar** at the bottom centre, raised 64 px over the footer, with every existing action and rule kept: "Assign..." (IT direct only), "Change status...", "Print labels", "Export", "Clear", and the select-all-matching link (up to `BULK_MAX` 200).
   - **§3 Employees.**
     - **Underlined tabs with counts** replace the Staff and Employment facets and the Show leavers / Policy gaps pills: All, Client staff, Internal staff, Leaving, Missing kit, New this month (new `joined=month` facet, Manila time). A `nav` named "Filter employees"; one tab at a time. The old URL params still work. A "N leavers hidden" link shows leavers.
     - **Columns:** checkbox, Employee (name over title, no avatar, no EMP number), Works for, Loadout, Items, Employment, Joined, and a chevron. M365 is gone from the list (it stays on the person's page). Search still matches EMP numbers.
     - **Selection and a floating bulk bar** (admin and it_staff only): **Transfer...**, **Export** (`/employees/export?ids=`, which overrides the list filters), **Print IT forms** (new `/employees/forms?ids=`: the Equipment accountability form once per person with page breaks and one Print button; the form body is now one component shared with `employees/[id]/form`) and **Clear**. Offboarded people (shown via the leavers link) have a disabled checkbox.
     - **Bulk transfer.** New action `bulkTransferEmployees(ids, input)` (`src/server/modules/employees/transfer-actions.ts`, pure checks in `src/lib/bulk-transfer.ts`): the same validation and writes as `transferEmployee`, per person, in ONE transaction, capped at `BULK_MAX`, one audit entry per person, writes in sorted-id order. **All or nothing:** if anyone cannot move nothing is written, and the dialog lists up to five blocked people with reasons and says "Untick them and try again".
     - Navigation uses `ListNavigationProvider`, `ListPendingRegion` and `NavLink`, so the table dims while the next page loads.
   **Decisions marked "my call" in the spec** (the owner never saw these; each is cheap to revisit).
   - **No phone card layout.** Below 768 px the tables scroll sideways as today. Follow-up.
   - **No item-by-item kit popover on Employees** (the lab had one; the owner's last approved screens show plain counts). Follow-up.
   - **Purchasing's own five tiles** (the owner only ever saw IT); Retired and Sold are closed states and get no tile.
   - **Tiles hidden in the Repairs view**, because the stage chips already do that job.
   - **Serial one-time add** in `getInventoryColumns`: a saved set without `serial`, from a user who never saw it, gains it once.
   - **Bulk transfer keeps each person's own title** (the dialog has no title field) and is **all or nothing**, with the blocked-people list.
   - "What's left to the builder" was settled as written: components under `patterns/`, the popover reuses the `FacetDropdown` shell, and Print IT forms' cap message follows the label page.
   **Rulings from the ledger** (each has its cost if wrong in the ledger).
   - **Rows per page shows whenever the total is over 25**, not only when there is more than one page; otherwise `per=100` on a short list would trap the user with no way back. Spec and plan said "one page, hide it".
   - **The "In repair" tile (status DEFECTIVE) turns on the Repairs pill and the Stage and Down columns**; that is the repair set. Only `stage` hides the tiles.
   - **The EMP number stays as screen-reader-only text in the Employee cell**, so screen readers and e2e row-name lookups keep it; the visible design matches the spec.
   - **Employees `ids` export over the cap says "Pick no more than 200 people to export at once."** instead of the label page's 10,000-row text (the plan said `capRefusal`).
   - **`TileDef.family` uses the existing status-family type** in `src/components/ui/status.tsx` (one family vocabulary); EmployeesTable owns the bulk bar (no `onBulk` prop); Employees reuses the Dense mechanism chosen for Inventory.
   - **Bulk and single transfer action tests added** (mock-based, the `flag-actions.test.ts` pattern): spec §6 required them and the plan had dropped them.
   - **The final fix wave also took the cheap minors:** an Inventory loading skeleton, tile columns from the tile count (five tiles get five columns), Inventory count formatting like Employees ("1,234 assets"), a consistent Clear that keeps leavers shown, and the per-page select keeping keyboard focus. Left alone: the bulk bar vs a wrapped footer under 910 px, the bulk wording difference, the forms page 404 race, and tab-count perf (measure on staging).
   - **One z-scale** for sticky bars and popovers, written in the `sticky-list.tsx` doc comment: head and footer z-10, bulk bar z-20, toolbar z-30 with its popovers z-40, Cris dock z-30, portalled menus z-40, dialogs and tooltips z-50, toasts z-[60]. The footer is `data-cris-avoid`, so Cris clears its Pagination, and her first-run hint is hidden on these two lists (the established rule for pages with such a bar).
   - **Light `--row-hover` is `#f2f4f7`**, not the spike's `#eef1f5`: muted text (`#667085`) measured 4.39:1 on the old one and 4.51:1 on the new. Because that hover barely differs from the zebra, the hovered row also shows a 2 px accent edge (a non-colour cue the owner may want to tweak).
   **Tests.** Typecheck and lint clean; vitest 188 files / 3,348 tests (up from 3,216 on `main`).
   **Browser battery** (run by the controller at the end, foreground, `--workers=1`, port 3100, chunks of at most 7 files; all 57 e2e files in 13 chunks plus an axe sweep).
   - Everything passed except three findings. **Two real bugs, fixed in `dcb64b7`:** the More filters popover's Apply button sat under the sticky footer (own-tags-types:371; see the z-scale) and hovered rows failed axe contrast in light (auth-shell:169; see `#f2f4f7`). **One environment-dependent failure, not a regression:** `quick-login.spec.ts:37` (the "unlisted account" case) assumes the dev `.env` does not list `finance@` in `QUICK_LOGIN_EMAILS`, and this worktree's does; no login code changed on the branch. A transient "Target crashed" in the first chunk's paging run passed on re-run.
   - After the fix wave: phase-45-lists + own-tags-types + auth-shell 44/44; import-export + inventory-ux + it-gaps + phase-42-sidebar 53/53.
   - Reviews: every task's review was clean after at most one fix round. The final review (`2113501..8a08eea`) said "With fixes" (two Critical, three Important, eight minors); `dcb64b7` and `dd1cc41` fixed them, and the scoped re-review confirmed 9 of 9 addressed and raised ONE NEW Important, which is open.
   **FIXED after the owner's go-ahead (`ca09f62`, 2026-10-20).** The final fix wave's window `scroll-padding` (`:root:has([data-sticky-list])`) made focus on a sticky toolbar or footer control jump the page (about 438 px per Tab; the "/" search shortcut and popover focus-return too). The clearance now sits on the rows instead: `[data-sticky-list] tbody tr` (and descendants) get `scroll-margin-top: --list-sticky-top + --list-head-h` and `scroll-margin-bottom: max(--cris-clear, 64px)`, a list page drops Cris's window `scroll-padding-bottom`, and StickyToolbar no longer writes `--list-scroll-top` on `<html>`. New e2e 6b in `phase-45-lists.spec.ts` (tabbing the stuck toolbar and focusing the footer keep `scrollY`; a focused row lands below the pinned head). Re-run: phase-45-lists 16/16, phase-41-cris + auth-shell 36/36.
   **Deferred minors worth knowing** (none blocks the merge; the full list is in the ledger).
   - Shared parts: no DOM tests for the observers, `RowSizeControl` or the per-page select (the battery covers the stuck border, the thead top and page 1 on a per change); `Table`'s default class string and `setDensity` have no render test; dense and compact `--row-h` are duplicated in `globals.css`; the tile count and list parity has no pure `tileBaseWhere` unit test; `facetOptions`' other `buildAssetWhere` calls use their own clock (a millisecond difference); a Manila month-boundary test (joined-this-month) could flake.
   - Inventory: the Repairs and Registration views at xl scroll inside the card, so their header is not window-sticky (accepted); the sticky header engages after hydration on wide screens; the Dense check column is 4 px wider than it needs to be; the bulk bar has no unit test for its contents; the More filters dialog does not move focus in; `Number()` accepts "5e1" for `per` (harmless, canonicalised); inventory export splits `ids` raw, with no trim or dedupe (pre-existing).
   - Employees: the Missing kit tab count runs a full `listEmployees` pass on every render, and `employeeTabCounts` is unmeasured; `BULK_MAX` is imported from `inventory-list` into employees code and the bulk dialog (a slightly larger client bundle); three "clear" controls show on a filtered-empty page; selection is covered only by the battery.
   - Bulk transfer: employment and the destination are not re-checked inside the transaction (parity with the single transfer), and the runner has no catch, so a P2028 or deadlock lands on the error boundary; `page.tsx` has an inline Prisma query (local precedent).
   - Print IT forms: about 400 concurrent queries for a 200-person print (watch the pool); one `<h1>` per sheet and no page heading; `/employees/forms` has no e2e for order, the unknown-id banner, the over-cap refusal or the empty state.
   **Follow-ups (owner's call).** A phone card layout for both lists; the Employees kit popover (item-by-item loadout); measure `employeeTabCounts` and the Missing kit count on staging at scale; make `quick-login.spec.ts` independent of the environment (set `QUICK_LOGIN_EMAILS` itself or skip when it is not as expected); add the `/employees/forms` e2e and the `?per=50/100` row-count checks (including the attention-sort and gaps paths).
   **Merge, push and deploy (2026-10-20, on "yes fix it, then merge to main, push and redeploy staging").** merged `--no-ff` as `97974b5` (merged tree = tested tip `b16fe43`), pushed `2113501..97974b5` (24 commits; secret scan zero, its single `SEED_PASSWORD=` hit is PICKUP prose naming the pattern), and staging REDEPLOYED at `97974b5` on 2026-10-20 (IP check .193 passed; `pg_dump -Fc` snapshot `staging-before-phase45.dump`, 2.4 MB, 43 tables, in the session scratchpad; CI image pulled, the laptop never builds; no migration, still 35; web healthy; /login 200 locally and over the LAN; the new list code is in the served bundle). Not yet exercised on staging: the signed-in Inventory and Employees pages (owner's passwords). Worktree and branch `phase-45-lists` removed. Still to do: measure the Employees tab counts on staging's scale data.
   **Next:** Phase 46 (client staff and people flows, with the client-ending rule) and Phase 47 (deeper asset management).

   **(ao) FONTS AND TABLE ROWS FIXED - merged `--no-ff` as `23568a9` (merged tree = tested tip `6149784`) and PUSHED 2026-10-19; staging REDEPLOYED at `23568a9`. NO migration (still 35).**
   Branch `fix-fonts-tables` (4 commits, now removed) merged on top of `89e3b5c`; pushed `89e3b5c..23568a9` (secret scan zero). Staging runs `23568a9` (Phase 44 plus this fix, 35 migrations). No spec or plan: a bug fix answering an owner report.
   Why: the owner asked "why is the font not the same on other devices? and text is not good on other displays and boxes". Their screenshot showed an office PC with a locally installed "Helvetica" that rendered heavy and blurry, and Inventory rows wrapping 3 lines at about 1280 px.
   **What changed** (4 commits).
   - `05f5603` **One font everywhere.** Geist and Geist Mono are self-hosted with `next/font/google`, and "Helvetica" / "Helvetica Neue" are dropped from the font stacks, so a PC with its own Helvetica no longer wins. The CI image build downloads the fonts once (a local `next build` needs network the first time); staging never contacts Google at runtime.
   - `bd7905b` **Table rows stay one line.** `Td` defaults to `whitespace-nowrap`, with a new `wrap` prop for a multi-line cell; `StatusPill` is nowrap. 39 long free-text columns in 24 files now truncate with a `title` tooltip. Notes, reasons and Finance-flagged details still wrap. **Convention from now on:** a new table cell is one line; pass `wrap` only for prose, and give a truncated column a `title`.
   - `b36dbd9` and `6149784` **Fit at 1280 px.** Inventory's Assigned column stacks the name over the EMP number, hold rows stack HOLD over "for {name}", and "not capitalised" sits under the "Fully registered" pill. Purchases puts Department under Requested by (the Department column is removed) and Request, Supplier and Department are tightened.
   - **Result at 1280 x 800:** Inventory fits through Purchased (Warranty scrolls), and Purchases and Employees fit.
   **Tests.** Typecheck and lint clean; vitest 3,216; affected e2e 188 passed (one purchases cold-compile flake passed on re-run); axe sweep 9/9.
   **Merge, push and deploy (2026-10-19).** The IP check matched `.193`; the snapshot `staging-before-fonts.dump` was taken first; redeployed with NO migration. Web is healthy, `/login` returns 200 locally and over the LAN, and the font woff2 is served 200 from staging. The worktree and the branch `fix-fonts-tables` are removed. **Owners on other PCs may need Ctrl+F5 once** to drop the old cached font.
   **Next:** Phase 45 (client staff and people flows) and Phase 46 (deeper asset management).

   **(an) PHASE 44 (The Cris login page) - BUILT, all reviews clean, battery green; MERGED `--no-ff` as `89e3b5c` (merged tree = tested tip `39b2e48`), PUSHED and REDEPLOYED to staging 2026-10-19. NO migration (still 35).**
   Spec `docs/superpowers/specs/2026-10-19-login-cris-design.md` (approved 2026-10-19, mockup v6 in `docs/mockups/2026-10-19-login-cris.html`; where they differ the spec wins), plan `docs/superpowers/plans/2026-10-19-phase-44-login-cris.md` (8 tasks); both sit on `main`. Branch `phase-44-login` was 14 commits above `main` `b9e85d9` when built (tip `619aa8a` then; the merged tip is `39b2e48`); the push `8c52d64..89e3b5c` carried 19 commits. The branch and its worktree `.claude/worktrees/phase-44-login` are now REMOVED; the SDD ledger (`.superpowers/sdd/2026-10-19-phase-44-login-cris/progress.md`) lived in that worktree, so treat this block as the record of the results, rulings and deferred minors.
   **Numbering changed again.** Phase 44 is now the login page, so the client-staff and people-flows phase (with the client-ending rule) is Phase 45 and deeper asset management is Phase 46.
   Why: the owner wanted the first screen every IT, purchasing and finance person sees to carry the Cris mascot's personality, with sign-in still quick and no CPU cost when nobody is looking.
   **What shipped.**
   - **The room scene and day log.** One server-drawn SVG world (`buildWorld()`, 3960 x 760 units) scaled to the hero and panned by a camera; Cris (the existing orb) works through six scenes from 08:40 to 17:05 (Stockroom, Purchasing, Receiving, Finance, Offboarding) with a speech bubble and moods; the day log sits bottom-left (compact row on narrow screens). Light is a daytime room, dark lights the pendant lamps. Breakpoint 900 px.
   - **The stepped card.** Log in is two steps (Work email, then Password; buttons "Continue" and "Log in"); Sign up is multi-step with field-to-step routing; the card is the page's `<main>` and carries the "Cris" wordmark (`APP_NAME` is unchanged elsewhere). Quick sign-in is a dropdown on the Welcome step; `/signup` renders the same experience.
   - **Focus mode.** When the user starts typing the room blurs, the card centres and a forward Cris flies out in front and talks (typewriter lines, `errorLine`, and the `shy` mood while the password field is focused). Direct loads render already centred with Cris in place.
   - **The `signUp` contract.** Sign-up rules now report the failing field (`SignUpField`), and `signUp` returns `{ created }` (via `AuthFormState {error, field, created}`) instead of redirecting, so the card can show its success step.
   - **Auth layout landmarks.** `src/app/(auth)/layout.tsx` no longer wraps children in `<main>`; the login/signup card is the `<main>` and `/bootstrap` wraps its own content.
   - **The e2e sign-in block.** One six-line sign-in block (through the new Log in steps) repeated verbatim in 54 spec files, plus a new `e2e/login-cris.spec.ts` (steps, focus mode, scenes, phone, reduced motion, axe) and the quick sign-in dropdown spec.
   - Old `login-form` / `signup-form` are deleted; `src/app/(auth)/card-props.ts` is new (see the rulings).
   **Battery** (full Playwright run in 9 chunks, `--workers=1`, on the worktree's dev DB).
   - First pass: 579 tests, 569 passed, 9 failed, 1 skipped.
   - Real issues, both fixed: **F1** the primary tile sub-text measured 4.43:1 (3 axe failures in chunk 1 and 1 in the axe sweep; fixed in `bb523b1` to clear 4.5:1) and **F2** Log in 1 checked the allowed domain, which locked out existing staff when an admin changed the flag (admin webhooks failed in chunk 2; fixed in `0fad30e`).
   - Test fragility, fixed: the command palette test pressed Ctrl+K right after networkidle and raced the listener (`70ef83c`, F3); the strict-mode `getByLabel("Work email")` clash fixed with `{ exact: true }` (`56bf26f`).
   - Flakes that cleared on re-run: it-core:356 (a "saved" toast missed on a cold compile) and purchases:96 (a 5 s heading wait on a cold compile).
   - Quick-login: the "forged" test failed only because this `.env` lists the wrong accounts; it needs `QUICK_LOGIN_EMAILS=it@...,admin@...` as documented, and then it passes (2 passed, 1 skipped; the absent-by-default case needs the variable unset).
   - Re-runs after the fixes: login-cris, auth-shell and admin green; axe sweep 9/9; it-core + purchases 37/37; auth-shell 16/16; after the final fix wave login-cris 12/12 and auth-shell + admin 32/32. Final state: every spec green (the quick-login absent-by-default case is not runnable with this worktree's `.env`). The dev DB was reseeded at the end.
   - Reviews: every task's review clean, the battery fix wave re-reviewed clean, final opus review "Ready to merge: Yes" with 0 Critical / 0 Important, and the final fix wave (`619aa8a`) re-reviewed clean. Final unit count on the branch: vitest 179 files / 3,216 tests (up from the 3,141-test baseline on `main`), typecheck and lint clean.
   **Rulings** (each from the ledger, with its cost if wrong).
   - The sign-in block repeated verbatim in about 54 spec files is accepted, not a duplication defect: the repo's rule forbids importing helpers across spec files (each reseeds independently) and spec §10 mandates per-file copies. Cost if wrong: a later refactor to a shared helper is mechanical.
   - Keep `src/app/(auth)/card-props.ts` (not in the plan) so `/signup`'s Welcome (via Back) shows the same Microsoft / quick sign-in / domain line as `/login`, because spec §7 says `/signup` renders the same experience. Cost if wrong: `/signup` runs the flag and quick-account queries; the revert is a one-file change.
   - Submit buttons use `disabled` + `aria-busy` + a visible "Logging in..." / "Creating account..." label instead of the kit's `Button loading`, because spec §5.2 requires the busy label to stay visible and the kit's loading state hides it. Cost if wrong: a small styling divergence from the kit.
   - The forward Cris stays under the card (z 2 below the card's 3): the owner's anti-goal "the form is never covered by Cris" outranks §3's layer list. It is only visible between 900 and 960 px. Cost if wrong: a one-line z-index change.
   - Keep the plan's 140 px minimum for the narrow side bubble; clipping happens only below about 360 px wide screens (rare). Cost if wrong: bubble text clipped on 320 px phones; revisit if the 375 px run ever shows clipping.
   - The `getByLabel("Work email")` clash is fixed in the tests (`{ exact: true }` in every e2e use, and spec §10's block corrected), not in the card: the card's `aria-labelledby` following its heading is spec §5.1 and good accessibility. Cost if wrong: none functionally; one more mechanical e2e edit.
   - Log in 1 must NOT check `allowed_domain` (spec §5.2 corrected): the login path never enforced the domain server-side, and a client-side domain check locks existing staff out when an admin changes the flag. The domain message stays on Sign up 1. Cost if wrong: none.
   - The final fix wave took review minors 1 and 2 and the `server-only` nit: Back and Change are disabled while a login or sign-up is pending, and the pause button became the standard toggle (constant label "Pause the scene" plus `aria-pressed`; spec §4.6 amended). The `server-only` import was skipped because it is not a dependency here. Cost if wrong: a one-line revert.
   - Left alone: review minors 3 (Enter before hydration), 4 (no `signUp` unit test) and 5 (Change/Show under 40 px), and the unused `page` prop; rare, no lockout, covered by e2e, axe-clean, in the plan's interface. Cost if wrong: small follow-ups.
   - `SEED_PASSWORD` was removed from the worktree's `.env` copy (main's `.env` is untouched) because `prisma/fixtures.ts` says a local `.env` must not set it; with it set, a spec that does not import `PrismaClient` types the fallback and fails. Cost if wrong: none (dev DB only).
   **Deferred minors worth knowing** (none blocks the merge; the full list is in the ledger).
   - Disabled Back and Change have no `:disabled` styling, so they look active while a login or sign-up is pending (they do nothing).
   - Enter pressed before hydration on a direct load posts an empty password (accepted; the user just sees the normal error).
   - There is no unit test for the `signUp` action; the e2e sign-up path covers it (with a 16-character password, not the 10-character boundary).
   - Change and Show are under 40 px tall (axe passes).
   - The world SVG is sent twice, in the HTML and in the RSC payload (about 63 KB raw, compresses well), because it is a prop of a client component.
   - Idle paint cost on a visible-but-unfocused window has not been measured by a human: record one trace in Chrome's Performance panel on the login page before or just after deploy.
   - Smaller: the email regex is duplicated between `login-steps.ts` and `signup-rules.ts` (equivalent today); `firstFromEmail` lower-cases the tail (McDonald becomes Mcdonald); the focus controller's timing logic has no unit tests (only SSR markup and geometry); the focused card's shadow colour is hard-coded with no dark override (`login.css`); `sign-in-card.tsx` is about 590 lines; `quick-login.spec.ts` selects the Account option without waiting for `data-login-ready`; the axe sweep on `/login` does not wait for Cris's line to finish typing; the mockup file still shows the old domain check on Log in and a flipping pause label (static reference; the spec wins).
   **Two gotchas.**
   - **Playwright chunks MUST use `--workers=1`.** With parallel workers the spec files race each other's reseed and fail at random.
   - **A worktree `.env` copied from main must not keep `SEED_PASSWORD`** (`prisma/fixtures.ts` documents this). The battery hit it: specs that import `PrismaClient` pick the value up through Prisma's `.env` loading, specs that do not type the fallback and fail to log in. Delete that line from the worktree copy (never print the file).
   **Merge, push and deploy (2026-10-19).** Merged `--no-ff` as `89e3b5c` (merged tree = tested tip `39b2e48`) and PUSHED `8c52d64..89e3b5c` (19 commits; the secret scan found zero, and its single `SEED_PASSWORD=` hit is old PICKUP prose that names the pattern). Staging REDEPLOYED at `89e3b5c`: the IP check matched `.193`; the snapshot `staging-before-phase44.dump` (2.4 MB, 43 tables) was taken first; the deploy pulled the CI image; there was NO migration (still 35); web is healthy. Checked: `/login`, `/login?step=login` and `/signup` return 200 locally, `/login` returns 200 over the LAN, and the page shows "Welcome to Cris". **Not exercised on staging: a real sign-in with a staging account** (it needs the owner's passwords), so the sign-in flow is covered only by the e2e battery. The worktree and the branch `phase-44-login` are removed. Still open from this phase: the deferred minors above, a phone check of `/login`, and the idle-paint trace in Chrome's Performance panel. Still open from before: the "My drafts" wording, the client-ending rule (now Phase 45), "Value at cost", the live Cris check once a key is added, and recreating neil.lucero@thebackroomop.com if it is still needed.
   **Next:** Phase 45 (client staff and people flows) and Phase 46 (deeper asset management).

   **(am) STUCK SAME-PAGE FILTER LINKS FIXED - merged `--no-ff` as `b97cf62` (merged tree = tested tip `ee19267`) and PUSHED 2026-10-19; staging REDEPLOYED 2026-10-19 at `b97cf62`. NO migration (still 35).**
   Branch `fix-stuck-filter-nav` (now removed) merged on top of `c7180b2`; pushed `c7180b2..b97cf62`. Staging runs `b97cf62` (Phase 43 plus this fix, 35 migrations). No spec or plan: this was a bug fix found and fixed by systematic debugging.
   Why: the owner reported (2026-10-19) "when clicking on the sidebar, sometimes it doesn't work … inventory, spare, setup, and there's a delay or sometimes no feedback".
   **Root cause** (systematic debugging on staging, production build only).
   - In Next.js 15.5.23 (app router) a soft navigation that changes ONLY the query string of the current list page (sidebar views such as Inventory to Spare and Employees to Client staff, tabs, page 2, sort headers, filter chips) silently never committed about half the time on Inventory, Employees, Purchases and Reservations: the router fetched the page data (200, complete) and its reducer finished, but React's transition render suspended forever on a page-content Flight chunk (status resolved_model) with no error, so the URL and screen never changed; navigations to a different page always worked.
   - Scope: it shows in the production build only; it is not a Phase 42 regression (the Phase 41 image failed at a similar rate); the dev server never shows it; Approvals and Equipment by client were unaffected in trials; Next.js 15.5.28 was tested through a CI image on a side container and does NOT fix it (8-click trials unchanged), so that upgrade was reverted.
   - Reverted along the way: the Next.js upgrade 15.5.23 to 15.5.28 (`1ec1b95`) was reverted by `c7180b2`; the main tree is identical to `2d9d908`.
   **The fix.** `src/lib/stuck-nav.ts` and `src/components/shell/stuck-nav-guard.tsx`, mounted in the (app) layout, production-only.
   - A watch starts when a same-page query navigation starts: a link click (through a capture-phase guard) or `pushGuarded` / `replaceGuarded` (about 23 programmatic call sites, including list-navigation, toolbars and row opens).
   - After 1.2 s it fires only if the page is still the one the click started from AND the browser recorded a request for the target after the click (resource timing, `_rsc` stripped). It then does a normal page load to the target.
   - It never fires when the app cancelled the click (for example an unsaved-changes prompt; `cancelStuckNavWatch` is also called there), a navigation elsewhere cancels it, and repeat clicks keep the first click time.
   **Proof.** 33 new unit tests; full vitest 3,141; the list-page browser tests pass (3 one-off flakes passed on re-run). Verified 32/32 clicks on a side container of the CI image (Employees filters, Inventory to Spare, Purchases tab, Employees page 2): instant at about 0.25 s, or rescued at about 1.3 to 1.5 s. Verified 8/8 on staging after the deploy.
   **Merged and deployed 2026-10-19.**
   - Merge: `--no-ff` as `b97cf62`, merged tree = tested tip `ee19267`; pushed `c7180b2..b97cf62`; secret scan zero.
   - Staging redeploy: CI image pulled (the staging laptop never builds). The `pg_dump -Fc` snapshot `staging-before-stucknav.dump` (about 2.4 MB, 43 tables) was taken first. IP check passed (.193). No migration, still 35. Web healthy; /login returns 200 locally and over the LAN.
   - Worktrees `nav-debug` and `stuck-nav` and branches `next-15-5-28` and `fix-stuck-filter-nav` are removed.
   **Found while debugging, still open (owner's call).**
   - DB connection pool: Prisma's default pool is 57 connections per process on this 28-core laptop against Postgres `max_connections` 100, so web plus worker could exhaust it (it happened once with extra test containers; staging stayed up). Recommended: `connection_limit` 15 for web and 5 for the worker.
   - List pages prefetch about 25 row record pages per view. They could be switched off, but only after re-testing with this fix: in trials, disabling row prefetch made the underlying hang more frequent.
   - An occasional axe colour-contrast flake, caught mid sidebar-views fade-in (the paging and it-core axe cases passed on re-run).
   **Still open from before:** the "My drafts" wording question, the Phase 44 client-ending rule, "Value at cost", the live Cris check once a key is added, recreating neil.lucero@thebackroomop.com if it is still needed.
   **Process notes:** one `git switch -c` to create a branch and one `git commit --amend` on an unpushed revert commit of my own (to add the trailer); nothing shared was rewritten.
   **Next:** Phase 44 (client staff and people flows), then Phase 45 (deeper asset management).

   **(al) PHASE 43 (Performance at real size: 1,000 assets, 600 employees, 15 people at once) - CODE-COMPLETE on branch `phase-43-performance`; MERGED `--no-ff` as `27bc496` (merged tree = tested tip `3e62190`) and PUSHED 2026-10-19; staging REDEPLOYED 2026-10-19 at `27bc496`. ONE migration, 35 `20261019090000_perf_indexes` (12 indexes, no data change), applied: staging went 34 to 35.**
   Spec `docs/superpowers/specs/2026-10-19-performance-at-scale-design.md` (APPROVED 2026-10-19 in chat), plan `docs/superpowers/plans/2026-10-19-phase-43-performance.md`; both sit on `main`, pushed with the merge (`29b015b..27bc496`). The baseline report is `docs/perf/2026-10-19-baseline.md`; the after-run report is `docs/perf/2026-10-19-after.md`.
   The branch `phase-43-performance` (worktree `.claude/worktrees/phase-43-performance`, now removed) had its code tip at `d702ded`, 16 commits above `main` (45 files changed outside docs), then its docs commit `3e62190`, which is the tested tip. Staging runs `27bc496` (Phase 43 on top of Phase 42, 35 migrations) with the scale data. A temporary detached worktree `perf-after` was used only to run the harness and will be removed.
   **Numbering changed again.** Phase 43 is performance, so the audit's client-staff and people-flows phase is now Phase 44 and the deeper asset management phase is now Phase 45. Every earlier deferral that reads Phase 43 or Phase 44 in (ag) to (ak) now reads Phase 44 or Phase 45.
   Why: the owner asked to "improve the performance of the webapp, e.g. 15 persons using it doing tasks and changes, 1000 assets and 600 employees; remove all seeded data and replace them with my requirement so we can test it". The owner chose "Replace staging data" and put this before client staff; then: "test it then fix the problems and gaps... no need for approval".
   **Staging data was replaced on 2026-10-19.**
   - Snapshot first: a `pg_dump -Fc` file, `staging-before-scale.dump` (about 156 KB, 43 tables), taken before anything was wiped. It sits in the session scratchpad, not in the repo; copy it somewhere permanent if you want to keep it.
   - Then the normal seed ran, followed by the new `npm run db:seed:scale`.
   - Staging now holds 1,000 assets (900 IT), 600 employees across 8 internal teams and 40 fictional clients, 150 purchase requests, about 3,000 executed approvals plus 40 open, 200 reservations, 1,500 notes, 43 policies and 40,000 audit rows over 6 months.
   - Accounts: 20 in all. The 5 role accounts (admin@, it@, purchasing@, finance@, viewer@thebackroomop.com) plus perf01 to perf15@thebackroomop.com: perf01-10 are IT staff, perf11-12 purchasing, perf13-14 finance, perf15 admin. All use staging's seed password, which is not recorded in the docs.
   - Lost in the wipe: one hand-made account, neil.lucero@thebackroomop.com (viewer, created 2026-09-22). The owner should recreate it in Admin > Users if it is still needed.
   **New tools.**
   - `npm run db:seed:scale`: deterministic, layers on the normal seed, and refuses if scale data already exists. Its ranges are BR-xx-1000+, EMP-1000+, PR-1000+ and APR-5000+.
   - Load harness, `scripts/loadtest` (see the README there). `run.mjs` runs 15 HTTP readers by role; `writers.mjs` runs one headless browser with 3 contexts doing assign, return, triage and approve/reject; `report.mjs` writes `docs/perf/*.md`. Always run it alone against staging, never alongside the dev server or the browser battery.
   - Slow-query log: set `SLOW_QUERY_MS=<ms>` in staging's .env and recreate the web container (`docker compose up -d web`). It logs `[slow-query] Model.op Nms` and never logs arguments. When unset, it is off. It is ON at staging with `SLOW_QUERY_MS=200` (see "Merged and deployed" below).
   **Baseline** (`docs/perf/2026-10-19-baseline.md`; staging; 6 minutes; 15 readers plus 3 writers). Every target was already met.
   - 1,301 page requests, 0 errors. The worst page p95 was 395 ms and the slowest single request 519 ms (/inventory/work). Home p95 was 270 ms.
   - The writers ran 239 steps with 0 failed and 34 assign/return/triage cycles. Click-to-toast p95 was about 614 ms.
   - The web log showed no P2024 connection timeouts.
   **What was fixed** (results identical, pinned by tests).
   - One index migration, `20261019090000_perf_indexes`, with 12 indexes: PurchaseUnit.requestId, AssetDocument.assetId, Asset warrantyUntil / purchasedAt / defectiveSince / updatedAt / (cls, status), Approval.type, PurchaseRequest.updatedAt, AuditEntry (entityType, action, createdAt), Employee (employment, joinedAt), Reservation (state, expiresAt).
   - `requireUser` and the Cris flag are read once per request (React `cache()`).
   - The IT nav Spare / Repairs / Missing counts come from one query.
   - The offboarding leavers read is narrowed (it reads only what the rows need, and `leaverStates` is cut by one bound, not a per-leaver OR).
   - The depreciation drill-down computes the year grid once.
   - The Home age chart counts its buckets in SQL.
   - Deterministic id tiebreaks on the capped and visible Home reads, so tied rows keep a stable order.
   - Skipped as not provably identical: the approvals badge merge and the inventory year chips in SQL. Left alone because they measured fine: book value on /finance/assets.
   **Proof.** Vitest 3,108 tests. The full browser battery: 55 files, all passing on re-run. Two one-off flakes did not reproduce from a fresh seed; their likely cause was tied sort orders, now fixed with the tiebreaks. The axe sweep has no moderate findings.
   **Final review (opus, whole branch):** "with fixes" - the docs plus the tiebreaks. Both are done.
   **Merged and deployed 2026-10-19.** The owner pre-approved all three ("no need for approval for these tasks").
   - Merge: merged `--no-ff` as `27bc496` (merged tree = tested tip `3e62190`) and pushed 2026-10-19 (`29b015b..27bc496`). Secret scan: zero real secrets; the 2 `SEED_PASSWORD=` matches are "…" placeholders in usage comments in `scripts/loadtest`.
   - Staging redeploy: redeployed 2026-10-19 at `27bc496`. The CI image was pulled (the staging laptop never builds). The `pg_dump -Fc` snapshot `staging-before-phase43.dump` (about 2.4 MB, 43 tables, holding the scale data) was taken first. The IP check passed (.193). Migration 35 `20261019090000_perf_indexes` was applied, so there are now 35 migrations, and the 3 sampled indexes are present. Data is intact (1,000 assets). Web is healthy; /login returns 200 locally and over the LAN.
   - Slow-query log: turned on at staging with `SLOW_QUERY_MS=200` appended to staging's .env, confirmed in the container. It stays on, and logs only queries over 200 ms (model, operation and duration, never arguments). To turn it off, remove the line and recreate web.
   - Worktrees: `phase-43-performance` and its branch are removed. A temporary detached worktree `perf-after` was used only to run the harness and will be removed. `origin/main` = `27bc496` before this docs fix.
   **After-run** (`docs/perf/2026-10-19-after.md`; staging at `27bc496` with migration 35; 6 minutes; 15 readers plus 3 writers). All targets were met.
   - 1,331 page requests, 0 errors. The slowest single request was 426 ms (519 before).
   - Overall page p50 94 / p95 200 / p99 283 ms (before: 96 / 219 / 366).
   - The writers ran 234 steps with 0 failed (12 approve-or-reject steps were skipped at the decision cap).
   - The web log showed 0 P2024 connection timeouts and 0 queries over 200 ms.
   - Conclusion: the app already met the targets at this size; the fixes trimmed the slow tail (p99 -22 %, slowest -18 %) and cut about 5 queries from each IT page load.
   **Still open:** the "My drafts" wording question (it counts every draft in the organisation, not just the user's own - rename it "Drafts", or count only the user's own?); the client-staff question for Phase 44 (may a client be ended while people still work for it - allowed, with Worklist chasing, or blocked until they are moved or offboarded?); the "Value at cost" question (from Phase 38); the live Cris check once a key is added; recreate the removed account neil.lucero@thebackroomop.com if it is still needed.
   **Still owed:** the owner can spot-check the Home age chart against their expectations. The automated equivalence tests cover it, but there is no manual check on staging yet. Also the live Cris check once the owner adds the key (restart, one short lookup, then a second message after a page change, to confirm there is no 400); Cris is still in preview.
   **Next:** Phase 44 (client staff and people flows), then Phase 45 (deeper asset management).

   **(ak) PHASE 42 (A sidebar that stays put, with fewer links and the views under the page you're on) - CODE-COMPLETE 2026-10-18 on branch `phase-42-sidebar`; MERGED `--no-ff` as `4c2dd00` (merged tree = tested tip `821ddf0`) and PUSHED 2026-10-18; staging REDEPLOYED 2026-10-18 at `4c2dd00`; NO migration (still 34).**
   Spec `docs/superpowers/specs/2026-10-18-sidebar-views-design.md` (`0018702`; its Status line reads MERGED, PUSHED and DEPLOYED), plan `docs/superpowers/plans/2026-10-18-phase-42-sidebar.md` (`16e6627`, 5 tasks). Spec and plan sit on `main`, pushed with the merge (`a20af50..4c2dd00`).
   The branch `phase-42-sidebar` (worktree `.claude/worktrees/phase-42-sidebar`, now removed) had final code tree `a21e289`, 10 commits above `16e6627` (38 files changed), then its docs commit `821ddf0`, which is the tested tip. Staging runs `4c2dd00` (Phase 42 on top of Phase 41 and its two Cris follow-ups, 34 migrations).
   **Numbering changed again.** Phase 42 is the sidebar, so the audit's client-staff and people-flows phase is now Phase 43 and the deeper asset management phase is now Phase 44. Every earlier deferral that reads Phase 42 or Phase 43 in (ag) to (aj) now reads Phase 43 or Phase 44.
   Why: the owner's screenshot of /inventory scrolled down. The owner said: "when scrolling down I still need to scroll up to see the other buttons or functions" and "too cluttered". From 13 mockup boards on the canvas the owner chose board 12 (views under the page you're on, without the Today card) in the modern sleek look of board 9, with a fixed set of views. The owner rejected the Setup/Activity hub pages and the progress ring.
   **What it does.**
   - Desktop sidebar: sticky, a full-height inset panel. The nav scrolls inside it only when it does not fit, with soft edge shadows. The account row is always visible. The current link is scrolled into view. The window still scrolls the page.
   - Links: about 10 icon links per workspace, with no headings (IT 17 to 10, Purchasing 25 to 9, Finance 12 to 8, Admin 4).
   - Views: the current link opens a fixed set of views with live counts.
     - Inventory: All, Spare, Repairs, Missing, Register assets.
     - Employees: Everyone, Client staff, Leaving, Policy gaps.
     - Approvals: Open, Mine, Purchase reviews, Closed.
     - Setup: Asset categories, Asset types, Departments & clients, Equipment policies.
     - Activity: Inventory activity, Employee activity, Audit log.
     - Reports: By client, Internal teams.
     - Purchasing's Requests, Suppliers, Stock and Assets carry their sub-pages.
   - IT Approvals badge: it now counts open approvals plus purchase reviews.
   - Workspace: the "IT · 1 workspace" box became a small tag in the brand row. People with 4 workspaces get a menu button.
   - Ctrl K: still finds every page by name, including "Equipment by client". Repeated names read "Approvals › Closed".
   - Phone drawer: shows the same nav. Old URLs and bookmarks are unchanged. No migration.
   **Proof.** Vitest 160 files / 2960 tests, tsc and lint clean. The full Playwright battery: 55 files, 575 passed, 2 expected quick-login skips; the axe sweep has no moderate findings; the new `e2e/phase-42-sidebar.spec.ts` has 9 cases. After the final fix wave the sidebar-related files were re-run: 64/64.
   **Final review (opus, whole branch):** two Important findings, both fixed: one failing approvals read no longer breaks every page (the badge fails to 0, `003a983`), and Repairs stays highlighted on its stage chips (`a21e289`). Five minor polish items were also fixed.
   **Merged and deployed 2026-10-18.** Merged `--no-ff` as `4c2dd00` (merged tree = tested tip `821ddf0`) and pushed (`a20af50..4c2dd00`); the secret scan was zero. Staging was redeployed at `4c2dd00`: the CI image was pulled (the staging laptop never builds); the `pg_dump -Fc` snapshot `staging-before-phase42.dump` (about 156 KB, 43 tables) was taken first; the IP check passed (.193); NO migration, so still 34 migrations; web healthy; /login answers 200 locally and over the LAN. The worktree and branch `phase-42-sidebar` are removed; `origin/main` = `4c2dd00` before this docs fix.
   **Still open, the owner's call:** "My drafts" counts every draft in the organisation, not just the user's own. The label is older than this phase. Ask whether to rename it to "Drafts" or to count only the user's own. Also open for Phase 43: may a client be ended while people still work for it? The options are allowing it, with Worklist chasing, or blocking it until those people are moved or offboarded.
   **Can wait:** a hand-typed /inventory?status=SPARE&stage=x highlights Spare; IT on /purchases records highlights nothing.
   **Still owed:** the live Cris check once the owner adds the key (restart, one short lookup, then a second message after a page change, to confirm there is no 400); Cris is still in preview. The "Value at cost" question (from Phase 38) stays open.
   **Next:** Phase 43 (client staff and people flows), then Phase 44 (deeper asset management).

   **(aj) COMPACT CRIS (a second small follow-up to Phase 41: a smaller Cris that never blocks the page) - branch `cris-compact`; MERGED `--no-ff` as `afcfeea` (merged tree = tested tip) and PUSHED 2026-10-18; staging REDEPLOYED 2026-10-18 at `afcfeea`; NO migration (still 34); Cris is still in preview (no key).**
   Why: the owner's screenshot showed the 116 px Cris covering the "Register asset" button in the Register form's sticky action bar. The owner asked: "make Cris smaller, he sometimes blocks other inputs, forms or buttons".
   **What it does.**
   - Smaller: Cris is 64 px (56 px on phones), about 20 px from the corner. The chat box still opens above, with its pointer centred.
   - Clicks: only the glass body (about 44 px) catches clicks; the rings and glow pass clicks through.
   - The corner is kept clear while Cris is shown: `#main` gets extra bottom padding; there is a focus scroll padding; the four sticky bottom action bars (Register, Edit asset, Edit employee, Add employee wizard; marked `data-cris-avoid`) leave about 84 px on Cris's side.
   - Hint: it hides after 8 s and never shows on a page with a sticky bar.
   - Tuck away: a "–" appears on hover or keyboard focus. It turns Cris into a slim edge tab, "Bring Cris back", and the tab is persisted per person (`CrisPrefs.tucked`). Settings' "Put Cris back in the corner" also untucks.
   - Old position: a saved old default position (72 px up) reads as the new default.
   **Proof.** Vitest 156 files / 2865 tests, tsc and lint clean, the full Playwright battery passes (all 54 files, including 20 Cris cases; the new ones are 18 Register button clickable with Cris on screen, 19 tuck away persists, 20 clicks on the rings pass through; 2 expected quick-login skips), axe sweep clean (no moderate findings), reviewer findings fixed in one round. Secret scan zero before the push.
   **Deployed 2026-10-18 at `afcfeea`:** the CI image was pulled (the staging laptop never builds); the `pg_dump -Fc` snapshot `staging-before-compact.dump` (about 155 KB, 43 tables) was taken first; the IP check passed (.193); NO migration, so still 34 migrations; web healthy; /login answers 200 locally and over the LAN. The worktree and branch `cris-compact` are removed; `origin/main` = `afcfeea` before this docs fix.
   **Still owed:** the live Cris check once the owner adds the key (restart, one short lookup, then a second message after a page change, to confirm there is no 400). The owner should press New chat after adding the key. Never paste a key into chat, the docs or git.
   **Next:** Phase 42 (client staff and people flows), then Phase 43. The "Value at cost" question (from Phase 38) stays open.

   **(ai) CRIS PREVIEW MODE (a small follow-up to Phase 41: without an AI key Cris is ON in preview) - branch `cris-preview`; MERGED `--no-ff` as `a155f7b` (merged tree = tested tip `76a5bad`) and PUSHED 2026-10-18; staging REDEPLOYED 2026-10-18 at `a155f7b`; NO migration (still 34).** 
   Why: at the owner's request ("just make a mockup Cris, no API") Cris no longer vanishes when the server has no `ANTHROPIC_API_KEY`; the person can see and try her. Records of Phase 41 above and below that say the widget is absent or Cris is off without a key are the state at the 2026-10-17 redeploy. 
   **What it does.** Without `ANTHROPIC_API_KEY`, Cris is ON in preview: a "Preview" pill, the greeting "I'm still in development — for now I can only chat…", the starters "Say hello" and "What will you do?", and placeholder replies only (no context chip, no card scan button). There are no AI calls, no cost, no lookups and no changes: Confirm and picks are refused, and Undo still works. Preview turns are never replayed to the real model, so a chat started in preview cannot feed placeholder lines to it after a key is added. Settings › Cris shows "No AI key on the server — Cris is in preview: placeholder replies only." Adding a key and restarting switches Cris to the real model. `.env.example` and spec section 8 ("The key") say the same. 
   **Proof.** vitest 156 files / 2852 tests, the Cris e2e passes 17 of 17, a reviewer approved it. Secret scan zero before the push. 
   **Deployed 2026-10-18 at `a155f7b`:** the CI image was pulled (the staging laptop never builds); the `pg_dump -Fc` snapshot `staging-before-preview.dump` (about 155 KB, 43 tables) was taken first; the IP check passed (.193); NO migration, so still 34 migrations; web healthy; /login answers 200 locally and over the LAN. The worktree and branch `cris-preview` are removed; `origin/main` = `a155f7b` before this docs fix. 
   **Still owed:** the live Cris check once the owner adds the key (restart, one short lookup, then a second message after a page change, to confirm there is no 400). The owner should press New chat after adding the key. Never paste a key into chat, the docs or git. 
   **Next:** Phase 42 (client staff and people flows), then Phase 43. The "Value at cost" question (from Phase 38) stays open. 
 
   **(ah) PHASE 41 (Cris, the in-app IT assistant: a mascot and chat box on every IT page, check / assign / replace / who-has-a-tag / spares-in-stock, a Confirm-then-Undo safety chain, Settings › Cris) - CODE-COMPLETE 2026-10-17 on branch `phase-41-cris`; MERGED to `main` via `37f1b00` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; staging REDEPLOYED 2026-10-17 at `37f1b00` (CI image pulled, `pg_dump -Fc` snapshot taken first, IP check passed (.193), migration 34 applied, now 34 migrations; web healthy); at that redeploy Cris had no AI key; since 2026-10-18 it runs in preview without one (record (ai)); ADDS MIGRATION 34.**
   Spec `docs/superpowers/specs/2026-10-17-cris-assistant-design.md` (commits `22a5115`, `6f7b289`, `99872f9`, `08d4f03`; its Status line reads BUILT), plan
   `docs/superpowers/plans/2026-10-17-phase-41-cris.md` (`3ebc748`, `08d4f03`). Both sit on `main`, pushed with the merge (`origin/main` = `37f1b00` before this docs fix).
   The branch was the worktree `.claude/worktrees/phase-41-cris` (the worktree and branch are now removed); its final code tree was `ed6ce10`, 26 commits above `08d4f03` (94 files changed), then docs commit `e91d43d`, merged as `37f1b00`. The process note: Playwright and the dev server ran only at the end (the controller's battery, in chunks), as after the 2026-10-17 laptop crash.
   **Numbering changed.** The owner chose to build Cris first, so Cris took Phase 41: the audit's client-staff and people-flows phase is now Phase 42, and the deeper asset management phase is now Phase 43. Every "Phase 41" and "Phase 42" deferral recorded in (ag) now reads Phase 42 and Phase 43.

   **MIGRATION 34 `20261018090000_cris`** is additive: it creates `CrisConversation`, `CrisMessage` and `CrisPendingAction` and changes nothing that exists. The staging redeploy of 2026-10-17 applied it (33 to 34 migrations; the snapshot `staging-before-mig34.dump` was taken first). The worker's existing prune deletes chats older than 30 days and pending actions older than a day.
   **DEPLOY NOTES (redeployed 2026-10-17 at `37f1b00`):**
   - Staging's `.env` has no `ANTHROPIC_API_KEY`. The owner adds it themselves; never paste a key into chat, the docs or git. Settings › Cris then shows "Key: set on the server ✓". At this redeploy (2026-10-17) the widget was absent without a key; since 2026-10-18 (record (ai)) Cris runs in preview without one, and Settings › Cris says so. After the key is added, restart the app (`deploy-staging.ps1 -Force`, or a compose restart of web and worker) and press New chat.
   - The default model is Claude Haiku 5.5. Admins can switch it to Sonnet 5.5 or Opus 5.5 in Settings › Cris. Set a monthly spend cap in the Anthropic console (the app's own figure is only "about").
   - Once the key is in and the app restarted, run ONE short live lookup, then a second message after changing page, to confirm there is no 400 (the context block changes per message while the system prompt stays fixed).
   - `CRIS_MODEL=fake` is for dev and e2e only (scripted replies, no key, no cost) and is refused when `NODE_ENV=production`; `.env.example` carries both notes.
   - The IP check before a redeploy and the CI-built image are unchanged (the staging laptop never builds).
   - **Deployed 2026-10-17:** CI image pulled; the pre-migration snapshot is `staging-before-mig34.dump` (`pg_dump -Fc`, about 149 KB, 40 tables); IP check passed (.193); migration 34 applied (34 migrations; tables `CrisConversation`, `CrisMessage`, `CrisPendingAction`); web healthy; /login answers 200 locally and over the LAN. The live Cris check is still owed: it can only run once the owner adds the key (see (ai)).
   - **Local note:** the owner's untracked folder "Claude outputs/" (Cris images and the voiceover script) is listed in the main checkout's `.git/info/exclude`, which keeps the deploy script's clean-tree check passing; never commit or delete it.

   **WHAT SHIPPED**
   - **A. The mascot.** Cris sits bottom-right on every IT page (admin and it_staff only). It can be dragged, snaps to a side, and its position is saved per person. Looks: Gold, Sky blue and Silver, or Match theme; seven moods; motion Lively, Calm or Still; reduced motion is respected. The dock is a labelled `<aside aria-label="Cris">` landmark.
   - **B. The chat box.** It opens above Cris by default. It has a greeting, a context chip (the page's person or asset) and quick starts; person, which-one, spares, stock, confirm and result cards; Confirm, and Undo for 60 s; "Earlier messages"; the composer with a scan field; "{n} questions left today"; and on phones a responsive bottom panel. Make bigger grows only the height.
   - **C. The jobs.** Check someone's items; assign a spare by pick, scan or typed tag; replace with outcome Defective, Triage or Missing; who has a tag; spares in stock (read-only, 3 at a time).
   - **D. Safety (the design's core).**
     - The model never writes. It proposes a pending action with exact ids; the card is built from DB reads by id, not from the model's words.
     - The server enforces picks: a person must be confirmed, and a laptop must be picked, scanned or typed exactly.
     - Confirm sends only the pending action's id. It is atomic (a guarded `usedAt` claim), so a double click or two tabs are safe, and it re-checks everything before it writes.
     - Every change runs through the same lifecycle rules as the screens (`assignCore` and `replaceCore` in `src/server/modules/lifecycle/direct.ts`), audited "(via Cris)" in the activity sentence and History.
     - Undo reverses within 60 s, only if nothing else touched the items, with the holds restored.
     - Assigns via Cris are plain (DEPLOYED only, no loans; a loan stays a screen job).
     - Confirm refuses while Cris is off; Undo still works then, so a change can always be reversed in its 60 s.
   - **E. Data sent to the AI.** Names, employee nos., titles, who they work for (including clients), tags, models, serials, holdings and gaps. Never notes, free text or money. The system prompt is fixed; the first name, Manila date and page go in a context block at the start of each user message.
   - **F. Limits.** 100 questions per person per day by default (Manila midnight; admins change it), 10 a minute, one reply at a time per chat ("Cris is still answering…"), a new chat after 40 questions, and chats deleted after 30 days.
   - **G. Settings › Cris (`/settings/cris`).** For everyone with Cris: personal colour, motion, show, and back to the corner. For admins: the on switch, the daily limit, the model, key status, and this month's questions and cost.

   - **Battery on the Phase 41 tip (2026-10-17):** `tsc` clean - `lint` clean - **34 migrations**, schema up to date (this phase adds migration 34) - **2831 unit / 155 files** -
     the full Playwright battery run in chunks on `inventory_dev:3100` with `CRIS_MODEL=fake`: all 54 files pass, plus 17 Cris cases on the fake model (`e2e/phase-41-cris.spec.ts`), with **2 expected quick-login skips**; the affected specs (the Cris spec, admin, auth-shell, axe-sweep, direct-lifecycle, custody, holds) were re-run green after the final fix wave - the **axe sweep is clean, with no moderate findings** (the dock-outside-landmarks "region" finding was fixed by the `<aside>`). `npm run db:seed` ran last on `inventory_dev`; port 3100 free.
     One battery find: `auth-shell` axe failed on the mascot hint fading mid-animation (contrast); fixed in `59ccf87`.
   - **Final review (opus):** Ready after fixes - 0 Critical, 3 Important and 16 Minor; the safety chain, data minimisation, migration 34 and off-without-key all held, and no path changes custody without the person's own Confirm. One fix wave (`62e01c2`, `9c974dc`, `0cd0f60`, `5100c67`, `e5152dd`, `fb7573a`, then `ed6ce10`) fixed:
     - a 400 from the provider retries once without the history before the chat is abandoned (a credit or spend-cap 400 no longer trashes the chat);
     - "Spares in stock" lists spares read-only (`list_spares` without a person), with an assign-with-scan e2e and a spares-in-stock e2e;
     - Confirm refuses while Cris is off, while Undo still works;
     - a Postgres deadlock reads "try again" instead of a 500;
     - the dock is a labelled aside; Make bigger grows only the height;
     - the generic flag actions (`setFlag`, `setFlagValue`) refuse the `cris` key; `saveCrisPrefs` is admin and it_staff only; `max_tokens` is 4000.
   - **Rulings and deviations (from the build ledger, each with its cost if wrong):**
     - Task 3: Ruling: loans stay a screen job in v1 (Cris assigns are DEPLOYED only) - costs if wrong: no loan via Cris.
     - Task 2: Ruling: Cris does not call `rememberPicks` (it is the human picker's recent list) - costs if wrong: recent pickers do not show Cris's picks.
     - Task 4: Ruling: a replace's OLD item may be proposed without a pick only when the person holds exactly one item of that type (the card shows it) - costs if wrong: a model could name the old laptop implicitly, still shown on the card.
     - Task 4: Ruling: `find_people` auto-picks only on a full name or employee no. present in the person's own words; otherwise a one-choice "Which one?" card - costs if wrong: an extra click.
     - Task 5: Ruling: the system prompt stays fixed; name, date and page go in a context block at the start of each user message (changing `system` mid-conversation would invalidate replayed thinking, a 400 on new accounts) - costs if wrong: none.
     - Task 7: Deviation: the status line shows "Thinking…" (no "Looking up {what}…", since there is no streaming), and the Searching mood is unused - costs: a less specific status.
     - Task 7: Ruling: "Replace X's laptop" pre-fills the box (it needs a reason) - costs if wrong: one more keystroke.
     - Final review: Ruling: picks and button presses count as daily questions (each is a model call; a replace flow uses about 3) - costs if wrong: "{n} questions left" drops faster than the person expects.
     - Final review: Ruling: the month's cost figure undercounts failed and fallback turns (a failed turn's rows and their usage are deleted; the retry probe is billed but not counted) and is labelled "about" - costs if wrong: the console, not the app, is the truth for spend.
     - Fix wave: Ruling: spares in stock are not filtered by type (every free IT spare is listed, with its type on each row) - costs if wrong: a longer list for "spare laptops".
     - Controller: Ruling: Undo works while Cris is off (the brief over-reached; the review's M1 intent) - costs if wrong: an Undo after the switch-off.
     - Controller: Ruling: the quick start reads "Spares in stock", not "Spare laptops in stock" (it lists every spare type) - costs if wrong: copy only.
     - Final review: Accepted: the retry's answer is discarded (the person asks again in the fresh chat); the deadlock retry is detected by the `CRIS_SAME_MOMENT` constant, a string comparison.
   - **Parked follow-ups (still open, from the ledger and the final review):**
     - The employee Timeline does not show "via Cris" (`employees/[id]/timeline` uses `actionLabel` only; the activity sentence and History do).
     - Two racing preferences saves (Settings › Cris and a second tab) can lose one field; the widget serialises its own saves.
     - `recordUndo` copies about 15 lines of `commitDirect`'s write half; share them when the direct path next changes.
     - An "EMP-1" search matches EMP-10 to EMP-19 by contains (safe: it only yields a "Which one?" list); `get_holdings` reads twice (performance only).
     - The rollover at 40 questions can leave one extra empty chat (pruned in 30 days); two chats racing can pass 100 a day by one.
     - The one-reply guard is 3 minutes and a worst-case turn could outlast it; fallback-iteration accounting is unverified; counting failed turns in the month cost needs a usage-only row.
     - The model writes the assign and replace `reason`; keep it only when it appears in the person's words (MISSING still needs a reason asked of the person).
     - A scan whose tag is not on the open spares card is sent as text and loses "Scanned ✓" on the Confirm card.
     - Person-card items link to records the person may not be able to open (carry a `canOpen` flag); a pick replays as the stored words after a reload; the layout reads the `cris` flag twice per IT page; some dead code and duplication (`promptParts`, `buildSystemPrompt`, `exactTagIn`, `EMPTY_PICKS`, a doubled `refusalText`, three first-name parses).
     - Widget: Undo after a reload is refused by the server (the button is gone anyway); re-render cost while typing; the echo bubble re-keys and a New chat greeting is announced again; the drag-versus-click timing is a battery watch.
     - A type-name filter for spares in stock; e2e case 17 depends on the seed's stock pool (BR-PH-0301 on page two); a dedicated result flag instead of the `CRIS_SAME_MOMENT` string comparison.
   - **Open question for the user (from Phase 38, still open, carried forward unchanged):** should IT and viewers see peso amounts ("Value at cost") on profiles and offboarding at all? Today they do; hiding them is a product decision. Phase 41 changed nothing here (Cris never sends money to the AI).
   - **What is next:** the merge, the push and the staging redeploy are done (2026-10-17, `37f1b00`, migration 34 applied; CI built the image, the staging laptop never builds, `pg_dump -Fc` first); since 2026-10-18 Cris runs in preview on staging (record (ai)) until the owner adds the key, then restart, press New chat and run the live check. Then Phase 42 (client staff and people flows; the six mockups are already on the canvas), then Phase 43 (deeper asset management).

   **(ag) PHASE 40 (Fix what's broken, and the IT basics: bugs, a phone shell, better search, a purchase-review worklist, offboarding that removes IT access, triage with a reason) - CODE-COMPLETE 2026-10-17 on branch `phase-40-it-fixes`, MERGED to `main` via `2469068` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; staging REDEPLOYED 2026-10-17 at `2469068` (CI image pulled, `pg_dump -Fc` snapshot taken first, IP check passed (.193), migration 33 applied, now 33 migrations; web healthy); ADDS MIGRATION 33.**
   Spec `docs/superpowers/specs/2026-10-17-it-fixes-and-basics-design.md` (`e3c9890`), plan
   `docs/superpowers/plans/2026-10-17-phase-40-it-fixes-and-basics.md` (`fc16778`). Both sit on `main`, pushed with the merge (`origin/main` = `2469068` before this docs fix).
   The branch was the worktree `.claude/worktrees/phase-40-it-fixes` (the worktree and branch are now removed); its final code tree was `808e23a`, 27 commits above `fc16778` (210 files changed), then docs commit `110a4a3`, merged as `2469068`.
   The process note: Playwright and the dev server ran only at the end (the controller's battery, in chunks), as after the 2026-10-17 laptop crash. The origin was a read-only UX audit
   of the IT side (about 70 findings); the user chose "All three, in order": Phase 40 (this), then 41 (client staff and people flows), then 42 (deeper asset management).

   **MIGRATION 33 `20261017120000_setup_removed`** runs `ALTER TYPE "SetupState" ADD VALUE 'REMOVED'` and nothing else. The staging redeploy of 2026-10-17 applied it (32 to 33 migrations; `SetupState` is now DONE, NOT_YET, NOT_NEEDED, REMOVED).
   **DEPLOY NOTE:** it is forward-only once anyone marks access "Removed". Do not roll staging back past `2469068` once anyone marks access "Removed": an older image would break the employee pages that read the enum. Restore the snapshot instead.
   **Deployed 2026-10-17:** CI image pulled; the pre-migration snapshot is `staging-before-mig33.dump` (`pg_dump -Fc`, 149 KB, 40 tables); IP check passed (.193); web healthy; /login answers 200 locally and over the LAN (title "Sign in · Backroom IT").

   - **§2 Bugs.** The accountability form's Issued date is the assignment date (the newest assignment audit via `heldSinceByAsset`; "—" when none). Employment changes only through
     offboarding: Edit is read-only plus "Start offboarding…"; an OFFBOARDING person's Employment offers Offboarding or Active (cancel offboarding); an OFFBOARDED person is read-only;
     the server refuses any other move with "Use Start offboarding — leavers go through the offboarding wizard"; new employees are always ACTIVE. The Help 404 is replaced by a
     Keyboard shortcuts dialog, and "/" focuses the page's search box. Asset History and Timeline read in words (names for ids, "(removed)" for missing ones, Manila dates, Yes / No,
     no `[object Object]`, action labels). The Columns chooser labels "Registration". The label print dialog is followed by "Did the labels print correctly?"; only "Yes, mark printed" stamps them.
   - **§3 Phone shell.** Below `lg`: a menu button, the page name, Search and Scan a tag in the top bar; the drawer carries the workspace switch and the account block with Sign out.
     The switcher reads "{n} workspaces", not the cookie name.
   - **§4 Palette.** Assets match tag, model, serial and holder with hints ("serial 5CG7…", "held by …"); an exact tag is the first result and opens on Enter; people match name and
     employee no. with a held-tag hint; "Too many searches just now — try again in {n} s."; a stale-response guard; combobox / listbox / option ARIA; the shortcut reads "Ctrl K" or "⌘K".
   - **§5 Titles and toasts.** Page titles read "{Page} · Backroom IT". Toasts have Dismiss; errors persist; success toasts go after 4 s and pause on hover or focus.
   - **§6 Work and approvals.** A "Purchase reviews" worklist group (SUBMITTED, cap 50) and an IT nav badge; approval checks read Passed / Failed; the A key runs the row's main action
     (approve, or retry a failed one) and ignores Ctrl / Cmd / Alt and key repeat; `STATUS_LABEL` is used for asset statuses everywhere; /audit shows action words (the CSV keeps the codes);
     every action code the server and worker write has a label (`AUDIT_ACTIONS`, with a test that fails on a missing one).
   - **§7 Offboarding removes IT access (migration 33).** `SetupState` gains REMOVED; the Accounts step lists the four IT access items with "Mark removed"; readiness reads
     "IT access · {n} still active" or "IT access · removed"; `completeOffboarding` refuses with "Remove their IT access first" while any is live (`itAccessLive`: Entra / Intune,
     Autopilot or Argus Done, or a named VPN); the next action reads "Remove access". "Not recorded" never blocks.
   - **§8 Asset record and triage.** The Overview shows OR no., Covered by and Who to call for repairs when set. Triage has no default; Dispose and Donate need a reason (chips per
     decision, or 2+ characters). The reason is stored in the audit diff under the `reason` key, with no column.
   - **§9 Loading and empty.** A shell skeleton, an approval-detail skeleton and a 4-column audit skeleton; one shared `FilteredEmpty` with Clear filters; Labels badge contrast.
   - **Found in review (cross-cutting).** Dialogs return focus to their trigger even when a field autofocuses (`use-focus-trap` reads the opener at render); the toast focus hand-off
     (next Dismiss, the opener, or `#main`); "/" stands aside while any overlay is open; Ctrl / ⌘K is ignored under another dialog; the Edit form posts employment only when its select
     is shown, and both the Edit and offboarding-completion writes are state-guarded ("That person changed — reload and try again").
   - **Battery on the Phase 40 tip (2026-10-17):** `tsc` clean - `lint` clean - **33 migrations**, schema up to date (this phase adds migration 33) - **2459 unit / 132 files** -
     the full Playwright battery in chunks on `inventory_dev:3100`, with **every file rerun after the final fixes** (`c0fb1b6`, `808e23a`): all pass, **2 expected quick-login skips**
     (no `QUICK_LOGIN_EMAILS` in the dev env) - the **axe sweep is clean, with no moderate or minor findings**. `npm run db:seed` ran last on `inventory_dev`; port 3100 free.
     Two battery finds: `phase-40` case 3 caught a real focus bug (`useFocusTrap` read the active element after a child's autofocus, so focus went to the body on close; fixed in
     `c0fb1b6`), and `offboarding.spec` "each decision applies" had a stale exact "Missing" assert (decided items leave the Collect step; test fixed in `808e23a`).
   - **Final review (opus):** 0 Critical, 2 Important and 12 Minor; spec §2-§9 complete, migration 33 safe. The Importants: the Edit form could silently cancel an offboarding
     started elsewhere, and Home's "oldest {d} d" ignored the oldest rows. The final fix wave (`547dac3`, `154756b`, `1f38f8f`, `a7a66f8`, `ed84c07`, `2ed8a13`) took both, the
     Ctrl K / J-K modifier minors, the completion state guard, the action-label completeness test, the shortcuts-dialog wording, the refusal tests, dead code and a stale toast opener.
   - **Rulings (from the build ledger, in order, each with its cost if wrong):**
     - Task 2: Ruling: `employmentChangeAllowed` allows any same-value re-send (including OFFBOARDED to OFFBOARDED) so editing a leaver's name or title still works — costs if wrong: none (no state change).
     - Task 2: Ruling: CSV import may still CREATE people as OFFBOARDING / OFFBOARDED (loading historical leavers is its purpose; updates can never move employment); the spec's "new employees always ACTIVE" covers the wizard and `createEmployee` — costs if wrong: an import can add a leaver who never went through the wizard (they hold nothing on creation).
     - Task 4: Ruling: "1 workspace" in the singular; the search trigger is an icon button below `lg` and the wide bar from `lg`; Density and Keyboard shortcuts are hidden below `sm` (Theme stays) so the phone bar fits the page name; record tabs and edit pages are titled "{Tab} · {tag|name} · Backroom IT" — costs if wrong: small layout and wording differences.
     - Task 5: Ruling: the palette keeps its in-memory rate limit (30 per 10 s) instead of `checkRate`, since a database row per keystroke is wrong for type-ahead — costs if wrong: the limit resets on a restart.
     - Task 5: Ruling: holder matching is scoped by asset visibility (the holder is already visible on the record) — costs if wrong: none beyond today's exposure.
     - Task 5: Ruling: the copy "Search failed — try again." (not in the spec) is accepted — costs if wrong: wording only.
     - Task 7: Ruling: raw approval states (queue State column, detail pill), purchase-request states, reservation states and the palette's request state stay raw in Phase 40, because §6 scopes `STATUS_LABEL` to asset statuses; they move to Phase 41's naming-consistency item — costs if wrong: some raw enums stay visible one phase longer.
     - Task 7: Ruling: pressing A on a row claimed by someone else shows "{ref} is claimed by {owner} — only they can approve it." — costs if wrong: wording only.
     - Task 7: Ruling: the /audit action cell uses `actionLabel` (spec §6 "never" beats the old slug note); the CSV export keeps the codes — costs if wrong: admins lose the slug on screen (it is still in the export).
     - Task 8: Ruling: the triage reason is stored in the audit diff `reason` key, with no column and no migration — costs if wrong: the reason is not queryable as a field.
     - Task 8: Ruling: Change status to Dispose / Donated still takes no reason (§8 names triage only); deferred to Phase 42 — costs if wrong: a disposal without a reason through Change status.
     - Final review: Ruling: the waiting age for requests Finance sent back, worker-error raw codes, "Offboarding" vs "Leaving" wording, and IT access still "Removed" after cancelling an offboarding (with the cancel moving into the wizard) go to Phase 41 — costs if wrong: small inconsistencies one phase longer.
     - Final review: Ruling: dropped as not worth doing: a `#main` focus fallback outside `(app)`, the scrollable-region axe watch and loosening the strict axe scans — costs if wrong: none seen in the battery.
     - Spec §11: cancel offboarding stays in Edit until Phase 41 (a leaver can be un-offboarded from Edit); IT access blocks completion only when live; REMOVED is a new enum value rather than reusing "Not needed"; Help becomes a shortcuts dialog; Purchase reviews count SUBMITTED only (`IT_REVIEWED` is Purchasing's).
   - **Deferred to Phase 41, by ruling:** raw approval, purchase-request and reservation states in pills; the palette's request state; employment enums in offboarding conflict messages;
     uppercase pill casing; "Offboarding" vs "Leaving" wording; worker-error raw codes; the waiting age for requests Finance sent back; IT access still "Removed" after cancelling an offboarding
     (with the cancel moving into the wizard). **Deferred to Phase 42:** Change status to Dispose / Donated still takes no reason; the sidebar's raw role line (the sidebar grouping).
   - **Open question for the user (from Phase 38, still open, carried forward unchanged):** should IT and viewers see peso amounts ("Value at cost") on profiles and offboarding at all?
     Today they do; hiding them is a product decision. Phase 40 changed nothing here.
   - **Follow-ups (worth keeping):** ⌘K can flash for one frame before the palette settles; the toast live region announces an error twice (alert inside a polite region), errors pile up
     without a cap and Esc does not dismiss; the duplicated column labels in the chooser; the history date formatter only reads keys with a date-like suffix, so a future date key must
     follow the naming; no unit test for the DOM selection of the "/" target.
   - **What is next:** Phase 41 (client staff and people flows; mockups first), then Phase 42 (deeper asset management). The merge, the push and the staging redeploy are done
     (2026-10-17, `2469068`, migration 33 applied; CI built the image, the staging laptop never builds, `pg_dump -Fc` first).

   **(af) PHASE 39 (No long scrolls: a tabbed profile side card, side panels for the long logs, paged stock tables, bounded lists, spares on demand) - CODE-COMPLETE 2026-10-17 on branch `phase-39-no-long-scrolls`, MERGED to `main` via `8faf91b` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; staging REDEPLOYED 2026-10-17 at `1b502a1` (CI image pulled, `pg_dump -Fc` snapshot taken first, no migration, still 32 migrations); NO MIGRATION.**
   Spec `docs/superpowers/specs/2026-10-17-no-long-scrolls-design.md` (`3d033f4`), plan
   `docs/superpowers/plans/2026-10-17-phase-39-no-long-scrolls.md` (`ee5a662`). Both sit on `main`, pushed with the merge.
   The branch is the worktree `.claude/worktrees/phase-39-no-long-scrolls`; its final code tree is `4e79632`, 19 commits above `ee5a662` (the list is the build's
   `branch-commits.txt`); this docs commit sits on top of it. The process note: Playwright and the dev server ran only at the end (the controller's battery), as after the 2026-10-17 laptop crash.

   **STANDING DESIGN RULE: a page never grows with the data.** A log shows the newest few entries, with "View all" opening a side panel (search, paged). A big table pages 50 at a
   time, with search and filters. A list inside a form opens one item at a time, or shows "+N more". No page holds a scroll box of its own. Any new screen that lists records
   must follow this rule from the start; the helpers are the shared long-list and side-card view rules added in this phase's first task.

   - **A. The profile's right column is one card with four tabs: Notes, IT setup, Form, Transfers** (each with a badge). The chosen tab is remembered per browser in
     localStorage `br.profile-side-tab` (always in try/catch); `?side=` overrides it and `?notes=1` implies Notes. **Notes:** the 3 newest, a "⋯" menu with Edit / Delete, and
     "View all {n} →" opening a side panel (search, Written by, Manila month headings, 20 at a time, server-paged `listEmployeeNotes`). **IT setup:** aligned 150px selects with
     status dots; any refusal snaps the select back. **Form:** one status line, visible "{k} issued since" tags, buttons side by side. **Transfers:** the latest 3, a Timeline
     link, and an empty state.
   - **B. The purchase request conversation** shows the newest 5 in place; "Earlier messages ({n}) →" opens a side panel (search, Kind filter, 30 at a time, `?thread=1`).
   - **C. Stock tables.** The stocktake count/review pages 50 at a time with search, category, "Only uncounted" and "Only differences"; counts are saved before any page or filter
     move; an invalid count blocks with "A whole number, zero or more". On hand pages 50 with category headings, a totals card and the top-8 subtotals over everything. Expiry has
     tabs Expired / Expiring, paged 50, in a deterministic order (expiry, code, reference, id).
   - **D. Bounded lists elsewhere.** Title rules are an accordion (one open; "Leave without saving?"); past holds sit behind "Show past holds ({n})" (20 per page, newest resolved
     first); a history entry shows 3 fields then "+{n} more fields"; import failures show the first 20 with "Download all failures (.csv)" (BOM, formula guard); the asset types
     and categories tables are searchable inside a bounded box.
   - **E. Spares on demand.** The profile no longer ships every spare asset: the Fill / Replace / Reserve pickers load on open through `spareCandidates` (max 50, search,
     pool-wide held / queued counts, and a `pickable` flag for Replace / Reserve).
   - **What the next staging redeploy does.** There is no migration and nothing stored changes. The screens above stop growing with the data. Merge, push and redeploy are the
     user's decisions, not pre-authorised. Staging deploys by pulling the GitHub Actions image (the staging laptop never builds); take a `pg_dump -Fc` first.
   - **Battery on the Phase 39 tip (2026-10-17):** `tsc` clean - `lint` clean - **32 migrations**, schema up to date (this phase adds none) - **2112 unit / 122 files** -
     **525 e2e / 50 files**, green on `989ef26` (chunks B-I; 2 pre-existing skips) after three battery fixes (two test-only, one real stocktake focus / click bug: the error mounting
     on blur shifted the page and the Next-page click missed); after the final-review wave (`bab8766`, `4e79632`) the affected specs re-ran green (26 + 87 + 20 + 42). `asset-classes`
     case 21 failed once in a mixed batch and passed 20/20 on a fresh seed: the known batch-order flake (also seen in Phase 36). `npm run db:seed` ran last on `inventory_dev`.
   - **Final review (opus):** 0 Critical, 1 Important (stocktake: a re-typed count after someone else's change could be silently skipped) and 10 Minor, all fixed in `bab8766` and
     `4e79632`; the re-review found all 11 addressed, no new issues, no ruling challenged, every §1 surface bounded.
   - **Rulings (from the build ledger, in order, each with its cost if wrong):**
     - Task 1: Ruling: stock tables use LOG_PAGE_SIZE (50) since ENTITY_PAGE_SIZE is 25 (plan P-1; spec said 50 rows) — costs if wrong: none.
     - Task 2: Ruling: the VPN "Other…" name box stays open on a validation refusal (so the name can be corrected); every select refusal and the rate-limit refusal still snap back — spec §2.3's aim is not to show unsaved values — costs if wrong: none.
     - Task 2: Ruling: e2e for §7.2 #1 and #11 (tabs, memory, axe per tab) is owned by Task 9. — costs if wrong: none (test ownership only; #1 was then written in Task 3, see below).
     - Task 3: Ruling: the notes count line uses the singular for one note ("1 note · newest first · showing 1") — grammar over the spec's literal "{n} notes" — costs if wrong: none.
     - Task 3: Ruling: the page-height e2e takes its baseline at 4 notes (card already at full size: 3 notes + footer) and asserts 25 notes is within 40 px, also comparing the Notes tabpanel's own height — spec §7.2's "1 note" baseline would compare different card sizes and depend on the Equipment column's height — costs if wrong: none.
     - Task 3: Ruling: §7.2 #1 (tabs, badges, keyboard, memory) is written in Task 3's no-long-scrolls.spec.ts; Task 9 must not duplicate it (axe #11 stays in Task 9). — costs if wrong: none (test ownership only).
     - Task 5: Ruling: implementer copy accepted — "Search the stocktake", "No item matches.", "The count for {code} didn't save — try again."; the category filter may hold several categories (house FacetDropdown); breadcrumb/sidebar links are not gated on pending saves (spec asks only for page and filter moves) — costs if wrong: a count typed and immediately followed by a sidebar click could be lost.
     - Task 6: Ruling: report exports ignore the on-screen search (spec: export unchanged); the Expired/Expiring counts follow the search and category; the default tab is Expired even when empty — costs if wrong: an export contains more rows than a searched screen shows.
     - Task 8: Ruling: the page keeps one small query for spares reserved for this person (tiles' "reserved · {tag}" and Assign reserved must show on first paint), through the same shared where-clause — costs if wrong: none (bounded by this person's holds).
     - Task 8: Ruling: Fill gains a search box with implementer copy ("Search the spares", "Type a tag or model…", "No spare matches.", "Loading spares…", "Couldn't load the spares." + "Try again") so spares beyond the first 50 are reachable — costs if wrong: wording only.
     - Ruling: disclosure toggles use one pattern — a stable name ("Edit the {title} rule", "+{n} more fields") with aria-expanded and aria-controls — costs if wrong: none.
     - Ruling: ?notes=1 implies the Notes tab (treated as ?side=notes) — costs if wrong: none.
   - **Open question for the user (from Phase 38, still open):** should IT and viewers see peso amounts ("Value at cost") on profiles and offboarding at all? Today they do; hiding
     them is a product decision. Phase 39 changed nothing here.
   - **Follow-ups (worth keeping):** the stock Consumption report is not paged (it was not in the spec's audit list); the asset record header's spare list and Register's
     purchase-request select still load everything; Reserve still drops spares held for the same person client-side, after the 50 cap; there are no action-level tests for
     `listEmployeeNotes` or `spareCandidates`; there is no e2e for Esc cancelling a note edit in the notes panel; the shared Pagination drops focus when Next lands on the last page
     (house-wide, pre-existing); Expiry's "Expiring (n)" on the Expired tab uses a window that tab does not show.

   **(ae) PHASE 38 (Equipment by client, and depreciation from the purchase month) - CODE-COMPLETE 2026-10-17 on branch `phase-38-equipment-by-client`, MERGED to `main` via `1b16921` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; staging REDEPLOYED 2026-10-17 at `a3cb693` (CI image pulled, `pg_dump -Fc` snapshot taken first, no migration, still 32 migrations; staging had 1 of 33 assets Finance-approved, so only its book value moved); NO MIGRATION.**
   Spec `docs/superpowers/specs/2026-10-17-equipment-by-client-design.md` (`8391e22`), plan
   `docs/superpowers/plans/2026-10-17-phase-38-equipment-by-client.md` (`a7f80d8`). Both sit on `main`, pushed with the merge.
   The branch is the worktree `.claude/worktrees/phase-38-equipment-by-client`; its final code tree is `649767f`, 9 commits above `a7f80d8` (the list is the build's
   `branch-commits.txt`). The process note: Playwright and the dev server ran only at the end (the controller's battery), as after the 2026-10-17 laptop crash.
   - **A. The depreciation rule, changed everywhere.** The start month is the Manila month of `purchasedAt` (fallback: the month Finance approved the asset), counted in full as
     month 1. Only approved assets depreciate, but they catch up from the purchase month. The as-of month is the current month, which is actual, not projected. This holds on the
     Finance register, the asset page, the year schedule, the override dialog, the Home Finance card and the new report and export. Wording: "as of today ({Month} counted)";
     Home "as of today"; Approve reads "Approve to start depreciation from the purchase month"; the override dialog reads "It depreciates from {Month YYYY}, the purchase month." or
     "It starts depreciating once Finance approves it, from the purchase month."; the schedule help line reads "This month is counted; later months are projected."
   - **B. The Equipment by client page.** `/equipment-by-client` (IT -> People lifecycle, and the Finance nav): Clients | Internal departments tabs; stats; search; All / With gaps /
     No policy; a sortable table with Equipped bars (a floor, never 100% while anyone is missing); a detail panel (By category, Missing something, On loan, See their staff, Export);
     "Export all (.xlsx)" and a per-group export (one row per IT item; "Held since" comes from a batched raw-SQL audit lookup shared with the side panel). Readable by admin,
     it_staff, finance_staff and viewer. **Money** (Book value today, Book value, Per person, category values, the Cost and Book value export columns, "{n} without a cost") is
     shown only to admin and finance_staff and is never selected or sent for other roles. Person and staff links show only for roles that can open /employees; the Departments &
     clients link only for admin and it_staff.
   - **C. Labels.** The profile stat, the held-item panel and offboarding now say "Value at cost" / "Value out at cost" (they always showed cost, never a depreciated value).
   - **What the next staging redeploy does.** There is no migration and nothing stored changes; everything is recomputed on read. **Every approved asset's book value drops**, because
     depreciation now starts at the purchase month and takes the current month. The new page appears in the nav. Merge, push and redeploy are the user's decisions, not
     pre-authorised. Staging deploys by pulling the GitHub Actions image (the staging laptop never builds); take a `pg_dump -Fc` first.
   - **Battery on the Phase 38 tip (2026-10-17):** `tsc` clean - `lint` clean - **32 migrations**, schema up to date (this phase adds none) - **1998 unit / 118 files** -
     **513 e2e / 49 files**, green on the first pass on `02c1265` (chunks A-I, 2 pre-existing skips); after the final-review wave (`649767f`) the affected specs re-ran green
     (55 + 7 axe); `npm run db:seed` ran last on `inventory_dev`.
   - **Final review (opus):** 0 Critical, 3 Important (the without-a-cost count not shown; rounding showed 100% beside a gap; cost labelled "Book value" on the profile, panel and
     offboarding) and 2 Minors, all fixed in `649767f`; the re-review found all addressed, no money leak, and one depreciation rule everywhere.
   - **Rulings (from the build ledger, in order, each with its cost if wrong):**
     - Task 1: Ruling: the spec §2.3 schedule help line (dropped by the plan) is added in Task 1's fix round — "This month is counted; later months are projected." — spec is the authority — costs if wrong: none.
     - Task 2: Ruling: "no policy" follows the spec wording — a group is no-policy only when it has no base policy AND no person resolves to a policy; summariseGroup takes group.hasBasePolicy, so a client with a list but no staff yet reads 100% equipped — costs if wrong: an empty client shows 100% instead of "—".
     - Task 3: Ruling: links follow what the viewer can open — person and "See their staff →" links only for roles that can reach /employees (admin, it_staff, viewer); Finance sees names as plain text and no staff button; the empty state links Departments & clients only for admin/it_staff, plain text otherwise — a link that redirects is worse than none — costs if wrong: Finance can't jump from the report to a person.
     - Task 3: Ruling: PATH_RULES uses the house form /^\/equipment-by-client(\/|$)/ (stricter than the plan's bare regex) — costs if wrong: none.
     - Ruling: the profile stat, the held-item panel and offboarding's "Book value out" — which show plain cost — are relabelled "Value at cost" / "Value out at cost" rather than recomputed or hidden — they never ran depreciation and hiding money from IT on profiles is a product decision for the user (asked at finish) — costs if wrong: IT keeps seeing cost amounts on profiles.
     - Ruling: Equipped % and "fully equipped" never round up to 100 while anyone is missing something (floor, capped at 99 when missing > 0) — a green 100% beside "1 missing" misleads (plan's round() was a defect) — costs if wrong: none.
   - **Open question for the user:** should IT and viewers see peso amounts on profiles and offboarding at all ("Value at cost")? Today they do (the Phase 29 / 37 behaviour); hiding them is a product decision.
   - **Deferred minors (follow-ups worth keeping):** the export repeats the page's money mapping (a shared helper would remove the drift); "Held since" and the export dates use UTC
     (they can read a day early before 08:00 Manila - house-wide); each row click re-runs the full query set; the e2e peso assertions do not distinguish a ₱0; the spec setup sits outside the try in `equipment-by-client.spec.ts`.

   **(ad) PHASE 37 (client staff, equipment policies per client, the profile redesign, a three-step Add employee) - CODE-COMPLETE 2026-10-17 on branch `phase-37-clients-profile`, MERGED to `main` via `6050649` (`--no-ff`, merged tree = tested tip) and PUSHED 2026-10-17; staging REDEPLOYED 2026-10-17 at `c8eca0e` (CI image pulled, `pg_dump -Fc` snapshot taken first, MIGRATION 32 applied, 32 migrations; all 5 departments read INTERNAL, the Finance standard kit's slots now read Laptop / Monitor / Docking Station / Headset / Phone / Monitor (shown "Monitor 2"), IT setup reads "Not recorded" for everyone, and no clients exist until added on Departments & clients).**
   Spec `docs/superpowers/specs/2026-10-16-clients-and-profile-design.md` (`0cafcf1`), plan
   `docs/superpowers/plans/2026-10-16-phase-37-clients-and-profile.md` (`f5dec5d`; 12 tasks, P-1...P-5 at its start). Both sit on local
   `main` (= `f5dec5d`, `origin/main` = `89c68c5`), pushed with the merge. The branch is the worktree `.claude/worktrees/phase-37-clients-profile`; its final
   code tree is `b1f3c66`, 20 commits above `f5dec5d` (the list is the build's `branch-commits.txt`, newest first: `b1f3c66`, `3603e8e`, `c596c13`, `4ef12dd`,
   `cd73311`, `c3538a1`, `82f7749`, `0b73cd4`, `5b98650`, `e4de309`, `08b9a6c`, `b2e0031`, `519c616`, `27618f1`, `5b54af2`, `0c7d039`, `7243b88`, `f25bb30`, `8e9f72d`, `bb670a3`).
   Adds **MIGRATION 32 `20261016180000_clients_profile`**: the `GroupKind` enum with `Department.kind` (default INTERNAL) and `Department.archivedAt`; the `SetupState`
   enum with `Employee.entraStatus` / `autopilotStatus` / `argusStatus` / `vpn` (nullable, read as "Not recorded"); the `EmployeeNote` table; and a guarded data step that
   rewrites typed `PolicySlot` names and ADD `EmployeeSlotException` names to the category name (the type name inside Other), so "second monitor" becomes
   "Monitor", shown numbered as "Monitor 2". It writes no audit rows. The process note: the laptop crashed once mid-run (2026-10-17), and on the user's
   instruction Playwright moved to the end (Task 11) instead of running per task.
   - **A. Clients and the Departments & clients page.** A client is a `Department` of kind CLIENT (P-1). The page (IT -> Records & admin -> Departments & clients) has
     tabs, search, Active / No policy / Ended filters, sort, add, rename, and end (archive) / restore. Filters run in the browser over all rows (P-2).
     The Employees list has a Works for column and Works for / Staff facets; the export gains "Works for" and "Staff"; the import accepts "Works for" / "Client" headers
     and blocks CREATE rows into archived groups. The transfer, purchase and stock pickers list departments and clients in two optgroups (P-4, `groupPickerOptions`
     and `GroupSelectOptions`); the server refuses an archived group.
   - **B. Equipment policies per client or department.** IT -> People lifecycle -> Equipment policies is a master-detail page: each group has its own list of Category
     -> Type lines, start from a copy, copy to others (same-type slots and their waivers are kept), and title rules per group; older global title rules fold. The selected group
     lives in `?group=` (P-2).
   - **C. The profile.** An identity band; a Notes log (the author edits or deletes their own note, an admin deletes any); an IT setup card (Entra/Intune, Autopilot, Argus, VPN);
     equal equipment tiles with numbered labels; loans and extras as tiles; a side panel (`?item=`) with Held since, Recent history and the actions. "Add a slot" asks
     category then type and names itself; the reason chips are split into add and waive. `loadout-view.tsx` was split (P-5: `equipment-tile.tsx`, `held-item-panel.tsx`).
   - **D. Add an employee in three steps.** Details (including Works for and Accounts & access), Equipment spares per line, Check & create, with a live policy panel
     (P-3: `previewPolicy` takes the lines; the wizard has its own panel). Someone created not ACTIVE gets no equipment (step 2 shows their lines without spare pickers and the
     server ignores any assign sent).
   - **What the next staging redeploy does.** Every existing department stays INTERNAL; slot names change to labels; IT setup reads "Not recorded" for everyone; there are no clients
     until someone adds them on Departments & clients, and then each client gets its own list on Equipment policies. Merge, push and redeploy are the user's decisions, not
     pre-authorised. Staging deploys by pulling the GitHub Actions image (the staging laptop never builds); take a `pg_dump -Fc` first.
   - **Battery on the Phase 37 tip (2026-10-17):** `tsc` clean - `lint` clean - **32 migrations**, schema up to date (this phase adds migration 32) - **1936 unit / 117 files** -
     **508 e2e / 48 files**, all green: chunks A-H on `c596c13` after the test-locator fixes, then the final-review wave's affected specs re-run on `b1f3c66`
     (27 + 52 + 7 axe); `npm run db:seed` ran last on `inventory_dev`.
   - **Final review (opus):** 0 Critical, 3 Important (copy wiping waivers; a category change reusing a slot; slot load order for gap counts) and 4 Minors, fixed in `3603e8e` and
     `b1f3c66`; the re-review found all addressed.
   - **Rulings (from the build ledger, in order, each with its cost if wrong):**
     - Ruling: if Task 1's drift check shows a difference after the migration is applied to inventory_dev, the implementer fixes the migration SQL and aligns inventory_dev with corrective SQL via `npx prisma db execute` (never reset), since the migration is unapplied anywhere else. Costs if wrong: dev DB drift that a fresh seed DB would expose in the battery.
     - Ruling: Task 3 leaves the old one-card new-employee form listing archived groups until Task 10 replaces it; the interim is never shipped alone. Costs nothing if wrong.
     - Ruling: e2e assertions on the old seeded slot names (laptop/monitor/dock/headset/phone/second monitor) are owned by Task 8 (labels become numbered tiles there); Tasks 2-7 treat failures that are only those names as expected. Costs if wrong: a red spec carried for a few tasks, caught by Task 8's run and the battery.
     - Task 3 ruling: the import archived-department block applies to CREATE rows only; an UPDATE row naming the person's current (archived) group is accepted (Rule 6b already blocks any department change). Spec 2.1 drops archived groups "for new choices" and keeps their people, so the plan's stricter wording is amended. Costs if wrong: someone could re-import an ended client's staff without restoring it (no move is possible, so nothing changes group).
     - Task 3 ruling: the archived-department block text stays the static vocabulary sentence with names in the wizard's "e.g." line (the blocked-causes explain cannot interpolate one name); this matches how an unknown department reads. Costs if wrong: wording differs slightly from the spec sentence.
     - Ruling: from Task 4 on, implementers write and update Playwright specs but never run Playwright or a dev server; every e2e run moves to Task 11's battery (chunked, foreground), the user's instruction after the crash, to keep load off the staging laptop. Costs if wrong: e2e failures surface late and land in Task 11's fix work instead of each task's loop.
     - Task 5 ruling: "Start from" sources exclude archived groups and bases without typed lines (narrower than the brief); an archived group is off every new choice (spec 2.1) and an untyped base copies nothing. Costs if wrong: a user cannot start from an ended client's list.
     - Task 5 ruling: when a group has no base policy but still has title rules, show those rules (editable, removable) without "+ Add a title rule"; hiding live rules makes the "show no gaps" confirm untrue. Costs if wrong: a small deviation from the plan's "hidden without a base".
     - Task 5 ruling: the editor note uses straight quotes "Monitor 2" as the binding text says. Costs if wrong: wording only.
     - Task 8 ruling: the loan chip follows the spec, not the brief: amber ("warning") only when due within 3 days, red when overdue, neutral otherwise (the spec is the authority over the plan's "warning; danger when overdue"). Costs if wrong: far-off loans read calmer than the plan intended.
     - Task 8 ruling: add `id="status"` on the asset record page's status control so the panel's "Change status" link lands there (a small cross-task edit inside Task 8's fix). Costs if wrong: none.
     - Task 10 ruling: the plan's detailsMissing test with name "A" contradicted its own rule (names shorter than 2 count as missing) and spec 5.2; the implementer followed the rule, and the test expects ["name","title","departmentId"]. A plan defect; the spec wins. Costs if wrong: none.
     - Task 10 ruling: the Client picker is a native select (browser type-ahead by first letters) rather than a search combobox; 40 options with natural sort stay usable, and a combobox can follow. Costs if wrong: slower picking among many similarly named clients.
     - Ruling: changing a policy line's CATEGORY drops its slot id (a new slot; old waivers cascade with the old slot) while a type change within the same category keeps it; a waiver given for a Monitor must never silently waive a Headset. Costs if wrong: changing a category on a line resets that line's per-person waivers.
     - Ruling: Copy to others reuses the target's existing slot of the same type (in order) so identical lines keep their waivers; "replaces its items" should not wipe waivers that still apply. Costs if wrong: none.
     - Ruling: Add a slot keeps the labels "What" / "Which kind" (the plan's wording, house aria rule) rather than the spec's descriptive "Category" / "Type". Costs if wrong: label wording only.
     - Ruling: one Add-employee create may spend up to 21 write-rate tokens through assignAsset (final review M3), left as is; failures are reported per spare and the person is kept. Costs if wrong: a fast "Create and add another" run can see rate-limit failures on spares.
     - Ruling: offboarding/queries.ts keeps its slot order (name, id); switching would reorder the offboarding wizard's list, and it differs from the profile only for legacy same-type slots with different names (Phase 37 renamed all typed slots to labels). Costs if wrong: a rare gap-count mismatch in the offboarding view for legacy data.
   - **Plan decisions P-1...P-5:** P-1 clients reuse `Department` (spec ruling 1), the Departments page gets its own component and `RefTable` stays for categories and types;
     P-2 group filters on the Departments page run in the browser over all rows, while Equipment policies keeps the selected group in `?group=` and loads only that group's detail on the server;
     P-3 `previewPolicy` gains the lines and `PolicyPreview` stays only for the edit page (Title changes), the wizard having its own panel component; P-4 pickers share one helper,
     `groupPickerOptions`, rendered as `<optgroup>`s by `GroupSelectOptions`; P-5 `loadout-view.tsx` (1091 lines) is split in Task 8 (tiles to `equipment-tile.tsx`, the side panel to `held-item-panel.tsx`, the view keeps the dialogs).
   - **Deferred minors (follow-ups worth keeping):** the reference-actions department create / rename / delete stay reachable by a hand-made call; extras and loans are not numbered
     (duplicate "More for Monitor" names); the IT setup select keeps its optimistic value when a rate-limit refusal comes back; there are no action-level DB tests for the new actions;
     a fast "Create and add another" can hit the write-rate cap on spares; offboarding queries still order slots by name.

   **(ac) PHASE 36 (own tags and real types) - CODE-COMPLETE 2026-10-16 on branch `phase-36-own-tags-real-types`, MERGED (`033c061`), PUSHED and ON STAGING 2026-10-16
   (migration 29 applied; `pg_dump` snapshot first; Laptop types now Standard 12 / High-performance 0 / MacBook 1).** Spec `docs/superpowers/specs/2026-10-16-own-tags-and-real-types-design.md`, plan
   `docs/superpowers/plans/2026-10-16-phase-36-own-tags-and-real-types.md` (8 tasks, D-block D-1... at its end). Cut from
   `main` `5879cdb`. Adds **MIGRATION 29 `20261016090000_laptop_types` (data only, guarded, no audit rows)**.
   - **A. Typed tags.** Staff type every tag: one Tag box (before Serial) for one unit, Tag 1...n rows for a batch,
     paste a column into either. One shape everywhere (Register, receiving, import, the search jump): 1-20 letters,
     digits, `- _ .`, upper-cased, unique (`TAG_SHAPE`, refusal `TAG_RULE`). The cap is **20, not the spec's 30**: the
     label's barcode fits about 22 characters at the minimum module, so longer tags would print unscannable labels
     (Task 1 ruling). No suggested numbers, no prefix field, no `nextTags`/`prefixFor`; category `tagPrefix` stays in
     the data and Admin. An empty tag refuses with "Enter a tag for every unit".
   - **B. Type always asked.** The Type select (named "Type") shows whenever the category has two or more types, starts
     empty and is required ("Pick the type", server-side too: `typeRequired`). One type is set silently, none leaves the
     asset untyped. The model never sets the type (`KnownModel.typeId` and `resolveModelType` are gone).
   - **C. Laptop types (migration 29).** "Dell Latitude" becomes **Standard**, "ThinkPad" becomes **High-performance**,
     **MacBook** is added, and BR-LT-0201 moves to MacBook. The seed matches. Every step is guarded.
   - **D. People search.** `searchPeople({ q, scope })` (10 results, 250 ms debounce, Recent shows 5 before typing) feeds
     the holder pickers (Register, Assign, bulk drawer, stock issue); pages stop loading every employee
     (`activeEmployeeOptions` deleted). It spends the **live-check** rate budget, not the write budget (Task 5 ruling).
     The inventory **Assigned** filter is a `PeopleFacet`: search, removable chips, an **Unassigned** option
     (`assigneeId IS NULL`, value `none`), and "Search failed - try again" when a search fails.
   - **E. Schedule by category.** `/finance/depreciation` opens as one row per category with Cost and a Total (no asset
     rows); a category link drills into `?cat=` with the paged asset rows, `Subtotal - {category}` and "<- All categories".
     The export is unchanged and still has asset rows.
   - **Deploy.** Code-complete, unmerged and unpushed. Staging deploys by pulling the GitHub Actions image (the staging
     laptop never builds). **On that deploy staging's Laptop types are renamed (Dell Latitude to Standard, ThinkPad to
     High-performance), MacBook is added, and BR-LT-0201 moves to MacBook;** the Finance standard policy's laptop slot
     follows its type, so it reads Standard. Migration 29 applies on that redeploy; take a `pg_dump -Fc` first.
   - **Battery on the Phase 36 tip (2026-10-16):** `tsc` clean - `lint` clean - **29 migrations**, schema up to date -
     **1842 unit / 112 files** - **489 e2e / 46 files** by `--list` (478 + the new `e2e/own-tags-types.spec.ts`'s 11, case 11 added by the final-review fix wave).
     Chunks as in Phase 35 with B and D, E1, F run as two foreground halves, `own-tags-types` joining **B**:
     **A 58 - B 70 + 2 skipped + 27 - C 78 - D 43 + 27 - E1 29 + 32 - E2 56 - F 24 + 42 = 486 passed / 488**, zero failed
     in the final runs (before the final-review fix wave, which re-ran `own-tags-types` + `register-labels`: 28 passed, and
     `holds` + `finance-registration-depreciation`: 25 passed); `npm run db:seed` ran last, port 3100 free throughout.
   - **Final-review fix wave (2026-10-16):** `searchAssignees` allows `viewer` (and still `finance_staff`; class-checked);
     `searchPeople` is pickers only (`admin`, `it_staff`, `purchasing_staff`; `scope: "active"` only, no `assignees` scope, no `cls`);
     Register and add another focuses the Tag box; the one-unit tag error sits under Tag as "Enter a tag for every unit" /
     "{tag}: {TAG_RULE}"; the Assign dialog never preselects a hold's person who has left ("Held for {name}, who has left -
     pick someone else."); the label preview shows `YOUR-TAG` with an empty Tag box; the Schedule drill-down subtotal shows the
     category's Cost; stale comments fixed. The seed has at most 12 depreciating assets per category, so no drill-down page-2 e2e.
   - **Adapted pins (Task 8):** every spec that registered through the old suggested tag now types its own
     (`asset-classes`, `department-owned`, `direct-lifecycle`, `inventory-ux`, `it-core`, `it-gaps`, `purchasing-ext`,
     `receiving`, `registration`, `register-labels`); "New model - which type?" became "Type" and "ThinkPad" became
     "High-performance"; `quick-forms` case 2 expects the employee picker to list only Recent before typing;
     `finance-registration-depreciation` case 9 clicks the Laptop category before it looks for the subtotal; the import
     fixtures (`e2e/fixtures/make.ts`, the four regenerated .xlsx) use type "Standard".
   - **One product fix found by the new battery:** the Register label preview showed the tag as typed (lower case) while
     the stored tag is upper-case; `register-form.tsx` now previews `trim().toUpperCase()`.
   - **Deferred minors (from the build ledger):** Task 1: the import bad-tag explanation reads slightly doubled. Task 3:
     model-combobox re-inlines name normalisation; serial-section indentation and split import; `CLASS_EXAMPLE.prefixHint` is
     dead; a stale "(Task 3)" comment (the one-unit tag error and the schema.prisma comment were fixed in the final wave). Task 4: migration 29 looks up the Laptop category
     case-sensitively (`name = 'Laptop'`); no seeded High-performance asset. Task 5: no unit tests for PeopleCombobox,
     searchPeople or recentPeopleOptions (covered by e2e); a whitespace-only re-search; results flicker empty per keystroke. Task 6: a chosen id whose employee no longer exists shows the raw id;
     searchAssignees counts and the facetOptions shape are untested (e2e covers them). Task 7: the drill view runs
     scheduleSummary and scheduleCategory (two passes); no DB test that the subtotal equals the summary row. Task 8:
     register-labels case 16's cleanup is now a no-op (the category stays until the next seed); own-tags-types case 7 leaves its
     employee and two spare laptops; older adapted pins use waitForTimeout rather than a hydration helper.

   **(ab) PHASE 35 (registration review + Finance asset register + depreciation) — CODE-COMPLETE 2026-10-15 on branch
   `phase-35-registration-depreciation`, MERGED to `main` via `2963bc7` (`--no-ff`, merged tree = tested tip `297dc26`) and PUSHED 2026-10-15; staging REDEPLOYED 2026-10-15 at `2963bc7` (CI-built image pulled; MIGRATION 28 applied, 28 migrations; a `pg_dump -Fc` snapshot was taken just before; 32 assets, 31 not yet Finance-confirmed now read With Finance / To review; no depreciation policy set yet, so book value = cost); adds MIGRATION 28.** Spec
   `docs/superpowers/specs/2026-10-15-depreciation-design.md`, plan
   `docs/superpowers/plans/2026-10-15-phase-35-depreciation.md` (12 tasks, P-1…P-12, D-block at its end).
   - **A. Registration review.** A derived `RegState` (`src/lib/registration.ts`, never stored): Waiting for IT check /
     With Finance / Needs correction / Fully registered. IT and Purchasing see a **Registration** column, filter
     (`reg`) and notice on `/inventory`, plus a block on the record. Finance approves (`confirmAssetDetails`, with
     "Approve as not capitalised" when there is no cost) or sends back with a checklist (`REGISTRATION_FIELDS`) and a
     note (`returnAssetToIt`); the department fixes it on Edit (flagged fields ringed with `data-flagged`) and
     replies with **Mark corrected…** (`resubmitAssetToFinance`). A cost saved on a not-capitalised asset reopens the
     review (`finance.reopened`). Audit actions: `finance.confirm`, `finance.return`, `finance.resubmit`,
     `finance.reopened`.
   - **B. Finance's register.** `/finance/assets` lists every asset (two chip navs: "Finance state" and "Asset
     status"), search, whole-filter totals and Excel export; `/finance/assets/{id}` is Finance's asset page
     (Review box, money summary, purchase, capitalization, documents, year-by-year schedule, history, export).
     Finance's review controls left IT's record page (plan P-9).
   - **C. Depreciation.** Straight-line, computed on read in integer centavos and Asia/Manila months
     (`src/lib/depreciation.ts`); starts the month after approval; per-category policy (`/finance/depreciation?tab=policies`,
     audit `depreciation.policy`), per-asset override (`depreciation.override` / `.cleared`), the year Jan–Dec
     schedule with subtotals and projected months, and a Book value stat on Finance's Home.
   - **Deploy.** Code-complete, unmerged and unpushed. Staging deploys by pulling the GitHub Actions image (the
     staging laptop never builds). **On first deploy every unconfirmed asset lands in Finance's To review**
     (spec §3.1, by design). Migration 28 applies on that redeploy.
   - **Battery on the Phase 35 tip (2026-10-15):** `tsc` clean · `lint` clean · **28 migrations**, schema up to date ·
     **1844 unit / 110 files** · **478 e2e / 45 files** by `--list` (464 + the new file's 12). Seven chunks with the
     new spec joining **C**; D, E1 and F ran as two foreground halves: **A 58 · B 87 + 2 skipped · C 76 · D 70 ·
     E1 61 · E2 56 · F 66 = 474 passed / 476**, zero failed, no re-run. `npm run db:seed` ran last; port 3100 free throughout.
   - **Adapted pins (Task 12):** `asset-classes` case 16, `department-owned` 13b/13d, `receiving` (Finance confirm,
     send back, mark corrected) and `home-finance` (the register) moved to `/finance/assets/{id}` and the new
     names; an approval now lands on `/finance/assets/{next}`.
   - **Two a11y fixes found by the new spec's axe pass, both in Task 11's `schedule-table.tsx`:** the scroll
     container is now a focusable `role="region"` (axe `scrollable-region-focusable`), and the projected month
     headers no longer use `opacity-60` (colour contrast 2.31). No other product code changed in Task 12.

   **(aa) PHASE 34 (Register and Labels redesign) — CODE-COMPLETE 2026-10-15 on branch
   `phase-34-register-labels` (final code tree `f7c4f70`, plus this docs commit), MERGED to `main` via `ffbc0e8` (`--no-ff`, merged tree = tested tip `cf39923`) and PUSHED 2026-10-15; staging REDEPLOYED 2026-10-15 at `07b1f32` (migration 27 applied; image built by GitHub Actions);
   MIGRATION 27 `20261014090000_register_labels`.** Spec
   `docs/superpowers/specs/2026-10-14-register-and-labels-redesign-design.md` (`908fe14`), plan
   `docs/superpowers/plans/2026-10-14-phase-34-register-labels-redesign.md` (`2904714`) — 12 tasks,
   P-1…P-9, the D-block D-1…D-27. The branch was cut from `2904714`; the spec and plan commits sit on
   local `main`, unpushed beyond `origin/main` `fc9e051`.

   **What shipped.**
   1. **"New equipment", two tabs**: **Register** and **Labels** (with a count of labels waiting), one
      page header for both; the nav link keeps the name "Register assets".
   2. **Register**: category cards in the spec's order (IT: Laptop, Workstation (PC), Monitor, Headset,
      Mouse, Type C Hub, Docking Station, Laptop Bag, Other; Purchasing's four in name order; no
      Uncategorised); a model box that matches a known model whatever its case or spacing and sets its
      type — a new model, or a known one with no type, asks "which type?" and the server refuses a
      typeless model when the category has types; "Where does it go" as a segmented control; the IT
      serial required (Purchasing optional) and a scanner's Enter never submits; a batch filled by paste
      with in-batch duplicates flagged; **Purchase and warranty** — invoice, official receipt and delivery
      refs, unit cost and fees with a live total (never stored), warranty length 0/6/12/24/36 setting
      "Warranty until" (a hand-typed date survives a purchase-date change), covered by, contact — and
      three new document kinds (official receipt, warranty slip, delivery receipt); a "Tag prefix and
      notes" fold-out (Brand moved in); a live label preview at actual size. Every registration creates
      a `PurchaseRecord` (audit `purchase.recorded`) and lands on **Labels** with the batch ticked
      (`?just=`); `register-success.tsx` is gone.
   3. **Labels**: a **Waiting to print** queue grouped by registration (`?pick=`), the sheet preview *is*
      the printable sheet at half scale, click a sticker to start there, **Reprint other tags** (the Tags
      box), Print stamps `labelPrintedAt` once (a reprint never moves it; printing a list selection via
      `?ids=` stamps too). Scope: the classes the role manages plus the batches the user registered (R20).
   4. **The label redesigned**; the A4 3 × 4 geometry, the Barcode / QR fit rules and the 100 mm
      calibration bar are unchanged.
   5. **Migration 27**: `AssetCategory.tagPrefix`; `Asset.labelPrintedAt`, `purchaseRecordId`,
      `receiptRef`, `warrantyCoveredBy`, `warrantyContact`; the `PurchaseRecord` table; every existing
      asset backfilled as printed (nothing old floods the queue); the IT category reshape, name-keyed and
      idempotent — Dock → Docking Station, the new categories and types, Peripheral's Mouse → Mouse/Wired,
      Phone → Other/Phone, each other Peripheral type → Other under its own name (R24) — that RAISEs
      rather than guesses when a target or source name is held by a Purchasing category. The importer
      stamps `labelPrintedAt` too (R25). Register offers `tagPrefix ?? learned prefix ?? ""` (R23).

   **Rulings (ledger R1–R27 = plan D-1…D-27).** The ones that changed behaviour: R7 add-another keeps
   category, model and type; R8 Purchasing "In use" keeps the required Who; R9 an untyped known model asks
   for a type; R12 a warranty-length click is an explicit choice; R14 the labels measurement cases measure
   print media; R16 Print marks the queue when `window.print()` returns; R19 one unit's tag is a chip
   changed via Tag prefix; R20 (superseding R18) the Labels scope; R23 the prefix order; R24 / R25 / R26 the
   final review's fix wave. R27: `--list` was expected at 462, but it reads **464 tests in 44 files** —
   R27 counted `register-labels.spec.ts`'s 17 cases on Phase 33's 445 and missed Task 11's two new cases
   in existing files (`department-owned.spec.ts` 8b, `labels.spec.ts` "13 typed tags print as two A4
   pages").

   **Review.** Every task passed its review (fix rounds in T1, T5, T6, T7, T9). Final whole-branch review
   (`2904714..fbe7ac1`): With fixes — 0 Critical, 4 Important (I1 a learned prefix beat `tagPrefix`; I2
   the migration folded every non-mouse Peripheral type into Other/Keyboard; I3 a prefix-less category
   could not register one unit; I4 CSV imports flooded Waiting to print), M1–M9. One fix wave
   `fbe7ac1..f7c4f70` (`a1ac0bf`, `ca3af7b`, `5999f99`, `f7c4f70`) took all four Importants and M1, M2, M5,
   M8, M9; the scoped re-review found all nine addressed and no new breakage.

   **Proof.** `tsc` clean · `lint` clean · **27 migrations**, schema up to date · **1786 unit / 106
   files** · **464 e2e / 44 files** by `--list`. The new `e2e/register-labels.spec.ts` (17 cases) joins
   **B**. Battery on the final tree `f7c4f70` (2026-10-15), D, E1 and F each as two foreground halves:
   **A 58 · B 87 + 2 skipped · C 64 · D 70 · E1 61 · E2 56 · F 66 = 462 passed / 464**, zero failed, zero
   flaky, zero re-runs; the 2 skipped are `quick-login.spec.ts`'s two on-only cases (they run only with
   `QUICK_LOGIN_EMAILS` set). `npm run db:seed` ran last; port 3100 free before, between and after every run.

   **Ships knowingly.** M3 (a cancelled print dialog still stamps the batch — R16), M4, M6, M7, and the
   ledger's deferred Minors (e.g. a cross-class tag collision on Register reads "One of those tags was
   just taken"; the queue's 2000-row cap; a failed `markLabelsPrinted` is silent).

   **What remains — the user's decisions, not pre-authorised:** merging to `main`, pushing (it also
   carries the two unpushed spec and plan commits on `main`), and the staging redeploy, which **applies
   migration 27** (`scripts/deploy-staging.ps1` runs `prisma migrate deploy` before `web` and `worker`
   start; it reshapes the IT categories on staging's real data and RAISEs on a Purchasing-class name
   clash). After the redeploy, the physical print-and-scan check of the new label on a real A4 sheet (print a sheet from the Labels tab on the office printer, measure the 100 mm calibration bar, scan a barcode and a QR with the office scanner and a phone) is owed — a user action on staging after the redeploy.

   **(z) PHASE 33 (Laws of UX on the IT queues and records) — MERGED TO `main` via `9bc7785` (`--no-ff`, merged tree = tested tree + docs) and PUSHED 2026-10-01
   (branch `phase-33-queues-records-uiux`, final tree `fd2ee57`); no migration.** Spec
   `docs/superpowers/specs/2026-09-24-queues-records-ux-design.md` (`4a39db8`), plan
   `docs/superpowers/plans/2026-09-25-phase-33-queues-records-ux.md` (`ca86afd`) — 10 tasks, P-1…P-18,
   the D-block D-1…D-14. The second half of the 2026-09-24 IT-screens audit (Phase 32 took the first).

   **What shipped.**
   1. **Approvals detail** (`/approvals/[id]`): the header comes from `approvalHeader` — one primary by
      state (**Approve** in one step on a PENDING request via the new `approveNow`, Approve on your own
      claim, Retry on a failed execution), a visible **Reject…**, Claim / Release / Escalate in ⋯ More;
      no admin override on someone else's claim (plan P-2: the code never had one). After a decision,
      **Next in queue →** (`nextInQueue`, skipping others' claims) or **Queue clear**. "Before → after"
      first; failures read `The change could not be applied.` with a cause sentence keyed on the
      worker's real phrases (`src/lib/approval-failure.ts`) and the raw error in a `Worker error`
      disclosure; a return filed from an offboarding links back to the wizard. A conflict (someone else
      moved the request first) survives the refresh in the house copy.
   2. **Approvals queue**: search (ref no, tag, person) and a **Type** facet as plain `q` / `type`
      parameters beside `tab` / `via` / `page` (`approvalsHref` keeps today's URLs byte-identical without
      them), value-only chips, a row menu `Actions for {refNo}` with the same verbs, the shared `Tabs`,
      friendly priority words, the pager line only when there are pages; the keyboard contract unchanged.
   3. **Labels**: a **Tags** box (`?tags=`, pasted or scanned; resolved within the classes the role
      manages), **Start at label N** (`?start=`, `labelSlots`), named skipped tags, the tags on the sheet,
      a class-aware crumb carried on every link into the page, a plain No-QR banner.
   4. **Reservations**: one hint line, columns that fit each tab, `{n} holds · {k} expire within 2 days`,
      the house toolbar.
   5. **`/audit`**: search resolves tags, people and ref nos (`resolveEntitySearch`, class-scoped, never
      surfacing a hidden row), rows read as sentences with the action slug beside them, a **When** pill
      group (Today / Last 7 days / Last 30 days), value-only chips; the export honours search and When.
   6. **The four activity feeds** gain the same search (the old "no search on the feeds" rule reversed);
      the feeds and the offboarding queue take the busy transition and value-only chips.
   7. **Shared pieces**: `SearchBox` and the list-navigation hook live in `src/components/patterns/`.

   **Rulings (ledger R1–R9, plan D-block).** R1 — Task 10 split (e2e first, battery and docs after the
   fix wave). R2 — `buildAuditWhere`'s date defaults to today. R3 — the failure-cause regexes the plan
   prescribed matched no real worker error; they key on the real phrases now. R4 / R5 — e2e pins that
   read field names off `/audit` rows (the Fields column is gone by design) assert the sentence's
   wording or the stored diff instead. R6 / R7 — chunks D, E1 and F ran as two foreground halves each
   (the machine ran ~1.5× slower; compositions unchanged). R8 — a pre-existing date-dependent pin
   (`purchasing-ext.spec.ts:351`, a three-letter month; en-GB writes "Sept") fixed test-only. R9 — chunk
   A re-run as-is after a slow-pass purchases heading timeout.

   **Review.** Every task passed its review (fix rounds in T4 and T9). Final whole-branch review (most
   capable model): With fixes — 0 Critical, 2 Important (the labels crumb lost the class from real links;
   a second approver's Approve conflict vanished on refresh), 7 Minor; one fix wave `d1a1af8` took both
   Importants, the approve-now rollback hardening, a `test.slow()` for a two-action approvals case and a
   fixture moved inside its `try`; the scoped re-review found all addressed.

   **Proof.** `tsc` clean · `lint` clean · **26 migrations**, schema up to date · **1727 unit / 99 files**
   · **442 e2e / 42 files** by `--list`. The new `e2e/queues-records-ux.spec.ts` (14 cases) joins **D**.
   Battery on the final tree: **A 58 · B 67 · C 64 · D 70 · E1 61 · E2 56 · F 66 = 442 / 442**;
   `npm run db:seed` ran last; port 3100 free before, between and after every run.

   **Ships knowingly (final review Minors M-1…M-5, M-7 and the triaged deferred Minors; M-6 was fixed).**
   M-1 the labels page prints only the `{tags} — not found or not your class` form of the pinned copy;
   M-2 approvals and reservations add a `Search: {q}` chip where `/audit` and the feeds add none; M-3 on
   a PENDING row the menu's Approve is one step while the `A` key still asks to claim first (spec §2
   froze the keys); M-4 the queue's row menu shows the raw conflict banner without refreshing, unlike
   the header; M-5 the expiring-soon count loads the Active rows to count them; M-7 the primary spins
   while Reject submits. Also: the feeds' search does not resolve purchase-request ref nos (outside
   spec §6.1); the entity search caps at 100 matches per kind; actions without a sentence read
   "{actor} {slug}"; two Clear filters controls on a filtered empty list; chip removal sits outside the
   busy transition.

   **Merged and pushed 2026-10-01.** `9bc7785` (`--no-ff`; its tree matched the branch tip `0512c7b`, which
   is `fd2ee57` plus docs); the push also carried the plan commit `ca86afd`; branch and worktree removed.
   Staging still runs `4a39db8` — the code-only redeploy (no migration) is the user's decision.

   **(y) PHASE 32 (Laws of UX on the IT screens where the work gets done) — MERGED TO `main` via
   `--no-ff` `853d13d` AND PUSHED (2026-09-24); final tree `e29e879`, docs `c5afaf0`; tree hashes matched; branch
   and worktree removed; no migration; staging REDEPLOYED 2026-09-24 (code-only, runs `2e333ef`).** Spec
   `docs/superpowers/specs/2026-09-24-it-work-ux-design.md` (`7b878ed`), plan
   `docs/superpowers/plans/2026-09-24-phase-32-it-work-ux.md` (`4b77f59`) — 14 tasks, P-1…P-16, the
   D-block D-1…D-10. It grew from a read-only audit of the IT screens Phases 29–30 had not covered
   (73 findings); the user split it in two — this phase is "doing the work", Phase 33 "queues and
   records" (its scope is parked in `HANDOVER-PENDING.md` §5.3).

   **What shipped.**
   1. **Pure rules** (`src/lib/offboarding.ts`): `offboardingNext` (Resolve {refNo} → Set a date →
      Collect N items → Close account → Complete), `readiness` / `completionBlockers` (mirroring
      `completeOffboarding`'s three gates), `offboardingAttention` + `orderByOffboardingAttention`,
      `defaultStep`, `decisionStateLabel`; `EMPLOYMENT_LABEL`; the worklist's `WorkControl`,
      `workActionLabel`, hidden rows in `groupWork`, `capLine`, `SEE_ALL_HREF`, `summaryChips`,
      `pastSlaCount` (counted before Home's row cap), `workHeadline`, `loanSoonEdge`, `workRowHref`;
      `withoutDismissal`.
   2. **Offboarding queue** opens worst first (Attention default, demoted by a header click), one
      state-labelled action per row, a Progress cell, a marker line, `{n} people leaving · {k}
      overdue`, Export in ⋯ More.
   3. **Wizard** opens where the work is (`defaultStep`), its header carries the next step as a link
      (hidden on its own step) and a More menu, every step is reachable, the last step reads Finish
      (id stays `report`). **Collect**: one hint line, progress, undecided first, focus moves on, the
      reason error in one pass, and **Mark the rest as Returned…** (`decideRemaining`, one rate event,
      one transaction and audit row per item, per-item refusals; `decideItem`'s body extracted into a
      shared `decideOne`). **Accounts**: `Never had an account` behind a confirmation
      (`closeAccounts` `confirmClear`). **Finish**: the readiness checklist before Complete, and a
      success card with `Next leaver →` after completing (`?done=1`).
   4. **Farewell report**: Back control, no roadmap copy or placeholder, `DRAFT — {n} items
      undecided` + `Still to decide` (print and sheet).
   5. **Worklist**: Triage… / Mark checked / Set loan date… open the record's own dialogs in place;
      honest labels (approvals read Open; viewers read Open everywhere and a viewer's leaver link
      goes to `/offboarding/{id}`); a row menu with **Hide until tomorrow** and a real **Undo**
      (the toast gained an optional action); `· {k} hidden today` with Show / Unhide; section
      chips; cap lines leading to the list that holds the rest.
   6. **Home and nav**: a Worklist count badge (admin + IT, every worklist row minus today's hidden,
      indexed counts in the layout), a headline and Open worklist on IT's Worklist card, the
      viewer's read-only worklist, Claimed by you only for approvers, no Jump to.
   7. **Scan card**: the record state's main action (Triage… / Mark checked / Return… / Assign…,
      full width, ≥44 px), the leaver line to the Collect step, one attention line with the hold and
      due pills, friendly words, a retype box and search for a misread tag; still no cost or vendor.
   8. **Reservations**: each hold row's menu hands the spare over (`Assign to {name}…`) and holds
      Release…, whose dialog names the device and the person.

   **Rulings (ledger R1–R10, plan D-block).** R1 — e2e pins broken by T1/T2's pure changes adapted
   in T3. R2 — the Mark-the-rest dialog resets only on open. R3 — `decideRemaining` does not re-read
   the wizard to refuse an EXECUTION_FAILED item (same as `decideItem`). R4 — two stale queue pins
   adapted in T5. R5 — clearing a stored `inactive` needs no confirmation (not live). R6 — plan P-7
   corrected: the "reads DEPLOYED with no holder" row keeps its Fix record link (`assignAsset`
   refuses non-SPARE). R7 — the badge's loan edge is `loanSoonEdge` (Manila midnight, today + 8).
   R8 — Purchasing sees the scan action on its own class's records. R9 — Task 14 split: e2e first,
   battery and docs after the fix wave. R10 — battery chunk B re-run as-is after asset-classes case
   21's known flake.

   **Review.** Every task passed its review (fix rounds in T6, T9, T11). Final whole-branch review
   (most capable model): With fixes — 0 Critical, 1 Important (a viewer's leaver link), 10 Minor;
   one fix wave `e29e879` took the Important, three deferred Minors (an underlined blocked-item link,
   "never had an account" on the wizard, a native Export sheet) and three cheap new ones ("Continue to
   Finish", the scan leaver link only where `/offboarding` opens, report-page e2e pins on the printed
   h1); the scoped re-review found all seven addressed.

   **Proof.** `tsc` clean · `lint` clean · **26 migrations**, schema up to date · **1664 unit / 96
   files** · **428 e2e / 41 files** by `--list`. The new `e2e/it-work-ux.spec.ts` (15 cases) joins
   **E1**. Battery on the final tree, the seven foreground chunks, `E2E_PORT=3100 --workers=1
   --global-timeout=540000`: **A 58 · B 67 · C 64 · D 56 · E1 61 · E2 56 · F 66 = 428 / 428** (B's
   first pass 66 + 1 failed on the known asset-classes case-21 timeout; the as-is re-run passed);
   `npm run db:seed` ran last; port 3100 free before, between and after every chunk.

   **Ships knowingly.** "no sync yet" still printed on the employee profile and the farewell report
   (display wording, Phase 33); the scan leaver line is hidden, not plain text, for Finance and
   Purchasing; the worklist's leavers read every leaver in full on each IT Home / Worklist render
   (capped after); the remaining deferred Minors triaged as shippable in the final review
   (focus-to-body after a hide or the last confirm, `data-changed` not visible, same-named Show
   buttons, the cap line's string split, singular "File 1 decisions").

   **Merged and pushed (2026-09-24).** `--no-ff` into `main` as `853d13d`, the merged tree byte-identical to
   the tested tip `c5afaf0` (tree hashes matched — the root checkout has no `node_modules`); only `main`
   was pushed, carrying the docs-only commits `7b878ed` and `4b77f59`; branch and worktree removed.
   **Staging REDEPLOYED 2026-09-24** (code-only `-Force`, runs `2e333ef`, 26 migrations, none pending;
   web healthy; `/login` 200 locally and on the LAN).

   **(x) PHASE 31 (leftovers sweep) — MERGED TO `main` via `--no-ff` `bcc7b16` AND PUSHED (2026-09-24);
   final tree `7599d9e`, docs `3d477c0`; tree hashes matched; branch and worktree removed; no migration;
   staging REDEPLOYED 2026-09-24 (code-only, runs `7a479e1`).** A bounded change with no spec and no plan document
   (the Phase 28 shape), approved in chat on 2026-09-24: it closes the items Phase 30 shipped knowingly.

   **What changed.**
   1. **A derived sort orders only as the primary key.** `primarySortOf(sort, key)` in
      `src/lib/url-state.ts`; the People list's Loadout sort now yields to a clicked column (the twin of
      Phase 30's I-2), and the inventory list's Attention check uses the same helper.
   2. **Typed `revalidatePath` patterns on real file paths.** Ten calls in five files
      (`employees/actions.ts`, the asset / employee / supplier importers, `stock/revalidate.ts`) named
      URL-shaped patterns such as `"/inventory/[id]"`; Next.js matches a typed pattern against the
      route's FILE path, route groups included, so every one was inert (harmless only because these
      pages render dynamically). Now `/(app)/…`, with `"layout"` where a record has tabs (inventory
      record, employee profile, offboarding wizard) and `"page"` for supplier and stock-item pages. The
      final reviewer confirmed all six resulting calls against the installed Next 15.5.23 code. Guard:
      `src/lib/revalidate-paths.test.ts` fails on any typed pattern (any quote style) that names no
      folder under `src/app`, or a `"page"` pattern whose folder has no `page.tsx`.
   3. **The pager's disabled arrows are not links.** `src/components/ui/pagination.tsx` rendered them as
      `<a>` with `pointer-events-none` — the mouse was stopped, the keyboard was not (Tab + Enter on page
      1's ‹ opened `page=0`, › on the last page went past the end). A disabled arrow is now a
      non-focusable `<span role="link" aria-disabled="true">`; the arrows are named "Previous page" /
      "Next page"; the header comment's mojibake is fixed. Applies to all 14 paged lists.
   4. **Both exports follow the derived sorts.** The inventory export orders by the Attention sort
      through `attentionOrdered` (the helper the list pages from); the People export follows the Loadout
      sort through `derivedCut` / `derivedIds` (shared with the list), and still refuses over
      `EXPORT_CAP` before loading full rows.

   **Rulings.** R1 — bounded path, no spec or plan (user-approved design). R2 — the People export's
   Loadout order was added to the scope (the user said yes to "item 5"). R3 — the arrows' accessible
   names ("Previous page" / "Next page") ride along with the non-link fix; no spec pinned the arrow
   glyph as a name. R4 — `"layout"` rather than one `"page"` call per tab: one call covers every tab and
   the edit page. R5 — final-review M-4 ships: an Attention-sorted inventory export reads the view
   twice (correct, and bounded by `EXPORT_CAP`; folding it into one read would need the approvals join
   inside the export's own query). R6 — a mis-staged commit (`2d9e582`, which carried only the guard
   test) was completed by a NEW commit `451a549`, never an amend. R7 — battery chunk C's first pass
   failed on `net::ERR_NETWORK_IO_SUSPENDED` (the laptop's network suspended mid-run, which then ran the
   chunk into the global timeout: 49 passed / 1 failed / 14 did not run); the as-is re-run was 64 passed
   (4.3m), so no code was touched.

   **Review.** Final whole-branch review (most capable model): APPROVE WITH FIXES, 0 Critical, 0
   Important, 5 Minor; one fix wave `7599d9e` took M-1 (a stale "seven revalidations" comment), M-2 / M-3
   (the e2e non-vacuity checks now compare the asserted window) and M-5 (the guard reads any quote
   style); the scoped re-review found all four resolved.

   **Proof.** `tsc` clean · `lint` clean · **26 migrations**, schema up to date · **1634 unit / 96
   files** · **413 e2e / 40 files** by `--list`. The new `e2e/leftovers.spec.ts` (4 cases) joins **D**;
   cases 1–3 first assert that the derived order differs from the plain one on the seed, so none passes
   vacuously. Battery on the final tree, the seven foreground chunks, `E2E_PORT=3100 --workers=1
   --global-timeout=540000`: **A 58 · B 67 · C 64 (re-run, R7) · D 56 · E1 46 · E2 56 · F 66 = 413 /
   413**; `npm run db:seed` ran last, clean; port 3100 carried no listening process before the first
   chunk, between any two chunks, or after the last.

   **Still shipping knowingly.** The Attention sort itself stays an in-memory pass (revisit past a few
   thousand assets); R8's "Asset not found" copy for wrong-class record URLs; the inventory page links'
   lost `next/link` prefetch; the later refactors listed in (w).

   **Merged and pushed (2026-09-24).** `--no-ff` into `main` as `bcc7b16`, the merged tree byte-identical to
   the tested tip `3d477c0` (tree hashes matched — the root checkout has no `node_modules`); only `main`
   was pushed; branch and worktree removed. **Staging REDEPLOYED 2026-09-24** (code-only `-Force`,
   runs `7a479e1`, 26 migrations, none pending; web healthy; `/login` 200 locally and on the LAN).

   **(w) PHASE 30 (Laws of UX applied to the inventory area) — MERGED TO `main` via `--no-ff`
   `69f8545` AND PUSHED (2026-09-24); final tree `4e6fc7f`, docs `bba0f6c`; tree hashes matched; branch and
   worktree removed; no migration; staging REDEPLOYED 2026-09-24 (code-only, then `e07bef7`).**

   **What it is.** A read-only audit of the three inventory screens (at `c563600`) found 57 breaches of
   the Laws of UX — 19 on `/inventory`, 19 on the create flows, 19 on `/inventory/[id]`. This phase
   takes 55 of them (two in part) and parks two with a home; the house standard is Phase 29's employee
   area (Jakob's law within the app). Spec `docs/superpowers/specs/2026-09-23-inventory-ux-design.md`
   (`a94f47a`, decisions 1–10), plan `docs/superpowers/plans/2026-09-23-phase-30-inventory-ux.md`
   (`b582535`, 9 tasks — pure rules, server, record header, record body and the Edit route, one
   Register flow, list header, list rows, e2e, battery and docs — plan-level decisions `P-1`…`P-16`,
   `D-1`…`D-16`). Both docs commits sit on local `main`, unpushed; the branch was fast-forwarded onto
   them (R1), so they are in its history.

   **The ten decisions.** (1) The record's header has one state-chosen primary — **Return** on a held
   device — with Replace, Change status, Reserve, Set loan date and Print label in a ⋯ More menu, and
   **Edit kept as a visible button**. (2) One create flow: `/inventory/register`, named “Register
   assets” everywhere, with `/inventory/new` redirecting to it; at quantity 1 it also offers the
   initial state, the assignee, a loan date and documents with kinds. (3) List rows gain a ⋯ row menu
   reusing the record's dialogs. (4) An exact tag typed or scanned into the list search still jumps to
   the record. (5) Unfinished business shows on the list: an attention line in each row's Status cell
   and an **Attention** sort key computed in memory like Phase 29's Loadout key. (6) `/inventory` opens
   on the first class the role manages. (7) All three screens in one phase. (8) Screen verification
   runs through Playwright and unit tests; agents never sign in through the Browser pane. (9) The new
   e2e file joins chunk E2. (10) No migration.

   **The record (`/inventory/[id]`, spec §4).** `recordActions(state, role)` in
   `src/lib/record-actions.ts` is the one rule for `{ primary, more, edit }` (P-4): Triage → Mark
   checked → Mark corrected → Confirm details → Return → Assign → none, with a pending approval
   suppressing only the lifecycle actions (Finance's and IT's review actions are not lifecycle
   changes). `RecordActions` renders the primary, Edit and the More menu; the seven controls
   (`HolderControl`, `ReplaceControl`, `StatusControl`, `TriageControl`, `LoanDueControl`, `ItCheck`,
   `FinanceReview`) became controlled dialogs (P-3) whose titles name device and person and confirm
   with a verb, while the approval-path dialogs keep today's titles and add “This files a request for
   approval.” (P-5). Change status offers only `statusTargets`, in the friendly words of `STATUS_LABEL`
   (P-6); Replace hides spares queued or held for someone else and says how many; one pill asks
   something of the viewer; the breadcrumb is class-aware; after Confirm details Finance gets “Next to
   review →” or “Queue clear”. The body: Edit left the record layout through the `(record)` route group
   (P-15) with its own breadcrumb, a sticky bar and a toast, and Save / Cancel leave it the way Back
   does (R9); the Overview stops repeating the header and gains the loan date, a Record row and a Last
   change line (`auditPhrase`); documents choose a kind before Upload through the new shared
   `FileDrop`; one Reveal spins at a time and a revealed secret can be copied; Reservations shows only
   on IT records. Commits `cfb6903`, `ee324a2` + `aef4ba3`.

   **Register (`/inventory/register`, spec §5).** One flow for one asset or 200. The fields come in the
   order they depend on (Category focused); at quantity 1 the one-row table stays (P-12) with Initial
   state (Spare · Deployed · Loan), Assign to, Loan until and documents with kinds below it. Enter
   moves between rows, a pasted serial column fills the rows and grows Quantity (`parseSerialPaste`),
   Cost is typed the way receipts print it (`normaliseCost`), live checks name and link the existing
   record on the `check` rate kind, and every error arrives at once with focus on the first. Quantity 1
   submits through `createAsset`, more through `registerAssets` (P-13), both refusing in one pass; a
   sticky bar carries Cancel, Register {n} asset(s) and Register and add another; one asset ends on its
   record with Print label and Register another, a batch on a card that lists every tag. Commits
   `c069969` + `7785d6a`.

   **The list (`/inventory`, spec §6).** One **Register assets** primary with Import… and Export in
   More; the list opens on the role's own class (`defaultClassFor`, `withViewClsQS`, P-7); pill view
   switches; holder search with a Clear ×; a single Purchased facet (P-8); value-only chips; a “· {k}
   need(s) attention” count that links to the Attention sort (P-10); no “page 1 of 1”; list navigations
   — pagination too, after the fix wave — mark the table busy. Rows: the status dot beside the word
   with the row's attention reason under it, tag and holder as links, the whole checkbox and header
   cells as targets, and a ⋯ `Actions for {tag}` menu (Assign…, Return…, Change status…, Print label,
   Open record) rendered only when it has an action beyond Open record (P-11). The selection bar acts
   directly — Print labels · Export · Change status… · Assign… — and the drawer, still named “Bulk
   actions” (P-14), names what it will touch. Commits `12aa880` + `a9752bf`, `a208f9b`.

   **The shared Menu (`src/components/ui/menu.tsx`).** Its popup now renders in a portal — on
   `document.body`, or inside the open Dialog or Drawer so it is neither inert nor hidden behind the
   modal — fixed-positioned from the trigger, flipping against the viewport only and repositioning on
   scroll and resize; a keyboard open focuses the first item, Tab from an open trigger reaches the
   menu, Shift+Tab closes it, and `aria-controls` ties the popup to its trigger. Every Menu caller —
   the employee tiles, the profile and list More menus, the admin editors, the account menu and the
   workspace switcher — inherits it; the full battery below is their proof. Commits `56f5bbd`,
   `87a6fdb`, `2cef231`; the e2e file `e2e/inventory-ux.spec.ts` is `f999f74`.

   **The sixteen rulings.** **R1** the worktree branch was fast-forwarded to local `main` `b582535` so
   the spec and plan are in its history, as in Phases 20–29; cost if wrong: none. **R2** the three
   list-header pins (`asset-classes.spec.ts:435`, `it-core.spec.ts:152`, `registration.spec.ts:215`)
   were adapted in Task 6, not Task 5 — during Task 5 the old New asset link still worked through the
   redirect; cost: three test lines move between tasks. **R3** at quantity 1 the merged form maps
   `createAsset`'s `tag` / `serial` error keys onto row 1's cells (`Row 1 · …`), so both paths render
   errors in the same place; cost: one mapping function. **R4** an approval-path registrant (e.g.
   purchasing_staff registering IT) cannot pick Loan at quantity 1 — the approval executor never
   applies `loanDueAt`, so Loan there would create a dateless loan; Loan is offered only when
   `isDirectLifecycle(role, cls)`; cost: such a device is registered Deployed and IT converts it.
   **R5** `it-gaps.spec.ts` case 4, broken by Task 2's Replace exclusion, was adapted in Task 3, which
   wires `hidden` into the dialog; cost: one e2e case moves between tasks. **R6** Change status on the
   approval path also offers only `statusTargets`, because the executor's guard refuses the same
   targets at execution; cost: one line in `status-control.tsx` restores the full list. **R7** a
   transitional copy of the old create form kept `/inventory/new` alive between Tasks 4 and 5 and was
   deleted with the redirect; cost: one duplicated component for one task. **R8** after the route-group
   move, `[id]/not-found.tsx` catches wrong-class record and edit URLs, so they read “Asset not found”
   instead of the app-level “This page doesn't exist” — accepted, since the asset is absent from that
   role's view and the copy reveals nothing more; cost: one not-found message. **R9** Save and Cancel
   leave the edit page the way `BackLink` does (`leaveFor` in `src/lib/nav-stack.ts`: pop the record
   entry and `router.back()`, else `router.replace`), so history no longer reads list → record → edit →
   record and the record's Back returns to the list; cost: two call sites. **R10** a single
   registration audits `create`, so `lastLifecycleChange` also matches `create` and the record reads
   “Last change: created · {date} · {actor}”; cost: one OR term. **R11** staged documents carry across
   the quantity switch (`carryDocuments` in `src/lib/register-documents.ts`): 1 → N makes the first
   file the batch invoice and keeps the rest listed with a warning, N → 1 returns the invoice as kind
   Invoice; cost: one helper. **R12** the list's Register assets link carries the viewed class
   explicitly (`/inventory/register?cls={cls}`), because the Register page narrows categories only when
   `?cls=` is present; cost: one href. **R13** a row menu near the bottom of the scrolling table was
   clipped (measured: menu 682.9–804.9 against a wrapper bottom of 683.9), so Menu first flipped upward
   against its scroll container — superseded by R14. **R14** Task 8's two-row list case (`?q=WD19S`)
   showed a menu can fit neither side of a short table, so Menu renders its popup in a portal,
   fixed-positioned and flipping against the viewport only; Task 7 reopened for rounds 2 and 3; cost:
   one primitive's positioning. **R15** the fix wave applies the final review's four Importants and its
   fix-before-merge Minors, plus a hand-crafted-only refusal of `TEMPORARY` in `createAsset` off the
   direct path (the approval-path dateless loan R4 hid only client-side); everything else in the triage
   ships and is recorded below; cost: small, local edits. **R16** the re-review's three nits ship — the
   double-encoded dash in a `src/components/ui/pagination.tsx` comment, the inventory list's page links
   losing `next/link` prefetch (I-4's trade-off), and the sr-only “ · ” some screen readers voice as
   “middle dot”; cost: nothing at runtime.

   **Verification (decision 8).** No agent signed in through the Browser pane. Every screen task proved
   itself by running the Playwright files it adapted, foreground, one agent at a time on port 3100
   (`E2E_PORT=3100 --workers=1 --global-timeout=540000`), with the port free before and after and `npm
   run db:seed` last. Task 8's `e2e/inventory-ux.spec.ts` (13 cases) is the phase's own proof: the
   record header per state, legal status targets, a row-menu Return (on the two-row list — the R14
   regression test), attention, holder search, Register at quantity 1 as a loan, a pasted batch,
   one-pass errors, Purchasing's own class and a viewer's record.

   **Reviews and fix rounds.** Every task was reviewed; Tasks 1, 3 and 8 were approved first time.
   **Task 2** took one round: a refused category still ran the serial pre-check, so a hand-crafted call
   could name another class's tag — the Phase 20 leak reopened (`a54f843`). **Task 4** took one: Save
   and Cancel pushed the record, so its Back returned into the edit form, breaking Phase 28's promise
   (R9, `aef4ba3`). **Task 5** took one: documents staged at quantity 1 were silently lost when
   Quantity crossed 1 (R11), and single registrations showed no Last change line (R10) (`7785d6a`).
   **Task 6** took one: the Register link lost the viewed class, so Purchasing staff saw both classes'
   categories (R12, `a9752bf`). **Task 7** took three: round 1 flipped a clipped bottom-row menu upward
   (R13, `56f5bbd`); Task 8's short-list case then reopened it (R14) — round 2 portalled the popup
   (`87a6fdb`), its re-review found that Tab skipped the portalled menu and nothing tied popup to
   trigger, and round 3 fixed both (`2cef231`), also catching a document Tab handler that ignored
   `event.target`.

   **The final review and the fix wave.** The whole-branch review (base `b582535`, head `f999f74`,
   `reviews/final-review.md`) came back **Ready to merge WITH FIXES**, no Critical, four Important.
   **I-1** `checkIdentifiers` accepted any class and now returned ids and tags, so `it_staff` could
   hand-craft `cls=PURCHASING` and learn a Purchasing tag — now `forbidden()` unless
   `canRegisterClass`. **I-2** the Attention pass ran whenever `attention` was any sort key, so a
   header click from the Attention view kept attention order under the new header's indicator — now it
   runs only as the primary key and `sortHrefs` are built without it. **I-3** Finance's dialog still
   confirmed with a bare “Confirm” — now “Confirm details of {tag}?” with a Confirm details button, and
   an “Unknown asset” refusal is surfaced. **I-4** pagination links never marked the list busy — now a
   `NavLink` through the shared transition. One fix wave, `4e6fc7f`, applied all four plus the sr-only
   separator in the Status cell, a 24 px Clear ×, `[id]/edit/loading.tsx`, a caught Reveal,
   `Math.max(0, hidden)` and the `TEMPORARY` refusal (R15); the re-review
   (`reviews/fix-wave-review.md`) found everything addressed, no new Critical or Important, and three
   nits (R16).

   **Battery, run on the final tree `4e6fc7f` (2026-09-23):** `tsc` clean · `lint` clean · **26
   migrations**, schema up to date (**this phase adds none**) · **1624 unit / 95 files** · **409 e2e /
   39 files** by `--list`, across the same seven foreground chunks, composition unchanged from Phase 29
   apart from the new `e2e/inventory-ux.spec.ts` joining **E2** (spec decision 9, plan P-16) —
   `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 58 passed (3.7m) · B 67 passed (4.1m) · C
   64 passed (4.2m) · D 52 passed (3.9m) · E1 46 passed (6.6m) · E2 56 passed (4.9m) · F 66 passed
   (6.8m) = 409**, zero failed, zero flaky, zero skipped, zero did-not-run, no re-run needed. Twenty
   cases are new: the 13 of `e2e/inventory-ux.spec.ts`, four in `e2e/it-core.spec.ts` (A 54 → 58), two
   in `e2e/registration.spec.ts` (D 50 → 52) and one in `e2e/back.spec.ts` (with the new file, E2 42 →
   56); 389 → 409. `npm run db:seed` ran last, clean; port 3100 carried no listening process before the
   first chunk, between any two chunks, or after the last. See §0 item 9 for the chunk commands.

   **What ships knowingly** (the final review's deferred-minor triage, each marked “may ship”): the
   Attention sort is an in-memory candidate pass over every asset the filters admit — fine today,
   revisit past a few thousand assets (spec §7, `PICKUP.md` §5); Export ignores the Attention sort (it
   orders in SQL); `src/server/modules/import/asset-actions.ts`'s `revalidatePath("/inventory/[id]",
   "page")` patterns omit the route groups (`(app)`, now also `(record)`) — verify them against the
   route group, they were likely inert before this phase too; Phase 29's Loadout sort
   (`src/server/modules/employees/queries.ts:71`) carries the same secondary-key `find` pattern I-2
   fixed here; R8's “Asset not found” copy for wrong-class record URLs; the inventory page links' lost
   `next/link` prefetch and the `pagination.tsx` comment mojibake (R16); on page 1 the disabled ‹ link
   still points at `page=0` (pre-existing). Later refactors, not blockers: one shared dialog submit
   hook, the row menu lifted out of `inventory-table.tsx` (452 lines), a `data-testid` on PageHeader's
   actions group so specs stop reading its div order. **Parked with a home** in `HANDOVER-PENDING.md`
   §5.3: merging the History and Timeline tabs, Record RMA… / Record quote… dialogs on the Repair card,
   a record-shaped list loading skeleton, and Serial and Loan due as optional chooser columns.

   **Merged and pushed (2026-09-24).** `--no-ff` into `main` as `69f8545`, the merged tree byte-identical to
   the tested tip `bba0f6c` (tree hashes matched — the root checkout has no `node_modules`); only `main`
   was pushed, carrying the two docs-only commits `a94f47a` (spec) and `b582535` (plan); branch and
   worktree removed. **What remains: the staging redeploy, the user's decision, not pre-authorised.** The phase adds no migration, so the redeploy that carries
   it is a code-only `scripts/deploy-staging.ps1 -Force` (staging runs `ccb0432` at 26 migrations).

   **(v) PHASE 29 (Laws of UX applied to the employee area) — MERGED TO `main` via `--no-ff`
   `d76903b` AND PUSHED (2026-09-23); final tree `9660e6e`, docs `e01923a`; the merged tree is byte-identical to
   the tested tip (tree hashes matched); branch and worktree removed; no migration; staging
   redeployed 2026-09-23 (`ccb0432`, 26 migrations, at the laptop's new DHCP address `192.168.203.56`).**

   **What it is.** A read-only audit of the three employee screens found 43 breaches of the Laws of UX
   — 11 on `/employees`, 12 on `/employees/new`, 20 on `/employees/[id]`. This phase takes about 35
   of them. Spec `docs/superpowers/specs/2026-09-22-employee-ux-design.md` (`401b838`, decisions 1–10),
   plan `docs/superpowers/plans/2026-09-22-phase-29-employee-ux.md` (`1acd928`, 8 tasks, plan-level
   decisions `P-1`…`P-13`, `D-1`…`D-16`). Both docs commits sit on local `main`, unpushed; the branch
   was fast-forwarded onto them (R1), so they are in its history.

   **The profile (`/employees/[id]`, spec §4).** The header is state-aware: a single primary chosen by
   the person's state — “Assign kit” when every slot is empty, “Fill N gap(s)” when required slots are
   missing, “Open the offboarding wizard” for a leaver, none when complete or policy-less — with **Edit
   kept as a visible button** (brainstorm decision 1) and a ⋯ “More actions” menu holding Timeline,
   Export holdings, Transfer… and Start offboarding… (the last two ACTIVE-only). An overdue leaver gets
   a `DuePill`. The numbers agree: “1 required gap” is the headline, “3 of 6 slots filled” the secondary
   line, and the `ProgressBar` keeps the same geometry. A filled slot tile is now a **menu trigger** —
   click, Enter, Space or Backspace open Replace…, Return…, Open record, Waive this slot… / Remove
   exception — with an always-visible ⋯ as a second trigger; required-and-empty tiles sort first, then
   filled, then optional-and-empty (“optional — not a gap”). An empty tile whose type carries a hold for
   this person shows “reserved · {tag}” and an Assign reserved button. Replace became a searchable
   `EntityCombobox`; Fill preselects a sole spare and marks queued ones; Return's title names tag, model
   and holder. Tiles carry `data-pending`/`aria-busy` while an action runs and a 2 s `data-changed` ring
   after it lands. The Slots/Table choice is remembered per user through `saveLoadoutView` on the
   existing `UserPreference` store. Viewers' tiles are inert `div`s that keep their accessible names.
   Commits `3c0afc8` (header), `d5ba6cd` + `b428a15` (tiles and dialogs).

   **The New form (`/employees/new`, spec §5).** One card, fields in the order an operator thinks in
   (Name first and focused, then Title, Department, Employee number, Joined, Employment, Account status
   last), the Microsoft 365 card folded away. Three live read-only checks on a 400 ms debounce: the
   employee number says “EMP-0099 is already Carlo Dizon's” with the name linking to the profile, or
   offers “Next free: EMP-0100” with a **Use it** button that fills the field (nothing is ever prefilled
   silently); a policy preview under Title reads “matches Finance standard · 6 slots”, by title or by
   department. `createEmployee` now returns **every** field error in one pass and the form focuses the
   first invalid control; the same-name refusal is stated **once**, as a banner naming the existing
   person with a linked employee number. A sticky action bar carries Cancel, Create employee and Create
   and add another. Commits `a2f27fc`, `78e3c23`.

   **The list (`/employees`, spec §6).** It reads as a worklist: a sortable **Loadout** column third
   (“no policy” / “complete” / “N missing”), sorted in memory over the candidate set — one click puts the
   least complete people first, `null` last either way. The count line states what the default cut hides
   (“9 people · 1 leaver hidden”, the number linking to the Show-leavers href). Search gained a clear ×
   and a department term; the two toggles became pill switches; “page 1 of 1” is gone; the filtered-empty
   state shows a chip row of the active filters. New employee is the header primary with Import… and
   Export in a More menu. Commit `9b1291f`.

   **The sixteen rulings — the decisions a later session must be able to find.** **R1** the worktree
   branch was fast-forwarded to local `main` `1acd928` so the spec and plan commits are in its history,
   as in Phases 20–28; cost if wrong: none. **R2** `LoadoutView`'s inert-tile branch is `!canMutate` (a
   viewer), not `!mayAct && !frozen` — the plan's condition leaked a working menu to viewers of leavers;
   cost: one condition. **R3** the same-name refusal body reads “Not added — tick ‘This is a different
   person’ to add them anyway” while the title keeps “Another {name} exists in {department} ({no})” with
   the number linked, because P-3's full sentence repeated the title word for word; cost: one string.
   **R4** `custody.spec.ts` case 8 adapts to the spec's pinned copy — the progress line to “N of M slots
   filled” and the menu label to “Waive this slot…” — the plan wrongly expected no change there; cost:
   two test lines. **R5** menu items whose target is a route handler (`/employees/[id]/holdings`,
   `/employees/export`) navigate with `window.location.assign`, because `router.push` into a route
   handler is a client navigation into a download; cost: two lines. **R6** an ACTIVE person under an
   all-optional policy with nothing assigned gets **no** primary — `missingRequired` is 0 and §4.4 says
   optional slots are not a gap, so “Assign kit” would demand what the policy does not; cost: one
   condition. **R7** `SpareOption.pendingRef` is built from **every** open approval on the asset, not
   only this employee's, so a spare queued for someone else is excluded from Fill, Replace and the
   Reserve picker (first deferred as pre-existing data scope, then fixed in the final wave); cost: an IT
   operator could have picked a spare another person's approval was waiting on. **R8** one reservation
   marks **one** tile: a single consuming pass over the ordered tiles attaches each reserved spare to at
   most the first empty matching tile, per §4.6's “the tile” (singular); cost: one tile fewer shows the
   hold. **R9** the taken-number message shows the number **as typed** (“{no} is already {name}'s”), not
   uppercased as the plan's prose implied — the operator sees what they typed; cost: one
   `.toUpperCase()`. **R10** the submit intent comes from the **DOM submitter**
   (`(e.nativeEvent as SubmitEvent).submitter` with `name`/`value` on the two buttons), not React state,
   which the review showed could be read stale within the same task; cost: two attributes and a
   submitter read. **R11** the profile's “No items yet” line must not swallow the whole `Stat` grid — a
   person holding nothing was losing the Open requests count even with an open request; found by the
   e2e, carried into the final wave; cost: one `Stat` on a day-one profile. **R12** the e2e fixture
   restore stays a database write in `finally` (driving the UI from a `finally` is fragile when the page
   is mid-failure), and case 4 additionally drives a real Return through the tile menu to submission in
   its body so the phase's new trigger path is exercised end to end; cost: one e2e case body. **R13**
   `tileMenuItems` keeps offering Waive on **any** policy slot including optional ones (pre-phase
   behaviour; §4.4's “when the slot is required” is read as “a slot without an exception”), and the dead
   `required` parameter is dropped from the signature and the tests; cost: one menu item on optional
   tiles. **R14** the plan's Task 3 Step 3 (“replaces the four Stats”) contradicted §4.2 (“No items yet”
   replaces Book value and Oldest item only); the spec wins — Items held is implied by the line and Open
   requests stays whenever there is one. Root cause of R11; cost: one `Stat`. **R15** the four read-only
   live checks meter against a separate **`check`** rate kind (240/min) so a bulk-add burst cannot starve
   the 60/min create budget; `RateEvent.kind` is a plain `String`, so **no migration**; cost: a second
   rate-row kind. **R16** `key={state.q}` on the list's search input also remounts on Enter, so the box
   loses focus after a search — parked, may ship: the search result is the operator's next target, and
   the ref-clear alternative belongs in the post-merge toolbar commit because the same `defaultValue`
   shape exists in five sibling toolbars; cost: one Tab press after Enter.

   **Review and the fix wave.** Every task was reviewed; Tasks 4, 5 and 7 each took one fix round. The
   final whole-branch review (base `1acd928`, head `9f10d02`, `reviews/final-review.md`) came back
   **Ready to merge WITH FIXES**: one Critical (R11/R14), four Important (R7's `pendingRef` scope, the
   “Clear search” that emptied the URL but not the uncontrolled input, a “Next free” that went stale
   after Create-and-add-another, and the read-only checks drawing on the mutation budget → R15) and
   fourteen Minors. One fix wave, `9660e6e`, applied all of them plus four Minor one-liners and R13; the
   re-review found all ten items addressed, no new breakage, and one new Minor (R16, parked).

   **Battery, run on the final tree `9660e6e` (2026-09-22):** `tsc` clean · `lint` clean ·
   **26 migrations**, schema up to date (**this phase adds none**) · **1556 unit / 90 files** ·
   **389 e2e / 38 files** by `--list`, across the same seven foreground chunks, composition unchanged
   from Phase 28 apart from the new `e2e/employee-ux.spec.ts` joining **E1** (spec decision 9, plan
   P-13) — `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed
   (4.1m) · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 46 passed (6.6m) · E2 42 passed (4.1m) · F 66
   passed (6.8m) = 389**, zero failed, zero skipped, zero did-not-run. **One flake, and no fix commit
   for it:** chunk B's first pass read 66 passed / 1 failed (4.4m) on
   `e2e/asset-classes.spec.ts:499` (“21. names Purchasing, points at the Register screen, and admin can
   follow the fix”); the as-is re-run was 67 passed (4.1m), so it is recorded as a flake and no product
   or test code was touched. Nine cases are new — `e2e/employee-ux.spec.ts` — so 380 → 389 and E1 moved
   37 → 46; no other chunk's count changed. `npm run db:seed` ran last, clean, which also removed the
   throwaway rows **EMP-9801 / EMP-9802** (“Throwaway Fixround”) that a Task 5 fix-round click-through
   created in `inventory_dev`; port 3100 carried no listening process before the first chunk, between any
   two chunks, or after the last. See §0 item 9 for the chunk commands.

   **The post-merge hygiene list** — recorded, not done, and none of it blocks: extract `SlotTileCard`
   and `useTileFeedback` out of `src/components/employees/loadout-view.tsx`, now about 1070 lines; give
   the three New-form checkers (`EmployeeNoCheck`, `PolicyPreview`, `SameNameCheck`) one shared
   `useDebouncedCheck` hook; fix the five sibling toolbars' uncontrolled search inputs together (the
   `defaultValue` + `key` shape behind R16); drop or re-scope the sentence in `rateLimited()` that says
   “60 changes”, which is unreachable once a refusal comes from the new `check` kind; and reconcile
   `reservationsBySlot`'s consuming pass with `reservedCount`, which still counts every hold, so a
   loan-covered empty tile can read “on loan”, “reserved · tag” and offer Assign reserved at once.

   **Merged and pushed (2026-09-23):** `--no-ff` into `main` as `d76903b`, the merged tree byte-identical to the
   tested tip `e01923a` (tree hashes matched — the root checkout has no `node_modules` and cannot re-run the
   battery, so the hash check stands in for it); only `main` was pushed, carrying the two docs-only
   commits `401b838` (spec) and `1acd928` (plan); branch and worktree removed. **Staging redeployed 2026-09-23**
   (`scripts/deploy-staging.ps1 -Force`, runs `ccb0432`): the seven-statement duplicate check returned no
   rows first (11 categories, 19 types, 5 departments, 1 policy, 2 vendors, 0 stock categories), then
   Phase 27's **migration 26** `case_insensitive_names` applied — **26 migrations**, web healthy, `/login`
   answers 200 at `http://127.0.0.1:3000` and at the laptop's NEW DHCP address `http://192.168.203.56:3000`
   (`.183` before; the user changed location on 2026-09-23 and the laptop is on DHCP again, so every label
   printed before that date encodes the old URL and the address can move again without a reservation).

   **(u) PHASE 28 (a Back control on every page that has a parent — where the operator came from,
   else the breadcrumb's parent) IS MERGED TO `main` via `--no-ff` `7214066` AND PUSHED (2026-09-22) — final
   tree `5a8bbcf` (product commit `ad39271` plus the e2e fix round `5a8bbcf`), docs `e8b48a4`; the merged tree
   is byte-identical to the tested tip (tree hashes matched), branch and worktree removed; the staging
   redeploy is the user's decision, not pre-authorised. It is a
   BOUNDED change: the design was approved in conversation on 2026-09-22 and there is NO spec and NO
   plan document — this block, §0 item 9 and `PICKUP.md` are its record. It adds NO migration (26
   stays).**

   **The design, in one paragraph.** `PageHeader` renders a “← Back” button (a real `<button>`,
   accessible name “Back”) automatically whenever the page passes a breadcrumb with a linked crumb —
   the 37 sub-pages (records, profiles, edit/new forms, imports, timelines, documents, reports,
   approvals, deliveries); the asset record's sub-tabs inherit it from `inventory/[id]/layout.tsx`'s
   header. Top-level lists and Home pass no breadcrumb and show no Back (the sidebar is their way
   around). Back goes WHERE THE OPERATOR CAME FROM when this tab has a previous in-app page —
   `router.back()`, so a list returns with its filters, search and page intact — otherwise to the
   PARENT, the breadcrumb's last linked crumb (a deep link, a fresh tab, a scanned QR). The “is there
   a previous page” test is `src/lib/nav-stack.ts`: this tab's in-app route history in
   `sessionStorage` (`br.nav-stack`, capped at 50, repeats skipped), fed by `NavigationTracker` (a
   client component mounted once in `(app)/layout.tsx` inside Suspense — Next 15 requires a boundary
   around `useSearchParams`; `/login`, `/logout`, `/signup` and `/bootstrap` sit outside `(app)` and
   never enter the stack). `BackLink` pops the current page and calls `router.back()` when a previous
   page remains, else `router.push(parent)`. One button, one label, one rule.

   **Seven files, no page file touched.** New: `src/lib/nav-stack.ts` and `src/lib/nav-stack.test.ts`
   (4 unit cases), `src/components/shell/navigation-tracker.tsx`,
   `src/components/ui/back-link.tsx`, `e2e/back.spec.ts` (3 cases — the filtered list round trip, a
   deep link's parent fallback, no Back on lists/Home and exactly one on a profile). Modified:
   `src/components/ui/page-header.tsx` and `src/app/(app)/layout.tsx`. Because `PageHeader` reads the
   nearest LINKED crumb, `/stock`'s lone unlinked crumb correctly gets no Back, and the asset
   record's sub-tabs get the button from the record layout's header without a page file of their own.
   Commits `ad39271` (the product) and `5a8bbcf` (the fix round).

   **The two rulings.** **R1** — the worktree was branched from LOCAL `main` (`758ed3f`), as every
   phase since 20; cost if wrong: none. **R2** — Back is a NAVIGATION control, not a transition, so
   the product behaviour stands and the TEST adapts: `e2e/purchases.spec.ts:280` asserted zero
   buttons in the viewer's `main header` on `/purchases/[id]`, which the new button breaks; it now
   pins that header's button count to exactly one AND that one's accessible name to “Back”, so a
   transition button still cannot slip past — it would either raise the count or fail the name.
   Every spec was grepped for header-scoped button counts before the battery;
   `e2e/approvals-audit.spec.ts:164` needed nothing, its header locator only reads text. Cost if
   wrong: a test line. The review found exactly this one Critical plus one Minor (`e2e/back.spec.ts`'s
   helper-provenance line numbers were off by five); one fix round (`5a8bbcf`) cleared both and the
   scoped re-review came back CLEAN.

   **Battery, last run 2026-09-22 on the final tree `5a8bbcf`:** `tsc` clean · `lint` clean ·
   **26 migrations**, schema up to date (this phase adds none) · **1532 unit / 88 files** ·
   **380 e2e / 37 files** by `--list`, across the same seven foreground chunks with explicit file
   paths, composition unchanged from Phase 27 apart from the new `e2e/back.spec.ts` joining **E2** —
   `E2E_PORT=3100 --workers=1 --global-timeout=540000` — **A 54 passed (3.4m) · B 67 passed (4.0m)
   · C 64 passed (4.2m) · D 50 passed (3.7m) · E1 37 passed (5.9m) · E2 42 passed (4.1m) · F 66
   passed (6.7m) = 380**, zero failed, zero flaky, zero skipped, zero did-not-run. Every chunk was
   green on its first pass: no chunk was re-run and there is no test-only fix commit in the battery,
   the fifth close in a row with none. Three cases are new — `e2e/back.spec.ts` — so 377 → 380 and
   E2 moved 39 → 42; no other chunk's count changed. `npm run db:seed` ran last, clean; port 3100
   carried no listening process before the first chunk, between any two chunks, or after the last.
   See §0 item 9 for the chunk commands.

   **What stays parked.** **Back on top-level lists and Home — DECLINED**, not deferred: the sidebar
   is their navigation, and a control that leaves the app's top level has nowhere honest to go. **The
   richer keyboard layer** (j/k and friends) is unchanged and still parked from Phase 27 — keyboard
   support stays at Enter on a focused row, plus the Back button's ordinary tab order, which puts it
   ahead of the breadcrumb links. Everything else Phase 27 parked — `/audit`'s raw `vendor` pill
   (M-2), the six inline `P2002` checks outside the five consolidated modules (R5), M-P27-1…-3, the
   depreciation module and the Purchasing bulk import — is untouched by this phase.

   **What remains: merging to `main`, pushing, and the staging redeploy are the user's decisions, not
   pre-authorised.** This phase is code-only — it adds no migration, so its own redeploy is a plain
   `scripts/deploy-staging.ps1 -Force` — but staging still runs `e96fb2a` (Phases 19–26, 25
   migrations) and Phase 27's **migration 26** `case_insensitive_names` is still pending there, so the
   first `-Force` after a Phase 28 merge applies it and the seven-statement duplicate check above must
   be run first. `main` = `origin/main` = `758ed3f` and carries no unpushed commits; this phase's docs
   commit sits on the branch, above `5a8bbcf`.

5. **Execution mode: subagent-driven, and the user asked for it explicitly.** `superpowers:subagent-driven-development`.
   Fresh implementer per task, then review. Tasks 1–4 used two reviewers; 5–9 used one, escalating only
   if the first found something structural. **The reviews are where correctness came from** — see item 7.

6. **THE CHECKLIST — run it against every task before calling it done.** Unchanged from Phase 9 and
   still earning its keep; §0 item 5 of the previous revision has the full list, and §6a is the detail.
   The four that bit hardest in Phase 10:
   - **Does the surface consume EVERY refusal its rule can return?** (rule 10.) `barcodeFit` guarded
     length but not charset, so one bad tag would have 500'd a 200-label sheet.
   - **Does the test's input reach the branch its name claims?** (rules 65/78.) Four inert assertions
     this phase, one of them guarding the scanner's central promise.
   - **Is a number or contract string defined twice?** (rules 26/37/38.) `CALIBRATION_MM` was hardcoded
     in a banner beside the constant that owns it.
   - **Does a comment claim a property the code doesn't have?** (rule 16.) Six instances, two of them
     printed onto adhesive paper, and one that justified a correct decision with an impossible scenario.

7. **What Phase 10 has cost, and what it bought — read this before deciding how much review to run.**
   **Forty-four defects were caught across eleven tasks. TWENTY of them were in the plan I wrote**, not
   in the implementations: a module name that would have clobbered `src/lib/labels.ts` and its ten
   importers, a global `@page` rule that would have regressed two live print surfaces, a test helper
   that does not exist, **three mutation-table predictions that were simply false**, a scope line that
   would have shipped a red suite, a helper that made the test I had asked for impossible to write,
   and — in Task 10 alone — a dev quickstart that could not run from the clean clone the same task
   mandated, a prod description that undercounted its own services by two, and a sentence that was true
   of the agent harness and false of the human it was addressed to.

   **Not one of the forty-four would have failed a green test suite.** **Five were findable only by
   rendering the thing and putting a number on it**: a barcode checksum weighted from the wrong end
   (all 8 tests green), a calibration ruler measuring 89.38 mm against a declared 100 mm, a barcode
   clipped 0.4 mm by a border nobody accounted for, a scanner that **silently died** the moment an
   operator clicked an outcome by hand, and four serious axe violations on routes no spec had ever
   visited. **And three more were findable only by RUNNING the documentation** — chief among them a
   `/` in a generated password that breaks the deployment outright, in roughly 40% of attempts.
   **Budget for measurement and for execution, not just for tests.**

8. **State this session left behind (2026-08-26):** on `phase-10-polish`, working tree **clean**, **8
   migrations none pending**, `inventory-db-1` up and healthy. **The database holds
   `e2e/axe-sweep.spec.ts`'s leftovers** — that file sorts last and reseeds itself, so this is normal
   drift, not damage. Reseed before trusting any fixture-dependent read. No scratch files in the repo;
   `backups/` holds only the pre-existing dump; `uploads/` holds its usual 57 files. **`.next` currently
   holds a DEV build** (the e2e suite rebuilt it after `npm run build`) — see the warning in item 9.
   Two throwaway compose projects were used this session, `inv-readme-test` and `inv-fix-test`; **both
   were `down -v`'d and neither left a container, volume or network behind.** The live `inventory` db
   was stopped twice to free port 5432 and restarted both times.

   ⚠️ **Restart the dev server before any confirmation run.** The one this session used accumulated
   **3.2 hours of CPU** and a Task 9 agent's sweep stalled against it. §6's Phase 6 lesson is real:
   a long-lived dev server degrades the suite into phantom failures. Use `preview_stop`/`preview_start`,
   never raw Bash.

9. **Running the e2e suite — 319 tests across 31 files, and the split below is MEASURED, not estimated.**
   Task 16 (Phase 16) ran all five chunks, foreground, `E2E_PORT=3100 --workers=1 --global-timeout=600000`
   (chunk 1 at 540000, chunk 5 at 1200000): **52 in 2.8m · 63 in 4.1m (chunk 2 needed a fix first — see
   below) · 69 in 4.4m (chunk 3 needed two more fixes — see below) · 36 in 2.4m · 6 in 2.9m = 226.**
   Correction history, one line: **147 / 12 files** at Phase 10's close → **167 / 13 files** at Phase 12
   → **187 / 14 files** at Phase 13 → **203 / 15 files** at Phase 14 → **214 / 16 files** at Phase 15 →
   **226 / 18 files** at Task 16's close → **227 / 18 files** after the final-review fix wave (D-19 added
   `registration.spec.ts` case 7; D-20 added axe assertions inside existing cases, so no new file and no
   further count change from D-20 itself) → **239 / 19 files** at Phase 17's close (Task 8 added
   `e2e/paging.spec.ts`, 12 cases, which is the entire 227 → 239 growth; no existing e2e file changed at
   the close, and the final battery then changed two waits inside `custody.spec.ts` case 7 without adding
   a case, `D-12` — see the plan's `D-1`…`D-12`) → **258 / 21 files** at Phase 18's close (Task 10 added
   `e2e/suppliers.spec.ts` (11 cases) and `e2e/purchasing-ext.spec.ts` (8 cases), the entire 239 → 258
   growth; two pre-existing files changed EARLIER in the phase, not at the close — `e2e/asset-classes.spec.ts`
   (Task 7, a compile-forced `provenance` value in a hand-built fixture literal) and `e2e/purchases.spec.ts`
   (Task 9, two `selectOption` lines so its draft-creation steps pick a department) — see plan `D-15`) →
   **258 / 21 files, unchanged**, confirmed by `--list` after the final-review fix wave (2026-09-09,
   `D-18`/`D-19`) — the wave added assertions inside two existing cases (`suppliers.spec.ts` case 1,
   `purchasing-ext.spec.ts` case 6), no new case and no new file → **275 / 23 files** at Phase 19's close
   (Task 7 added `e2e/stock.spec.ts`, 11 cases, and Task 8 added `e2e/stocktake.spec.ts`, 6 cases, the
   entire 258 → 275 growth; **no existing e2e spec file changed** — the only pre-existing e2e file touched
   was the shared fixture helper `e2e/fixtures/make.ts`, which gained the stock export/import-template
   columns (plan P-2) and two new fixtures, `stock-clean.xlsx`/`stock-mixed.xlsx`; `git diff --stat
   dba6a94..HEAD -- e2e` confirms exactly those five paths changed and nothing else — see plan
   `D-1`…`D-20`) → **296 / 27 files** at Phase 20's close (Task 7 added `e2e/transfers.spec.ts` (5 cases)
   and `e2e/directory.spec.ts` (5 cases); Task 8 added `e2e/offboarding-v2.spec.ts` (5 cases) and
   `e2e/it-gaps.spec.ts` (6 cases), the entire 275 → 296 growth. Four pre-existing e2e files changed, none
   adding a case: `e2e/offboarding.spec.ts` (Task 8 fix round 2, `2641af5` — the printable-farewell case's
   directory search now passes `?leavers=1`, since §5's leavers-hidden-by-default would otherwise hide the
   just-offboarded Dennis Ong from the search it re-opens) and, found only while re-running Task 9's
   closing battery, `e2e/it-core.spec.ts` (`fe4295c` — gap 3's `coveredByLoan` moved Marites Bautista's
   loadout-gaps count from a stale "2 missing" to the true "1 missing"), `e2e/paging.spec.ts` (`63df64a` —
   case 6's raw `db.employee.count()` now excludes OFFBOARDED to match the toolbar's leavers-hidden
   default), and `e2e/registration.spec.ts` (`0b463b1` and `f6ec5e1` — gap 2's class-scoped
   `checkIdentifiers` needed a category chosen before its live check runs at all, and case 5's collision
   fixture needed to be the same class as the batch under test). See plan `D-1`…`D-30` and HANDOVER (m) for
   what each fix diagnosed) → **296 / 27 files, unchanged**, confirmed by `--list` after the final-review
   fix wave (2026-09-10, `D-23`…`D-30`) — the wave changed assertions inside two existing cases
   (`directory.spec.ts` case 3, `it-gaps.spec.ts` case 6), no new case and no new file. →
   **305 / 29 files** at Phase 21's close (Task 7 added `e2e/oversight.spec.ts`, 7 cases, and
   `e2e/rate-limit.spec.ts`, 2 cases, the entire 296 → 305 growth. Two pre-existing e2e files changed,
   neither adding a case: `e2e/approvals-audit.spec.ts` (Task 1, plan `D-3` — the fresh-seed Closed count
   moved from 2 to 5 once migration 22's backfill and the three seeded direct rows landed) and
   `e2e/axe-sweep.spec.ts` (Task 6, plan `D-8` — `PROMOTED_RULES` added the four attributed rules). No
   further e2e file changed in Task 8 itself; confirmed by `--list` on the final tree `562587f`. →
   **305 / 29 files, unchanged**, confirmed by `--list` on the final tree `2ae8738` after the final
   review's fix wave and ruling R7's Manila-date fix — a third pre-existing e2e file changed after Task 8's
   close: `e2e/transfers.spec.ts` (ruling R7, plan `D-15` — case 4's "tomorrow" now computed on the
   Asia/Manila calendar to match the product fix; no case added or removed). See plan `D-1`…`D-16` and
   HANDOVER (n) for what each task shipped and what the final review's fix wave and the final battery
   fixed.) → **319 / 31 files** at Phase 22's close (Task 8 added `e2e/stock-lots.spec.ts`, 8 cases, and
   Task 9 added `e2e/stock-reports.spec.ts`, 6 cases, the entire 305 → 319 growth; **no pre-existing e2e
   spec file changed** — the only other new e2e file is the fixture `e2e/fixtures/delivery-receipt.pdf`
   (Task 8, plan P-6); `git diff --stat 4db54be..HEAD -- e2e` confirms exactly those three paths changed
   and nothing else. See plan `D-1`…`D-20` and HANDOVER (o) for what each task shipped.) →
   **319 / 31 files, unchanged**, confirmed by `--list` on the final tree `a4b57b5` after the final
   review's fix wave (`2eeabf7`, `D-16`…`D-19`, no e2e file among its changes) and the final battery that
   followed it — one pre-existing e2e file changed at the final battery itself: `e2e/it-core.spec.ts`
   (a test-only fix, `a4b57b5` — the documents-upload case gained the file's own `waitForHydration()` guard
   before its first `setInputFiles()`, closing a hydration-race gap that had only ever been wired to one of
   the file's two upload call sites; no case added or removed). See plan `D-16`…`D-20` and HANDOVER (o) for
   what the final review's fix wave and the final battery found and fixed.) It
   does **not** fit one foreground run. Split it, each chunk
   with `--global-timeout` so Playwright reaps itself rather than being killed — **this was the
   Phase-17-through-18 command list (the five chunk boundaries had not moved since Task 8, only chunk 4's
   timeout — 900000, `paging.spec.ts` scale-fixture cases are slower — and chunk 1's, 600000, was
   540000); Phase 19's Task 9 re-drew the five chunks from scratch to fold in `stock.spec.ts` and
   `stocktake.spec.ts` — see its own five-chunk list just below the history**:

   ```bash
   npx playwright test e2e/admin.spec.ts e2e/approvals-audit.spec.ts e2e/auth-shell.spec.ts e2e/home-finance.spec.ts --workers=1 --global-timeout=600000
   npx playwright test e2e/import-export.spec.ts e2e/it-core.spec.ts e2e/kitchen-sink.spec.ts e2e/department-owned.spec.ts --workers=1 --global-timeout=600000
   npx playwright test e2e/offboarding.spec.ts e2e/purchases.spec.ts e2e/receiving.spec.ts e2e/asset-classes.spec.ts e2e/direct-lifecycle.spec.ts --workers=1 --global-timeout=600000
   npx playwright test e2e/scanner.spec.ts e2e/labels.spec.ts e2e/registration.spec.ts e2e/custody.spec.ts e2e/paging.spec.ts --workers=1 --global-timeout=900000
   npx playwright test e2e/axe-sweep.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts --workers=1 --global-timeout=1200000
   ```

   **Phase 17's Task 9 (2026-09-08) ran this exact five-chunk list, foreground, `E2E_PORT=3100`, on branch
   tip `c2b4c9f`:** **52 passed (2.8m) · 63 passed (4.1m) · 69 passed (4.3m) · 49 passed (3.5m, chunk 4 now
   carries `paging.spec.ts`) · 6 passed (2.9m) = 239 / 239**, zero failed, zero did-not-run, on the first
   pass — no fix was needed. `tsc` and `lint` were also clean, and `1055 unit / 58 files` all passed.
   `npx playwright test --list | tail -1` confirmed **`Total: 239 tests in 19 files`** afterward.

   **The final tree (`4f7b29e`, after the fix wave) was re-run in four chunks instead** — 54 · 67 · 63 ·
   55 = 239, plus `1056 unit / 58 files`: `it-core` + `import-export` + `purchases`; `asset-classes` +
   `department-owned` + `auth-shell` + `labels`; `offboarding` + `receiving` + `paging` + `home-finance` +
   `approvals-audit`; `admin` + `direct-lifecycle` + `scanner` + `registration` + `custody` + `axe-sweep` +
   `kitchen-sink`. The last chunk exposed `custody.spec.ts` case 7's stale-toast race — it passes alone
   and failed twice after `admin` and `axe-sweep` in one server session — fixed in the test (plan `D-12`),
   55/55 on re-run. Either chunking is valid; the five-chunk list above stays the reference.

   **Phase 18's Task 10 (2026-09-08) ran the same four-chunk composition, on branch tip `38a3b02`, with
   the two new files added to chunk D:** `it-core` + `import-export` + `purchases` (54); `asset-classes` +
   `department-owned` + `auth-shell` + `labels` (67); `offboarding` + `receiving` + `paging` +
   `home-finance` + `approvals-audit` (63); `admin` + `direct-lifecycle` + `scanner` + `registration` +
   `custody` + `axe-sweep` + `kitchen-sink` + `suppliers` + `purchasing-ext` (74, `--global-timeout=900000`
   — 74 tests and axe-sweep pushed it past the default budget and past a single 70-test chunk, so the cap
   was raised and disclosed rather than silently matched to the other three) — **54 (3.4m) · 67 (3.9m) ·
   63 (4.0m) · 74 (8.0m) = 258**, plus `1110 unit / 64 files`, `tsc` and `lint` clean, 19 migrations. Chunk
   A first ran 53/54 (`it-core.spec.ts`'s document-upload-rejection case failed once on a fault-banner text
   mismatch), then 54/54 on an immediate re-run, and `it-core.spec.ts` alone also passed 21/21 including
   that exact case — a non-reproduced failure of the cold-compile/headroom class §7 documents, not a Phase
   18 regression (`it-core.spec.ts` is untouched by this phase and this exact chunk composition already
   ran clean at Phase 17's close). See plan `D-1`…`D-17`, "Measured at close".

   **Two of Phase 16's own chunks needed a fix before they passed** (plan `D-18`): Task 13 replaced the
   register page's post-submit redirect to `/inventory` with an in-place `RegisterSuccess` panel, and
   three PRE-EXISTING specs (`department-owned.spec.ts`, `receiving.spec.ts`, `asset-classes.spec.ts`)
   still waited for that redirect — all three now wait for the panel's own text instead. The first
   failure also uncovered a real (not test-only) bug: the panel's headline read the live `tags` form
   state, which could recompute one tag number ahead of what was actually written; `register-form.tsx`
   now freezes the tags a submission actually sent. Read `D-18` before assuming a register-flow test
   failure here is just a locator.

   **The final-review fix wave (D-19/D-20, 2026-09-08) did NOT re-run the full five-part battery** — its
   verification protocol was narrower and targeted, foreground throughout: `registration.spec.ts` +
   `custody.spec.ts` together (13 passed, 1.4m), `department-owned.spec.ts` + `it-core.spec.ts` together
   (37 passed, 2.8m — `document-actions.ts`'s `canManageClass` → `canAttachDocuments` change and the
   `documents-panel.tsx` prop split touch surfaces both files exercise), then `axe-sweep.spec.ts` alone
   (6 passed, 2.9m, `--global-timeout=1200000`). `--list` confirmed **227 / 18 files** afterward. **D-20's
   first run of the new axe assertions failed once**, on `custody.spec.ts` case 8's Waive dialog: a SERIOUS
   3.6:1 contrast violation on the "Waive" `Button variant="primary"`. This is the SAME phantom class
   `axe-sweep.spec.ts`'s own `scanRoute` comment already documents (measured three times in this project) —
   the button samples mid-transition or with the pointer resting on it and passes at rest — because every
   axe call `registration.spec.ts`/`custody.spec.ts` added follows a click (unlike `it-core.spec.ts`'s
   callers, which are all fresh `page.goto`s). Fixed by giving both files' copied `expectNoSeriousAxe` the
   same pointer-settle step `scanRoute` uses (`page.mouse.move(0, 0)` + a 700 ms wait) before analysing —
   not a weakened assertion, a corrected measurement moment; the full battery should still confirm this at
   the next full run before merge, since a targeted subset is not the same claim as a clean five-part run.

   **Closed 2026-09-08 on `ead422d` (the merge candidate):** the controller ran the remaining files in the
   foreground, `--workers=1`, `E2E_PORT=3100`: `admin` + `approvals-audit` + `auth-shell` + `home-finance`
   **52 passed (2.8m)** · `offboarding` + `purchases` + `receiving` + `asset-classes` + `direct-lifecycle`
   **69 passed (4.4m)** · `scanner` + `labels` **24 passed (1.3m)** · `import-export` + `kitchen-sink`
   **26 passed (1.5m)**. With the fix wave's 13 · 37 · 6 that is every one of the 18 files — **227 / 227
   passed on `ead422d`**, zero failed, zero did-not-run. `tsc` clean and **1040 unit / 56 files** re-run on
   the same head. Nothing is owed before merge.

   **Phase 19's Task 9 (2026-09-09) drew its own five-chunk list from scratch, to spread the two new
   files (`stock.spec.ts`, `stocktake.spec.ts`) rather than tack them onto Phase 17's chunk boundaries,
   foreground, `E2E_PORT=3100`, `--workers=1`, `--global-timeout=540000`, on branch tip `2f26ac1`**:

   ```bash
   npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts e2e/stock.spec.ts e2e/stocktake.spec.ts --workers=1 --global-timeout=540000
   ```

   **54 passed (3.3m) · 67 passed (3.9m) · 63 passed (4.0m) · 38 passed (2.6m) · 53 passed (7.3m) = 275 /
   275**, zero failed, zero did-not-run, on the first pass of every chunk — no re-run was needed anywhere
   in the battery. `tsc` and `lint` were clean, **1212 unit / 72 files** all passed, `npx prisma migrate
   status` reported **20 migrations**, schema up to date, and `npx playwright test --list | tail -1`
   confirmed **`Total: 275 tests in 23 files`** both before and after. Port 3100 carried no listening
   process before the first chunk, between any two chunks, or after the last. See plan `D-1`…`D-20`,
   "Measured at close", and HANDOVER (l) for what shipped.

   **Phase 20's Task 9 (2026-09-10) redrew the chunks into SIX to add the four new files while keeping
   every chunk ≤ 70 tests, foreground, `E2E_PORT=3100`, `--workers=1`, `--global-timeout=540000`, on branch
   tip `f6ec5e1`:**

   ```bash
   npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts e2e/stock.spec.ts e2e/stocktake.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/transfers.spec.ts e2e/directory.spec.ts e2e/offboarding-v2.spec.ts e2e/it-gaps.spec.ts --workers=1 --global-timeout=540000
   ```

   Note chunk C's `offboarding` pattern also matches `offboarding-v2.spec.ts` (substring), so its 5 cases
   run in both C and F — by the brief's own chunk lists, not an oversight; 296 unique tests, 301 counted
   across the six chunks.

   **A 54 passed (3.3m) · B 67 passed (3.9m) · C 68 passed (4.4m) · D 38 passed (2.6m) · E 53 passed
   (7.3m) · F 21 passed (2.0m) = 301 run / 296 unique**, zero failed, zero did-not-run — but not on the
   first pass of every chunk. `tsc` and `lint` were clean, **1291 unit / 75 files** all passed, `npx prisma
   migrate status` reported **21 migrations**, schema up to date, and `npx playwright test --list | tail -1`
   confirmed **`Total: 296 tests in 27 files`**. Port 3100 carried no listening process before the first
   chunk, between any two chunks, or after the last, and `npm run db:seed` ran clean at the end. Chunks A,
   C and D each failed their first pass on a stale pre-Phase-20 e2e expectation, reproduced once as-is, was
   fixed in its own commit, then re-ran clean — full diagnosis of each in HANDOVER (m) above. See plan
   `D-1`…`D-30`, "Measured at close" (Task 9's numbers), and the final tree below.

   **The final-review fix wave's battery (2026-09-10) re-ran the same six commands above verbatim, with
   explicit file paths throughout (not the bare `offboarding` pattern Task 9's close actually typed for
   chunk C — see below), on the final tree `4d54382`:** **A 54 passed (3.4m) · B 67 passed (3.8m) · C 63
   passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.3m) · F 21 passed (2.0m) = 296 / 296**, zero failed,
   zero did-not-run. Chunk A's first pass was 53 passed, 1 failed (`it-core.spec.ts:302`, a `toBeVisible`
   5 s timeout on `getByText(/Accepted: PDF, PNG, JPG/)`) and passed 54/54 on an immediate as-is re-run —
   the cold-compile/headroom class §7 documents, not a regression; no test or product code was touched.
   `tsc` and `lint` were clean, **1295 unit / 75 files** all passed, `npx prisma migrate status` reported
   **21 migrations**, schema up to date, and `npx playwright test --list | tail -1` confirmed
   **`Total: 296 tests in 27 files`**, unchanged. Port 3100 carried no listening process before the first
   chunk, between any two chunks, or after the last, and `npm run db:seed` ran clean at the end. Task 9's
   earlier close (`D-22`) had typed chunk C's file argument as the bare pattern `offboarding` rather than
   `e2e/offboarding.spec.ts`, which also matched `offboarding-v2.spec.ts` — hence its 68 and the
   301-run/296-unique sum; the explicit six-command list above is the canonical one, and this re-run's sum
   is exactly 296. See plan `D-1`…`D-30`, "Measured at close", and HANDOVER (m) for the final review's
   findings and the fix wave.

   **Phase 21's Task 8 (2026-09-14) kept the same six chunks Phase 20 drew, adding the phase's two new
   files to chunk F, foreground, `E2E_PORT=3100`, `--workers=1`, `--global-timeout=540000`, on branch tip
   `562587f`:**

   ```bash
   npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts e2e/stock.spec.ts e2e/stocktake.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/transfers.spec.ts e2e/directory.spec.ts e2e/offboarding-v2.spec.ts e2e/it-gaps.spec.ts e2e/oversight.spec.ts e2e/rate-limit.spec.ts --workers=1 --global-timeout=540000
   ```

   Chunks A–E carry exactly Phase 20's file composition, chunk C read by its explicit
   `e2e/offboarding.spec.ts` path throughout (no bare-pattern overlap this run); chunk F keeps Phase 20's
   four files (`transfers`, `directory`, `offboarding-v2`, `it-gaps`) and adds the phase's own two new
   files, `e2e/oversight.spec.ts` (7 cases, `test.describe.serial`) and `e2e/rate-limit.spec.ts` (2 cases).

   **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E 53 passed (7.4m)
   · F 30 passed (3.3m) = 305 / 305**, zero failed, zero did-not-run on the first pass of every chunk — no
   re-run was needed anywhere in the battery. `tsc` and `lint` were clean, **1312 unit / 77 files** all
   passed, `npx prisma migrate status` reported **22 migrations**, schema up to date, and `npx playwright
   test --list | tail -1` confirmed **`Total: 305 tests in 29 files`**. Port 3100 carried no listening
   process before the first chunk, between any two chunks, or after the last, and `npm run db:seed` ran
   clean at the end. See plan `D-1`…`D-16`, "Measured at close", and HANDOVER (n) for what shipped.

   **The final review's fix wave (2026-09-15, ruling R6) committed `b6b4e2a`** — `cleanReason` keeps
   tab/LF/CR (`D-11`), `pagedSnapshot` names `PAGED_MAX_WAIT_MS` 10 s / `PAGED_TIMEOUT_MS` 20 s (`D-12`);
   `tsc`/`eslint` clean, **1314 unit / 77 files** (2 new: the `reason.test.ts` cases pinning tab/LF/CR
   survival), scoped re-review ADDRESSED both findings, 0 new findings.

   **The full battery then re-ran the same six commands above verbatim, with explicit file paths
   throughout, on `b6b4e2a`:** **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed
   (2.7m) · E 53 passed (7.4m)** clean, but chunk F failed: **25 passed, 1 failed, 4 did not run** —
   `transfers.spec.ts` case 1, at 01:00 Manila (`test.describe.serial` skipped the rest behind it),
   reproduced identically on an immediate as-is re-run. `tsc`/`lint` clean, **1314 unit / 77 files**, **22
   migrations**, `--list` still **305 / 29 files**. Diagnosis: the Transfer dialog's default effective date
   and the schema's future-date check both compared against the UTC calendar date (`toISOString`), so
   between 00:00 and 08:00 Manila a transfer recorded on the local "today" actually stored yesterday's date
   and the test's `fmtDate(new Date())` (Asia/Manila) header line never matched — Phase 20's parked M-5
   (there, `D-29`), now proven a real defect for local users. Fixed by ruling R7 (plan `D-15`): a shared
   `localDateISO(now)` in `src/lib/format.ts` (the Asia/Manila calendar date) backs the dialog's default/max
   and the schema's "today"; `isRecentTransfer` gains a one-day grace below zero, since a same-day transfer
   stored as UTC midnight sits up to eight hours ahead of `now`; `transfers.spec.ts` case 4's own "tomorrow"
   now computes on the same calendar. Commit `2ae8738`.

   **The full battery re-ran once more on the final tree `2ae8738` (2026-09-15):** **A 54 passed (3.4m) · B
   67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.6m) · E 53 passed (7.4m) · F 30 passed (3.2m) =
   305 / 305**, zero failed, zero did-not-run, all first pass, no further fix commits. `tsc`/`lint` clean,
   **1317 unit / 77 files** all passed (3 new: `localDateISO`'s own case in `format.test.ts`, and
   `isRecentTransfer`'s one-day-grace and two-day-refusal cases in `transfer-schema.test.ts`), `npx prisma
   migrate status` reported **22 migrations**, schema up to date, `--list` confirmed **305 / 29 files**,
   unchanged. `transfers.spec.ts` itself passed clean, all 5 tests. Port 3100 carried no listening process
   before the first chunk, between any two chunks, or after the last, and `npm run db:seed` ran clean at
   the end. See plan `D-11`…`D-16`, "Measured at close", and HANDOVER (n) for the final review's findings
   and the fix wave.

   **Phase 22's Task 10 (2026-09-16) kept Phase 21's first five chunks unchanged (A–D and the E
   composition) and split chunk E into E1/E2 to add the phase's two new files rather than let one chunk
   grow past 70 tests, foreground, `E2E_PORT=3100`, `--workers=1`, `--global-timeout=540000`, on branch
   tip `dfb1a0f`:**

   ```bash
   npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/stock.spec.ts e2e/stocktake.spec.ts e2e/stock-lots.spec.ts e2e/stock-reports.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/transfers.spec.ts e2e/directory.spec.ts e2e/offboarding-v2.spec.ts e2e/it-gaps.spec.ts e2e/oversight.spec.ts e2e/rate-limit.spec.ts --workers=1 --global-timeout=540000
   ```

   Chunks A–D and F carry exactly Phase 21's file composition, unchanged; the former chunk E (`custody` +
   `axe-sweep` + `kitchen-sink` + `suppliers` + `purchasing-ext` + `stock` + `stocktake`, 53 tests) splits
   into **E1** (the first five files, 36 tests) and **E2** (`stock`, `stocktake`, plus the phase's two new
   files `stock-lots.spec.ts` and `stock-reports.spec.ts`, 31 tests) — neither half needed the
   `stock`/`stocktake` pair moved elsewhere, since E2 alone (31) stays well under the ~70-test cap this
   phase's own spec §9.3 sets.

   **A 54 passed (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 38 passed (2.7m) · E1 36 passed
   (5.6m) · E2 31 passed (3.0m) · F 30 passed (3.2m) = 319 / 319**, zero failed, zero did-not-run, all
   first pass, no fix commits anywhere in the battery — every chunk, including both stock-family files
   run for the first time as one of seven separate foreground processes, passed on its first try. `tsc`
   and `lint` were clean, **1404 unit / 79 files** all passed, `npx prisma migrate status` reported **23
   migrations**, schema up to date, and `npx playwright test --list | tail -1` confirmed **`Total: 319
   tests in 31 files`**, both before and after. Port 3100 carried no listening process before the first
   chunk, between any two chunks, or after the last (only stale `TIME_WAIT` entries remained, never a
   `LISTENING` one), and `npm run db:seed` ran clean at the end. See plan `D-1`…`D-20`, "Measured at
   close", and HANDOVER (o) for what shipped.

   **The final review's fix wave (2026-09-16) committed `2eeabf7`** — the expiry report and its export
   exclude archived items (`D-16`), one shared `revalidateStockReads` helper is called by all three stock
   writers incl. the importer (`D-17`), the expired-lot advice fires only under the `"skip"` policy and
   `expiryLabel` says "day" for one (`D-18`); scoped re-review ADDRESSED all four, 0 new findings.

   **The full battery then re-ran the same seven commands above verbatim, with explicit file paths
   throughout, on `2eeabf7`:** chunks B–F and E1/E2 passed clean on the first try — **B 67 passed (3.9m) ·
   C 63 passed (4.0m) · D 38 passed (2.6m) · E1 36 passed (5.7m) · E2 31 passed (3.1m) · F 30 passed
   (3.3m)** — but chunk A's first pass was **53 passed, 1 failed (3.6m)**: `e2e/it-core.spec.ts:302`, the
   documents-upload PNG-rejection case, a `toBeVisible` 5 s timeout on `getByText(/Accepted: PDF, PNG,
   JPG/)`, reproduced identically on an immediate as-is re-run — not the cold-compile/headroom class,
   since `2eeabf7` touches none of the files this case exercises (`src/server/uploads.ts`,
   `document-actions.ts`, `documents-panel.tsx`, the rate limiter). `tsc`/`lint` clean, **1404 unit / 79
   files**, **23 migrations**, `--list` still **319 / 31 files**. Diagnosis: `setInputFiles` fires its
   native `change` event the instant the server-rendered `<input>` exists, before React's delegated
   `onChange` is wired up on a freshly-navigated page; the file's own `waitForHydration()` helper (already
   guarding one call site, line 241) was never wired to this test's upload call at line 302. Fixed
   test-only — `await waitForHydration(page.getByLabel("Upload document"));` before the first
   `setInputFiles()` — verified in isolation (1 passed), then **chunk A re-ran 54 passed, 0 failed
   (3.3m)**, clean. Commit `a4b57b5`.

   **The full battery re-ran once more on the final tree `a4b57b5` (2026-09-16):** **A 54 passed (3.3m) ·
   B 67 passed (3.9m) · C 63 passed (4.0m) · D 38 passed (2.6m) · E1 36 passed (5.7m) · E2 31 passed
   (3.1m) · F 30 passed (3.3m) = 319 / 319**, zero failed, zero did-not-run, no further fix commits. `tsc`
   and `lint` were clean, **1404 unit / 79 files** all passed (unchanged — the fix wave's test assertions
   landed inside existing `stock-allocation.test.ts` cases, adding none), `npx prisma migrate status`
   reported **23 migrations**, schema up to date, `--list` confirmed **319 / 31 files**, unchanged. Port
   3100 carried no listening process before the first chunk, between any two chunks, or after the last,
   and `npm run db:seed` ran clean at the end. See plan `D-16`…`D-20`, "Measured at close", and HANDOVER
   (o) for the final review's findings and the fix wave.

   **Phase 23's Task 10 (2026-09-17) kept Phase 22's seven chunks exactly, adding this phase's two new
   files to the two chunks with the most headroom — `e2e/quick-forms.spec.ts` to D and
   `e2e/deadlines.spec.ts` to F — foreground, `E2E_PORT=3100`, `--workers=1`,
   `--global-timeout=540000`, on the final tree `09bf0a5`. THESE ARE THE CURRENT SEVEN; use them:**

   ```bash
   npx playwright test e2e/it-core.spec.ts e2e/import-export.spec.ts e2e/purchases.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/asset-classes.spec.ts e2e/department-owned.spec.ts e2e/auth-shell.spec.ts e2e/labels.spec.ts e2e/quick-login.spec.ts e2e/register-labels.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/offboarding.spec.ts e2e/receiving.spec.ts e2e/paging.spec.ts e2e/home-finance.spec.ts e2e/approvals-audit.spec.ts e2e/finance-registration-depreciation.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/admin.spec.ts e2e/direct-lifecycle.spec.ts e2e/scanner.spec.ts e2e/registration.spec.ts e2e/quick-forms.spec.ts e2e/leftovers.spec.ts e2e/queues-records-ux.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/custody.spec.ts e2e/axe-sweep.spec.ts e2e/kitchen-sink.spec.ts e2e/suppliers.spec.ts e2e/purchasing-ext.spec.ts e2e/employee-ux.spec.ts e2e/it-work-ux.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/stock.spec.ts e2e/stocktake.spec.ts e2e/stock-lots.spec.ts e2e/stock-reports.spec.ts e2e/activity.spec.ts e2e/back.spec.ts e2e/inventory-ux.spec.ts --workers=1 --global-timeout=540000
   npx playwright test e2e/transfers.spec.ts e2e/directory.spec.ts e2e/offboarding-v2.spec.ts e2e/it-gaps.spec.ts e2e/it-nav.spec.ts e2e/holds.spec.ts e2e/oversight.spec.ts e2e/rate-limit.spec.ts e2e/deadlines.spec.ts --workers=1 --global-timeout=540000
   ```

   **Phase 35 adds `e2e/finance-registration-depreciation.spec.ts` (12 cases) to chunk C** (the list above is
   the current one: 476 listed / 45 files). Chunks A, B, C, E1 and E2 carried exactly Phase 22's file composition at that time; D grows from 38 to 47
   and F from 30 to 39, both still far under the ~70-test cap Phase 22's spec §9.3 set. **Phase 24 kept
   all seven exactly as written above** — it added no e2e file, only three cases to
   `e2e/it-gaps.spec.ts`, so F moved from 39 to 42 and every other chunk's count was unchanged; that
   battery total was **340**. **Phase 25 kept all seven too**, adding its one new file
   `e2e/it-nav.spec.ts` (13 cases) to F — so F moved from 42 to **55**,
   every other chunk's count was unchanged, and that battery total was **353**, still inside the cap.
   **Phase 26 keeps all seven too**, adding its one new file `e2e/holds.spec.ts` (11 cases) to F —
   so F moved from 55 to **66**, every other chunk's count was unchanged,
   and that battery total was **364**, still inside the cap.
   **Phase 27 keeps all seven too, and is the first phase to grow a chunk other than F**: its one
   new file `e2e/activity.spec.ts` (7 cases) joins **E2**, the lightest chunk — shown in the E2 line
   above (plan P-6) — and the phase's other six new cases land in chunks already carrying their
   files (approvals-audit +1 in C, admin +3 in D, suppliers +1 in E1, stock +1 in E2). So C moves
   from 63 to **64**, D from 47 to **50**, E1 from 36 to **37**, E2 from 31 to **39**, F stays at
   **66**, and the battery total is **377**, still inside the cap.
   **Phase 28 keeps all seven too**, adding its one new file `e2e/back.spec.ts` (3 cases) to **E2**,
   again the lightest chunk — so E2 moves from 39 to **42**, every other chunk's count is unchanged,
   and the battery total is **380**, still inside the cap.
   **Phase 29 keeps all seven too**, adding its one new file `e2e/employee-ux.spec.ts` (9 cases) to
   E1 — so E1 moved from 37 to **46**, every other chunk's count was unchanged, and that battery
   total was **389** (final tree `9660e6e`, 2026-09-22).
   **Phase 30 keeps all seven too**, adding its one new file `e2e/inventory-ux.spec.ts` (13 cases) to
   E2 and new cases to existing files (it-core, back, registration) — the counts on the final tree
   `4e6fc7f` (2026-09-23) were A 58 · B 67 · C 64 · D 52 · E1 46 · E2 56 · F 66 = **409**.
   **Phase 34 keeps all seven too**, adding its one new file `e2e/register-labels.spec.ts` (17 cases) to
   **B** (shown in the B line above) — on the final tree `f7c4f70` (2026-10-15) the counts were
   A 58 · B 87 + 2 skipped · C 64 · D 70 · E1 61 · E2 56 · F 66 = **462 passed / 464 listed** (the 2 are
   `quick-login.spec.ts`'s on-only cases); D, E1 and F ran as two foreground halves each. See (aa).

   **A 54 passed (3.4m) · B 67 passed (5.8m) · C 63 passed (5.9m) · D 47 passed (4.7m) · E1 36 passed
   (8.9m) · E2 31 passed (4.1m) · F 39 passed (4.8m) = 337 / 337**, zero failed, zero did-not-run.
   `tsc` and `lint` were clean, **1476 unit / 82 files** all passed, `npx prisma migrate status`
   reported **24 migrations**, schema up to date, and `npx playwright test --list | tail -1` confirmed
   **`Total: 337 tests in 33 files`**, both before and after. Port 3100 carried no listening process
   before the first chunk, between any two chunks, or after the last, and `npm run db:seed` ran clean at
   the end. One test-only fix, `09bf0a5`: chunk B's first pass on `dbc93a0` was **64 passed, 2 failed,
   1 did not run**, reproduced identically on an immediate as-is re-run, and the two failures were one
   bug — `e2e/department-owned.spec.ts` case 9's duplicate create relied on the new-employee form's old
   auto-defaulted department, which this phase deliberately replaced with a blank "Choose a department",
   so the form was refused on "Pick a department" before the duplicate check; because that case sits in
   a `test.describe.serial`, its failure retires the worker and the file's `beforeAll` reseed runs again
   before case 11, leaving Purchasing Home reading Approvals 1 / Below reorder level 1 / Expiring within
   30 days 1, three exact matches for case 11's `getByRole("link", { name: "1", exact: true })`.
   **Worth memorising: a failing case inside `describe.serial` re-runs the file's `beforeAll` for
   whatever follows it, so a later case in the same file can fail on a freshly reseeded database rather
   than on anything of its own.** Chunk A was re-run on the final tree after the fix, so every number
   above is post-fix. See plan `D-1`…`D-20`, "Measured at close", and HANDOVER (p) for what shipped.

   **Phase 24's Task 6 (2026-09-17) ran the identical seven on the final tree `7601cab`: A 54 passed
   (3.4m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47 passed (3.5m) · E1 36 passed (5.7m) · E2 31
   passed (3.1m) · F 42 passed (4.4m) = 340 / 340**, zero failed, zero flaky, zero skipped, zero
   did-not-run — every chunk green on its first pass, no re-run and no fix commit anywhere in the
   battery. `tsc` and `lint` were clean, **1485 unit / 84 files** all passed, `npx prisma migrate
   status` reported **24 migrations**, schema up to date (this phase adds none), and
   `npx playwright test --list | tail -1` confirmed **`Total: 340 tests in 33 files`**. Port 3100
   carried no listening process before the first chunk, between any two chunks, or after the last, and
   `npm run db:seed` ran clean at the end. See plan `D-1`…`D-10`, "Measured at close", and HANDOVER (q)
   for what shipped.

   **Phase 26's Task 6 (2026-09-21) ran the same seven, with `e2e/holds.spec.ts` added to F, on the
   final tree `1442289`: A 54 passed (3.5m) · B 67 passed (3.9m) · C 63 passed (4.1m) · D 47
   passed (3.6m) · E1 36 passed (5.7m) · E2 31 passed (3.0m) · F 66 passed (6.6m) = 364 / 364**,
   zero failed, zero flaky, zero skipped, zero did-not-run — every chunk green on its first pass, no
   re-run and no fix commit anywhere in the battery. `tsc` and `lint` were clean, **1511 unit / 85
   files** all passed, `npx prisma migrate status` reported **25 migrations**, schema up to date
   (migration 25 `repair_end_and_holds` is this phase's), and `npx playwright test --list | tail -1`
   confirmed **`Total: 364 tests in 35 files`**. Port 3100 carried no listening process before the first
   chunk, between any two chunks, or after the last, and `npm run db:seed` ran clean at the end. See
   plan `D-1`…`D-10`, "Measured at close", and HANDOVER (s) for what shipped.

   Splitting is safe **because every spec file reseeds in its own `beforeAll`**. Say plainly what it
   costs: a split run does not prove the suite green in one process, and its compile-warmth profile
   differs — the axis every headroom failure in this project lives on.

   ⚠️ **`--global-timeout` is not a per-test timeout.** A run that hits it prints "N did not run" and
   exits, and its tail reads like a pass. **Check the count.**

   ⚠️ **NEVER background a Playwright run.** A Task 9 agent did, stalled, and left the controller
   guessing. An unreaped run races its own `beforeAll` reseed against yours.

   ⚠️ **NEW, and it cost a real failure: running the battery IN ORDER makes the e2e suite maximally
   cold.** `npm run build` and `next dev` share `.next` and their outputs are incompatible, so clearing
   `.next` after the build is the honest move — and then Playwright's dev server compiles every route
   from nothing. Under that, `it-core.spec.ts:126` failed on a 5s default. **The tell is worth
   memorising: `inventory/loading.tsx` renders only `Skeleton` divs, which carry no text and no roles,
   so an aria snapshot of a loading page is an EMPTY `main`.** Empty `main` means "waiting on a server
   render" — it is not a lost keypress (which would leave the server-rendered table in `main`) and not
   data drift. Fixed with headroom, **after** `git diff main..HEAD` proved the route's page and queries
   were byte-identical to `main`; that check is what separates headroom from a papered-over regression.
   If you clear `.next`, expect the first run to be slow and do not read slowness as breakage.

**Battery at this session's close — ALL GREEN, run in full on 2026-08-26:** `tsc` · `lint` · **797 unit
tests / 47 files** (5.1s) · `npm run build` · `docker compose --profile prod build` (**3** images —
`worker` now builds too) · **147 e2e / 12 files** in the four measured parts above. `labels` 9;
`scanner` 8; `axe-sweep` **6**. The axe sweep's moderate/minor tally, none serious or critical:
`empty-table-header` **9** · `page-has-heading-one` **2** · `landmark-unique` **1**.

---

## 1. What this project is

Building "Backroom IT — Inventory v2" from scratch for The Backroom Offshoring: an internal IT
asset-management app (purchase → assignment → repair → disposal) with an approval queue, an
append-only audit trail, four role-gated workspaces, and an offboarding wizard. **We are recreating
a high-fidelity HTML design prototype in a real Next.js codebase** — not porting the prototype's markup.

- **Repo:** github.com/neilluceromc/ChristianAuditing (**PUBLIC** — never commit secrets or `.env`)
- **Stack:** Next.js 15 App Router · PostgreSQL 16 (Docker) · Prisma 6 · Auth.js v5 · Tailwind v4 (CSS-var tokens)
- **Deploy:** single machine (the user's own device), one Docker Compose stack: `docker compose --profile prod up`
- **Machine:** Windows 11 · Node 24 · Docker Desktop · Postgres as container `inventory-db-1` (compose project `inventory`, loopback-only 127.0.0.1:5432)

## 2. How we work (follow this exactly — it is load-bearing, not ceremony)

One **plan per phase** under `docs/superpowers/plans/`, executed **subagent-driven**:

1. Write the phase plan with `superpowers:writing-plans` — bite-sized tasks, **full verbatim code in every step**, recorded scope decisions up front, entry criteria mapped to tasks.
2. Execute with `superpowers:subagent-driven-development`: **fresh implementer subagent per task** (paste the full task text into the prompt — never "go read the plan"), then review. Small/verbatim tasks get one fresh-eyes **spec review (sonnet)**; security-, concurrency- or logic-critical tasks get an **opus quality review**.
3. **The controller applies review fixes** for small, well-understood defects directly and verifies live in the Browser pane; larger fixes go back to an implementer subagent.
4. **Amend the plan doc whenever code deviates** (commit as `docs(plan): …`) so the plan never lies to a future reader.
5. Finish with `superpowers:finishing-a-development-branch` → merge to main, delete branch, push.

**Settled 2026-08-21: subagent-driven execution is the approved mode, and it is now exercised rather
than aspirational.** Tasks 8–10 of Phase 8 were done single-context (one agent implementing and
self-reviewing) because agent dispatch was gated in that session; the user lifted the gate for 11
onward. Tasks 11 and 12 ran the full loop — fresh implementer, spec-compliance review, quality review,
each reviewer re-reviewing after fixes — and **both turned up defects that types, lint and a fully green
unit suite could not see** (§6a rules 47 and 51). Two things learned about running it: a self-review is
structurally bad at catching unrequested scope, because the author has already justified it to
themselves; and **verify a reviewer's claims before acting on them** — one hinged on a nav table having
only three entries (true, and one grep to check), and the correct remedy for another was the opposite of
what it proposed.

**Models:** sonnet implementers and spec reviewers; opus for quality reviews of anything that moves
data or gates access. **Verbatim implementers transfer plan defects wholesale — the reviews are where
correctness actually comes from.** Across five phases they caught: a working auth bypass (`a%` in the
email field logging in as admin), a fail-open authorization default, a signup enumeration oracle, a
focus trap that never installed, a bulk transaction that would time out at its own documented cap,
phantom audit entries on every first edit of a seeded asset, ciphertext that wasn't bound to its row,
and an execution path that could strand an approval in APPROVED forever.

Phase 7 added three more, and all three were defects in the **plan** rather than the implementation —
which is the argument for reviewing the rule and not just the diff: a decision from a previous holding
that hid an item still needing collection; a wizard billing years-old returns to a farewell report; and
a completion gate that shared two thirds of the definition of "decided" while its comment claimed all of
it. None of the three could have been caught by the unit suite or by seed-based e2e, because no fixture
had a prior return — each was found by an opus reviewer asked "is the rule right?" rather than "does
this match the plan?". When a task is logic-critical, point the reviewer at the rule and give it the
domain facts (the unique index, what the execution plan guarantees, what the seed does and doesn't
contain) — and mutation-test the new tests once they're green, the way Phase 7's `decisionOf` suite
was: reversing a comparator and weakening a filter both passed the suite as written, and killing those
two mutations is what caught it.

**Recorded deviation from the skills:** work happens **in-place on a `phase-N-<name>` branch**, not a
git worktree — the repo root IS the app root and this is a single workstream. Commit style
`feat(scope): …` / `fix(scope): …` / `docs(plan): …`, co-author trailer
`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## 3. Environment / how to run

- **DB:** `docker compose up -d db`. Seed: `npm run db:seed` (TRUNCATE + reseed — the sanctioned reset; **`prisma migrate reset` is blocked by the harness classifier and unnecessary**). **`npm run db:seed` is SOMETIMES blocked by the classifier when run directly** — it was during Phase 8 Task 3, and it was not during Task 13, which ran it twice. Try it; if it is refused, run it from your own terminal or let Playwright do it (every spec reseeds via `execSync` in `beforeAll`, which is never blocked). **8 migrations** as of Phase 8 Task 9 (7 at the Phase 7 merge); add new ones as hand-written SQL dirs, then `npx prisma migrate deploy && npx prisma generate` (`migrate dev` also works but invents a name). **A reseed TRUNCATEs, so a migration's backfill does not survive it** — anything the app depends on has to be set by `prisma/seed.ts` too (`Employee.offboardingAt` is set both ways for exactly this reason).
- **Dev app:** never via Bash — use the Browser-pane preview (`preview_start` name `app-dev`, port 3000). The controller owns this server; subagents must not start one.
- **Worker:** `npm run worker` (poll loop) or `npm run worker:once` (drain and exit — what e2e uses). In prod it's the compose `worker` service.
- **NEVER run `npm run build` while a dev server is running** — they share `.next` and it bricks the dev server.
- **Full battery:** `npx tsc --noEmit && npm run lint && npm run test && npm run build`, then `docker compose --profile prod build` to prove the production image, then the e2e suite. **The e2e half no longer fits one command** — **187 tests across 14 files** as of Phase 13 Task 12 (167 across 13 files at Phase 12's close, 147 across 12 files at Phase 10 Task 9, 123 at Phase 9's close, 8.2 minutes at Phase 9 Task 10, ~5 when this line was first written). **The split (now FIVE parts, 187 tests across 14 files — part 3 now includes `asset-classes.spec.ts`) and the reasoning are in §0 item 9; use those commands.** Whatever you do, **run Playwright in the foreground.** A backgrounded run that is never reaped keeps its own `beforeAll` reseed racing yours, which produces FK/unique errors and a cascade of unrelated timeouts in specs that pass in isolation — diagnose by listing live `node.exe` command lines, not by editing assertions.
- **Seeded accounts** (all `@thebackroomop.com`): `admin@` (admin, permanent) · `it@` (it_staff) · `purchasing@` (purchasing_staff) · `finance@` (finance_staff) · `viewer@` (viewer). **The password is `SEED_PASSWORD` in `prisma/fixtures.ts` — one owner, imported by `prisma/seed.ts` and by every e2e `login` helper.** It was `ChangeMe123!` hardcoded in fourteen places until 2026-08-24; the user changed it to **`admin123`** for their own local deployment. **Do not hardcode it anywhere** (rules 26/37/38) — a missed copy fails as "wrong email or password", not as the edit it was. **And note the asymmetry:** `signupUser` refuses anything under **10 characters**, so the seeded value is one the app's own signup would reject. Sign-in is unaffected (`authorize` does a plain `bcrypt.compare` with no length rule, which is the right place for that asymmetry — a policy change must never lock out existing accounts), but do not read `SEED_PASSWORD` as evidence of what the policy permits, and do not reuse it as the fixture for a signup test.
- **Seed contents:** **25 assets** (all 8 statuses; **not one of them has a `serial` — `count(serial)` is 0, and `prisma/seed.ts` never sets one**, which is why Phase 9 Task 13's duplicate-serial fixture had to be built by the importer itself rather than taken from the seed), 10 employees (one equipment policy, "Finance standard", targeting the Finance department — so **three** employees currently have policy gaps: EMP-0042, EMP-0088, EMP-0097. Marites EMP-0042 holds 4 items against that policy and is short **1** required slot; do not read her "1 gap" as the seed's total, which is what misled a Phase 9 task; Dennis EMP-0090 is OFFBOARDING; Nina EMP-0097 has a reserved monitor), 7 approvals (all 6 states; APR-2040 past SLA → badge reads "3, urgent"; APR-2035 is APPROVED with a **deliberately malformed payload** + a queued job — the worker's EXECUTION_FAILED demo), 5 PRs (one per state; **PR-0198 is the bounce-back with a three-party note thread**, still the fixture the purchasing e2e leans on; `purchase_request_ref_seq` sits at 201 so the first drafted ref is PR-0202), 4 reservations. **As of Phase 8 Task 12: 2 `WebhookEndpoint` rows** (`hooks.thebackroomop.com/inventory`
active, subscribed to `approval.executed` + `offboarding.completed`; `legacy.thebackroomop.com/erp-bridge`
**disabled**, subscribed to `purchase_request.completed` — so "disabled" is a real state on the list) with
their secrets AES-GCM encrypted under `secretAad(row.id)`, **and 5 `WebhookDelivery` rows** spread so every
chip `deliveryStage` can produce is reachable: 2 `DELIVERED`, 1 `RETRYING · 2/5` (with a real
`nextAttemptAt`), 2 `DEAD · 5/5`. **No `DELIVER_WEBHOOK` `Job` rows, deliberately** — a queued one would
make `worker:once` POST to a hostname that does not resolve on every seeded run. Dennis
EMP-0090 holds `BR-LT-0166` / `BR-PH-0312` / `BR-HS-0510` — the three items the offboarding wizard and
the farewell-sheet e2e both drive — and every non-ACTIVE employee carries `offboardingAt = day(-3)`.
(This sentence used to begin "On the Phase 7 branch"; that branch is deleted and its seed is now the
only seed, so the qualifier was stale and is dropped.)

## 4. What's DONE (Phases 1–9 on `main`; ALL of Phase 10 on `phase-10-polish`)

**Phase 1 — Foundation:** design tokens (light/dark, motion, reduced-motion kill switch); six-family
status system (`src/lib/status.ts`; `MISSING` is the 8th AssetStatus → fault); full Prisma schema
(append-only triggers on AuditEntry/NoteEntry, partial uniques, refNo sequences); seed; ~34 UI
primitives in `src/components/ui/`; `/dev/kitchen-sink` (404s in prod).

**Phase 2 — Auth + Shell:** Auth.js v5 (credentials; Entra registered only when fully configured);
**three-layer authorization** — edge middleware (JWT-only) → DB-backed `requireUser`/`requireRole` →
UI nav filtering, all from one truth module (`src/lib/workspaces.ts`, default-deny path gating);
login/signup/bootstrap; four workspace sidebars + switcher + topbar + mobile drawer + ⌘K palette;
cookie-driven SSR theme/density/workspace.

**Phase 3 — IT core** (`docs/superpowers/plans/2026-08-16-phase-3-it-core.md`): the full `/inventory`
surface (facets/sort/chips/bulk-select → approval-creating bulk drawer/CSV export/column prefs; new;
record with Overview/History/Timeline/Documents/Secrets/Reservations; edit), the full `/employees`
surface (Items+Loadout columns, **the loadout view**, edit with M365 canonical+custom, timeline,
printable accountability form), reference-data CRUD ×3.

**Phase 4 — Approvals + audit** (`docs/superpowers/plans/2026-08-17-phase-4-approvals-audit.md`): the
claim-based queue (five tabs, J/K/C/A/R/E + screen-reader live region), the detail page (live system
checks, Approve-only-after-claim, background-pending + EXECUTION_FAILED cards with verbatim worker
errors, Retry), **the worker** (atomic `FOR UPDATE SKIP LOCKED` lease, stale recovery, `--once`,
per-type live re-validation inside the execution tx, state-guarded terminal writes, catch-all →
EXECUTION_FAILED so nothing strands in APPROVED), `/audit` (zero row actions by design), and the
ActivityFeed renderer powering the two scoped feeds.

**Phase 5 — Purchasing** (`docs/superpowers/plans/2026-08-17-phase-5-purchasing.md`): the three-party handoff made real —
`purchaseTransition` (brief §6.1, pure + TDD) driving six state-guarded server actions, each appending a **NoteEntry**
in the same transaction; `/purchases` (tabs write `?state=`, dwell second line under State), `/purchases/new` +
`/purchases/[id]/edit` (multi-unit editable rows, autosaved DRAFT created by the first save, "add from a policy
loadout", centavo-safe prices), `/purchases/[id]` (**the bounce-back**: red-left-bordered banner naming who sent it
back with the verbatim reason and `IT_REVIEWED → SUBMITTED · nothing was cleared`, a 4-stop stepper whose return path
is a dashed "← sent back" connector, `NOW · 2nd time`, per-unit states, the IT slot editor and Finance unit editor
inline), and `/purchases/activity`. **IT gained access to `/purchases`** — brief §6.1 makes IT the second party, and
`it-review`/`it-reject` were otherwise unreachable for `it_staff` (see §7).

**Phase 6 — Finance + Home** (`docs/superpowers/plans/2026-08-17-phase-6-finance-home.md`): the role-aware
dashboards. Every section loads through `safeSection` and renders through `SectionCard`, so one failing query
shows the designed FAILED card while the rest of the page renders. IT Home has **no KPI row** — "Your shift"
(5 rows ordered by what breaks first, each clearable for the rest of the day via a `UserPreference`), Claimed-by-you
above the pool, the Fleet bar with its coverage line, the 5-bucket Age histogram, and the Warranty runway that
marks two identical laptops expiring the same week. Purchasing Home leads with a to-do list and spend; **Finance
Home leads with money and age**; Viewer gets the same layout minus the queue. Focus mode is the `br.focus` cookie.
Plus `/finance/assets` (the capitalized register with value columns) and `/finance/activity` (the one cross-domain
scoped feed, so the only one showing the domain pill).

**Phase 7 — offboarding + repairs + policies (COMPLETE, 15/15 tasks committed on the unmerged
`phase-7-offboarding`).** Everything below is done and reviewed:

- **`lifecycle.return` learned four outcomes** (`SPARE | DEFECTIVE | BUYOUT | MISSING`, always clearing
  the holder) so the wizard's Defective / Buyout / Missing decisions execute instead of dying as
  `EXECUTION_FAILED`. Widening the producer meant fixing its two READERS as well: the queue's change-cell
  summary and the approval detail's "Return target" check both had `SPARE` hard-coded.
- **`src/lib/offboarding.ts`** — the phase's vocabulary and rules, pure and TDD'd: `OUTCOMES` /
  `OUTCOME_STATUS` / `reasonRequired`, the four `WIZARD_STEPS` + `parseStep`, `canContinue`,
  `reportTotals`, and the derivation trio `outcomeOfStatus` / `returnTargetStatus` / `decisionOf`.
- **`Employee.offboardingAt`** (migration `20260818090000_employee_offboarding_anchor`) — the anchor that
  makes "this offboarding" a real window. Stamped by `updateEmployee` when employment enters
  `OFFBOARDING`, cleared on a return to `ACTIVE`, kept once `OFFBOARDED` so the report stays readable.
- **`src/server/modules/offboarding/queries.ts`** — `listOffboarding` (the queue) and `getWizard`
  (everything one wizard needs, including the policy slots via the Phase 3 `computeLoadout`), sharing one
  windowed derivation through the exported `candidatesFor`.
- **`src/server/modules/offboarding/actions.ts`** — `decideItem` (one approval per decision,
  immediately), `closeAccounts` (guarded partial update of `m365Status`), `completeOffboarding`
  (person-only; refuses while anything is undecided, while any return sits `EXECUTION_FAILED`, or while
  the M365 account is still live).
- The seed's offboarding fixture **holds equipment**: Dennis Ong EMP-0090 now has `BR-LT-0166` (₱48,000),
  `BR-PH-0312` (₱18,000) and `BR-HS-0510` (₱5,500). Fleet 22 → 25, which moved two Home assertions.
- **`/offboarding`** (the queue) and **`/offboarding/[employeeId]`** (the 4-step wizard), plus the four
  components they render and Home's `LEAVE` row pointing at the wizard. Walked end to end against the
  seed: a reasonless MISSING is refused inline by the server, three decisions produce `APR-2042/3/4`,
  the report totals ₱53,500 / ₱18,000 / ₱0, and completion writes an `offboarding.completed` audit
  entry carrying the decision set.
- **`SegmentedControl` can hold no value** — the `Math.max(0, …)` clamp is gone and the indicator is
  not rendered at `-1`, so an undecided item cannot read as "Returned". Verified in the DOM (no radio
  checked, no indicator) and at the three pre-existing call sites, which all still slide normally.
- **`/offboarding/[employeeId]/report`** — the printable farewell sheet (scope decision #9): light-only
  hardcoded hex so it prints the same in dark mode, `PrintButton`, the decided-items table, the three
  totals, acknowledgement, signature blocks. A MISSING item with no cost on record adds ₱0 to
  `totals.lost` while still counting in `counts.MISSING`, so the sheet says that loss is unknown
  rather than zero.
- **`Th` forwards `aria-label`.** It destructured a fixed prop set and never spread, so the prop four
  call sites passed was silently dropped — and the compiler stayed quiet because every prop in the
  type is optional, making it a *weak type* and relaxing the excess-property check. Three of those
  four call sites predate Phase 7.
- **The repairs brain** (`src/lib/repairs.ts`, TDD, 21 tests): four stages derived from fields that
  already existed — `to-assess` / `at-vendor` / `returned-ok` / `beyond-repair` — plus `downDays`,
  `quoteWarning`, `isRepairView`, and `withRepairStage` (a stage chip clears the `status` pin it
  cannot coexist with). `beyondRepair` compares **whole centavos**, not floats. The `stage` facet
  narrows SQL to the repair candidate set; `repairStage()` made the final cut in memory — **Phase 20
  moved that cut into SQL as `REPAIR_STAGE_CASE_SQL`/`repairStageIds`, and Phase 24 has `listAssets`
  page the resulting id set through `pagedSnapshot`, so no part of the repairs list resolves in memory
  any more.** Two seed
  fixtures were added so `beyond-repair` and `returned-ok` are reachable at all, and the worker now
  stamps `defectiveSince` when an asset **enters** DEFECTIVE (audited).
- **Repair mode on `/inventory`**: Stage + Down columns (repair-only, never offered to the column
  chooser), the stage chip row, the write-off warning on the record, and the `HOLD` marker for
  reserved-but-SPARE stock. `repairStageIds()` gives the bulk action and the CSV export the **same**
  cut the screen shows — a SQL candidate set is not safe to act on. One exported `stageOf()` owns the
  row→stage marshalling for all three call sites.
- **`/reservations`** — the cross-asset hold list (scope decision #10 made it read-only; **Phase 26
  gave it Release, a search box, Employee and Department facets, four sortable headers and whole-row
  click, and holds are now placed from the asset record or a person's profile and released there or
  here**): three tabs writing
  `?state=`, a "Reads" column proving a hold never moved the asset's status, and EXPIRED (the clock)
  kept visibly distinct from RELEASED (a person), each with its own date.
- **`/admin/equipment-policies`** — create/delete policies (exactly one of a role title or a
  department, never both — role wins when both would otherwise match), inline slot chips (solid =
  required, grey = optional) with click-to-add and click-to-toggle, and an audit trail that records
  the **whole slot list before and after** every change (`auditSlots` in
  `src/server/modules/admin/policy-actions.ts`) rather than just the one slot touched — a policy edit
  changes what counts as complete from that moment on and touches no existing assignment, so the
  before/after lists are the only way the change reads back afterward. `createPolicy` requires a
  slot to name an asset type (a typeless slot could never be filled by `computeLoadout`) and requires
  the policy to target exactly one of title or department. Every `equipmentPolicy.findMany` that
  feeds `resolvePolicy` (employees, home ×2, offboarding, purchases, this page) now orders by name, so
  which policy wins a tie is at least stable — see §8 for what that does and doesn't fix.
- **`e2e/offboarding.spec.ts`** — 14 tests, the first time any of the three Phase 7 surfaces (or
  repair mode, unreachable before this) were driven by a real browser rather than fetched HTML. It
  walks the wizard end to end through the worker (a Missing return now executing to MISSING instead
  of `EXECUTION_FAILED` is the Task 1 payoff, confirmed live), proves the server gate refuses
  completion when an item is blocked by a pre-window approval — the `candidatesFor`/`blockedBy`
  regression a review caught mid-phase, now covered live rather than only in the unit suite — and
  covers the viewer read-only path on the policies page. Running it for real found four bugs in
  the spec itself (two navigation races, two helper functions declared in the wrong closure) and one
  real product bug: the wizard's locked step-bar entries rendered at 2.4:1 contrast (`text-fg-faint`
  on canvas), which axe flags as serious — fixed to `text-fg-muted`, the token the reachable steps
  already used.

**Phase 10 — polish (COMPLETE, all 11 tasks, MERGED to `main` as `--no-ff` `bd78813`)**

- **T1 · `src/lib/code128.ts`** — a hand-rolled Code 128-B encoder, no dependency. Pure module widths;
  knows nothing of millimetres, SVG or assets. Its table was verified against an independent
  from-first-principles enumeration of the legal pattern space, and its checksum is pinned by a
  hand-computed vector — because weighting it from the wrong end left all 8 tests green.
- **T2 · `src/lib/label-geometry.ts`** — A4/grid constants, `labelPages`, and `barcodeFit`, which is
  **total by construction**: `encodable` is the renderer's single guard and covers every reason the
  encoder would refuse, so one bad tag degrades one label instead of 500ing a 200-label sheet.
- **T3 · `src/components/inventory/label-sheet.tsx` + `/inventory/labels`** — the printable 3×4 A4
  sheet. Real inline-SVG barcodes, a **100 mm calibration ruler** (measured at 377.94 px = 100.00 mm on
  screen, under print emulation, and in a generated PDF), and a named `@page` so the two pre-existing
  print surfaces keep their margins. `PrintButton` moved to `components/ui/` on its third caller.
- **T4 · the gate and the entry point** — a `PATH_RULES` entry for `/inventory/labels` **before** the
  general `/inventory` rule (which admits purchasing and finance), a "Print labels" link in the bulk
  drawer for an explicit selection only, and `e2e/labels.spec.ts` (15 tests) which **measures** the bar,
  the page box and the two-sheet break rather than asserting visibility.
- **T5 · `src/lib/scan.ts`** — the pure four-way scan verdict (`match` / `unknown` / `already-decided` /
  `blocked`, plus `ignored`), over a minimal structural `ScanItem` rather than the wizard's own type.
- **T6 · the scanner wiring** — `ScanProvider` (a document keydown buffer, a focus guard, a `{tag,
  nonce}` context, and a banner for every verdict) plus `ItemDecision` reacting to its own tag. A scan
  scrolls, highlights, focuses the **card container** (not the Confirm button — an operator's stray
  Enter on an empty buffer would otherwise file an approval nobody clicked), preselects `RETURNED`,
  clears the previous reason, **and writes nothing**. Step 0 hoisted `cellText`/`refKey`/`tagKey` into
  `src/lib/tag-key.ts` so the client bundle stops carrying 873 lines of sheet parsing.
- **T7 · `e2e/scanner.spec.ts`** (8 tests) — every verdict including a **manufactured** blocker (the
  seed cannot produce one), the guard asserted in **both** directions, and "writes nothing" proved by a
  Prisma count delta rather than the absence of a toast.
- **T8 · the two known moderates** — `CardHeader` is an `h2` (measured: `/` went 1 → 0 heading-order
  violations), and `SegmentedControl` announces its error. Fifteen e2e assertions hard-coded `level: 3`
  and had to move with it.
- **T9 · `e2e/axe-sweep.spec.ts`** — 46 of 47 page routes, grouped by lowest-privilege role, each
  asserting it **landed** on the intended path before scanning. Found **four serious violations on
  routes no spec had ever visited**: an `aria-label` on a role-less `<span>`, a 2.57:1 footer, 1.71–1.93:1
  history cells, and colour-only links in prose. Moderates counted, not fixed (§8).

- **T10 · `README.md`, executed rather than written** — the public face of a public repo, proven from a
  fresh clone: the production path (build → `up -d` → `migrate` exit 0 → seed inside the `web` container
  → a real Auth.js credentials POST returning `{"role":"admin"}`) and the dev path (`npm ci` →
  `prisma generate` → `migrate deploy` → seed → `worker:once` → `npm run dev` → `/login` 200), both
  under a throwaway compose project. **Execution found three things prose could not:** a `/` in a
  base64 `POSTGRES_PASSWORD` breaks the unescaped container `DATABASE_URL` (`P1013`, `migrate` exits 1)
  in ~40% of generated passwords; the plan's own dev quickstart could not run from a clean clone; and
  `npm ci` alone leaves `@prisma/client` ungenerated despite the postinstall hook existing.
- **T10b · the two compose fixes T10 uncovered** — `web` bind-mounts `./uploads:/app/uploads`, and
  `worker` declares `build: .`. Verified by writing as uid 1000 into the mount and surviving a
  `--force-recreate`, and by `build` reporting three images where it had reported two. README moved in
  the same commit, because the fix falsified its own caveat.
- **T11 · the battery, green in full** — `tsc` · `lint` · 797 unit · `npm run build` ·
  `docker compose --profile prod build` · 147 e2e in four measured parts. One failure, diagnosed and
  fixed with headroom **after** proving the route was byte-identical to `main` (§6a rules 90 and 91).

**What remains is not code: the physical print-and-measure (§0 item 4a), and the merge and push
decisions, which are the user's.**

**The number worth carrying out of this phase.** **Forty-four defects across eleven tasks, twenty of
them in the plan rather than the implementations**, and **not one would have failed a green suite**.
Five were findable only by rendering the thing and measuring it — and Task 10 added a sixth category:
**three findable only by RUNNING the documentation**, including a password character that breaks the
deployment outright. The reviews, not the implementations, are again where correctness came from —
see §0 item 7. **Task 10's own lesson generalises past documentation: prose about a system is a claim
about the system, and the only thing that tests it is execution.**

**Phase 9 — import / export (COMPLETE, all 14 tasks, MERGED to `main` as `7284c10`)**

**THE IMPORT CHAIN IS COMPLETE, from uploaded file to written row, on two entities.** Read it in order,
because each stage exists to make the next one honest:

- **T7 · the pure rules** — `src/lib/import-vocabulary.ts` (22+ block causes, 6 `ImportOption`s,
  `groupByCause`, `blockSpec`, `IMPORT_OPTIONS`, the 2,000-row cap) and `src/lib/import-assets.ts`
  (`matchHeaders`, `planAssetRows`, and the shared key rules `refKey` / `cellText` / `tagKey`). No I/O,
  no Prisma, no `next/*` — every rule testable with plain arrays, which is scope decision 2's whole
  purpose.
- **T8 · `src/server/import/read-sheet.ts`** — `readGrid`, the **only** `read-excel-file` import in the
  app, schema-less because the library's schema mode returns *either* objects *or* errors and so cannot
  express partial success.
- **T9 · `src/server/modules/import/{resolve,asset-actions}.ts`** — `buildAssetRefs` (pure, tested) and
  `planAssetImport`, the dry run that **writes nothing**.
- **T10 · `applyAssetImport`** — one transaction per row, re-planned from the FILE rather than the
  browser's plan, diff-before-write, `unchanged` as a first-class verdict, classified per-row failures.
- **T11 · `/inventory/import`** — Upload → Validate → Results, blocked rows grouped by cause with one
  fix each, a fix that re-plans and never writes.
- **T12 · `/employees/import`** — the same chain on `Employee`, sharing the vocabulary, the wizard, the
  key rules and the date convention rather than mirroring them.
- **T13 · `e2e/import-export.spec.ts`** — 21 tests over both halves plus all four export routes, and
  `e2e/fixtures/make.ts` with its ten generated `.xlsx` files. Script and output both committed: every
  sheet is written by `toXlsxBuffer` through the app's own export column specs, so each is a file this
  application could genuinely have produced — which matters because the flagship workflow is
  re-uploading an unedited export, a shape no hand-built fixture holds.

**Three scope decisions were added mid-phase and they are the load-bearing ones.** **13:** an import may
set `status`/`assignee` on CREATE and never moves them on UPDATE — everywhere else those route through
the approval queue, and a spreadsheet must not be the only surface that can flip 500 assets with no
approval, no SLA and no trail. **14:** every block cause offers a fix the operator can act on *inside
the wizard* — a screen we have → a link, a decision → an `ImportOption`, the sheet itself → the
`reupload` kind. This exists because `unknown-vendor` shipped linking to `/admin/vendors`, **which does
not exist**, and nothing in this app can create a `Vendor` at all. **15:** the employee half stamps
`offboardingAt` by `updateEmployee`'s own three-branch rule on create and blocks an employment change on
update, because that column bounds "this offboarding" for every farewell report.

**Facts about this feature that are easy to get wrong and expensive to rediscover:**

- **The date convention is MEASURED, not inferred.** `readSheet` returns a `Date` at **UTC midnight** —
  identical under Manila, New York and UTC — so `parseDateCell` reads **UTC** fields. Three review rounds
  reasoned their way to the opposite convention; fifteen lines of probe settled it. Don't swap those
  getters without re-running it (§8).
- **The plan has no `unchanged` bucket and cannot have one.** `AssetPlan.counts` is
  `{create, update, blocked}`; a no-op is only discoverable at write time by `assetDiff`. Any comparison
  of approved-vs-actual must reconstruct `created + updated + unchanged + failed`.
- **`AssetUpdatePatch` distinguishes an absent key (leave it alone) from `null` (clear it).** Collapsing
  those is a destructive write on every trimmed re-upload; it was caught twice, in two different forms.
- **Re-uploading an unedited export writes nothing at all** — zero rows, zero audit entries, no
  `updatedAt` movement. **T13 now asserts this in a spec that survives**, all three legs separately
  (audit delta 0, no `updatedAt` moved, and the Results step saying "already matched" rather than
  reporting zeros as if something failed). Three throwaway harnesses had proved it and all three were
  deleted; each leg was then mutation-tested, because a passing assertion is not a live one.
- **`AuditEntry` is append-only by DATABASE TRIGGER** — `DELETE` raises. Verification that writes must
  restore with `pg_dump` / `pg_restore --clean --if-exists`, not by cleaning up rows.
- **A full-cap apply is ~15 s** for the write loop alone, and the action re-plans the whole file
  internally first, so the wall clock is higher.

**What this phase cost, and why the reviews are the answer.** Fourteen tasks, **fourteen plans wrong in a
way that would have shipped a defect** — including Task 13's, whose own pre-execution amendment was
itself incomplete (removing the impossible serial fixture left the mixed file with one block cause, so
"grouped biggest-first" became unassertable, which the amendment did not notice). Task 7 took three rounds and ten fixes *after* passing a
byte-for-byte spec-compliance review — which is the sharpest available demonstration that a spec review
and a quality review are different instruments (§6a rule 70). The defects that mattered were almost never
in the transcription: they were rules that disagreed with `schema.prisma`, `asset-rules.ts` or
`actions.ts` — three files the plan's author never opened.

**Phase 8 — Admin workspace (COMPLETE, all 14 tasks, MERGED to `main` as `e5a5730`)**
(`docs/superpowers/plans/2026-08-19-phase-8-admin.md`): the user rules and the two mutations behind
them. **Task 1** — `src/lib/admin-users.ts` + tests: `ROLE_OPTIONS` / `ROLE_LABELS`, and the pure rules
`lockReason` / `roleChange` / `disableChange`, with the permanent admin locked against **both** role and
`disabled`. **Task 2** — `setUserRole` / `setUserDisabled` in `src/server/modules/admin/user-actions.ts`,
**the first code anywhere in this repo that writes `User.role` or `User.disabled`**, plus
`selfRoleChangeWarning` (added by review) and the shared `asActionResult` in `src/server/prisma-errors.ts`.
`/audit` can now name a `user` row (`name · email` → `/admin/users`) instead of printing a truncated cuid.
**Task 3** — `/admin/users` itself: the permanent admin as a `LOCKED` chip with its reason in a caption,
role selects per row, a confirm dialog before a self role change, the artboard's `Workspaces` column
(`roleWorkspaces()`), avatars, and the actor's own row stating `Your own account` instead of a
Disable button that could only fail. Also `aria-describedby` on the shared `Dialog` primitive.
**Task 4** — `src/lib/admin-flags.ts` + tests, the feature-flag allowlist: `FLAG_SPECS`, `specFor`,
`FlagState`, `flagChange(state, next)`, `flagChangeWarning(state, next)` and `domainValue`, with
`m365_sso` refused ON but permitted OFF, and `allowed_domain` refused ON without a value. Plus
`flagDomain()` in `src/lib/auth-shared.ts`, now the single effective-value expression for all four
readers of that flag.
**Task 5** — `setFlag` / `setFlagValue`, `listFlags`, `/admin/flags` and `FlagRows`: two switch cards, a
value editor for `allowed_domain`, a confirm dialog before the direction that opens signup to anyone, a
stated reason on any switch the rule won't move, and the `feature-flag` branch in `entityLabels` so the
log can name the flag it changed. Review fixes deliberately left unsquashed so the verdicts stay
legible: `c699743` + `d29ce9b`; `28e21ba` + `4b112cd`; `5d8e819` + `8a604df`;
`cc43421` + `3ae53d2` + `e3191a2` + `3b158df`; `ce275c1` + `3157a5c` + `aaca261`;
`5c4ab33` + `093a209`.
**Task 6** — the webhook vocabulary, and the first code of the phase's second half: `src/lib/webhooks.ts`
(`WEBHOOK_EVENTS`, `EVENT_LABELS`, `partitionEvents`/`parseEvents`, `webhookEnvelope`, `deliveryStage`),
`src/lib/jobs.ts` (`MAX_JOB_ATTEMPTS`, now the repo's only `5` — the worker imports it), the `"delivery"`
namespace and `JobStatus` families in `src/lib/status.ts`, and `src/server/webhooks/sign.ts` — the only
file in the feature allowed to touch `node:crypto`, signing `t=<seconds>,v1=<hex>` over `"t.body"`.
**Task 7** — the endpoint actions in `src/server/modules/admin/webhook-actions.ts`:
`createEndpoint` / `rotateSecret` / `updateEndpoint` / `setEndpointActive` / `deleteEndpoint`, with the
signing secret **AES-256-GCM encrypted under an AAD bound to its own row** (`secretAad`) and returned in
plaintext exactly once, `urlSchema`'s metadata-host refusal, `removeUnknown` so an unrecognised
subscription is never deleted by inference, and `listEndpoints`' explicit `select` keeping the ciphertext
out of the RSC payload. Also the `webhook-endpoint` branches in `entityLabels` and `AUDIT_ENTITY_TYPES`.
**Task 8** — `/admin/webhooks` and `src/components/admin/endpoint-editor.tsx`: the endpoint list, the
shown-once secret banner, per-endpoint URL/events editing, the ⋯ menu (disable/enable, rotate behind a
dialog stating `ROTATION_WARNING`, delete), and the banner that names subscriptions this build no longer
sends with one explicit removal. Added `deleteBlockedReason` to `src/lib/webhooks.ts` (the phase's third
one-string-two-surfaces rule) and **moved `SIGNATURE_HEADER` there from `src/server/webhooks/sign.ts`**,
which a client component cannot import. Review fixes for Tasks 6–8, unsquashed:
`5c4ab33` + `093a209`; `cc13bf5` + `df7a9a8` + `e90b277`; `4b26385`.
**Task 9** — `emitWebhook` in `src/server/webhooks/emit.ts`, the only producer of `DELIVER_WEBHOOK`
jobs: no I/O, called inside the transaction that writes the domain change, writing one `WebhookDelivery`
(the ledger) plus one `Job` (the retry engine) per **active, subscribed** endpoint. Wired into
`executeApproval` (worker-side, relative import), `completeOffboarding` and `runTransition`'s `complete`
branch. Plus the phase's one migration: `Job_one_live_deliver_per_delivery` **and**
`Job_deliver_payload_shape`, the pair that together mean "at most one live job per delivery" while still
letting Replay re-enqueue a terminal one.
**Task 10** — `src/worker/deliver-webhook.ts`, the first outbound network request in this project.
One attempt per job: signs the exact bytes it POSTs (`t=<seconds>,v1=<hex>` over `` `${t}.${body}` ``),
**`redirect: "manual"`** so an approved receiver cannot bounce the signed body to a host nobody approved,
`AbortSignal.timeout(10s)`, and a classification of permanent (3xx, 4xx except 408/429, disabled
endpoint, undecryptable secret, missing row) versus retryable (everything else). Never reads a response
body — status and statusText only, which is what keeps the SSRF capability a blind oracle. The worker's
`tick()` still owns backoff and the cap; the handler's job is the ledger, and `retryStatus()` is what
makes it agree with the job on the final attempt as well as the earlier ones.
**The pipeline is COMPLETE, and as of Task 13 it is READ**: Task 12 added the fixtures, Task 13
`/admin/webhooks/deliveries`.
**Task 11** — the Admin Home: `adminHome()` in `queries.ts`, `AdminHomeBody` in
`src/components/home/admin-home.tsx`, and an `admin` branch in `src/app/(app)/page.tsx` above the other
workspaces. Four stat tiles then three lists — who can get in, what is switched on, integrations — each
linking to its own admin page. Also **`flagEnabled(spec, row)` in `src/lib/admin-flags.ts`**, now the
single expression for a flag's EFFECTIVE on/off state, which `listFlags` and `adminHome` both call, and
**`SHOWS_FOCUS_TOGGLE` in `page.tsx`**, so the Focus button is not offered on a Home with nothing to
collapse. First task executed properly subagent-driven; both reviews found real defects.
**Task 12** — the seed fixtures: 2 endpoints (one disabled) with encrypted secrets, and 5 deliveries
spread across every chip `deliveryStage` can render, including the `DEAD · 5/5` row the design's Replay
control exists for. No `DELIVER_WEBHOOK` jobs — a deliberate absence that turned out to hide the defect
§6a rule 56 describes, because with no live jobs every Replay works against seeded data.
`/admin/webhooks/deliveries` is reachable against a fresh database — which it had to be before Task 13
built it.

**Task 13** — `/admin/webhooks/deliveries` and `src/components/admin/delivery-table.tsx`: the delivery
ledger with `DEAD · 5/5` chips (`deliveryStage`, denominator defaulted to the worker's
`MAX_JOB_ATTEMPTS`, coloured through `statusFamily(status, "delivery")`), four `?state=` tabs, a per-row
Replay and a batch "Replay N dead-lettered". Plus `replayDelivery` / `replayAllDead` in
`webhook-actions.ts` (reset-not-resume per scope decision #11, `lastError` kept deliberately,
`nextAttemptAt` cleared, P2002 from `Job_one_live_deliver_per_delivery` as a designed refusal, and an
audit diff of `status`/`attempts` only), `listDeliveries` in `queries.ts`, and **two new pieces of
vocabulary in `src/lib/webhooks.ts`**: `DELIVERY_TABS`/`parseDeliveryTab` (labels and status groups on
the entry, so the page has no second list) and `replayBlockedReason` — the single owner of the three
replay refusals, which the action refuses with and the query renders `replayable` from. 14 unit tests.
Verified in a real browser against a real database, including the click, the refusal-by-absence
afterwards, `worker:once` producing `RETRYING · 1/5`, and the audit row. `5394a8a`.

**Task 14** — `e2e/admin.spec.ts`, 12 tests, the only protection any `/admin/*` route has: the
permanent admin's lock stated before the click (and its affordances ABSENT, not disabled), an ordinary
role change resolved to a NAME on `/audit`, a disable that then blocks sign-in, **a no-op save that
writes no audit entry** and **a self role change that warns naming the incoming role, signs the actor
out, and lets them back in with the new role** — the last two are the behaviours Task 2's review said
were the whole reason this spec exists, and the plan's own draft had omitted both. Plus the flags
allowlist, the shown-once secret, the no-events refusal, the delivery chips, and a replayed delivery
losing its Replay control. One axe check per area. `cde5c12` → `e3b0002`.

Task 14 also produced **`aa75b44`, a WCAG AA fix that is not scoped to Phase 8 at all.** Its new axe
checks surfaced `--text-faint` (`#98A2B3`) rendering at **2.4–2.57:1** where AA requires 4.5:1 — on
~24 usages, including ten on the `/employees` list that had been there since Phase 3, green only
because `it-core.spec.ts` axe-checked `/employees/[id]` and never the list. Fixed at the TOKEN
(`#667085` light, `#868f9c` dark), not at the three Phase 8 call sites that happened to trip the new
checks. **This puts shipped code deliberately out of step with `design_handover/README.md`, which
specifies the old values and which §7 calls the untouchable source of truth** — see §8 for the
standing record of that deviation, because it is the kind of thing that must not be discoverable only
by grepping a CSS comment.

**TWO PURELY VISUAL CHECKS WERE NEVER DONE, and they need a human at a keyboard.** Everything about
both screens is asserted behaviourally — through the DOM, by `e2e/admin.spec.ts`, against a real
database — so what is missing is only what the eye catches. Neither blocks Phase 9 and nothing depends
on either. Sign in once at `http://localhost:3000` as `admin@thebackroomop.com` and both take about a
minute:

1. **The Admin Home (Task 11) has never been LOOKED at.** Its data was verified by calling
   `adminHome()` directly (all five roles present, `sum(rows) === total`, `m365_sso` reading
   `unavailable`) and `e2e/admin.spec.ts` now asserts its structure. What to check by eye: four tiles
   then three lists, **no fleet bar and no age histogram** (those belong to IT Home and their presence
   here was the original bug), and that IT Home is unchanged when you switch the workspace back.
2. **`/admin/webhooks/deliveries` (Task 13) has been driven but not looked at.** What to check: the
   status chips in **both** light and dark themes — four status families land on one table, and the
   `delivery` namespace exists precisely so a healthy `QUEUED` row does not read as amber like a
   failing one — plus the table at **375px** with a long endpoint URL and a long `lastError` beneath
   it, and where the dead-lettered banner sits relative to the tabs.

**Phase 13 — asset classes (CODE-COMPLETE, all 12 tasks, on `phase-13-asset-classes`, UNMERGED and
UNPUSHED)** (`docs/superpowers/plans/2026-09-06-phase-13-asset-classes.md`, spec
`docs/superpowers/specs/2026-09-06-asset-classes-design.md`):

- **T1 · schema + triggers** — `AssetClass { IT, PURCHASING }` on `AssetCategory.cls` and `Asset.cls`;
  six new `AssetStatus` values (`OPERATIONAL STORED REPAIRING RETIRED SOLD LOST`); three migrations
  (`asset_status_purchasing_values`, `asset_classes`, `asset_class_invariants_lock`);
  `asset_class_invariants` (class↔status, and `Asset.cls = category.cls` under a `FOR SHARE` lock on
  the category row — D-3) and `category_class_frozen` (a category's class is immutable once it has
  assets).
- **T2 · `src/lib/asset-class.ts`** — the partition: `STATUSES_BY_CLASS`, `DEFAULT_STATUS`,
  `DEFAULT_ASSIGN_STATUS`, `parseCls`, `CLASS_LABEL`/`CLASS_PHRASE`, pinned to the trigger's own
  literal lists by reading the migration file.
- **T3 · `approval-execution.ts` + the worker** — class-aware assign/return/change-status targets,
  each rule mutation-tested to fail when its class check is removed; `ASSIGNABLE_FROM` its own literal.
- **T4 · offboarding** — `OUTCOME_STATUS` keyed by class; no Buyout offered for a Purchasing item;
  `outcomeOfStatus` searches both maps; `Decision.toStatus` carries the payload's real target instead
  of re-deriving it through two maps (D-10).
- **T5 · the class-scoped list layer** — `cls` in `buildAssetWhere`, facet counts, CSV export and the
  bulk drawer's "act on all matching".
- **T6 · the write-path gates** — class gates on register, create, edit, request-status-change and
  bulk, including `resubmitAssetToFinance` (D-13); `CLASS_PHRASE` so no bare article precedes a class
  label anywhere.
- **T7 · routing and page gates** — `/inventory/register` and `/inventory/new` widened to Purchasing;
  the Secrets tab hidden by role AND class, and `/inventory/[id]/secrets` renders the not-found page
  rather than an ejecting redirect (D-18); the wrong-class edit redirect goes to the record, not
  `ROLE_LANDING` (D-14).
- **T8 · class-aware controls** — status pickers, the create/register forms (`ASSET_CLASSES` /
  `CLASS_LABEL` / `CLASS_EXAMPLE`, no hand-typed literals left in a component), the category table's
  Class column.
- **T9 · `?cls=`, the two Finance tabs, Home pinned to IT** — the `/inventory` class switch (a nav
  destination, modelled on `?purchaseYear=`); `/finance/assets`'s IT/Purchasing tabs; Home's alerts
  stay IT-only and pinned (D-16; D-19 records that the leaver card pins `cls: "IT"` on holdings while
  the offboarding queue does not).
- **T10 · the import wizard** — a Purchasing row is refused by name (`wrong-class`), reworded twice
  under review to name who can act and what the row actually is (D-17).
- **T11 · seed + `e2e/asset-classes.spec.ts`** — four Purchasing categories (Vehicle, Furniture,
  Pantry Equipment, Building) with seven assets; 20 e2e cases (D-8/D-13/D-14/D-15/D-17 add cases; case
  15 dropped as unreachable from the UI).
- **T12 · this handover, the amendments, the battery** — §0 items 4f and 9, §6a rules 101+, §8, §9.

**TWO VISUAL CHECKS WERE NEVER DONE, same shape as Phase 8's two above, and they need a human at a
keyboard.** Both are asserted behaviourally — through the DOM and through Playwright — so what's
missing is only what the eye catches:

1. **The class switch's chips (`/inventory?cls=`) and the two Finance tabs have been axe-scanned and
   driven, never LOOKED at.** Neither blocks anything and nothing depends on either.
2. **The Register form (`/inventory/register`) has never been seen through a `purchasing_staff`
   login.** It has only been verified through `admin`/`it_staff` and the DOM — the Vehicle/Furniture
   copy and the `CLASS_EXAMPLE` placeholders are unverified by eye for the role that will actually use
   them day to day.

### Conventions every later phase must follow

**Added by Phase 8** (both learned the hard way, both cheap to violate):

- **A retry engine and its ledger are written in the SAME handler, from the same value.** Scope
  decision #6: the `Job` row owns retries, `WebhookDelivery` mirrors it. `deliver-webhook.ts` derives
  the ledger's terminal state from the same `attempts` and the same `MAX_JOB_ATTEMPTS` the worker uses,
  because a mirror that disagrees only on the LAST step is worse than no mirror (§6a rule 43).
- **A `"use server"` module makes every export a server action, so the worker cannot import one.** That
  is why `secretAad`/`signPayload` live in `src/server/webhooks/sign.ts` and not beside the actions
  that also need them. The mirror-image rule: **a `src/lib/` module imported by a client component must
  not reach `node:`** — which is why `SIGNATURE_HEADER` had to move OUT of `sign.ts` into
  `src/lib/webhooks.ts` when a client component needed to name it.

| Concern | Where |
|---|---|
| Mutation shape | `actionRole` guard → `checkRate` → zod → tx (domain write + `writeAudit` together) → `revalidatePath` → `ActionResult` |
| Typed results / guards | `src/server/action-result.ts` · `src/server/auth/guards.ts` (`actionRole`/`actionUser` return null, never redirect) |
| Audit | `writeAudit(tx, …)` + `diffOf` — day-precision date compare in `updateAsset` is the template for avoiding phantom diffs |
| State machines | Pure + TDD'd first (`src/lib/approval-flow.ts` is the template), called via **state-guarded `updateMany`** (count 0 → conflict) |
| List state | URL search params via `src/lib/url-state.ts`; column prefs are per-user DB rows, never URL |
| Lifecycle changes | Never a direct asset write — create an Approval; the worker executes it |
| Secrets | AES-256-GCM **v1: base64(version‖iv‖tag‖data), AAD = `"assetId:label"`** |
| Purchase transitions | `runTransition` in `src/server/modules/purchases/actions.ts` — pure check → state-guarded `updateMany` → **NoteEntry append** → `writeAudit`, all in one tx; `asActionResult` maps P2028 → conflict |
| Partial updates | Write **only the fields the caller sent**, and put each written field's before-value in the `updateMany` guard — filling untouched fields from the row you read loses concurrent edits silently (Phase 5's `saveUnit`) |
| Dashboard sections | `safeSection(label, run)` → `SectionCard` — a failing query becomes a typed failure and the designed FAILED card, never a blank page |
| Per-user, per-day UI state | a `UserPreference` row (`home:dismissed`), reset by a date change — not an audited domain event |
| DB invariants to catch (P2002 → typed conflict) | `Approval_one_open_per_asset` (one open approval per asset) · `Job_one_live_execute_per_approval` (one live execute-job per approval) · `Reservation_one_active_hold_per_asset` |
| Derived state beats stored state | "Decided" is read out of the approvals that exist (`decisionOf`), not kept in a wizard table — which is what makes a half-finished offboarding N correct records instead of a lost session |
| A derived predicate is only shared if ALL of it is shared | Phase 7 extracted `groupCandidates` but left the *window* duplicated, and the server gate promptly disagreed with the UI. `candidatesFor` now owns window + grouping together, and all three call sites use it |
| A facet SQL can't express | narrow to a candidate set in the `where`, then make the final cut with the same rule that renders it — never two rules for one concept. Phase 17 made that cut **in memory** with the pure function (`repairStage`, Task 11); Phase 20 expressed the same rule as `REPAIR_STAGE_CASE_SQL`/`repairStageIds` and `it-gaps.spec.ts` case 6 asserts the two equal per asset; Phase 24 has `listAssets` page that id set through `pagedSnapshot`, so the repairs view is SQL end to end |
| …and that cut belongs to EVERY consumer of the `where` | `buildAssetWhere` feeds the list, the facet counts, the CSV export and `bulkRequestStatusChange` (which acts on *all matching*). Cutting only in `listAssets` would let a screen showing 1 asset create 7 approvals. `repairStageIds()` is the shared resolver |
| Money compared on a threshold | in **whole centavos**, never floats — `Decimal(12,2)` plus `quote >= cost * 0.6` is not inclusive at exactly 60% (₱6,000.57 of ₱10,000.95 failed). A test with round numbers proves one lucky pair |
| Extracting a rule | grep for every other place that writes the same thing. `withRepairStage` was extracted to stop a chip leaving a contradictory filter, and the generic `ChipFilterRow` on the same page was a second chip that bypassed it |

---

## 5. What REMAINS

**Phase 10 was the last planned phase and it is now code-complete. Nothing here is a coding task.**
What is left is one physical measurement, two user decisions (merge, push), and the deferred list
below. §0 item 4 is the actionable version of this section.

- **Phase 8 — the Admin workspace. COMPLETE and MERGED** (`e5a5730`). What it delivered is §4; the
  invariants it established are §6a. Two things remain outstanding and neither is code: **the push
  decision, which is the user's and unmade**, and **two purely visual checks** listed at the end of §4.
- **Phase 9 — import / export. COMPLETE and MERGED** (`--no-ff`, `7284c10`); `phase-9-import-export` deleted.
  `docs/superpowers/plans/2026-08-21-phase-9-import-export.md` (14 tasks, **15 recorded scope
  decisions**, every shipped task carrying an `AMENDED` banner, several carrying two or three). Both
  halves ship — see §4. **Nothing about the feature is outstanding; what is outstanding is the push
  decision, which is the user's and unmade.**
- **Phase 10 — polish. COMPLETE: all 11 tasks done, MERGED** to `main` (`--no-ff` `bd78813`, 2026-08-27), battery green on the merged result.
  Spec: `docs/superpowers/specs/2026-08-25-phase-10-polish-design.md`. Plan:
  `docs/superpowers/plans/2026-08-25-phase-10-polish.md` (11 tasks, **44 amendments A-1…A-44**,
  every executed task carrying a banner). **Shipped:** the printable 3×4 A4 label sheet with real
  Code 128-B barcodes and a measured calibration ruler; an IT-only route rule and a bulk-drawer
  entry point; the offboarding scanner (a scan preselects Returned and writes nothing); the two
  known moderate axe fixes; an axe sweep over 46 of 47 routes that found four serious
  violations on pages no spec had ever visited; **a deployment `README.md` proven by executing both
  its production and its dev path from a fresh clone**; and **two `docker-compose.yml` fixes that
  proving the README uncovered** — `web` now bind-mounts `./uploads` (asset documents were destroyed
  on every container recreate) and `worker` now declares `build: .` (it consumed an image tag
  published to no registry). Split out of Phase 9 on 2026-08-21 because
  the two halves share almost no code. **Entry criteria are §6, and exactly one is still open: the
  physical print-and-measure of the calibration bar (§0 item 4a), which needs a printer and a human.**
- **Entra SSO is deferred, deliberately and on the record.** `src/server/auth/index.ts` registers the
  provider when three env vars are set but carries `TODO(sso-phase)`: there is **no `signIn` callback**
  mapping an Entra profile to a `User` row, so an Entra login would arrive with no role. That is why
  Phase 8 makes `m365_sso` unavailable rather than togglable — on the one deployment that has
  configured the env vars, a free switch is one click from a sign-in path that authenticates and lands
  nowhere. Wiring it needs real tenant credentials; when they exist, the work is that callback plus
  deleting the refusal.

---

## 6. Phase 10 entry criteria (superseded in part by the SPEC — read that first)

**A SPEC NOW EXISTS: `docs/superpowers/specs/2026-08-25-phase-10-polish-design.md`.** It was
brainstormed and approved on 2026-08-25 and it OVERRIDES this section wherever they disagree — most
importantly it **drops item 1's "or a completed purchase"** (no data model exists for it) and settles
the scan code as 1-D Code 128, the axe bar, and how the README gets verified. This section is kept as
the raw entry criteria the spec was reasoned from. **No implementation plan exists yet.** These four items are what the brief and the current state of the code commit
the next plan to. Source: `design_handover/README.md` cards **`1m`** (label sheet geometry) and **`7g`**
(scanner rules) — **re-read them**; they carry more detail than is repeated here, and Phase 9's plan
invented non-existent fields three separate times because it was written from memory of the schema
rather than from the schema.

**Two of these four have NO SERVER SURFACE AT ALL**, which historically means they get under-planned and
become the reason a phase does not close on time. Budget them as real tasks, not as trailing polish.

1. **The printable label sheet does not exist.** A 3×4 A4 sheet of asset tags with scan codes,
   printable straight from a bulk selection or a completed purchase, so sticker and record are created
   in the same minute. Print geometry is the whole difficulty: `/offboarding/[employeeId]/report`
   (Phase 7) is the only print surface in the app and it is a *document*, not a grid — read its
   `print:` classes and its light-theme-only decision before designing a second one. **There is a
   working precedent for the scan-code placeholder**: that report renders one as a striped `<span>`
   with `aria-label="scan code placeholder"`. Decide explicitly whether Phase 10 generates real codes
   (which needs a library, and therefore §7's Alpine lockfile procedure) or keeps the placeholder.
2. **The scanner contract is honoured everywhere except the one place the brief singles out.** `?q=`
   exact-tag-match redirecting to the record works on every built surface — `e2e/it-core.spec.ts` and
   `e2e/import-export.spec.ts` both lean on it — but **the offboarding wizard does not tick a matching
   row when scanned**: there is no scan handling in `src/app/(app)/offboarding/[employeeId]/page.tsx`.
   A USB scanner is just a keyboard, so this is input handling, not hardware work. **The trap is
   hydration**, not the keystrokes: see §6a rules 61 and 76 — a key handler that binds on hydration
   cannot be tested by typing immediately after a navigation, and three separate proxies for "React is
   ready" pass before it is. `e2e/it-core.spec.ts`'s `waitForHydration` is the helper to reuse.
3. **The deployment README does not exist**, and everything it needs to say is already true and
   scattered: the compose profile (`docker compose --profile prod up`), the loopback-only db, the
   generated secrets including `SECRET_ENCRYPTION_KEY`, the migration procedure (additive SQL dirs;
   `prisma migrate reset` is classifier-blocked), the worker service, and the npm-on-Windows
   package-lock hazard in §7. **`docker compose --profile prod build` is verified green as of Phase 9's
   close**, so the image side is sound and this is a writing task with no code — which historically
   means it slips. Schedule it first, not last.
4. **The full axe pass, and the plan must DECIDE what "full" means.** The e2e helpers only fail on
   **serious/critical**, so a pass that leaves the helpers alone will not notice anything below that
   bar. Two known items sat exactly there. **Closed in Phase 21** — the app-wide **`heading-order`**
   violation (`PageHeader` rendered `<h1>`, `CardHeader` rendered `<h3>`, so every page combining them
   skipped `<h2>` — moderate): `Worklist` now takes a `headingLevel`, so `/inventory/work` passes `h2`
   instead of falling through to `h3`, and the rule is promoted to `PROMOTED_RULES` (plan `D-8`). Still
   open: **`SegmentedControl`** exposing no `aria-describedby`/`aria-invalid`.
   Phase 8 Task 14 already fixed `--text-faint` app-wide for AA contrast, so the remaining debt is
   narrower than the design handover's stated tokens suggest — read §8 before assuming a violation is
   new. **Two things to carry in:** §6a rule 62 (a green suite bounds what has been *checked*, not what
   is true — that same token was failing on ~24 usages while the suite was green, because one spec
   axe-checked `/employees/[id]` and never the list), and Phase 9 Task 13's measured axe gotcha, now
   rule 79: `Button variant="primary"` reports a **serious** 4.29 contrast when axe samples it
   mid-transition or with the pointer resting on it, and passes at rest. Park the pointer and settle
   before scanning, or the pass will chase a violation that is not there.

**One more thing the plan should decide, because it is now a real cost rather than a footnote.** The
e2e suite is **123 tests / ~16.5 minutes** and no longer fits one foreground run (§0 item 7). Phase 10
adds at least one print surface and one input behaviour, both of which want e2e coverage. **Decide up
front whether Phase 10 grows the suite or starts sharding it**, rather than discovering at Task N that
the battery is unrunnable in one sitting.

---

## 6a. What Phases 8 to 13 have established (119 rules — Phases 8-13 — read before executing anything)

The plan's **Recorded scope decisions** are the full list (14). These are the ones the review
sharpened, and the ones a later task can silently break. **Phase 8 is finished, but this section is
not history** — rules 8, 10, 15, 16, 26 and 47 were each broken on a NEW page *after* being written
down here, which is why §0's checklist exists as a thing to run rather than a thing to have read.

1. **The permanent admin is locked against `role` AND `disabled`, and the UI says so before the click.**
   `authorize()` returns `null` for a disabled user, so disabling that account locks every human out as
   thoroughly as demoting it would. Card `3h` names only the role select; the guard is deliberately
   wider. `lockReason()` returns the *sentence*, which both the page (as static text beside a `LOCKED`
   chip) and the action (as a conflict message) print — one string, two surfaces.
2. **There is no "last admin" guard, and the property it would protect holds on four facts, not one.**
   (a) exactly one permanent admin per database, from **two** producers — `prisma/seed.ts` and
   `createBootstrapAdmin` (`src/server/auth/actions.ts:115`), mutually exclusive because bootstrap is
   gated on `tx.user.count() === 0`; (b) **no writer of `User.role` or `User.disabled` anywhere outside
   `src/lib/admin-users.ts`'s callers** — **Task 2 becomes the first**; (c) no user-deletion path;
   (d) no email or password change flow. Break any of those and this decision needs revisiting, not
   just the `isPermanentAdmin` flag becoming editable.
3. **An admin may demote themselves; they may not disable themselves.** Demotion is recoverable — any
   admin can restore it. Self-disable ends your own session with no way back for you specifically. The
   refusal names **any other admin**, deliberately not the permanent one: nothing forbids one ordinary
   admin disabling another, so pointing at the permanent account would send someone to bother one
   named individual for something a colleague can do.
4. **The two refusals `disableChange` can return must stay textually disjoint.** The self-disable
   string must not contain "permanent admin", and the lock string must not contain "your own account";
   the tests assert both directions. This is not styling — see the §7 gotcha about assertions that
   cannot tell two branches apart.

**From Task 2 (`28e21ba` + the review fix `4b112cd`). Rule 5 is the one Task 3 must act on.**

5. **Any self role change signs the actor out, and the page — not the action — has to say so first.**
   `requireUser` compares the JWT's role to the DB's on every request and redirects a mismatch to
   `/logout`, because the JWT freezes role at sign-in. So an admin changing their **own** role to any
   different role is signed out mid-session, and `revalidatePath("/admin/users")` triggers exactly that
   *inside the action's own response* — which means the success state very likely never renders. Scope
   decision #3 still permits self-demotion; what it was missing was the warning.
   **`selfRoleChangeWarning(target, next, actorId)`** in `src/lib/admin-users.ts` is `lockReason`'s
   sibling — a warning, not a refusal, one string on two surfaces. Task 3 gates the select's `onChange`
   behind a `Dialog` carrying that sentence (the precedent is
   `src/components/offboarding/complete-button.tsx`), and `setUserRole` returns `signsOutActor` derived
   from the same function so the two surfaces cannot disagree. **Never restate the rule inline as
   `row.id === actorId`.**

6. **Neither action returns `ActionResult<null>`, and the no-op path is why.** `setUserRole` returns
   `{ changed, signsOutActor }`, `setUserDisabled` returns `{ changed }`, and `revalidatePath` fires only
   when `changed`. Re-selecting a role a user already has writes nothing, and a caller that can't see
   that will claim an immutable audit entry that does not exist — the identical bug
   `src/server/modules/offboarding/actions.ts:239` already fixed one phase earlier, with a comment
   saying so. **The trap when editing these:** both `$transaction` callbacks now return a full
   `ActionResult` on *every* path and the caller discriminates on `.ok`. A returned `{ changed: false }`
   is truthy, so the older `if (failure) return failure` shape would read a successful no-op as a
   failure to propagate. Don't reintroduce it. And remember `writeAudit` runs inside that callback:
   **returning** from a Prisma `$transaction` callback COMMITS it — only a throw rolls it back — so
   every `return conflict(...)` must stay ahead of every write.

7. **`asActionResult` is a shared plain module, `src/server/prisma-errors.ts`, and must never move into
   a `"use server"` file.** Every export of a `"use server"` module becomes a network-reachable server
   action, and this helper's first parameter is a function, which isn't serializable across that
   boundary. The plan originally had it exported from `user-actions.ts`; Tasks 5, 7 and 13 import it from
   `@/server/prisma-errors` instead. Its doc comment is deliberately a **precondition addressed to
   callers** — the helper cannot see a callback's body, so each call site verifies the
   conflict-before-write ordering in a comment of its own. Four private copies predate it (§8).

8. **The audit trail names a user; the diff does not pad itself to do it.** `entityLabels` resolves
   `user:<id>` to `name · email` linking to `/admin/users` (`User.name` has no unique constraint, so a
   bare name would let two colleagues share one audit identity). The disable diff carries `disabled`
   **only**. An earlier version added `email: { from: X, to: X }` to carry identity, which made `/audit`
   print `Fields: disabled, email` — `/audit` renders diff *key names*, so that row told a later reader
   the email had changed, in an append-only table that can never be corrected. **Don't put a
   from-equals-to key in a diff to smuggle context; put the context in the label.** (There is one
   sanctioned from===to precedent — `offboarding.completed`'s `m365Status` — and it earns it by
   snapshotting a value that mutable rows can later lose. Nothing here can be lost: there is no
   email-change flow and no user-deletion path.)

9. **Scope decision #2's four facts were re-verified now that something finally writes these columns,
   and all four hold** — the only writes to an existing `User` row anywhere in `src/` are Task 2's two
   `updateMany` calls, and the lock is now a **database predicate** (`isPermanentAdmin: false` in both
   guarded `where` clauses) rather than application code alone. **The deferred SSO callback is the change
   that would falsify two of them at once:** it becomes a third producer of `User.role`, and SSO mappings
   conventionally refresh role from group claims on every login — a writer of `User.role` on existing
   rows, outside this module, unaware of the lock. Re-litigate #2 when that lands; don't re-cite it.

**From Task 3 (`5d8e819` + the review fix `8a604df`). Rule 10 is the one that generalises.**

10. **A page must consume EVERY refusal its rule module can return, not just the one the design card
    names.** Task 3 shipped with a live **Disable** button on the actor's own row: `lockReason` returns
    `null` for your own row, so the unlocked branch rendered a normal button, while `disableChange`
    refuses self-disable unconditionally — and `next` can only be `true` for the actor, since a disabled
    user is bounced at `guards.ts:19` and can never be on the page. **Every click was guaranteed to
    fail.** The rule was already written, exported and unit-tested; the component imported
    `selfRoleChangeWarning` and not `disableChange`. This breaks brief §3's hard constraint (*"Anything a
    role can't do must not render an action they'll get a 403 from"*) and card 3h's own thesis, which the
    same file applied correctly to the permanent admin two cells away. **Tasks 5, 8 and 13 each pair a
    rule module with a page — check this explicitly for each.** Note also it was **invisible from the
    seeded `admin@` account**, which is the permanent admin and therefore locked: verifying a
    self-targeted rule requires promoting a second admin.

11. **Don't synthesize a rule's input object in a client component.** The first fix built a `TargetUser`
    in the table with a hardcoded `isPermanentAdmin: false`. True at the time, and
    `selfRoleChangeWarning` does not even read that field — which is what made it dangerous: nothing
    could ever falsify it, while `admin-users.ts:42-44` promises that a rule which *starts* reading a
    pre-wired param is a change to one function, not to its call sites. `UserRow` now carries
    `target: TargetUser`, which `listUsers` was already building and discarding. Don't derive it from
    `row.locked` either — `locked` is computed *from* `isPermanentAdmin`, so that inverts the dependency.

12. **`changed: false` must still refresh the page.** Work out when that branch can fire: a `<select>`
    emits no change event for the already-selected option and a toggle button always sends the opposite
    of what it shows, so it fires **only when the client's props are stale.** Task 2's original reasoning
    ("a no-op refresh is a pointless round trip") is therefore exactly backwards — in the one reachable
    case, the refresh is the whole remedy. Left as shipped, a second admin clicking Disable on an
    already-disabled row got a spinner and then silence, repeatable forever, until they reloaded by hand.
    The server keeping `revalidatePath` gated on `changed` is still correct; the client refreshes on every
    `ok`.

13. **`Dialog` now sets `aria-describedby`, and that was load-bearing, not polish.** It set
    `aria-labelledby` only, and `useFocusTrap` focuses the first focusable element — usually Cancel — so
    a screen reader announced the title, then "Cancel, button", and never the body. Every dialog in the
    app was hiding its own reason for existing. Additive fix in the primitive; all seven call sites
    benefit. **This is also why the e2e suite was re-run at Task 3** (see §0): six e2e-covered components
    use that primitive.

**From Task 4 (`cc43421` through `3b158df`). Rule 14 is the one to carry forward — it is now this
phase's most-repeated defect.**

14. **A rule must permit the SAFE direction. This shape has appeared three times in four tasks.**
    (a) Task 1's `disableChange` is direction-blind, so it refuses *re-enabling* the permanent admin as
    well as disabling it — the one transition that repairs an out-of-band lockout is the one the rule
    forbids (§8). (b) Task 3's Critical was the mirror image: a live control for an action the rule would
    always refuse. (c) Task 4's `flagChange` refused turning `m365_sso` **off** as well as on — so a
    database where that row is already enabled shows *Continue with Microsoft* on `/login`, the exact
    roleless-login path scope decision #7 exists to prevent, while the admin page renders the row ON with
    a pill explaining the danger **and no way to close it.** Both Phase 8 rule modules now take the
    requested direction. **Turning a dangerous thing off is never the dangerous direction** — check it
    for every rule Tasks 5, 8 and 13 add.

15. **A switch must not be able to claim a restriction that isn't enforced.** `isAllowedDomain`
    (`src/lib/auth-shared.ts`) returns `true` — **unrestricted** — whenever the domain is falsy, and
    `FeatureFlag.value` is `Json?` with no default. `createBootstrapAdmin` with a blank domain writes
    `(enabled: false, value: null)`, the resting state of **every deployment that bootstrapped without a
    domain**. One click made that `(true, null)`: `/admin/flags` read ON beside *"Limits who may create an
    account"* while any address on earth could sign up, and `/signup` correctly showed no banner — so the
    two surfaces disagreed and **the admin page was the one lying.** `flagChange` now refuses enabling a
    `hasValue` flag with no value, and **`flagDomain()` in `auth-shared.ts` is the single expression every
    reader uses**, so the admin page cannot compute a stricter reality than the gate enforces. Three
    readers had hand-rolled that expression; Task 5's query would have been a fourth that diverged.

16. **A user-facing description can assert a security property the code doesn't have.** `m365_sso`'s said
    the Microsoft button was *"for accounts in the allowed domain."* `isAllowedDomain` is called in
    exactly one place — the credentials `signUp` path — and there is **no `signIn` callback anywhere** in
    `src/server/auth`, so an Entra login is filtered by nothing: not domain, not an existing `User`, not
    role. That is the sentence an admin reads while deciding whether to want the feature. Fixed, with a
    test asserting it never re-acquires the claim. **`prisma/seed.ts` still carries the same falsehood in
    the row's own `description` column**, which is why a flags page must render `spec.description` and
    never `row.description`.

17. **A test that asserts agreement is not a test that asserts structure.** `flagChangeWarning` reads
    `spec.offWarning`. A test checking it equals each spec's `offWarning` catches *drift* — but a
    reintroduced hardcoded `key === "allowed_domain"` branch returning the same sentence **passes it**,
    which I verified by mutation. The property is "reads spec data", and the only test that catches it
    registers a flag at runtime and requires the warning to follow. Worth remembering whenever a test's
    name claims a structural guarantee: mutate the structure, not just the value.

18. **`trim()` does not strip invisible characters; a whitelist is what saves you.** U+200B and U+2060 are
    `Cf`, not `Zs`, so `trim()` leaves them — the hole §8 records for the 3-character reason minimum,
    which ends on a *length* check. `domainValue` is immune because its final check is an ASCII
    **whitelist**, and there are now regression tests saying so, plus a homoglyph case and a trailing-dot
    case. The refactor they guard against is realistic: collapsing the four sequential checks into one
    looser pattern passes every test the plan originally specified while accepting a Cyrillic-о
    homoglyph — a silent 100% signup lockout.

**From Task 5 (`ce275c1` + `3157a5c` + `aaca261`).**

19. **Rule 8 got reproduced after it was written down — treat it as a checklist item, not a lesson.**
    Task 5's audit diffs carried `key: { from: X, to: X }` for exactly the reason Task 2's carried
    `email` — "to carry identity" — and `/audit`, which renders diff **key names**, printed
    `Fields: key, enabled`. Append-only, uncorrectable. **Before any task that writes an audit diff:
    does every key in it name a field that actually changed?** If context is needed, it goes in the
    entity label. The one sanctioned exception remains `offboarding.completed`'s `m365Status`, which
    earns it by snapshotting a value a mutable row can lose.

20. **A new `entityType` needs an `entityLabels` branch, and the plan will not remind you.** Task 2
    needed one for `user`; Task 5 needed one for `feature-flag` and the plan **never scheduled it**
    (Task 7 adds only `webhook-endpoint`). Without it every row of that type is an unlinked truncated
    cuid — so the most consequential thing the app can record, "signup was opened to any address",
    would have read `feature-flag | clx1234567… | update | key, enabled`. Note there are **two**
    places: `entityLabels` in `src/server/modules/audit/queries.ts` (the label) and
    `AUDIT_ENTITY_TYPES` in `src/lib/audit-list.ts` (the facet). Task 7 owns the latter for both
    `feature-flag` and `webhook-endpoint`, so until it lands the facet cannot filter flag rows even
    though the label resolves. **Tasks 7 and 13 introduce `webhook-endpoint` and `webhook-delivery`
    — check both places for each.**

21. **Guard the write even when the column is `Json`.** `setFlagValue` shipped with an unguarded
    `update`, so two admins saving different domains meant the second silently discarded the first
    **and the trail held two entries both claiming the same `from`** — the second false, permanently.
    A `Json?` column makes an equality filter awkward (`Prisma.DbNull` for the null case), which is
    presumably why it was skipped. **`updatedAt` is the answer**: it is `@updatedAt`, so it is a clean
    optimistic-concurrency token, and it catches a concurrent change to *any* column rather than just
    the one being written.

22. **Distinct audit verbs, per mutation.** Both flag actions shipped as `action: "update"`, so
    `/audit`'s Action column could not tell a switch flip from a value edit — only the Fields cell
    hinted, and that cell was simultaneously polluted by rule 8. Now `flag-enable` / `flag-disable` /
    `flag-value`, matching the sibling module's `role-change` / `disable` / `enable`. Don't add cases to
    `actionDot` for any of them: `/audit` never calls it and the four activity feeds scope to
    employee/asset/purchase-request, so it is dead code (§6a rule 13's note). **Incomplete since Phase
    27, though `actionDot` itself is unchanged:** an action that CAN reach one of the four feeds now
    needs an `ACTION_LABELS` entry in `src/lib/activity.ts` as well as a sentence, or the Action facet
    prints its raw name in the dropdown — which is exactly how the final review found five
    worker-written `<lifecycle.*> executed` actions (see (t), I-1).

23. **A client mirror of server state needs a reset path the server can't trigger.** `flag-rows` keys a
    `useEffect` on every row's value to resync the input after `router.refresh()`. That structurally
    cannot catch a **normalizing no-op**: stored `example.com`, admin types `EXAMPLE.COM`,
    `domainValue` normalizes to the same string, nothing is written, the key never changes, and the box
    keeps the uppercase forever — the exact failure the effect exists to prevent. The fix is to reset
    from the normalized value in the success path too, not to make the effect cleverer.

**From Task 6 (`5c4ab33` + `093a209`). This review read FORWARD into Tasks 7–13 and its findings are
already written into their plan text — rule 24 is why that mattered.**

24. **A contract to systems you cannot migrate has exactly one cheap moment to get right, and it is
    before the first consumer.** Task 6's signature signed only the body, so it was replayable — and this
    phase *ships a replay button*, which the reviewer verified produces **byte-identical** bytes and
    therefore a byte-identical signature (the envelope's four inputs are `delivery.id`, `.event`,
    `.createdAt`, `.payload`, and `replayDelivery` touches none of them). With no timestamp in the
    request a receiver cannot implement a tolerance window even if it wants to. We had copied GitHub's
    scheme without either of its mitigations — GitHub mandates TLS and its delivery GUID **changes** on
    redelivery, where ours is stable, and Task 7's URL schema permits `http://`. Now
    `t=<seconds>,v1=<hex>` over `` `${t}.${body}` ``, where `v1` names the **scheme** (the old `sha256=`
    named the algorithm, so the comment's claim that it gave receivers a migration path was false —
    §6a rule 16 again). **Fixed at zero consumers; after Task 10 it is a breaking change to receivers we
    cannot see.**

25. **One parser cannot serve two callers that need opposite things.** `parseEvents` dropped unknown
    events, which is right for `emitWebhook` (never fan out to a name nothing emits) and wrong for the
    editor. The consequence was severe and silent: an endpoint holding a renamed event showed **no trace**
    in the UI, and an admin editing **only the URL** caused the narrowed list to be written back —
    permanently deleting the subscription — audited as `events: { from: [x], to: [x] }`, an append-only
    entry asserting the field did not change on the write that erased it. Now `partitionEvents(raw) →
    { known, unknown }` with `parseEvents = partitionEvents(raw).known`. **When a normalizer discards
    something, ask which caller needs to know what was discarded.**

26. **A number that appears in the UI needs exactly one definition.** The `DEAD · 5/5` chip's denominator
    was a parameter fed from a literal in the worker, and Task 13's planned code declared a **second**.
    Tune the worker to 3 and the chip reads `DEAD · 3/5` — card `3h`'s headline artifact, wrong, with a
    green suite and a mutation-clean function. `MAX_JOB_ATTEMPTS` in `src/lib/jobs.ts` is now the only
    `5`; the worker imports it and `deliveryStage` defaults to it. Note the name: it is the
    **job-engine-wide** cap (`src/worker/index.ts:73` applies it to every job type), which is why it is
    not `MAX_DELIVERY_ATTEMPTS` and does not live in `webhooks.ts`. **`npm run worker:once` is the only
    check that covers `src/worker/index.ts` — nothing in the unit suite reaches that file.**

27. **Adding a status to the family map means ALL of its values, and check the namespace.** Task 6 added
    three of `DeliveryStatus`'s four; `PENDING` inherited the flat map's **approval** entry, so a queued
    delivery rendered amber (`attention`) — and since `RETRYING` is also `attention`, **colour could not
    distinguish "queued and healthy" from "failing".** `status.ts` already had namespaced lookups for
    exactly this collision. There is now a `"delivery"` namespace covering all four, `JobStatus`'s
    `RUNNING`/`DONE`/`FAILED` are in the flat map (`status.ts`'s doc comment claimed every enum value
    mapped and it did not), and **an exhaustiveness test iterating the real Prisma enum objects** makes
    the claim true. Any task that renders a new enum should add that enum to the test.

28. **When a test's subject is embedded in a larger string, assert on the part a mutation would change.**
    The first version of "the digest changes when the signing instant changes" compared the whole
    `t=…,v1=…` header — which can only pass, because the visible `t=` differs between two instants no
    matter what was actually hashed. A mutant that dropped `t` from the **signed string** sailed through
    it. Same family as §6a rule 17 and the `ROLE_OPTIONS`/`domainValue` tautologies in §8. **Golden
    vectors are the other half of this:** the reviewer demonstrated that
    `createHmac("sha256", Buffer.from(secret, "base64url"))` — tempting, because Task 7's `newSecret()`
    is base64url — passes every property-style assertion while invalidating every signature in
    existence, and so does `.update(body, "latin1")` on any non-ASCII body. Pinned literals are what
    catch those.

**From Task 7 (`cc13bf5` + `df7a9a8` + `e90b277`) — the security-critical task, and the one where a
design choice made a bug invisible.**

29. **Guard EVERY write, and notice when a design choice hides the failure.** `rotateSecret` shipped a
    bare `update`. Two rotations racing — two admins, **or one operator double-clicking** — both succeed;
    the second wins in the DB while the shown-once banner shows whichever response resolved last. The
    operator pastes S1, S2 is live, every delivery 401s, the worker treats that as permanent, everything
    goes `DEAD`. **The shown-once design is what makes it undetectable**: the reveal is the only place the
    value ever appears, so there is nothing to check it against. When a feature deliberately makes state
    unreadable, every write to that state needs a guard *more* than usual, not less.

30. **Guard on a column the write actually moves — or on `updatedAt`.** `updateEndpoint` guarded on `url`
    while the common edit changes only `events`. Postgres re-checks a `where` against the **new** row
    version after the lock (EvalPlanQual), so the stale-but-unchanged `url` still matched and the second
    write committed over the first, with an append-only audit entry claiming a superseded `from`. Same as
    §6a rule 21. `updatedAt` is `@updatedAt` and moves on every write, whichever column changed — that is
    the general answer. `setEndpointActive` needs no such fix: it guards the column it writes.

31. **`findMany` with no `select` fetches everything, including ciphertext.** `listEndpoints` pulled
    `secret` on every render while its comment claimed *"never selected"* — true only of what it
    *returned*. Its rows feed a `"use client"` component, so the object is serialised into the RSC
    payload: one `...r` from ciphertext in an admin page's source. **An explicit `select` makes the
    guarantee structural**, and the comment should assert something a reader can check four lines up.

32. **Signing is not confidentiality, and saying it is stops the next reader from fixing it.** The
    `http://` allowance was justified with *"the payload is signed either way, which is what makes that
    safe."* Signing gives the **receiver** integrity and authenticity; it says nothing about where the URL
    points, and over plain http the envelope and its HMAC cross the wire in the clear. §6a rule 16 again,
    and this one is load-bearing because it reads as "already considered".

33. **SSRF here is an accepted capability, recorded as one.** An authenticated admin can make the worker
    POST to any host it can reach. That actor can already change roles and open signup, and Task 10 stores
    only status codes — never bodies — so it is a blind reachability oracle, not a data read. `urlSchema`
    refuses `169.254.0.0/16` and `metadata.google.internal` only; **loopback and RFC1918 are deliberately
    allowed** (scope decision #4 and the plan's own `http://localhost:4999/hook` verification depend on
    them). **The guard's soundness rests on a non-obvious fact worth not breaking:** it pattern-matches a
    dotted quad, and `new URL` normalizes every integer form to one first — `http://2852039166/`,
    `http://0xa9fea9fe/`, `http://0251.0376.0251.0376/` all yield `169.254.169.254`. IPv6
    `[fd00:ec2::254]` is not blocked; accepted, no metadata service here. **The real hole is in Task 10:**
    `fetch` follows redirects by default, so a 307 from an approved receiver forwards the signed body to a
    host the admin never approved — `urlSchema` cannot see past the first hop.

34. **Pin a magic string that a rename would silently invalidate.** `secretAad` is `` `webhook:${id}` ``
    in a one-line function. Renaming it — or a caller passing `endpoint.id` instead of
    `secretAad(endpoint.id)` — typechecks, lints, passes everything, and makes every **pre-existing**
    secret permanently undecryptable while newly created ones work perfectly. Now pinned by a literal
    (`secretAad("abc") === "webhook:abc"`) plus a round-trip and a cross-row refusal. Rule 28's lesson
    applied to a constant rather than a format.

**From Task 8 (`4b26385`) — the first task in this phase whose defects were all caught before the
commit, because the §0 checklist was run against it deliberately rather than remembered. Rules 35 and 36
are the two a later task can reproduce.**

35. **Rule 16 governs user-facing PROSE, not just comments — and a sentence can be falsified by the
    branch it renders in.** Task 8's unknown-events banner ended *"the only thing that drops them is the
    button below"*, which was true in the branch that has a button and false in the branch that
    deliberately doesn't (a row with no recognised events left, where the removal would be refused, so
    the button is replaced by the sentence saying what to do first). Both branches print the same
    paragraph. **When copy references another element, check every branch that renders the copy still
    renders the element** — the clause is now conditional on the same flag the button is. Same family as
    rule 16's four earlier instances, but the falsehood was in prose an admin reads rather than a comment
    a developer reads, which makes it worse, not better.

36. **Rule 10 has now been broken in EVERY task of this phase that pairs a rule with a page — treat it
    as the default outcome, not a risk.** Task 8 had two, both found by running the §0 checklist rather
    than by testing: Delete was live on an endpoint with delivery history (`deleteEndpoint` always
    refuses those, and `EndpointRow.attempts` already knew), and "remove the unrecognised events" was
    live on a row whose recognised set is empty (`eventsSchema.min(1)` always refuses that save). Neither
    was reachable from the plan's own verification steps, because the seed has no deliveries and no
    renamed events — **the fixtures that would have exposed them do not exist, so the checklist is the
    only thing that catches this class.** The fix in both cases is the same shape: `disabled` plus the
    refusal's own sentence, from the rule module, printed before the click.

37. **A rule that is only a sentence still belongs in the rule module.** `deleteBlockedReason(attempts)`
    is the phase's third one-string-two-surfaces export (after `lockReason` and `flagChangeWarning`), and
    it exists because `deleteEndpoint` was building the sentence inline: the page needed the same words,
    and a second copy diverges the moment either is reworded. It returns `null` rather than `""` for the
    deletable case so a caller cannot render a blank explanation beside a dead control, and it is
    unit-tested for singularisation, for pointing at the safe direction (Disable), and for **staying
    textually disjoint from `deleteEndpoint`'s other refusal** — the P2003 race message — per rule 4.

38. **A constant a client component needs cannot live in a module that imports `node:crypto`.**
    `SIGNATURE_HEADER` was in `src/server/webhooks/sign.ts`; `/admin/webhooks`'s shown-once banner tells
    the operator which header to paste the secret against, and that banner is `"use client"`. The plan's
    answer was a **literal in the component** — a second definition of a contract with receivers we
    cannot migrate, which a rename typechecks past and leaves wrong in the one place a human reads it.
    It now lives in `src/lib/webhooks.ts` (the vocabulary module, which imports nothing platform-specific)
    and is pinned by a literal on both sides. **Task 10's import is already amended.** The general form:
    when a server-only module holds a value the UI must display, move the value, don't copy it — and
    `src/lib/*` versus `src/server/*` is the line that decides which module can hold it.

**From Task 9 (`5a5494e`) — the first task with no advance banner, which still had two defects. Rule 39
is the one to carry.**

39. **Mirroring an existing pattern means mirroring ALL of it — and a constraint that silently doesn't
    constrain looks identical to one that does.** Task 9's migration was told to mirror
    `Job_one_live_execute_per_approval`, and did: a partial unique index on
    `(payload->>'deliveryId')` where the job is live. What it did not copy is the **companion CHECK**
    (`Job_execute_payload_shape`), whose own comment in
    `20260814093000_provenance_restrict_and_indexes` says why it exists — *"or the one-live-job partial
    unique above it silently no-ops (NULLs never collide)"*. The index is on an **expression**; a job
    with no `deliveryId` key evaluates to NULL, and Postgres never collides NULLs, so unlimited live
    jobs would have been permitted for exactly the malformed payloads the guarantee matters most for.
    **Nothing in a green suite can tell you this.** The only thing that catches it is asserting the
    constraint against the live database — insert the violating row and require the error. Same family
    as rule 27 (a status map given three of an enum's four values). When you copy a guard, go read what
    else the migration that introduced it shipped in the same breath.

40. **A runtime re-check that the type system already guarantees is dead code, and its comment is a
    lie about where safety comes from.** The plan's emitter had
    `if (!parseEvents(endpoint.events).includes(event)) continue;`, commented as stopping a renamed
    event being resurrected by a stale row. `has` is exact array membership, so every row the query
    returns provably contains `event`, and `event` is typed `WebhookEvent` — so `partitionEvents` puts
    it in `known` unconditionally and the branch can never be taken. Harmless in itself; the damage is
    the comment, which tells the next reader that a runtime filter is what makes this safe when the
    **parameter type** is. Rule 16 in the form where the false claim is about which mechanism protects
    you. Ask of any defensive branch: what input reaches it, and can that input exist?

41. **"Prove it does nothing" is not a test of a producer.** Task 9's plan verified the emitter by
    completing a purchase with no endpoints configured and asserting `WebhookDelivery` count `0` — which
    an `emitWebhook` with an empty body passes perfectly. The positive case has to be run too, and the
    cheap version is worth knowing: create **two** endpoints subscribed to **different** events, trigger
    one, and require exactly one delivery on the right endpoint plus a `Job` whose `deliveryId` matches
    it. Then disable it and trigger again to prove `active: true` means "stops receiving". Generalise:
    when a task's verification only asserts an absence, ask what a no-op implementation would do.

42. **The worker's call sites are the ones a typecheck proves least about.** `src/worker/**` runs under
    `tsx`, not Next, and uses relative imports exclusively — there is not one `@/` import under that
    directory. A new module imported from both sides (`emit.ts` is imported by the worker AND by two
    `"use server"` modules) has to use the style that works in both. `npm run worker:once` loading at
    all is the cheap smoke test — module resolution happens before any job is leased — and executing a
    real approval through it is the full one. **Note also `emit.ts` is a PLAIN module deliberately:**
    its first parameter is a transaction client, which is not serialisable, and being exported from a
    `"use server"` file would make it a network-reachable action (§6a rule 7's shape).

**From Task 10 (`7ad0014`) — the security-critical task, and the one that proves a banner is not an
audit. It had five pre-written amendments, every one of them correct, and still shipped with two more
defects of the same family — one of them inside the branch the banner named as the model to copy.**

43. **A mirror that agrees on four steps out of five is worse than no mirror, because the page looks
    authoritative.** `deliverWebhook` was drafted to write `RETRYING` on every retryable failure. The
    worker's `tick()` dead-letters the job when `job.attempts >= MAX_JOB_ATTEMPTS` — so on the fifth
    failure the **job** goes `DEAD` and the **delivery row** still says `RETRYING`, `deliveryStage`
    renders `RETRYING · 5/5`, and **card `3h`'s headline artifact `DEAD · 5/5` can only ever appear for a
    PERMANENT failure**, never for a receiver that was simply down — which is the commonest way a
    delivery dies. Scope decision #6 makes that row a mirror of the job; the fix (`retryStatus(attempts)`)
    derives the terminal decision from the same value and the same constant the worker uses, so they
    cannot drift. **The general question: when two rows must agree, check the LAST transition, not just
    the steady state.** A test that stops after one attempt passes either way — this took driving one
    delivery through all five.

44. **A banner is what one reviewer found reading forward, not a completed audit — and its own examples
    can be broken.** Task 10's banner said to treat a `decryptSecret` failure "as a `Permanent` in the
    same shape as the disabled-endpoint branch." **The disabled-endpoint branch had the identical bug**:
    it threw without marking the delivery row, leaving it at `PENDING`/`0` — which `deliveryStage`
    renders as a healthy `QUEUED` — while the job went `DEAD` and the real reason sat in `Job.lastError`,
    a column no admin page reads. One omission in two paths, with the banner pointing at the broken one
    as the model. Fixed **structurally** rather than by remembering: a private
    `permanent(id, attempts, reason)` marks `DEAD` and *then* throws, so a `Permanent` cannot be raised
    without the ledger moving. When a review tells you to copy a sibling, read the sibling.

45. **Printing a signature is not testing it.** Task 10's plan verified delivery by printing the
    `x-backroom-signature` header and eyeballing the envelope. Task 6's review had already demonstrated
    two mutations that produce perfectly well-formed headers and invalidate every signature in existence
    (`Buffer.from(secret, "base64url")` as the HMAC key, and `.update(body, "latin1")`). **The receiver
    has to RECOMPUTE the HMAC**, which means the test needs the plaintext secret — obtainable without
    scraping the shown-once banner by creating the endpoint from a script that calls the same
    `newSecret` / `encryptSecret(…, secretAad(id))` pair `createEndpoint` does. The check that proved the
    SSRF fix is the same shape: a **second listener on another port that must stay silent**, rather than
    an assertion about the first one.

46. **`src/worker/**` has no unit coverage at all and cannot easily get any** (§6a rule 26 said this for
    `index.ts`; it is now true of a second file). `deliver-webhook.ts` is `fetch` plus Prisma with no pure
    core worth extracting, so `npm run worker:once` against a real receiver is its ONLY coverage. Anything
    that changes it needs the seven-case table in the plan's Task 10 Step 4 re-run — a green
    `npm run test` says nothing whatsoever about this file.

**From Task 11 (`e3e19eb` → `ac976ac`) — the first task executed properly subagent-driven, and the
evidence for doing 12–14 the same way.**

47. **A summary surface must not re-derive a state the detail surface already computes — §6a rule 15
    recurred, one phase later, on a brand-new page.** `adminHome()` read `FeatureFlag.enabled` raw;
    `listFlags()`, two functions above it in the same file, computes the EFFECTIVE state
    (`spec.hasValue ? flagDomain(row) !== null : row?.enabled ?? false`). They differ exactly in
    `(enabled: true, value: null)` — which `flagDomain`'s doc comment calls the resting state of any
    deployment that bootstrapped without a domain. The Admin Home would have shown a green dot and "on"
    beside *Signup domain restriction* while `/signup` enforced nothing **and `/admin/flags` one click
    away said "off"**: two admin surfaces contradicting each other, the summary being the liar. Rule 15
    was recorded after Task 5 and this still happened, which is why it is now a checklist line and not a
    lesson. The fix is `flagEnabled(spec, row)` in `src/lib/admin-flags.ts` with **both** callers routed
    through it — a copied ternary would have been the second definition rule 15 exists to prevent (three
    readers had already hand-rolled it once). Seven tests, mutation-verified: reintroducing the
    raw-column shortcut kills three.

48. **Don't invent work for a control that has nothing to do — remove the control.** The plan's Step 3
    left `FocusToggle` rendering on the Admin Home with nothing gated on `focus`, so the button flipped a
    cookie and re-rendered identically. The implementer's first fix was to add a `!focus`-gated `Jump to`
    card so Focus would have something to hide; review rejected it, because `WORKSPACE_NAV.admin` is
    exactly the three destinations `AdminHomeBody` already links inline — the card would have repeated
    them plus a link to the page you are on. `SHOWS_FOCUS_TOGGLE: Record<WorkspaceId, boolean>` is the
    fix: don't offer it. **Note it is a near relative of rule 10, not an instance** — rule 10 is an
    action guaranteed to FAIL, this one succeeds and does nothing visible. Same remedy, and worth keeping
    the distinction because the citation was wrong in the first comment written for it.

49. **Two reviewers can split on where something belongs, and the tiebreaker is blast radius.** The
    quality review wanted `SHOWS_FOCUS_TOGGLE` moved to `src/lib/workspaces.ts` beside the other three
    `Record<WorkspaceId, …>` tables; the spec review wanted it next to the JSX it governs. Kept in
    `page.tsx`: `workspaces.ts` is the nav-and-access truth the **edge middleware** reads, and "does this
    Home have a focus-gated secondary section" is a fact about one page's composition. Coupling routing
    truth to layout for a single consumer is the worse trade — and the quality reviewer agreed once the
    middleware point was made. **Recorded because the tempting refactor is the wrong one.**

50. **What the subagent split actually bought, stated plainly.** Tasks 8–10 were implemented and reviewed
    in one context; Task 11 had a fresh implementer and two fresh reviewers. The spec review caught
    unrequested scope (the `Jump to` card) that a self-review is structurally bad at noticing, since the
    author has already justified it to themselves. The quality review caught rule 47 — a correctness
    defect invisible to types, lint and 453 passing tests, found only by reading the sibling function and
    asking whether two surfaces could disagree. **Also: verify a reviewer's claims before acting on them.**
    The spec reviewer's redundancy argument depended on `WORKSPACE_NAV.admin` having only three entries;
    that happened to be true, and checking took one grep. The quality reviewer's rule-47 finding was
    likewise confirmed by reading `listFlags` before any code changed.

**From Task 12 (`8521589` → `b0d7c94`) — a fixture-only task, which found more defects per line than
any task in the phase. All of them were fixtures that the running code could not have produced.**

51. **A fixture must be checkable against the CODE THAT WRITES IT, never against the plan — and the
    comment describing it is the part most likely to be false.** The plan's seeded webhook deliveries had
    four shape defects: `type` in the DB's `@map`'d spelling (`lifecycle.assign`) rather than the Prisma
    client value the emitter actually sends (`lifecycle_assign`); `assetId`/`assetTag` missing though the
    emitter always sends both; refNos paired with the wrong types; and a `purchase_request.completed`
    delivery citing `PR-0198`, which is seeded `SUBMITTED` and therefore cannot fire that event. **The
    method that caught them was comparing against a payload captured from a live run** (Task 9's
    verification), not against the plan text. Then the comment block turned out to be worse than the data:
    it disclosed two rows as fiction while presenting a third as the honest one, and that third
    (`APR-2031`) **carries no `assetId`, which `execute-approval.ts:63-65` refuses for every approval type
    before ever reaching `emitWebhook`.** All three were fiction on the same axis. When you write a
    fixture, the honest comment is usually shorter than the one you first want to write.

52. **A promissory comment is a defect from the moment it ships until the task it names lands, and
    nothing checks it.** `deliver-webhook.ts` (Task 10) shipped *"Task 12's seed gives a RETRYING fixture
    a real `nextAttemptAt`"* — and Task 12's planned code did not set one. It was found from the other
    side, by the implementer reading the comment while writing the fixture; nothing else would have. If
    you must write one, phrase it as an intention ("Task 12 is expected to…") rather than a statement of
    fact, or better, don't.

53. **State a deliberate ABSENCE, not just deliberate presences.** Seeding no `DELIVER_WEBHOOK` `Job`
    rows is load-bearing — one would make `worker:once` POST to a hostname that does not resolve on every
    seeded run — and the block said nothing about it, three lines below the file's own
    `// Job queued for the APPROVED approval`. A reader had every reason to read the absence as an
    oversight to fix. Same for one plaintext `HOOK_SECRET` shared by two endpoints: safe because
    `secretAad(id)` binds each ciphertext to its row, and worth saying so, or the next reader "fixes" a
    copy-paste that was never one.

54. **"The secret is encrypted" is the claim that fails silently, so test the ROUND TRIP.** A length
    check on the ciphertext column proves nothing about whether it decrypts. Task 12's verification
    decrypts both seeded secrets under `secretAad(theirOwnId)` back to the fixture plaintext **and**
    confirms decrypting one under the other endpoint's AAD is refused. Do that whenever a seed writes
    ciphertext — a seed that stored plaintext, or encrypted under the wrong AAD, would look identical
    until something tried to use it.

55. **The cheap in-session reseed is a Playwright spec.** `npm run db:seed` is *sometimes*
    classifier-blocked for agents (it ran fine in Task 13's session), but every spec reseeds via
    `execSync` in `beforeAll` and that is never blocked.
    `npx playwright test e2e/auth-shell.spec.ts --workers=1` is ~60s / 16 tests and doubles as a
    regression check on the fixture you just changed. This is how Task 12 verified its numbers against a
    genuinely fresh database rather than reasoning about them.
56. **A refusal enforced by a DATABASE INDEX is still a refusal the page owes the operator — and it is
    the one rule 10 instance nothing in the rule module will remind you of.** Task 13's `replayDelivery`
    refuses three things: a `DELIVERED` row, an inactive endpoint, and a delivery that already holds a
    live `DELIVER_WEBHOOK` job. Only the first two are visible in the action's own `if`s; the third is
    `Job_one_live_deliver_per_delivery` raising P2002. The plan's `replayable: status !== "DELIVERED" &&
    endpoint.active` therefore rendered a live Replay button on **every freshly-emitted `PENDING` row and
    every backing-off `RETRYING` row** — which is what those statuses mean — each click a guaranteed
    P2002. **The fix is one owner:** `replayBlockedReason` in `src/lib/webhooks.ts`, which the action
    refuses with and the query renders from, exactly as `deleteBlockedReason` already did in the same
    module. When you check rule 10, ask what the DATABASE will refuse, not only what the rule module
    returns.
57. **A deliberate ABSENCE in the seed is still a coverage hole, and rule 53 is only half the lesson.**
    Task 12 correctly seeded no `Job` rows and correctly *said so*. That same absence is what made rule
    56 invisible: with no live jobs, every Replay works against seeded data and a green suite proves
    nothing about the case that matters. **When you state a deliberate absence, also state what it stops
    exercising** — a reader can then choose to probe it directly, which is how 56 was actually confirmed
    (insert a live job, watch `replayable` flip, delete it).
58. **A batch action must return what it DID, not that it ran.** Task 13's planned `replayAllDead`
    returned `{ queued }`, dropped every per-row refusal, and the component announced
    `Replaying ${deadReplayable}` — **the count rendered before the click**. A batch of four that queued
    two would have claimed four. As shipped it returns `{ queued, attempted, blocked }` and the banner
    says `Queued 2 of 4` with the reason. Same family as rule 43: a surface that agrees with reality most
    of the time reads as authoritative and is wrong exactly when someone is looking.
59. **A bare `catch {}` inside a batch loop converts a fault into a short count with no reason
    attached.** The planned loop swallowed everything escaping `replayDelivery` "because it is one row's
    problem". But that action already maps every failure it *expects* onto an `ActionResult`, so anything
    escaping it is real — and `src/server/prisma-errors.ts` states the rule outright: *an unexpected
    error must never be laundered into a friendly banner.* Let it throw.
60. **When one exit path clears a column, ask which other paths leave it stale.**
    `deliver-webhook.ts` clears `nextAttemptAt` on success, with the comment *"must not keep advertising
    an attempt that will never happen."* Task 13's replay re-queues a row from scratch — the identical
    situation — and the planned reset left the old timestamp behind. Related: **`nextAttemptAt` is
    written by NOTHING but the seed** (the worker's retry path never sets it, only clears it), so
    Task 13 deliberately does not render it and says so in `listDeliveries`. If a "next attempt" column
    is ever wanted, it comes from the job's `runAt`. Tracked in §8.
61. **A `fill()` that lands before React hydrates is silently discarded, and the assertion after it
    can pass for the wrong reason.** Task 14's flags test failed reproducibly on the full-file run and
    passed standalone. The tell was Playwright's own snapshot: the textbox held the STORED value, not
    the typed one, and the error slot was present but empty — so the action had received the original
    value and no-op'd. `src/components/admin/flag-rows.tsx` binds the input to `draft[row.key]`,
    initialised from props, so hydration overwrites anything typed before it runs. It passed alone
    because compiling the route inside the test bought hydration the time it needed; in the full file
    an earlier test had already warmed `/admin/flags`.
    **⚠ THE FIX THIS RULE ORIGINALLY PRESCRIBED WAS WRONG AND IS SUPERSEDED BY RULE 76.** It said to
    "wait for the field's expected INITIAL value, which proves the controlled component is mounted from
    props". It proves nothing: the server renders that same value into the HTML, so the wait is
    satisfied before any JavaScript has run. It appeared to work on `/admin/flags` only because the
    extra round trip bought hydration time by accident. Phase 9 Task 13 measured it failing on
    `asset-form.tsx`, along with two further proxies — see **rule 76** for all three and for the signal
    that actually works (`e2e/it-core.spec.ts`'s `waitForHydration`).
    **What survives from this rule:** fill, then **assert the new value stuck BEFORE clicking submit**.
    That assertion is still the point — it turns a lost keystroke into a clear failure instead of a
    wrong-reason pass — it is just not sufficient on its own. Same family as §7's "✓ Saved" race and the
    Task 3 navigation race.
62. **"The other specs pass" is not evidence the other pages are clean — it may only mean nobody
    looked.** Task 14's implementer found a contrast violation on three admin pages and concluded it
    was not a pre-existing pattern, having checked that other axe-covered pages passed. The same token
    was failing on ~24 usages, including ten on `/employees`, and the suite was green solely because
    `it-core.spec.ts` axe-checked `/employees/[id]` and never the list. **Before calling a defect new,
    grep for the construct on older surfaces AND check whether any test actually asserts against
    them.** A green suite bounds what has been checked, not what is true. The corollary bit twice in
    one task: fixing three call sites would have left twenty-one, and made two tokens mean one thing.
63. **A comment that cites a line number is a promise that rots.** The token fix above invalidated a
    forensic comment in `e2e/it-core.spec.ts` that quoted both a hex value and `globals.css:16` — the
    hex changed, and inserting an explanatory comment above the declaration moved the line. Worse, that
    comment opened with "BUG (app, not test)" and ran eleven lines before revealing in its final clause
    that the bug had been FIXED. **Cite names you can grep, not coordinates, and when a note records a
    resolved bug, say so in its first line.** (Rule 16's family: a comment must not claim a property
    the code lacks — including a location.)
66. **A `"use client"` component cannot take a function prop from a Server Component, and nothing in
    the toolchain will tell you.** Phase 9 Task 6 fixed a dropped-filter bug by passing the page's URL
    builder down to two components so neither could rebuild a URL wrongly. That works for
    `RepairChips` (a Server Component) and is **impossible** for `InventoryTable`, which carries
    `"use client"` — React only passes serializable data across that boundary. It receives a
    precomputed `Record<string, string>` of hrefs instead. **`tsc`, `lint` and `build` all pass on the
    broken version**; it fails only when the page actually renders, which in this repo means only under
    Playwright. So: when the fix for "a caller can get this wrong" is "pass the caller a function",
    check which side of the client boundary the caller is on first, and prefer precomputed data across
    it. Related to §7's note that a `"use server"` module's exports are all server actions — both are
    boundary rules the type system does not enforce.
64. **A column spec written from what the output OUGHT to say is wrong three times out of three.**
    Phase 9's plan produced three export column specs and all three were defective, identically: Task 3
    **dropped** `Employee no` and `RMA ref`, two columns the CSV it replaced actually emitted; Task 4
    **invented** an `email` field the `Employee` model does not have; Task 5 **invented** `decidedBy`
    and `decidedAt`, which appear nowhere in `src/` at all. None was caught by a test — the specs'
    assertions (unique non-empty labels, a known first column) pass just as happily on a spec missing
    two columns as on a complete one. **Write a column spec from the source, not from the intent, and
    when a task rewrites an existing output, diff the OLD output's field list against the new spec.**
    The suite now pins the asset sheet's full ordered label list precisely because that is the only
    assertion that would have caught it. Same family as rule 39 (copying a pattern but not all of it),
    one layer up.
65. **An equality that holds at zero is not evidence.** Task 5 verified that the farewell sheet's row
    count matches the printable report's by running both against the live database — and both returned
    **0**, because the seed contains no `lifecycle_return` approvals, so the employee had three held
    items and no decided ones. The check passed and proved nothing: a function returning a constant
    empty array satisfies it. Sibling of the Task 9 lesson that *"prove it does nothing" is not a test
    of a producer*. **When a verification compares two counts, confirm at least one of them is
    non-zero**, or say plainly in the report that you could not — which Task 5 did, and which is why the
    real assertion moved to the e2e that can create the state.

67. **A mutation only tests the suite if the fixture exercises the branch you mutated — and a test's
    NAME is not evidence that its INPUT reaches the branch the name claims.** Phase 9 Task 7 is the
    case study: **seven inert assertions across three review rounds, and three of them were inside
    tests written to close an earlier inert one.** The plan's own Step 9 mutation pass prescribed four
    edits and two proved nothing — `parseFloat("PHP 51,000")` is `NaN` under both the strict and the
    lenient branch, and the literal "swap rules 3 and 4" left the suite fully green because no fixture
    paired a matching tag with a taken serial. Then the *replacement* cost-ceiling test, written
    specifically to kill a dud, used `1e21` — which the **two-decimal** check catches first, making it
    a second copy of the 2-dp test wearing the ceiling's name, with **both** ceiling branches still
    deletable at 65/65 green. Then the date test, written to prove timezone-independence, forced
    `America/New_York` — the one offset where the local and UTC getters **agree**, so swapping them
    left 86/86 green. The root cause is identical every time: an accurate name over an input that
    lands somewhere else. **So: before believing a mutation proved anything, confirm the fixture
    reaches the mutated branch; and when a test forces an environment (a timezone, a locale, a clock)
    to make a case distinguishable, confirm the forced value actually distinguishes it.** The cheapest
    check is the one that found all seven — delete the code the test names and watch it fail.
68. **A whole-object assertion is worth more than the spot checks you would otherwise write, and it
    cannot rot.** Task 7's C-7 test asserted `"notes" in patch` and `"vendorId" in patch` — two of
    seven optional fields, with `cost` (money) among the five unpinned, so "the patch always carries
    `cost`" survived mutation on a test written to prevent exactly that class of destructive write.
    One line — `expect(Object.keys(patch).sort()).toEqual([…])` — pins all seven forever and fails
    loudly the day an eighth is added, which is the moment you want to be asked. Same family as rule
    64 (the export column spec that dropped two columns while its "unique non-empty labels" assertion
    passed happily): **an assertion over a SET is what catches an omission; an assertion over MEMBERS
    only catches a corruption.**
69. **A "structural guarantee" that rests on application code is a convention, and saying so in the
    comment is the whole difference.** Task 7's `type-outside-category` infers "the stored type cannot
    belong to the new category" from the record's `(categoryId, typeId)` pair having been consistent
    to begin with — and **nothing in the database enforces that**: there is no FK or CHECK tying
    `Asset.categoryId` to its type's category, only `createAsset` and `updateAsset` do, in application
    code. So an asset already stored inconsistently is blocked even by the row that would REPAIR it,
    and left alone by a row that keeps it broken. Both directions are safe here and the check was kept
    deliberately — but the comment first claimed a guarantee, and a reader who takes that at face
    value will not think to check. **Write down which invariant a shortcut depends on and who
    maintains it.** Sibling of rule 16: a comment must not claim a property the code lacks — including
    a property the *database* lacks.
70. **A spec review and a quality review are different instruments, and passing the first says nothing
    about the second.** Task 7 shipped as `8c4e8c0`, a byte-for-byte transcription of the plan, and a
    spec-compliance review passed it — correctly, because it *was* compliant. An opus review then asked
    *"is the rule right?"* and found **seven Critical defects in the plan text**; a second round found
    **three more**. Everything the suite could see was green throughout: 542 tests, `tsc`, `lint`,
    `build`. The pattern, five phases running, is that **the implementation is rarely the problem** —
    §2 already says the reviews are where correctness comes from, and this is the sharpest instance:
    the module's rules disagreed with `schema.prisma`, `asset-rules.ts` and `actions.ts`, three files
    the plan's author never opened. **When a task is logic-critical, point a reviewer at the rule with
    the domain facts in hand, and treat "the diff matches the plan" as the beginning of the review.**
71. **A shortcut that rests on application code is a convention, not a guarantee — and a
    SELF-REFERENTIAL argument for one is the tell.** Task 12 left `byEmployeeNo` un-guarded against
    case-collisions, reasoning that "nothing but this importer creates an Employee, and this importer's
    own case-insensitive match resolves a differently-cased row to an UPDATE, so no second variant can
    arise." It reads as rigorous and it is circular — the guarantee is the thing being assumed. The path
    it missed: **two concurrent applies.** Neither row exists yet, so both plan a CREATE; each writes in
    its own transaction (partial import is the default); `Employee.employeeNo`'s unique index is
    **case-sensitive**, so neither insert collides and no P2002 fires. From then on a plain map keys both
    variants to one entry and the record read second silently absorbs every later row naming that
    number — a wrong WRITE, not a refusal. The asset side is immune only because `tagKey` upper-cases and
    the database index catches the race. **Worse, the test pinned the losing behaviour as intended**, so
    the fix had to delete a green test. Sibling of rule 69: when a shortcut depends on an invariant, name
    the invariant and who maintains it — and if the answer is "this code", it isn't an invariant.
72. **Pure logic that lives where a test cannot reach it IS the defect, not merely untested.** Three
    times in one phase, each found only by review: `resolveAssetRefs` welded six Prisma calls to forty
    lines of pure map-building (extracted as `buildAssetRefs`); `patchForDiff`/`toDay` were trapped in a
    `"use server"` module, which permits only async exports (extracted as `assetDiff`); and the
    divergence predicate — **pure arithmetic over two count objects** — sat inside a React component that
    a node-environment vitest can never load (extracted as `hasDiverged`). In every case the defect was
    *in* the unreachable function, and in every case one unit test over the extracted version would have
    caught it with no browser and no database. **Before writing a rule inside an I/O module or a
    component, ask what stops a test importing it** — and treat "nothing can test this" as a claim to
    disprove, since it was wrong all three times it was made here.
73. **When one sentence must serve two entities, decide deliberately between forking it,
    parameterising it, and neutralising it — a codebase that does all three by reflex teaches the next
    reader nothing.** Task 12 resolved the same tension three ways in one commit: it **forked**
    (`bad-employment`, rather than let `bad-status` show an operator the eight ASSET statuses on an
    employee row), it **parameterised** (`classifyRowError` gained a `subject`, with the asset default
    reconstructing its old strings byte-for-byte), and it **neutralised** (`duplicate-in-file`'s explain
    lost "tag or serial … one physical asset" for "this value … one record here"). Each is defensible
    alone; together they leave no rule for the third importer. **Parameterise when the sentence has a
    slot; fork when it carries entity-specific facts — enum members, column names, numeric ranges;
    neutralise only when it carries neither.** Note the direction of the cost: neutralising takes
    specificity away from a surface that already shipped, to serve one that hasn't.
74. **A test written to close a review finding is not exempt from the review finding.** Nine inert
    assertions were found across this phase and **three of them were inside tests written to kill an
    earlier inert one**: the replacement cost-ceiling test used `1e21`, which the two-decimal check
    catches first, so both ceiling branches stayed deletable; the timezone block forced
    `America/New_York`, the one offset where the local and UTC getters *agree*; and a "mutation coverage"
    test was a verbatim duplicate of its neighbour, describing a mutation the shipped rule order makes
    impossible. All three had accurate names and inputs that landed elsewhere. **After writing a test
    that closes a finding, run the original mutation against it** — that is the only check that
    distinguishes a fix from a re-enactment (rule 67's corollary, and it needed its own entry because
    knowing rule 67 did not prevent any of the three).
81. **Some defects are only findable by rendering the thing and measuring it, and Phase 10 produced
    five.** A Code 128 checksum weighted from the wrong end left **all 8 tests green** (the one-character
    fixture makes both weightings coincide, and every pattern sums to 11 modules so the total is
    identical for any checksum). A calibration ruler declaring `100mm` rendered at **89.38 mm** because
    it was a flex item with default `flex-shrink: 1` beside a long caption — valid CSS, correct declared
    width, and a printed instruction telling the operator to measure it. A barcode overflowed its cell by
    **0.4 mm** because `LABEL_USABLE_MM` did not account for a `0.2mm` border, clipping part of STOP's
    trailing bar. A scanner **silently died** the moment an outcome was clicked by hand. And four serious
    axe violations sat on routes no spec had ever visited. **None would have failed a green suite; none
    was visible in a code read.** Budget for measurement — render the page, query the DOM, print the PDF,
    put a number on it — not just for tests.
82. **Defense in depth makes a layer-1 regression invisible to an outcome assertion.** `/inventory/labels`
    is guarded by a `PATH_RULES` entry AND the page's own `requireRole`, and `requireRole` redirects to
    the **same** `ROLE_LANDING` middleware uses. So "finance cannot reach it" passes identically whether
    the middleware rule is correct, misordered, or deleted — proved by mutation. Two people concluded the
    blind spot was structural; it is not. **Probe a path the rule covers where no page exists**
    (`/inventory/labels/no-such-page`): `requireRole` cannot run there, so only middleware can answer, and
    a misordered rule returns 200 with zero redirect hops. Otherwise **say in the test's name that it is
    an outcome guard, not a rule guard** — never write "asserted rather than assumed" over an assertion
    that cannot tell the difference. Phase 9's import specs had this exact overstatement; both are fixed.
83. **A locator whose role does not exist on the page under test is worse than no assertion.**
    `expect(getByRole("row", { name: /BR-LT-0166/ })).toHaveCount(0)` guarded the scanner's central
    promise on a page that renders `Card`s and has no `row` role anywhere. It cannot fail, in any state,
    and its name says it is guarding something. `toHaveCount(0)` on a vacuous locator is the purest inert
    assertion there is. **Delete such a locator rather than leaving it as decoration.**
84. **"Nothing was written" cannot be asserted from the absence of a UI signal.** The UI shows what the
    happy path renders; a write arriving by another route renders nothing to be absent. The scanner's
    guard also checked for a toast that only `submit()` fires — so a direct `decideItem()` call produced
    none and the absence proved nothing. **Assert against the database, as a delta.** And note the second
    layer: the first fix still passed, because it read the count before the fire-and-forget write landed.
    A correct assertion can still be inert if it races — settle first (`waitForLoadState("networkidle")`).
85. **A guard that decides what to IGNORE needs tests in both directions.** The scanner's focus guard
    correctly protected the Reason textarea and **silently killed the scanner** whenever focus sat on a
    `SegmentedControl`'s `sr-only` radio — which is exactly where focus lands after clicking an outcome,
    the ordinary first step of the workflow. **The same three lines caused both**, and only one direction
    had a test. Whenever a guard bails, ask what it must NOT bail on, and assert that too.
86. **`@page` is global to every print job in the app.** A drafted `@page { size: A4; margin: 0 }` in
    `globals.css` would have stripped the page margin from the farewell report and the accountability
    form, neither of which overrides it. Scope it: `@page name { … }` plus `.thing { page: name }`.
    Verified in this app — Chromium supports the `page` property, Tailwind v4's pipeline preserves the
    named at-rule verbatim, and `getComputedStyle(body).page` stays `auto` elsewhere.
87. **Verify a sweep's coverage against the filesystem, not against its own list.** `e2e/axe-sweep.spec.ts`
    swept every route it knew about and passed — and `/signup`, a public unauthenticated page, had never
    been axe-checked by anything, while `/login` had been since Phase 2. Found by diffing the spec's
    routes against `find src/app -name page.tsx`. **A sweep that passes proves its list is clean, not
    that the app is.** Same shape as rule 62, one level up. Also: assert each scan LANDED on the intended
    path — an under-privileged role redirects silently and axe then passes a page you never scanned.
88. **The muted tokens are already the dimmest tier that clears 4.5:1, so any opacity on top of them
    fails contrast by construction.** `opacity-40` on `--text-muted` table cells measured **1.71–1.93:1**.
    There is no lighter compliant shade to retreat to — the fix is full contrast, not a dimmer variant of
    the same idea. If a design calls for de-emphasis below that tier, it needs a different mechanism
    (weight, size, position), not transparency.
89. **A fact is only true for an audience, and moving it between documents changes the audience.**
    "`prisma migrate reset` is blocked" is true of the harness classifier that runs agents in this repo.
    The Task 10 plan told the README to say it, an implementer copied it verbatim, and in a deployment
    document read by a human operator it is simply false — worse, *reassuring*: it tells someone a
    destructive command is guarded when nothing in the repo guards it. **Before copying a line out of
    this handover into anything user-facing, ask who the new reader is and whether the sentence survives
    the move.**
90. **An empty `main` in a Playwright aria snapshot means "waiting on a server render", not "wrong
    page".** Every `loading.tsx` in this app renders only `Skeleton`/`SkeletonRow` divs, which carry no
    text and no roles, so a loading page snapshots as a bare `- main`. This one signal distinguishes the
    three failures that look identical from the assertion message alone: a slow render (empty `main`), a
    keypress lost before hydration (`main` full of the server-rendered content), and data drift (`main`
    full, with an empty-state message). Read the snapshot before forming a hypothesis.
91. **Before answering a timing failure with headroom, prove the path did not change.** Headroom and a
    papered-over regression are the same edit; only the diff tells them apart. For `it-core.spec.ts:126`
    the check was `git diff main..HEAD` over the route's `page.tsx`, its `queries.ts` and its toolbar —
    all three byte-identical to the last green `main`, which is what made 20s a fix rather than a
    cover-up. **Name the files you diffed in the commit message**, so the next reader can audit the
    judgement instead of trusting it.
92. **A total that matches is not evidence that its components do.** This doc recorded the e2e suite as
    147 tests and, separately, `axe-sweep` as 5 of them. The total was right for a whole phase while that
    component was wrong (it is 6). Totals are the last number to drift and the worst at catching drift.
    **When you write a breakdown, measure every line of it, not the sum.**
93. **When a fix makes a document false, the document moves in the SAME commit.** Fixing the missing
    `uploads` volume turned README's "uploaded documents are ephemeral" from a true caveat into a lie.
    Shipping the compose change alone would have left the repo's public face contradicting its own
    behaviour — the exact drift this project has now caught in comments (rule 16), in plans (A-30…A-44)
    and here in prose. Grep the docs for what a fix invalidates *before* committing it.
94. **A `"use server"` module is not a library.** Every top-level export from one must be an async
    function, so "extract the shared helper" is not always available across that boundary — Phase 12's
    `C-6` sent an implementer to reuse `toCost`, a non-exported synchronous arrow inside
    `src/server/modules/inventory/actions.ts`, and exporting it would have broken the build. Check the
    directive before proposing reuse. If a helper genuinely needs sharing, it moves to a
    non-`"use server"` lib module first, and that move is its own task.

95. **A user restating your design back to you is a free correctness check — spend it on the code, not
    on your memory of the plan.** Phase 12's `C-7`: asked to confirm the flow, the user described a
    hold-until-approved pipeline routing into per-department tabs. **Three of those four beliefs were
    wrong**, and answering "yes, that's right" would have built the next phase on a model the code did
    not implement. What made the check cheap was reading the actual gates — `grep` showed only two
    files read `financeConfirmedAt`, which is what proved confirmation was a *label, not a gate*. The
    fourth belief exposed a genuine missing feature. **Re-derive from the code every time: a plan
    section describing a flow may itself have been superseded by an earlier amendment.**

96. **"Write an audit row" is only half of an audit requirement — the sentence and the dot move in the
    same task.** Phase 12's `C-9`: four tasks each specified their `writeAudit` call exactly and none
    said what the row should READ AS, so `/inventory/activity` rendered
    **"J. Sarmiento finance.return BR-LT-0148"**. `auditSentence` in `src/lib/activity.ts` has a
    `default` branch and `actionDot` has a neutral fallback, which means **a missing case is never a
    type error and never a test failure — just output nobody sees until they open the feed.** Any new
    audit action adds its case and its dot, with tests, in the task that introduces it.

97. **The seam between a correct form and a correct action is visible ONLY to an end-to-end test.**
    Phase 12's `C-10` is the most expensive lesson in this project: `/inventory/register` **never
    worked, at any quantity**, from the day it shipped. `nextTags` is pure and fully unit-tested,
    `registerAssets` is correct, `tsc` and `lint` passed, and vitest runs in `environment: "node"` so
    no component test could exist to catch it. The bug lived entirely in what the client sent. **A task
    that ships a form and defers its e2e to a later task has shipped nothing verifiable** — and this one
    sat broken through three subsequent tasks.

98. **`.map` skips holes; never grow an array by assigning `.length`.** The concrete form of rule 97's
    bug. `next.length = 5` on a shorter array creates true sparse holes, and `.map`, `.forEach` and
    `.filter` all **skip** them rather than visiting them — so `next.map((s) => s ?? "")` fills
    nothing. The holes then serialize across the RSC boundary as `undefined` and fail
    `z.array(z.string())`. Use `Array.from({ length: n }, (_, i) => prev[i] ?? "")`.

99. **Removing a caller is a bigger edit than it looks — walk the call graph downward in the same
    amendment.** Phase 12's `C-11`: `C-5` was written as a change to Tasks 5–6 and was silently also a
    change to Tasks 3–4, orphaning `receiveUnits`, `receivableUnits`, `outstanding` and
    `isFullyReceived` — ~264 lines with **no caller at all**, which then read as a working feature for
    four more tasks. Worse, `C-4`'s rollback fix (a full amendment's work, guarding real data
    corruption) was protecting a path nobody could reach. **When a premise change deletes a screen, name
    every thing that screen was the only consumer of and say whether it lives or dies.**

100. **A write-nothing mutation proof only proves what the guard ALONE defends.** Phase 12's `C-12`:
     the plan predicted that weakening the in-batch duplicate check would make the count assertion
     fail. It does not — both tags are created inside one `$transaction`, so the second hits the DB's
     own `@unique` and unwinds the batch whether or not the app check exists. **A DB constraint sitting
     behind the guard masks the mutation, and a masked test is indistinguishable from an inert one
     unless you reorder the assertions and check each independently** — which is exactly what the
     implementer did. State which layer you expect to catch a mutation, not merely that something will
     fail.

101. **A default is scaffolding; the trigger is the guarantee.** Every existing category becomes `IT`
     through `AssetCategory.cls @default(IT)`, but a default only ever describes the common case — it
     is Phase 13's `asset_class_invariants` and `category_class_frozen` triggers that make a wrong
     class or a wrong status *impossible* to write, not merely unusual. Spec §2.4's "no drift path,
     enforced by Postgres, not trusted" was true only once the trigger existed, and D-3 (rule 102)
     shows it was still false for one release even then.

102. **A trigger that reads another table is a concurrency question, not just a logic question — lock
     what you read.** `asset_class_invariants` read `AssetCategory.cls` with a plain `SELECT` under READ
     COMMITTED; a concurrent insert and a concurrent `category_class_frozen` flip could each pass
     against a snapshot that never saw the other, and an asset's class could permanently disagree with
     its category with no trigger ever revisiting it. Fixed with `FOR SHARE` on the category read — not
     `FOR KEY SHARE`, which is what FK checks take and does not conflict with an update of a non-key
     column (D-3). Ask what the *other* transaction sees before calling a database check a guarantee.

103. **Review a new module's NAMES as hard as its values.** Every entry in `src/lib/asset-class.ts`'s
     six maps was correct against the four consumers that held the IT literals today; `canActOnClass`
     was not, because it mapped `finance_staff` to `[]` when Finance actually acts on assets of both
     classes through confirm/send-back — a later task reaching for that guard would have locked Finance
     out of a feature Phase 12 had already shipped. Renamed `canManageClass`/`MANAGEABLE_CLASSES` while
     it still had zero call sites (D-6).

104. **When a task deletes an export, the plan must grep every consumer at planning time, not trust the
     one call site it happens to name.** Task 4's step named a single `<ItemDecision>` render of
     `OUTCOME_STATUS`; the same page had three more bare reads and the farewell report imported it too
     — five consumers, one named in the plan (D-9).

105. **When the stored value IS the fact, print it — don't re-derive it through two maps.** Every
     offboarding page rendered `outcomeStatus(cls, decision.outcome)`, a lossy round-trip through
     `forward`/`reverse` that equalled the stored status only when the payload's status belonged to the
     asset's own class, and rendered a bare null otherwise. The decision row already knew the payload's
     real target; `Decision.toStatus` now stores and prints it directly (D-10). Derived-state-beats-
     stored-state has an inverse: a stored fact is not improved by being re-derived.

106. **A shape change breaks every whole-object assertion, not just the one you remember.** Making
     `cls` an unconditional key of `buildAssetWhere`'s return value broke the `toHaveLength(8)` check
     the plan named — and three more `toEqual({})` comparisons on the whole object that it didn't
     (D-11). Grep the test file for whole-object assertions before widening a function's output shape.

107. **Scope every list in a function by the same key, or write down why not.** Task 5 scoped
     `facetOptions`' categories and types by `cls` and left the assignee list global, so the IT view's
     Assigned facet would offer a driver who holds only a car — an option that can never have rows in
     that view, not merely a rare one (D-12). The review that caught it also confirmed which OTHER
     asset queries are right to stay global (labels' `?ids=`, the scanner's `exactTagMatch`, import
     dedupe) — the rule needs a reason recorded on both sides, not just a fix on one.

108. **A default parameter added so intermediate commits compile is removed in the commit where the
     last caller finally passes the real value.** The `cls = "IT"` defaults Task 5 put on four query
     functions kept `tsc` green while `?cls=` didn't exist yet; left in place past Task 9 they become a
     trap the moment the page threads a real `cls` and some caller forgets to pass it. Removed in the
     same commit that wired the last caller (D-12).

109. **A control gated by a predicate has its action gated by the same predicate, in the same phase.**
     Task 7 rendered Resubmit for whoever `canManageClass` allows, but `resubmitAssetToFinance` was
     still `actionRole("admin", "it_staff")` — a Purchasing user would have seen a working-looking
     button and gotten `forbidden()` on the click (D-13).

110. **The vocabulary carries the article — never `a ${label}`.** "not a IT status" and "a Purchasing
     category" both read as broken English, and both shipped more than once: D-8 fixed three worker
     strings, and D-13 reintroduced the same bug at six more sites before Task 6 was even done.
     `CLASS_PHRASE` ("an IT", "a Purchasing") is now the one place that decides, with a test.

111. **When a route opens to a new role, walk every link and redirect that role can now reach, and ask
     where it lands.** Task 7 closed every write gate correctly and left six dead affordances an
     unreachable role could still click: a wrong-class edit redirect to `ROLE_LANDING` instead of the
     record, an unguarded `/inventory/new`, two nav items lit at once, a Secrets tab hidden by class but
     not by role, a register form telling a Purchasing user to model a car on a ThinkPad (D-14). Gates
     were reviewed; affordances were not, and five of six led off a cliff.

112. **When a fix's own text contains the word "simplest," read the call site before believing it.**
     The prescribed fix for a double nav-highlight — `search.size === 0` — was not correct: the sidebar
     feeds `navIsActive` the LIVE search params, so every page-owned query param de-highlighted the
     bare nav item on six entries across four workspaces, with a green suite, because nothing tested a
     bare item under a filter (D-14b). The rule that was actually right derives which params a bare
     link yields to from the sibling nav item's own declaration (`WORKSPACE_NAV`), so it cannot drift.

113. **When a phase creates a vocabulary module, grep the plan's own code blocks for the literals it
     replaces — and when a defect is fixed on one of two sibling surfaces, name the other in the same
     amendment.** Task 8's plan text hard-coded `useState<"IT" | "PURCHASING">` and two hand-typed
     `<option>` labels the day after `asset-class.ts` was created to be the only copy of that
     enumeration; the same plan repeated `register-form.tsx`'s already-fixed `?? "IT"` fallback and
     ThinkPad placeholder on its sibling `asset-form.tsx`, missed because the amendment that fixed the
     first didn't name the second (D-15).

114. **"Every X in the file" is a grep, not a rule — read what each X serves before writing the
     instruction.** Task 9's step said "every `prisma.asset` read in the file"; one of them was
     `financeHome`'s Capitalized tile, which the spec gives BOTH classes, so pinning it to IT would have
     made Finance's headline silently disagree with the page it fronts by the entire Purchasing total,
     with a green suite (D-16).

115. **A fix that names an action must be true for every role that can read it, and for every row the
     card can hold.** Task 10's `wrong-class` refusal told the reader to "Register Purchasing assets"
     and linked to a screen `it_staff` cannot use that way — true only for `admin` (D-17). The same
     cause then had to hold true for a second row shape (a Purchasing asset matched by an existing tag)
     under one shared headline; "the route exists" proved neither claim.

116. **Assert the outcome the user sees, not the transport, unless the transport IS the contract.**
     "The URL 404s" was a claim about an HTTP status this app's `notFound()` cannot produce past a
     Suspense boundary — `/inventory/[id]/secrets` streams 200 with the not-found page in the body, and
     the guard had fired correctly the whole time (D-18). Assert the rendered outcome; reserve a
     status-code assertion for a route that is genuinely unmatched.

117. **When a task changes a fixture every spec shares, its verification is the whole suite, not its
     own file.** Task 11 validated only the new spec; the code-quality review walked every OTHER spec
     against the new seed and found `import-export.spec.ts` comparing an unscoped `db.asset.findMany`
     (36 rows) to a class-pinned export (29) — a failure the plan's own heuristic ("a moving IT count
     means an unpinned query") would have misdiagnosed, because the export query was right and the
     test's own Prisma read was the unpinned side (D-19).

118. **A negative assertion is proven only when the same locator matches in the other branch — write
     the pair or write nothing.** Two of Task 11's cases could never fail: "IT cannot resubmit" ran at
     a moment the control is absent for every role, and "no Reveal button" has no secrets in the seed
     to reveal regardless of the guard (D-19). Both moved to a moment, or a text, that actually
     distinguishes the branches.

119. **A subagent brief that allows a Playwright run must say the run completes inside the tool call,
     with a timeout that covers `--global-timeout` — no monitors, no waiting.** Task 11's first
     implementer stopped mid-run "with a monitor" and left an orphaned `next dev` behind; the second
     agent correctly refused to race an unowned process rather than guess at its state (D-18's process
     note). Reuse of an orphan, if it happens, is the controller's call, made against a diff proving the
     orphan is current code.

75. **This document is a surface, and rule 16 applies to it exactly as it applies to a comment.** §6a
    rule 61 told three tasks to prove hydration by waiting for a server-rendered field's initial value,
    which proves nothing (rule 76). §7's own bullet on the same subject already said the opposite — "a
    server-rendered input's seeded value does NOT prove hydration has run, because the SSR'd HTML
    already carries that value" — so **the doc contradicted itself for a whole phase and the wrong half
    was the one written as an instruction.** Nobody reconciled them because each was read on its own.
    **When you fix a rule here, grep this file for the same subject and reconcile every mention**, and
    prefer deleting a rule to leaving two that disagree. A handover that disagrees with itself is worse
    than one that is merely incomplete: it launders a guess as a finding.
76. **There is no cheap proxy for "React has hydrated", and three plausible ones all pass before it
    has.** Measured on `asset-form.tsx` during Phase 9 Task 13, in order of increasing subtlety:
    **(a)** the field's expected INITIAL value — rule 61's own prescription — is satisfied by the
    server-rendered HTML before any JavaScript runs; **(b)** the FILLED value passes because `fill()`
    writes the DOM directly, and hydration then rebinds the input from props and discards it (observed:
    the assertion passed, and the snapshot 20s later showed the stored value back in the box);
    **(c)** the filled value SURVIVING a beat also passes, because nothing rebinds the input until
    hydration actually runs, which can be later than any beat worth waiting. **(c) is the dangerous
    one**: the click then submitted the ORIGINAL value, `updateAsset` no-op'd, the button flashed
    "✓ Saved", and `/history` said "No changes recorded" — a green pass over a silently lost edit, with
    every assertion in the test satisfied. **Use the thing itself, not a proxy**: React attaches a
    `__reactFiber$…` key to every host node it hydrates. `e2e/it-core.spec.ts`'s `waitForHydration` is
    the helper; probe it on **the element you are about to interact with**, never on its ancestor form,
    because hydration walks parent-to-child and it is the input's own fiber that delegated `onChange`
    dispatch looks up. It is a React internal, and the trade is explicit: if a future React stops
    exposing it the helper times out and the test fails loudly, which is the right failure mode for a
    hydration gate. What it must never decay into is a bare `waitForTimeout`.
77. **Rules 51 and 52 have a good direction: build a fixture with the code that would have produced
    it.** Every `.xlsx` in `e2e/fixtures/` is written by `toXlsxBuffer` through the app's own
    `ASSET_EXPORT_COLUMNS` / `EMPLOYEE_EXPORT_COLUMNS`, and the row shapes are *derived* from those
    specs (`Parameters<(typeof ASSET_EXPORT_COLUMNS)[number]["cell"]>[0]`) rather than hand-typed — so
    "could the running code have produced this fixture?" is yes by construction, and a renamed column
    breaks the generator instead of silently making the fixture wrong. **Commit the generator AND its
    output**: the suite must not depend on a generation step (a fixture that has to be built before the
    tests run is one that can be built wrong, silently, on someone else's machine), and the generator
    must stay runnable so a column change regenerates rather than being hand-edited into a binary.
    The counter-case is rule 52's: Task 12's seeded webhook payloads were written from the plan instead
    of from the emitter, and were wrong in four independent ways.
78. **Mutation-test every assertion you would call load-bearing, and do it before you call the task
    done.** Nine inert assertions in one phase, three of them inside tests written to close earlier
    inert ones (rule 74), is enough evidence that "the test passes" carries almost no information about
    whether it *can* fail. The method, from Task 13: for each assertion, name the specific defect it
    exists to catch, break exactly that in the source, run only the affected test, confirm it fails
    **in the expected place**, revert. Five for five, and two findings came out of it that no amount of
    reading would have produced: the audit-delta assertion fires *before* the `updatedAt` assertion, so
    a single mutation could not prove both were live and a second, narrower one was needed; and a
    filtered-export mutation reproduced the shipped bug's exact signature (10 rows against a screen
    showing 3), which is what turned "this test looks right" into "this test is the guard". **Do the
    revert with `git checkout --`, and check `git status` before committing** — a mutation left behind
    is a shipped defect with a passing suite.
79. **axe reports a *serious* contrast violation on a primary button that passes at rest, and the cause
    is the pointer.** Measured twice in Task 11's review and again in Task 13: `Button
    variant="primary"` samples as `#fdfefe` on `#487cb6` — 4.29, below AA — when axe runs
    mid-transition or with the cursor resting on the button, while at rest `--accent` is `#2563a8` and
    passes. **Park the pointer (`page.mouse.move(0, 0)`) and let the transition settle (~700 ms) before
    scanning**; `e2e/import-export.spec.ts`'s `expectNoSeriousAxe` does both, with the measurement
    written beside it. This matters most for Phase 10's axe pass, which will otherwise spend time
    chasing a violation that is not there — and it is the reverse of rule 62's hazard, so hold both:
    a green scan may be under-checked, and a red one may be an artefact of when it sampled.
80. **`getByRole("alert")` is unusable in this application, on every page.** Next mounts a permanently
    present, normally empty `#__next-route-announcer__` carrying `role="alert"`, so an alert-role query
    always resolves to two elements and dies of strict mode **before it ever sees the banner it was
    written for** — and the failure message names strict mode, not the announcer, so it reads like a
    duplicate-banner bug in the page. Match refusal text directly instead, and match it **through the
    module that owns the sentence** (`rowCapRefusal(IMPORT_ROW_CAP + 1)`, `idsRefusalText(IDS_CAP + 1)`)
    rather than a literal, so the assertion cannot keep passing after the cap moves and the screen
    starts lying (rules 26, 37, 38).

⚠️ **The list ENDS at rule 100, not at rule 80.** Rules 75–80 sit out of numeric order at the
tail of this section — they are not duplicates, the ordering is simply wrong, and reading the last
entry to find the next free number gives you 81, which is taken. **Append at 101.**
---

## 7. Recurring gotchas that have cost real time

- **The generated Prisma client is SHARED ACROSS BRANCHES, and switching branches does not regenerate it.** `node_modules/.prisma/client` is gitignored, so it reflects whichever branch last ran `prisma generate` — not the branch you are on. Hit on 2026-09-02: after Phase 12 added `NoteKind.RECEIVE`, checking out `phase-11-label-qr` made `tsc` fail with *"Property 'RECEIVE' is missing in type … but required in `Record<NoteKind, string>`"* in `src/lib/purchase-thread.ts`. **Phase 11's code was correct for Phase 11's schema; the client on disk was from Phase 12's.** The error names an application file and reads like a real defect, which is what makes it expensive — it sent me looking at the merge I had just done. **Run `npx prisma generate` after any branch switch that crosses a schema change**, and suspect it immediately whenever `tsc` complains about an enum member or model field that the branch's own `prisma/schema.prisma` does not mention. The database keeping the other branch's migration applied is harmless by comparison — additive columns and enum values do not disturb a client that has never heard of them.
- **Stale `.next` types outlive a deleted route.** Deleting a page route leaves its generated type file behind in `.next/types`, and `tsc` then fails on a module that no longer exists — reported twice in one session against `(app)/[...pending]` after it was removed. `rm -rf .next` and re-run. Same diagnostic instinct as the entry above: when `tsc` names something the working tree does not contain, suspect a generated artifact before suspecting your change.
- **A fresh dev server has no session, and an agent will not type the seeded password into the login form.** It happened twice in one session. Any check that needs a signed-in browser therefore needs **you** to sign in once at `http://localhost:3000` (`admin@thebackroomop.com`), after which the agent can drive the page normally. **Two workarounds that need no browser at all, and are often better:** call the page's own query directly (`npx tsx` a throwaway script under the gitignored `backups/` that imports e.g. `adminHome()` and prints its output — this is how Task 11's data assertions were verified, and it checks the numbers rather than the pixels); or, for anything the DB can answer, `docker exec inventory-db-1 psql -U inventory -d inventory -c "…"` (note **`-U inventory`**, not `postgres` — that role does not exist and the error is unhelpful). Delete the scratch script afterwards. **A third route, and the best one for behaviour: write a throwaway Playwright spec.** The e2e harness logs in by filling the seed's fixture password (`ChangeMe123!`) from a script — that is the suite's own established mechanism, not an agent typing a human's password — so a temporary spec under `e2e/` can drive a signed-in browser, assert through the DOM, and be deleted afterwards. This is how Task 13 verified its click path, its refusal-by-absence, and its audit row. Name it `zz-*` so it sorts last and cannot perturb the files after it, and remember that **tests in one file share a database and only `beforeAll` reseeds** — Task 13's second test failed purely because its first had already consumed the fixture. Reserve the manual browser for what only the eye shows: layout, contrast, focus order, axe.
- **A long-lived dev server degrades into stalls, and Phase 10 hit it again.** The server this session used accumulated **3.2 hours of CPU**, and a Task 9 agent's axe sweep stalled against it — the agent then backgrounded the run and ended its turn waiting, leaving nothing reaped. Restarting via `preview_stop`/`preview_start` and re-running took **3.8 minutes**. This is §6's Phase 6 lesson (memory climbed 8.5→12.2 GB, a different set of specs failed each run, all passing in isolation) recurring on a different axis. **Restart the preview before any confirmation run**, and never start or stop a server with raw Bash.
- **A mutation applied with a `\n`-based pattern can silently fail to apply on this CRLF repo, and a mutation that never applied looks exactly like a passing suite.** This caught three separate agents in Phase 10. **Confirm the file on disk actually changed** (`grep -c` the mutated substring) before trusting any mutation result. Note also that `sed -i` on this setup rewrites the whole file to LF; revert with `git checkout --` rather than un-sedding, and check `file <path>` afterwards.
- **Playwright's `keyboard.type` produces real trusted key events; a browser-automation `type` action may not.** One agent found `e.key` came back empty from the latter and fell back to `dispatchEvent`, which carries no trusted-event semantics and proves less about a real listener. Use Playwright's own keyboard API for anything testing a key handler, and **say so** if you substitute synthetic dispatch.
- **The e2e suite no longer fits one foreground run, and the workaround has a sharp edge.** 123 tests, ~16.5 minutes, against a 10-minute ceiling on a foreground command here. **The three-part split, the exact commands, and why splitting is safe are in §0 item 7 — read them there rather than reinventing them here** (rule 75: one owner per fact). The sharp edge is `--global-timeout`: it bounds the whole RUN, not a test, and a run that hits it prints "N did not run" and exits **with a passing-looking tail**. Phase 9's close hit it at test 71 of 123 and the last lines read like a clean finish. **Check the count against 123.** And do not reach for `run_in_background` to get around the ceiling — an unreaped Playwright run races its own `beforeAll` reseed against yours, which produces FK/unique errors and a cascade of unrelated timeouts in specs that pass in isolation.
- **`test-results/` is wiped by the next Playwright run, so read the artifact before re-running.** `error-context.md` under `test-results/<slug>/` carries the failure message AND a full accessibility snapshot of the page at the moment it failed — which is what identified the lost-keystroke bug in rule 76 (the Model box holding its stored value was the whole tell). Phase 9's close lost one failure's error text by re-running first and had to reproduce it from scratch, at six minutes a go. The directory is gitignored, and the slug is truncated and hashed, so `ls test-results/` rather than guessing the path from the test name.
- **Browser-pane synthetic clicks often miss React handlers.** A `computer` click at page coordinates can land nowhere because the screenshot frame is scaled (a 1400×900 viewport screenshots at 800×514, so page coords are ~1.75× too large). Dispatching from `javascript_tool` is reliable: `el.click()` on the real element works for buttons AND for React-controlled checkboxes; for text inputs use the native value setter plus an `input` event, since assigning `.value` alone does not notify React. Also: the `Menu` primitive closes on **mousedown** outside, so `document.body.click()` does NOT close it — the next trigger click then toggles it shut and your menu item is gone.

- **Prisma `mode: "insensitive"` on an identity/`equals` field compiles to ILIKE**, making `%`/`_` wildcards — caused an auth bypass AND an enumeration oracle. Use `findUnique` on a normalized value. `contains`-search is the sanctioned use.
- **Installing any npm package on Windows** drops the Linux optional-dep trees (`@tailwindcss/oxide-wasm32-wasi`, `@emnapi/*`) from `package-lock.json` and breaks the Alpine prod `npm ci`. Regenerate inside Linux: `docker run --rm -v "$PWD:/app" -w //app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only --no-audit --no-fund"` (Git Bash needs `MSYS_NO_PATHCONV=1` and `//app`).
- **`auth()` immediately after `signIn(…, {redirect:false})`** in the same action returns a stale session — read from the DB instead.
- **Non-component exports from a `"use client"` module are not values on the server** — a server page importing an array from a client file gets a reference proxy and crashes at runtime; tsc and lint both pass. Shared constants live in `src/lib/`.
- **Reseeding invalidates every session** (new user ids). Stale JWTs escape via `GET /logout`, which clears the cookie; `requireUser` redirects there. Without it the login bounce loops forever.
- **Playwright: `--workers=1`, and every DB-touching spec file reseeds in `beforeAll`** — the files share one database and alphabetical order otherwise leaks state (approvals-audit deploys an asset and drains the badge that auth-shell asserts).
- **Prisma interactive transactions default to a 5s budget** — batch per-row loops (`createMany`, one `generate_series` nextval call) instead of N sequential round trips.
- **Seed payloads must mirror what the real producers write.** A seeded approval using `to.assignee` (an employeeNo) instead of `to.assigneeId` (a row id) made the happy-path demo item fail execution honestly but confusingly.
- **CSS syntax errors only surface at `npm run build`** — tsc and lint sail past a stray brace. That's what the full battery is for; run it before every merge.
- **Reviewers are usually right but occasionally wrong about repo facts.** One review asserted a migration didn't exist when it did. Verify claims against the migrations and the live DB before acting on them — then fix the real finding underneath.
- **Browser-pane quirks:** synthetic clicks often don't reach React handlers — dispatch a real bubbling `MouseEvent`/`KeyboardEvent` from `javascript_tool`, or use `form.requestSubmit()`. The sidebar only renders at `lg:` — use a 1280px viewport. Background reviewers may stop the dev server; `preview_list` and restart before the next live check.
- **Rows created in one transaction share a `createdAt` millisecond**, so `orderBy: { createdAt: "asc" }` alone is NOT a stable order — Postgres may return them either way between reads. Phase 5 shipped a bug where this flipped which purchase line was "unit 1", corrupting the `unit-N` anchors. Always add an `id` tiebreaker.
- **A partial update must write only the fields the caller sent, and guard each on its before-value.** Filling untouched fields from the row you read (`specs ?? unit.specs`) rewrites them with a value that is already stale under READ COMMITTED — two people editing different fields of one row silently clobber each other, and a `diffOf` against the same stale row records no trace of it.
- **Prisma throws; it doesn't return.** Without a `try`/`catch` a P2028 (transaction couldn't get a connection — reachable with just two concurrent transactions) escapes as a 500 instead of the designed conflict banner. Every actions module needs the mapping.
- **Widening a path rule can leave an operation ungoverned.** Granting `/purchases` to the IT workspace made every role pass the path gate, so "who may create a request" stopped being answered by any layer until `DRAFT_ROLES` was added. When you widen a gate, ask which rule it was silently carrying.
- **A client-side navigation currently leaves the previous page's DOM in the document** (a second `<table>` outside `<main>`). Reproducible between two Phase-3 pages, so it predates Phase 5; observed in dev only, not investigated.
- **Three e2e assertions that sat close to the default 5s budget started failing during Phase 9, and the cause was NOT a large slowdown — measure before blaming one.** The clean full run went 7.5 → 8.0 minutes across the whole phase, about 7%. A *failing* run clocked 10.0 minutes, and reading that as a 33% regression was wrong: failures inflate a run with retries and artifact capture, so **never measure performance from a run that failed.** What did change is that three specific first-hit navigations and one hydration race were already marginal, and a modest growth in on-demand compilation was enough to tip them: More routes for `next dev` to compile on demand means every first-hit navigation in the suite costs more, and three assertions were sitting close enough to the default 5s budget to start losing: the offboarding wizard's first `/offboarding/[employeeId]` hit, the approvals queue's first `/approvals/[id]` hit, and `/admin/flags`' hydration race. **None was a product defect.** The remedy each time was headroom — await the URL separately from the heading, or retry a fill until it sticks — never a weaker assertion. **Expect this to recur as the app grows**, and treat "a full-suite failure that passes in isolation" as a budget problem to measure rather than a flake to re-run. One specific trap: asserting a server-rendered input's seeded value does NOT prove hydration has run, because the SSR'd HTML already carries that value — **this bullet was right and §6a rule 61 was wrong about the same thing for a whole phase**; the reconciliation, the two further proxies that also fail, and the signal that actually works are now rule 76, and rule 75 is the lesson about letting this document contradict itself. **Phase 9's close measured it again and the numbers moved a lot more than 7%:** the suite went 8.2 → ~16.5 minutes over Tasks 11–13 (103 → 123 tests, two new routes, two new wizards), and inserting one 3.3-minute spec file fifth of nine was by itself enough to tip **three** further latent races in `it-core.spec.ts` and one in `auth-shell.spec.ts`. All four passed standalone. **Two of the four were assertions that had never had headroom and one was on the wrong budget entirely** — `auth-shell.spec.ts`'s single non-helper sign-in used a bare `toHaveURL` (5s expect budget) where the file's own `login` helper uses `waitForURL` (30s navigation budget). **When you add a spec file, re-run the files that come AFTER it alphabetically, not just your own.**
- **A long-lived dev server degrades the e2e suite into phantom failures.** After several full runs its resident memory climbed ~8.5GB → ~12.2GB and a different set of pre-existing specs failed each time, always as "clicked a link, the heading never arrived" — every one passing in isolation. Restart the preview before a confirmation run; the suite went 75/75 immediately afterwards.
- **A seeded fixture that doesn't exercise its own design is a silent gap.** Phase 6 found two: every asset shared one purchase date (so the five-bucket age histogram was one bar and the 4y+ amber could never render) and nothing expired inside the 90-day warranty window (so the clustered pair the design is about never appeared). When a screen's designed state can't occur against the seed, fix the seed — that is what it is for.
- **A Prisma filter cannot compare two columns.** A derived facet whose rule spans fields (repairs' `beyond-repair` = quote ≥ 60% of cost) either changes shape or narrows to a candidate set in SQL and gets its final cut from the same rule that renders it. Two rules for one concept is the failure mode. **Repairs went the whole way: Phase 17 made the cut in memory with the pure `repairStage()`, Phase 20 expressed it as the SQL `CASE` `REPAIR_STAGE_CASE_SQL` (with an e2e asserting the two agree per asset), and Phase 24 has `listAssets` page `repairStageIds`' id set through `pagedSnapshot` — so the candidate-set-plus-memory-cut shape is the *starting* position here, not the resting one.**
- **Widening one end of a pipeline means auditing its readers.** Teaching `lifecycle.return` four outcomes also required fixing `summarizeApproval` and the "Return target" system check, both of which had `SPARE` hard-coded — and a third reader (`summarizeApproval`'s `?? "SPARE"` fallback) that invented a target for the one payload with none, contradicting the check rendered one card away.
- **A new audit `action` string is invisible to the display layer until you teach it.** `auditSentence` falls through to a raw default and `actionDot` matches exact strings, so `offboarding.completed` rendered as "X offboarding.completed Y" with a neutral dot until both were extended.
- **Returning a failure from a `$transaction` callback COMMITS it** — only a throw rolls back. Every `return conflict(...)` in the offboarding actions precedes every write, which is what makes them safe; adding a write before one would commit silently.
- **Mutation-test a new pure rule before trusting its tests.** Reversing a comparator and weakening a filter both left Phase 7's `decisionOf` suite fully green; the weakened version silently produced a `Decision` with `outcome: null` and a receipt with `undefined` money keys. Five targeted rows now kill five distinct mutations.
- **A "weak type" swallows props silently.** A component whose prop type has *every* field optional turns off TypeScript's excess-property check, so passing a prop it doesn't declare compiles and is then dropped at runtime. `Th` ate `aria-label` at four call sites this way. When a component doesn't spread rest props, the prop has to be declared and forwarded.
- **Copy that is true in one state is a bug in another.** Three of the Task 9 findings were sentences the plan wrote assuming the only way to arrive: "Equipment is settled" on a step reachable while items are undecided, "This offboarding is closed" for someone who never started one, "nothing was ever returned" on a windowed item set. When you write a sentence about state, enumerate the states that reach it — `?step=` and a rejected approval both get there.
- **Centralising a rule only helps if every call site actually goes through it.** `withRepairStage` was extracted so a stage chip could not leave the contradictory `status` pin in place — and the generic `ChipFilterRow` on the same page rendered a *second* stage chip that bypassed it entirely, with the opposite removal semantics. When you extract a rule, grep for every other place that writes the same thing.
- **A SQL "candidate set" is not safe to act on.** When a derived facet narrows in SQL and makes its final cut separately, every consumer of that `where` needs the cut — not just the one that renders the list. `buildAssetWhere` has four (list, facet counts, CSV export, and `bulkRequestStatusChange`, which acts on *all matching*), so a cut applied only to `listAssets` would let a screen showing 1 row create 7 approvals. See Task 12's preamble. **Still the rule in Phase 24, where the cut no longer runs in memory at all: `repairStageIds` is the one shared resolver, and `listAssets` now pages the id set it returns through `pagedSnapshot` rather than resolving a second time.**
- **Floating point is not inclusive on a money grid.** `quote >= cost * 0.6` looks like the 60% line the copy promises, and is — on whole pesos. `Asset.cost` is `Decimal(12,2)` and the forms take centavos, where ~2.6% of exact-60% points fall the wrong way (₱6,000.57 of ₱10,000.95 is exactly 60% and failed). Compare in whole centavos. A test that uses round numbers proves one lucky pair, not the boundary.
- **An assertion satisfied by BOTH branches of a function cannot tell them apart — and mutation testing
  will not catch it.** Task 1's self-disable test asserted its refusal matched `/permanent admin/i`, and
  the self-disable sentence happened to contain "the permanent admin". Swapping the two branches of
  `disableChange` left the suite fully green, because `allowed` is `false` either way, so every
  boolean-level mutation still failed the same tests. The fix is to assert the *distinguishing* clause
  plus a **negative** assertion on the other branch's wording, which keeps the two strings disjoint as
  they get edited. Whenever one function returns two different refusals, ask what the test would do if
  they were swapped.
- **`design_handover/` is excluded from lint/build** and must stay untouched — it's the source of truth, not code. **One deliberate exception now exists**, and it is recorded in §8: Phase 8 changed `--text-faint` away from the hex this doc specifies, because the specified value fails WCAG AA. The rule stands; the exception is documented rather than silent.
- **A `"use server"` module makes EVERY export a server action, so the worker cannot import one.** Server actions are compiled into a POST endpoint per export and are not callable in a plain Node process — which is why `secretAad`/`signPayload` live in `src/server/webhooks/sign.ts` rather than beside the webhook actions that also use them. The mirror-image trap is just as sharp: **a `src/lib/` module imported by a client component must not reach `node:`**, or the client build breaks. That is why `SIGNATURE_HEADER` had to move out of `sign.ts` (which imports `node:crypto`) into `src/lib/webhooks.ts` when `/admin/webhooks` needed to print the header name. The two rules together mean a value shared by the worker AND a client component belongs in `src/lib/` with no `node:` imports anywhere in its module graph.
- **Typing into a controlled input immediately after a navigation can lose the keystrokes to hydration**, and the assertion that follows may then pass for the wrong reason rather than failing. Playwright's `fill()` operates on the DOM; if React hydrates afterwards it rebinds the input to its prop-derived state and your text is gone, the submit posts the ORIGINAL value, and a no-op branch returns a cheerful toast. It is timing-sensitive, so it shows up in a full-file run and vanishes when you run the test alone (the route is already compiled, so the page arrives faster and loses the race). **Assert the field's initial value, fill, then assert the filled value before clicking submit** — see §6a rule 61.
- **A UI confirmation that clears itself on a timer needs headroom on the assertion, not just on the timer.** `/inventory/[id]/edit`'s "✓ Saved" is a 3-second self-clearing flash (`setSaved(true)` plus a 3000ms timeout in `src/components/inventory/asset-form.tsx`), so the default 5s Playwright budget has to cover the whole server-action round trip *before* the flash even starts. A dev server minutes into a full e2e run occasionally takes long enough that it doesn't, and the failure looks like "element(s) not found" with the button still reading `"Loading" [disabled]` — nothing points at a timing race. It failed once in three full runs and was reproduced byte-for-byte by delaying `updateAsset` 7s. Fixed with a 20s assertion, not a weaker one.
- **A new audit `action` string needs a reader that will actually see it — check that BEFORE teaching the display layer, not after.** Phase 7 initially taught `auditSentence` four new cases and then reverted all four: the app's activity feeds each scope to one `entityType` (`employee` / `asset` / `purchase-request`), and `/audit` itself renders `listAudit`'s raw `action` string plus the diff's **key names** — it never calls `auditSentence` at all. So the four new cases were unreachable by any page in the app, and their tests were exercising dead code. Before adding a case for a new `entityType`, trace which surface would actually route it through the function you're editing. **Phase 27 added a SECOND reader to check, and it is the one that bites now:** the four feeds' Action facet renders `actionLabel`/`ACTION_LABELS` (`src/lib/activity.ts`), not the sentence, so a new `action` string needs an entry there as well as an `auditSentence` case — miss it and the dropdown lists the raw action beside the labelled one and splits the rows in two, which is precisely what the phase's own final review found (I-1). `/audit` still renders the raw `action` string and has no action facet of its own.

## 8. Deferred / out-of-scope (tracked, don't lose)

- **✅ CLOSED 2026-09-03 — `./uploads` IS now backed up.** It was a **false backup**: the `backup`
  service dumped only the database, so a restore resurrected every `AssetDocument` row with no file
  behind it and every download 404ing. The service now tars `./uploads` in the **same loop iteration**
  as the dump (so the two never drift by more than one run), with matching 14-file retention, from a
  **read-only** mount. Proven rather than asserted: the tar exits 0 inside `postgres:16-alpine`, the
  archive held **77 real asset photos** the nightly job had been silently excluding, and `touch` on the
  mount exits 1. ⚠️ **Two caveats remain:** the tar is taken against a live directory, so a file
  being written at that instant could be caught mid-write (write-once PDFs make this low risk, not zero
  risk); and `./backups` still needs to exist on the host — a bind mount into a missing directory
  failed outright during this work.
- **✅ CLOSED 2026-09-03 — the seeded password can no longer reach a deployed stack.**
  `SEED_PASSWORD` was a hardcoded `"admin123"` that `README.md` publishes, in a **public** repo, with
  nothing stopping a production seed from using it. It is now env-overridable, and `prisma/seed.ts`
  **refuses to run when `NODE_ENV=production` and the variable is unset** — the case that matters,
  since the production image sets `NODE_ENV=production` in its Dockerfile. The fixture default stays on
  purpose: the whole e2e suite imports that constant to log in, so dropping it would mean setting an
  env var before a single test could run. **Reachability is what makes the value dangerous, not the
  constant.** Proven both ways: the guard exits 1 with the intended message and leaves the DB untouched
  (it sits above the `TRUNCATE`; the asset count was unchanged), and `e2e/receiving.spec.ts` still
  reseeds and passes 13/13, so `execSync("npm run db:seed")` does not trip it.
- **The physical print measurement (Phase 10, Task 11 Step 4) was never taken — but the software half
  of it is now proven one leg further than the e2e goes.** The suite measures the bar in the **DOM under
  print emulation** (377.95 CSS px). On 2026-08-26 the bar was additionally measured **inside a real PDF
  produced by Chrome's own print pipeline** (`page.pdf({ preferCSSPageSize: true })` against
  `/inventory/labels`), which exercises the `@page` rule and the print stylesheet rather than emulating
  them. Results: Chrome wrote the **MediaBox at 209.89 × 297.01 mm** (A4), and the bar rectangle came
  out at **378.000 × 6.000 px** in a 794 × 1123 px page space — **100.0125 mm** by the 96 dpi
  conversion, and **99.9748 mm** measured as a fraction of the page box, which is immune to any
  transform in the content stream. **The bar is correct to within 0.03 mm; the integer values are the
  PDF writer rounding, not app error.**

  **What is therefore still untested is exactly one thing, and it is the one that actually bites: the
  printer driver.** Browsers default to "Fit to printable area", which silently scales a page down by
  roughly 4–6% — enough to make a 100 mm bar print at ~94 mm while every number above stays perfect.
  **So the physical test is not a test of the app any more; it is a test of the print dialog.** Whoever
  does it must set **Scale = 100% (NOT "Fit to page")**, **Paper = A4**, and **Margins = None/Default**,
  then measure with a tape and record the browser, the driver and all three settings next to the number.
  If it is short *at 100% scale*, the PDF escape hatch in spec §5 stops being speculative.
- **The axe sweep's moderate/minor tail, none serious or critical** (as printed on 2026-08-26):
  `empty-table-header` **9** · `page-has-heading-one` **2** · `landmark-unique` **1**. The sweep passes;
  these are recorded so a future pass can tell a new violation from an inherited one. **Closed in Phase
  21** — by Task 6, the tail (grown by then to `empty-table-header` 12 · `page-has-heading-one` 2 ·
  `heading-order` 1 · `landmark-unique` 1) was attributed to its root causes, fixed, and all four rules
  promoted to `PROMOTED_RULES` (failing regardless of impact); see HANDOVER (n) and plan `D-8`.
- **Phase 9, Tasks 9–12 — recorded and deliberately NOT fixed; four of the five are now CLOSED.**
  **✅ CLOSED in Phase 27 —** `reference-actions.ts` HAD **no case-insensitive uniqueness check** on
  create *or* rename, so "Laptop" and "laptop" could both exist as categories (and the same for types,
  vendors, departments); migration 26's seven `lower()` unique indexes are the root fix this line asked
  for, and every create and rename in the reference, policy, stock-category and supplier modules now
  checks case-insensitively inside its own transaction and names the row it clashes with. The importers
  still *block* on the collision rather than guessing — their `refKey` guards answer "which existing row
  does this sheet name mean", a different question from a write-time index, and stay (spec §2).
  **✅ CLOSED in Phase 27 —** "**`duplicate-vendor-name` cannot currently fire at all**, because nothing
  in this app creates or renames a `Vendor`" has been false since Phase 18 shipped the supplier surface,
  and doubly so now: `createSupplier` and `updateSupplier` each carry a case-insensitive pre-check and a
  `Vendor_name_lower_key` race net. **✅ CLOSED in Phase 27 —** one import still puts up to 2,000 entries
  at the top of `/inventory/activity` (`PAGE_SIZE` 50), but the four feeds now have an **Action facet**
  (`src/lib/activity-list.ts`, `ActivityToolbar`), so `import-update` can be filtered out — or filtered
  *to* — in one click; `/audit`'s own `buildAuditWhere` still has no action facet, which is the half of
  this sentence that stays true. **✅ CLOSED in Phase 27 —** `import-update` sentences no longer render
  raw column keys: `FIELD_LABELS`/`fieldLabel` print human names sorted on the label, so the example
  above now reads "updated department, join date on Nina Robles by import".
  An `unchanged` row still opens BEGIN/SELECT/COMMIT, which on the clean round trip is the entire cost;
  reading `before` outside the transaction would cut it by roughly two thirds if the ~15 s ever matters.
  And `matchHeaders<EmployeeField>(header)` with no spec array **typechecks and silently matches the
  asset table** — two overloads, or a required parameter plus an exported `matchAssetHeaders`, closes it.
- **Phase 9 — the Validate→Apply divergence is CLOSED, all three ways.** Recorded here because the
  entry used to say it had no home. The *decision* is a pure unit test (`hasDiverged`); the *render*
  and **the world actually moving between the two calls** are both in `e2e/import-export.spec.ts`
  ("the world moving between Validate and Import is reported, not papered over"), which validates a
  two-create file, creates one of those tags directly through Prisma, then applies — so the re-plan
  resolves it as an UPDATE and the composition swap the count sums are blind to actually happens. It
  is not fragile: the mutation is a single Prisma call between two Playwright actions in one test, and
  removing it was one of Task 13's five mutation checks (the assertions fail without it). It also
  covers the V-1 branch that must NOT promise groups "below" when there are none.

- **Phase 10 — the recorded accessibility debt, counted and deliberately NOT fixed.** The axe sweep
  (`e2e/axe-sweep.spec.ts`) fails on serious/critical and **counts** everything below that bar. As of
  Task 9, across 46 of 47 page routes: **`empty-table-header` ×9, `page-has-heading-one` ×2,
  `landmark-unique` ×1.** Decision 5 of the spec is why these are recorded rather than fixed — the count
  was unknown when the phase was planned, and committing to fix an uncounted set is how a polish phase
  stops being polish. The sweep prints this table on every run, so the number is always current. **Any
  future pass should start by re-reading it rather than trusting these figures.** **Closed in Phase 21 —**
  Task 6 attributed all three (plus `heading-order`, which had since joined the counted tail at 1) to their
  root causes, fixed each, and promoted all four to `PROMOTED_RULES`; the sweep now fails on any of them
  regardless of impact. See HANDOVER (n) and plan `D-8`.

- **Phase 10 — link underlining is deliberately inconsistent, and the reason is WCAG.** Seven links in
  prose now carry a permanent underline; **thirty-seven standalone and in-table links still underline on
  hover only.** axe's `link-in-text-block` fires only where a link sits inside a block of text and colour
  is the sole distinguisher — a standalone link or a table cell is not flagged and does not need it.
  That split is conventional and correct, but it is **visible**, and the design handover has no opinion
  on it. Recorded so it is not "fixed" into uniformity in either direction without a decision.

- **Phase 10 — `/bootstrap` is the one page route the axe sweep does not cover**, because it 404s once
  any user exists (asserted in `e2e/auth-shell.spec.ts`). There is nothing to scan in any seeded state.
  Not a gap; recorded so the 46-of-47 figure is not mistaken for one.

- **Card `1m`'s "or a completed purchase" is HALF-closed by Phase 12, and the remaining half is a
  screen nobody has asked for.** `design_handover/README.md` card `1m` says labels print "straight
  from a bulk selection **or a completed purchase**". When this bullet was written the second was
  unbuildable — `PurchaseUnit` had no relation to `Asset` and nothing anywhere created an Asset from
  a purchase. **Phase 12 fixed the data half:** `Asset.purchaseUnitId` exists, `/inventory/register`
  creates tagged assets, and a registration may name a `COMPLETED` request as provenance. So a
  completed purchase's assets now exist, carry tags, and can be labelled **from the bulk selection**.
  **What does NOT exist is a "pick a completed purchase, print its labels" entry point** — you reach
  the same stickers through `/inventory`. The label sheet already accepts `?ids=` and would need no
  change; this is a selection screen, nothing more. ⚠️ **Phase 12 also went the other way once:
  Tasks 3–4 built a full receiving flow against purchase units, and amendments `C-5`/`C-11` deleted
  it, because the user's actual process is "these assets are already purchased, we are registering
  them". Read `C-5` before proposing receiving again.**

- **Phase 9, Task 13 — what the e2e suite does NOT cover, named so nobody reads 123 green tests as
  "import is fully exercised".** Six gaps, all deliberate, none a defect:
  **(a)** neither rate-limit refusal is asserted — `import` (10/min) and `import_plan` (60/min) both
  need 10+ real applies inside one minute to provoke, and the wizard's `RateLimitNotice` render is
  therefore unverified end to end even though both refusal *sentences* are unit-tested;
  **(b)** the client-side upload ceiling (`IMPORT_MAX_UPLOAD_BYTES`) is unasserted, because provoking
  it means committing a >4 MB fixture to a public repo to test one `if`;
  **(c)** the per-row write-failure panel ("Rows that failed to write") is unasserted — producing a
  genuine per-row failure needs a race or a corrupted row, and `classifyRowError` is unit-tested
  instead;
  **(d)** four of the six `ImportOption`s are exercised only in unit tests — just
  `treatDuplicateSerialAsUpdate` and `keepCurrentEmployment` are driven through the UI. The two that
  are driven cover both *kinds* of option fix (one asset, one employee), which is why the others were
  judged redundant rather than forgotten;
  **(e)** the row cap is only ever *refused*; **no apply at scale is exercised**, so the ~15 s
  full-cap write loop and the "up to 15 seconds" copy beside the Import button are unmeasured by any
  test;
  **(f)** `/inventory/export?ids=` is asserted only in its refusing form (413 past `IDS_CAP`) — the
  happy path of a bounded selection export has no e2e.

- **Phase 9, Task 7 — `rmaRef` is exported but not importable, deliberately.** `ASSET_EXPORT_COLUMNS`
  emits an **`RMA ref`** column; `ASSET_IMPORT_HEADERS` does not recognise it, so it lands in
  `HeaderMatch.unknown` and is ignored. **This is not data loss on a round trip** — an update writes
  only the fields in `AssetUpdatePatch`, so an asset's stored `rmaRef` survives untouched, and a create
  starts it null anyway. Making it importable means a **new writable field**, not a header alias, and it
  drags in the rest of the repair block (`repairQuote`, `defectiveSince`) and the question of whether a
  spreadsheet should drive the repair workflow at all. Its own task if it is ever wanted. Related: T11
  should not render "unrecognised column" warnings for columns this app itself wrote — after T7's
  `employeeNo` split, `RMA ref` is the only one left on our own export.
- **Phase 9, Task 7 — `type-outside-category` is conservative, not exact, and there is no database
  constraint behind it.** Nothing ties `Asset.categoryId` to its type's category — no FK, no CHECK —
  only `createAsset` and `updateAsset` maintain the pair, in application code. So an asset already
  stored inconsistently (seed, raw SQL, a future write path) is blocked by the import row that would
  **repair** it, and left alone by one that keeps it broken. Both directions are safe and the block's
  own advice resolves the false positive; catching it exactly would need the stored type's own
  `categoryId` in `AssetRecordRef` — a T9 contract addition to detect a state the app cannot currently
  produce. Declined on purpose, recorded here because the alternative is someone rediscovering it as a
  bug. **A CHECK constraint or a composite FK would make it exact and is the real fix if the pair ever
  matters more than it does today.**
- **Phase 9, Task 8 — the date convention is now PINNED, and the answer reversed T7's rule.** Settled by
  running the reader, not by reasoning: `readSheet` returns a real `Date` for a date-formatted cell and
  the instant is **UTC midnight** — `2026-01-05T00:00:00.000Z` byte-identical under `Asia/Manila`,
  `America/New_York` and `UTC`, with only the *local* day moving (5 at UTC+8, **4** at UTC−5).
  `parseDateCell` had been reading **local** fields on the theory that xlsx readers emit local midnight,
  so it was one day early at every negative offset. Now reads `getUTC*`, a no-op for conforming input,
  asserted under all three zones. **Do not swap those getters back without re-running the probe** — the
  round trip is `toXlsxBuffer(ASSET_EXPORT_COLUMNS, …)` → `readSheet`, about fifteen lines under
  `backups/`. Nothing else in the app reads a spreadsheet; a second reader must normalise at its own
  boundary rather than teaching the rule to guess.

- **Phase 4 leftovers:** `/approvals` shows the first 50 rows of a tab with a "showing N of M" hint but no pagination; no admin surface LISTS the `Job` table — Phase 8 half-answered this: `/admin/webhooks/deliveries`
  reads `Job` to decide whether a delivery already has a live one (that is what makes its Replay
  control honest), but nothing anywhere renders job state, `lastError` or `runAt`, so a stuck
  `EXECUTE_APPROVAL` job is still invisible outside `psql`; the worker's stale-lease recovery uses a 5-minute wall-clock heuristic (safe now because every terminal write is state-guarded).
- **Phase 5 leftovers:** the draft autosave churns unit rows (`createDraft`/`saveDraft` return only request-level fields, so `/purchases/new` never learns the unit ids it just created and every later autosave deletes and recreates the set — `/purchases/[id]/edit` does pass real ids and updates in place); `/purchases` has no sortable headers or column chooser; the ⌘K palette now returns purchase requests to `it_staff` and `viewer`, and the detail page shows money and finance notes to anyone who can reach it (no field-level restriction was specified); `addComment` deliberately still accepts comments on COMPLETED/CANCELLED requests.
- **Settled 2026-08-17 — "Admin" means system administration, and the procurement department is just Purchasing.** No renaming is pending: the `Admin` workspace (Users & roles / Webhooks / Feature flags) is software settings, the `admin` role is the superuser, and the procurement workspace is `Purchasing` as built. Recorded only so nobody re-opens it.
- **Phase 6 leftovers:** the Admin workspace has no Home of its own (`ws === "admin"` falls through to the IT layout, so an admin sees SLA breaches and fleet composition under a Users/Webhooks/Flags sidebar); "Retry this section" refreshes the whole route because RSC has no per-section refetch; section degradation is loader-level, so a render-time bug inside a section still escapes to the route error boundary; `/finance/assets` has no search, no sortable headers and no book-value column (depreciation is a policy nobody has stated); Home's `DATA` rows key on `DATA:<assetId>`, which is unambiguous only while an asset can't be both MISSING and DEPLOYED-without-a-holder.
- **Phase 3 leftovers:** CSV export buffers up to 10k rows in memory and silently truncates `?ids=` beyond 500; sort remount drops keyboard focus to `<body>`; `EntityCombobox` lacks a listbox accessible name and Home/End.
- **Phase 7, Task 14 — equipment-policy leftovers:** the before/after slot lists `auditSlots` writes on every policy edit are **stored and queryable but rendered nowhere** — `/audit` shows only `slots` as a changed *field name* (see §7's audit-reader gotcha above), and no UI anywhere in the repo renders an audit diff's *values* for any entity. A policy-scoped activity feed, or diff-value rendering on `/audit` generally, is what would make them legible. Nothing prevents two policies targeting the same department or title — the schema has no constraint and `createPolicy` only checks the policy *name* for uniqueness (**re-worded, not closed, in Phase 27:** that name check is now case-insensitive and backed by `EquipmentPolicy_name_lower_key`, and a clash names the existing policy — but it is still only the *name*, so two policies may still target the same department or title). Task 14 answered this by ordering all five `equipmentPolicy.findMany` calls that feed `resolvePolicy` by name, so the first-match tie-break is deterministic — which makes the winner **stable, not correct**. The shadowed policy stays fully editable and governs nobody; the only visible signal is its card reading `0 people`, which is ambiguous with a policy that legitimately targets an empty department. Titles are case-folded when `resolvePolicy` matches them but stored raw when created, so `Accountant` and `accountant` would collide invisibly at resolve time while reading as two distinct policies on the page — **still open after Phase 27: migration 26 covers `EquipmentPolicy.name`, NOT `appliesToTitle`.** The module is also create/delete only — **no rename and no retarget** — so fixing a typo'd title means deleting the policy, which cascades every slot and severs the audit chain; `renameRefRow` in `src/server/modules/admin/reference-actions.ts` already does this for the sibling reference-data rows (asset categories/types/departments) and is the template. `auditSlots` infers what changed by set-differencing two slot-list snapshots taken around the write, so under READ COMMITTED a concurrent edit to a *different* slot of the same policy lands inside this actor's from→to pair — the stored lists stay correct, only an inferred summary of "what this actor did" would be wrong; carrying the acted-on slot id explicitly would close it. And the policy card's "N people" counts `employment: { not: "OFFBOARDED" }`, but `listEmployees` (which lights up the policy-gaps filter) applies policies to every matching employee, offboarded included — so an offboarded person can trigger a policy gap under a policy whose own card does not count them. `/admin/equipment-policies` also has one **moderate** axe `heading-order` violation, and it's app-wide rather than new to this page: `PageHeader` renders an `<h1>` and `CardHeader` renders an `<h3>` (`src/components/ui/page-header.tsx`, `src/components/ui/card.tsx`), so every page that combines the two skips `<h2>`. It sits below the serious/critical bar the e2e specs assert on, which is why it hasn't blocked anything yet.
- **Phase 7, Task 15 — close-out leftovers:** `/offboarding` and `/reservations` have no pagination, sortable headers or facets — team-scale lists, currently unbounded (**Phase 20: `/offboarding` now has Department and Progress facets and sortable name/started/undecided headers — `OFFBOARDING_LIST_CONFIG`, spec §4.2; `/reservations` is still open**; **✅ CLOSED in Phase 26 —** `/reservations` now carries the same toolbar as its siblings: a search box over tag, model and person, Employee and Department facets, four sortable headers (`HOLDS_LIST_CONFIG` — Asset, For, Expires, Created), whole-row click and pagination that keeps the tab, the search and the facets, so both halves of this line are closed; **✅ CLOSED in Phase 25 —** `/offboarding` also gained an Export button and `/offboarding/export` route mirroring `/employees/export` row for row, and its `progress` and `due` facet counts now narrow each other through the pure `narrowedFacetCounts`, so the queue's toolbar is at parity with the other IT lists; both `/offboarding` and `/reservations` also gained a `loading.tsx` skeleton, and the wizard gained a record-shaped one plus a `not-found.tsx`); the offboarding wizard doesn't yet tick a matching row when a USB scanner hits it (Phase 8's scanner polish, §6); the farewell report is printable but neither emailable nor an Excel export (the brief's `farewell-report` export route is Phase 8); `RETURNED OK` shows `—` in the Down column because `downDays` returns `null` for anything not `status === "DEFECTIVE"`, and nothing records when a repair actually ended (**Phase 25's audit made this a named Phase 26 candidate — `docs/HANDOVER-PENDING.md` §6**; **✅ CLOSED in Phase 26 —** `Asset.repairEndedAt` (migration 25) is stamped by `prepareLifecycle` whenever an asset leaves DEFECTIVE and cleared when it re-enters, and `downDays` closes the interval on it, so a returned-OK asset reads its real downtime; the dash now survives only where no end was ever recorded, which is the narrower truth — the migration's backfill fills only rows whose audit history shows the transition and invents nothing); `/reservations` is read-only by design (scope decision #10), so holds are still created and released from the asset record, not from this page (**corrected by Phase 25's audit: no asset-record control creates or releases a hold either — `HolderControl` exposes only `assign`/`return`, nothing in `src/server` ever calls `reservation.create`, and nothing transitions a hold to `RELEASED` or `EXPIRED`, so this line promised a control that does not exist; it is the other half of Phase 26**; **✅ CLOSED in Phase 26 —** all four clauses are now false: `HolderControl` has `mode: "reserve"`, `src/server/modules/reservations/actions.ts` creates (`reserveAsset`) and releases (`releaseHold`) holds from the asset record, an empty profile slot and `/reservations` alike, and `src/worker/holds.ts` sweeps ACTIVE holds past their Manila day to EXPIRED hourly); and **✅ CLOSED in Phase 24 —** the repairs stage facet paged in memory, which scope decision 5b judged correct at team scale but would have needed a generated column at fleet scale; the stage cut has been SQL since Phase 20 (`REPAIR_STAGE_CASE_SQL`, `repairStageIds`) and `listAssets` now pages that id set through `pagedSnapshot`'s count/skip/take, so no repair-candidate row is loaded with its includes only to be thrown away, and no generated column was needed.
- **Phase 7, Task 13:** `RESERVATION_TABS` / `parseReservationTab` live in `src/server/modules/reservations/queries.ts` alongside the Prisma call, where every sibling list (`inventory-list.ts`, `approvals-list.ts`, `purchases-list.ts`, `audit-list.ts`, `employees-list.ts`) puts its pure tab/parse logic in `src/lib/*.ts` with a unit-test file. Bundled with the query, it cannot be unit-tested without pulling in the DB client — which is why it is the one list parser with no test. Worth normalising if that module gains any more logic. **Still the only one:** Phase 8's Task 13 was pre-warned about this exact precedent and put `DELIVERY_TABS` / `parseDeliveryTab` in `src/lib/webhooks.ts` with 7 tests instead — and went one better by hanging each tab's `label` and `statuses` off the entry, so the page has no parallel `TAB_LABELS` map and the where-clause has no separate ternary. That is the shape to copy if `RESERVATION_TABS` is ever normalised. **✅ CLOSED in Phase 26 —** `RESERVATION_TABS`, `ReservationTab` and `parseReservationTab` moved verbatim to `src/lib/holds.ts` with `src/lib/holds.test.ts` beside them, each tab entry already hanging its own `label` and `states` off the entry exactly as this note prescribed, and `reservations/queries.ts` re-exports them for its callers — no list parser in the codebase is without a unit test now.
- **Phase 7 so far:** **Closed in Phase 21 —** a 3-character reason minimum accepted invisible characters (`trim()` stripped Unicode `Zs` but not U+200B/U+2060), so a MISSING item could carry a blank-looking justification — shared with `requestReturn` and `rejectApproval`; `src/lib/reason.ts`'s `cleanReason` now strips `\p{Cf}`/`\p{Cc}` before every reason field's length check, through the one shared helper this note called for, and every reason site in the app goes through it (plan `D-4`, spec §6). Four separate copies of "read a string field off a `Prisma.JsonValue`" (`obj`/`str` in `approval-execution.ts`, `returnTargetStatus`, `payloadReason`, and the `target` hoist in `approvals/queries.ts`) agree today and could be one exported pair; `getWizard` reads assets and approvals as two statements, so a worker commit between them shows an item as undecided for one render (self-correcting, and `decideItem` refuses with its designed conflict — closing it needs `RepeatableRead`, i.e. a transaction per render, which was declined deliberately); an empty policy slot on a leaver reads "not held" but does not yet distinguish "already returned" from "left their name with no return at all"; **`SegmentedControl` exposes no `aria-describedby`/`aria-invalid`**, so `ItemDecision`'s "pick an outcome" `FormError` is announced but not associated with the radiogroup that caused it — and now that "no value" is a meaningful, refusable state for that control (Task 8), the props are worth adding; **all four offboarding components hand-roll the `ok / rate_limited / validation / conflict` ladder** that `loadout-view.tsx` already abstracted into a local `handle<T>()` and `asset-form.tsx` extended — the duplication is what produced two of the Task 8 review's defects (a missing `validation` branch and a dropped unclaimed-key fallback), so a shared `useActionResult` in `src/components/patterns/` would be a real fix rather than tidying; **`beyondRepair` answers `false` for an asset with no recorded `cost`**, so an asset registered without one (the forms allow it; every seeded asset has one only because `mk()` defaults it) can be quoted any amount and still read TO ASSESS with no write-off warning — it is a three-state question (yes/no/unknown) being answered as a boolean, and Task 12's record view is where "no acquisition cost recorded" should surface; **nothing has ever written `defectiveSince` except the seed and, as of Task 11, the worker** — every asset that reached DEFECTIVE before this sits at `null`, which reads as `to-assess` with a permanently blank Down column, and `updateSchema` deliberately excludes the field so there is no way to correct it but to bounce the asset out of DEFECTIVE and back in (destroying the original date); that untested `status === "DEFECTIVE" && defectiveSince === null` branch wants a backfill (`UPDATE "Asset" SET "defectiveSince" = "updatedAt" WHERE status = 'DEFECTIVE' AND "defectiveSince" IS NULL`) and an editable field before this ships to anyone with real data; **`downDays` counts elapsed 24h periods, not `Asia/Manila` calendar days**, unlike the rest of the app — **re-worded, not closed, in Phase 26:** it now governs BOTH ends of the interval (`repairEndedAt − defectiveSince` in 24 h chunks), so a repair that ran from late evening to early morning can read one day short; and **`beyond-repair` outranks `at-vendor` in `repairStage`**, so an item physically sitting at a vendor with a high quote loses its at-vendor-ness in the chip — a decision attribute hiding a location attribute, which matters if the screen is used to chase equipment. **From Task 12's review, all judged worth recording rather than fixing now:** `facetOptions` still counts the repair *candidate* set, so Category/Type/Assigned counts read slightly high in repair mode (the Status facet, the one case that offered an unsatisfiable combination, is now hidden instead); the CSV export's 10k guard runs *after* `repairStageIds` has materialised the candidate set, so that path can exceed the bind-parameter limit before the friendly 413 (unreachable at team scale); `repairStageIds` resolves outside the transaction, a deliberate exception to `bulkRequestStatusChange`'s "reads happen INSIDE the transaction" — the alternative makes `BULK_MAX` count candidates instead of the cut; the `HOLD` marker is hidden whenever an assignee is present and never discloses expiry, and **nothing anywhere sweeps `ACTIVE → EXPIRED` at `expiresAt`**, so a long-expired hold still renders as live (**✅ CLOSED in Phase 26 —** the expiry text now renders on the inventory HOLD cell, the record's held banner and Reservations tab, the profile's holding area and `/reservations`, and `src/worker/holds.ts` flips ACTIVE holds past the start of today, Asia/Manila, to EXPIRED once at start and hourly after; the marker staying hidden while an assignee is present is unchanged); and **`Reservation_one_active_hold_per_asset` still exists only in raw migration SQL (`20260814090100`), not in `schema.prisma`** — **re-worded, not closed, in Phase 26:** it is now load-bearing for a WRITE path rather than only for `reservations[0]`'s read, because `reserveAsset`'s in-transaction check is the friendly first answer while the index is the guarantee, and a `P2002` from that constraint is caught and translated into the same pinned conflict copy (final review I-1; spec §0 decision 8, which asserted the opposite, is corrected by `D-8`).
- **Phase 8, Task 1 (recorded by review, judged not worth fixing now):** the permanent-admin lock is
  **direction-blind** — `disableChange` refuses *re-enabling* the permanent admin as well as disabling
  it, so if that account were ever disabled out of band the one transition that repairs the lockout is
  the one the module forbids, leaving a manual DB edit as the only recovery (**this became reachable
  the moment Task 2 landed** — `setUserDisabled` is now a real writer of `User.disabled`, though it
  refuses the permanent admin in both directions, so the lockout still requires an out-of-band write to
  create; the correct rule would refuse only transitions that
  *reduce* its access, and the fix is not one line because `lockReason` must still report the row as
  LOCKED for the UI while `disableChange` diverges — the two surfaces that share one string today would
  have to stop sharing it); **`ROLE_OPTIONS` is not exhaustiveness-checked** (`Role[]` accepts a subset
  and its test compares against a hardcoded literal, so a sixth role would silently vanish from every
  role select — `ROLE_LABELS: Record<Role, string>` would fail to compile, but that can be fixed
  without touching `ROLE_OPTIONS`). **The test half of that was FIXED in `4b112cd`**: it now asserts
  set-equality against `Object.values(Role)` from `@prisma/client`, with the admin-first ordering split
  into its own `it` so a failure says which claim broke. The *type* half stands — `ROLE_OPTIONS: Role[]`
  still accepts a subset, and `as const satisfies readonly Role[]` plus an `Exclude<Role, …> extends
  never` guard is what would move the guarantee to compile time. Also still open: **`TargetUser.disabled`
  is declared but never read**
  by any of the three rules, despite the type's comment promising it holds only what they read; and the
  **self-disable guard fails open on an id-space mismatch** — `target.id === actorId` is the only
  identity-keyed rule and `TargetUser` is unbranded primitives, so a caller sourcing `actorId` from the
  `Employee` id space instead of `User` would silently turn a refusal into an allow.
- **Phase 8, Task 2 (recorded by review, judged not worth fixing now):** there are now **five**
  implementations of `asActionResult` — the new shared `src/server/prisma-errors.ts` plus four private
  copies that predate it (`modules/admin/policy-actions.ts`, `modules/offboarding/actions.ts`,
  `modules/purchases/actions.ts`, `modules/purchases/draft-actions.ts`). Migrating them is a one-file-each
  change but not a pure deletion: `policy-actions.ts`'s copy carries an extra **P2003** branch with a
  message specific to its own FK direction, and the purchases pair have a narrower signature
  (`() => Promise<ActionResult<T>>` rather than `() => Promise<T>`). Worth one consolidation pass once
  Phase 8's own callers (Tasks 5, 7, 13) have settled the shared shape. **P2025 is currently unreachable
  in both user actions** — `updateMany` returns a count rather than throwing, and `auditEntry.create`
  can only P2003 on a deleted actor, which no code path can produce — so `goneMessage` is insurance for
  the later tasks, not for these two. The concurrency guard is also **safe by accident of which columns
  are immutable rather than by construction**: `roleChange` reads only `isPermanentAdmin` and
  `disableChange` only `isPermanentAdmin` + `id`, both of which nothing writes, so guarding the single
  written field happens to cover each rule's whole read set. A future rule that reads `disabled` while
  writing `role` — or any real "last admin" count — would open a window the current `where` clauses
  don't cover. And `actionDot`'s new `"disable"` case is **unreachable today** (all four callers scope
  `entityType` to employee/asset/purchase-request, and `/audit` never imports it); it is commented as
  pre-wired for a feed Task 11 may add, and if that lands, `DEFECTIVE` — the *fault* family — is worth
  re-examining as the reading for a deliberate administrative action.
- **Phase 8, Task 3 (recorded by review, judged not worth fixing now):** `listUsers()` is **unbounded**
  — no `take`, no pagination, no URL state, unlike `/employees` and `/inventory` and against brief §3.2.
  Fine at five users; a departure from the house list pattern worth closing if the org ever grows.
  `roleWorkspaces()` hardcodes the artboard's literal string **"all four"** while deriving the count from
  `Object.keys(WORKSPACE_META).length`, so adding a fifth workspace would render "all four" for five —
  the count is right, the word isn't. The **`signsOutActor` field on `setUserRole` now has no consumer**:
  the toast that used it was deleted as provably unreachable (`/logout` is a route handler, so the
  redirect is a document navigation that destroys `ToastProvider` and every queued toast), and the
  pre-click dialog is what actually does the job. It is left on the return type because a notice on
  `/login` explaining *why* you were signed out is the thing that would consume it — worth doing in
  Phase 9's polish, and until then the actor lands on a bare `/login` with no explanation. Also
  repo-wide, noticed here: `router.refresh()` after a server action that already called
  `revalidatePath` is a **second RSC round trip per mutation** (`policy-editor.tsx` does the same), and
  `retryAfter` is never cleared on success in any of these components, so after a rate-limit window
  slides you can briefly see a success toast and a "you've hit the cap" banner together.
- **Phase 8, Task 4 — two PRE-EXISTING Phase 2 bugs found by review, deliberately NOT fixed** (auth code
  behind `e2e/auth-shell.spec.ts`, outside this phase's scope — but both are real, so don't lose them):
  **(1) `createBootstrapAdmin` doesn't validate its domain field.** `src/server/auth/actions.ts:103` does
  `String(...).trim().toLowerCase()` and nothing else, so bootstrapping with `someone@corp.com` stores
  that verbatim; `isAllowedDomain` compares against the text after the last `@`, so it can never match and
  **every signup is refused, permanently, from the deployment's first minute** — with the error reading
  "Signup is limited to @someone@corp.com addresses." This is exactly the failure `domainValue`'s doc
  comment describes, on the one path that doesn't call it. The fix is to route bootstrap through
  `domainValue` (`src/lib/admin-flags.ts`) or move that function somewhere both can reach.
  **(2) `/login` gates the Microsoft button on one env var where the provider needs three.**
  `src/app/(auth)/login/page.tsx:19` tests only `AUTH_MICROSOFT_ENTRA_ID_ID`, while
  `src/server/auth/index.ts:35-41` registers `MicrosoftEntraID` only when ID, SECRET **and** ISSUER are
  all set — and its own comment says the conditional registration exists to stop a half-set env showing a
  broken button. With only the ID set and the flag on, the button renders and `signIn` throws on an
  unregistered provider. Low reachability today (the flag can't be turned on), but it widens the surface
  scope decision #7 reasons about.
- **Phase 8, Task 5 (recorded by review, judged not worth fixing now):** `m365_sso`'s displayed state is
  the **raw** `row.enabled`, not an effective one — `/login` gates the button on
  `enabled && !!AUTH_MICROSOFT_ENTRA_ID_ID`, so on a database where that row was enabled out of band with
  no env vars configured, `/admin/flags` shows the switch ON while `/login` shows nothing. That is the
  same "admin page describes a reality the enforcement point doesn't have" that `FlagRow.enabled` exists
  to prevent, just not applied to this flag; mitigated by the UNAVAILABLE pill and its sentence sitting
  right beside it, and unreachable in-app since the flag cannot be turned on. **`setFlag`'s zod schema has
  no `.max()` on `key`**, so a large string is parsed before `flagChange` rejects it — bounded by Next's
  server-action body limit, cosmetic. The value editor's `FormError` is **not** wired to its `Input` via
  `aria-describedby` (it is `role="alert"`, so it is still announced on appearance, and `FormField`
  already does this properly but is bypassed here). `SwitchProps` exposes no `aria-describedby` channel at
  all, so a disabled switch's reason cannot be programmatically attached — harmless today because a
  disabled `<button>` isn't focusable and the sibling `<p>` is read in document order, but worth knowing
  if a switch ever needs to be focusable-but-refusing. And **presentationally the flags panel departs from
  card `3h`'s artboard**: the artboard is one bordered container of divider-separated rows with the mono
  key as the primary label, where this ships a discrete `Card` per flag with the human label primary and
  the key demoted to 10px. Deliberate and arguably better, recorded so it reads as a choice.
- **Phase 8, Tasks 8 and 9 (recorded, judged not worth fixing now):** **`emitWebhook` can fail the
  transaction it is called from.** Scope decision #10 forbids I/O and it does none, but `create` is
  still a write: the emitter reads an endpoint, a concurrent `deleteEndpoint` commits, and
  `webhookDelivery.create` then violates its foreign key. In `executeApproval` that surfaces as
  `EXECUTION_FAILED` on the approval, which a retry clears (the endpoint is gone by then, so the retry
  emits nothing). Not guardable cheaply: swallowing is unavailable because a failed statement poisons
  the Postgres transaction, and emitting outside the transaction trades this for "webhook fired for a
  change that rolled back", which is strictly worse. Narrow enough to accept, recorded so it isn't
  rediscovered as a mystery. **`Job_one_live_deliver_per_delivery` and `Job_deliver_payload_shape` exist
  only in raw migration SQL, not in `schema.prisma`** — the fourth and fifth constraints in that
  position (`Reservation_one_active_hold_per_asset` is already on this list for the same reason), so
  `prisma db pull` still would not reproduce the schema this app actually depends on. **Extended in
  Phase 27 — there are now TWELVE:** eight `lower()` unique indexes (`User_email_lower_key`, plus
  migration 26's `AssetCategory_name_lower_key`, `AssetType_category_name_lower_key`,
  `Department_name_lower_key`, `EquipmentPolicy_name_lower_key`, `Vendor_name_lower_key`,
  `StockCategory_name_lower_key`, `StockCategory_prefix_lower_key`) and four partial unique indexes or
  CHECK constraints (`Reservation_one_active_hold_per_asset`, `Job_one_live_execute_per_approval`,
  `Job_one_live_deliver_per_delivery`, `Job_deliver_payload_shape`). Prisma cannot express a functional
  index, which is why none of the eight can be mirrored; the full list and the pre-redeploy duplicate
  check live in (t). **The delete
  affordance on `/admin/webhooks` is disabled from `endpoint.attempts`, which counts ALL deliveries** —
  so an endpoint whose entire history is a single dead delivery from a long-deleted receiver can never
  be deleted through the UI, only disabled. Correct per the rule (the ledger is the record of what was
  sent), but there is no "purge this endpoint's history" path anywhere, and Task 13 is where one would
  naturally live if it is ever wanted.
- **Phase 8, Task 12 — a PRE-EXISTING seed gap, surfaced by a fixture review and deliberately left
  visible:** **`APR-2031` is seeded `EXECUTED` but carries no `assetId`**, and
  `src/worker/execute-approval.ts:63-65` refuses every approval type with
  `if (!approval.assetId || !approval.asset) return fail(…)` before doing any work. So the seed contains
  an executed approval the real execution path could never have produced — which also means it can never
  have emitted `approval.executed`, which is why Task 12's webhook deliveries have no honest source row
  at all. Task 12's quality review proposed adding `assetId` to that literal; declined, because it edits
  an approval the IT Home and other fixtures read, needs a full ~8-minute Playwright run to clear, and
  would silently close a gap worth knowing about. The alternative — adding a *new* `EXECUTED` approval —
  is worse: `e2e/approvals-audit.spec.ts` pins `Closed 2`. **If Phase 9 ever tidies the seed, this is the
  one-line fix, and it needs the full e2e suite run behind it.** Related, and cheap to get wrong the same
  way: `prisma/seed.ts` is NOT prettier-formatted (compact one-line object literals per row) — running
  `npx prettier --write` on it produces a ~575-line reformat that buries any real change.
- **Phase 8, Task 10 (recorded, judged out of scope):** **there is no `secretVersion` column and no
  key-id header**, so a receiver cannot support an overlap window during a rotation — rotating is a hard
  cutover, which is why `ROTATION_WARNING` exists and why `/admin/webhooks` states it before the click.
  An overlap scheme (nullable `secretPrev` + a dual-signature header) was declined deliberately: this
  phase has one migration. **`lastError` for a network failure is undici's terse `"fetch failed"`** with
  no cause chain, so "DNS did not resolve" and "connection refused" are indistinguishable on the
  deliveries page; surfacing `err.cause.code` would fix it and was left alone because the retry behaviour
  is identical either way. **The delivery is signed with the secret decrypted AT ATTEMPT TIME**, which is
  what makes rotation affect in-flight deliveries — deliberate (a replay after rotation must use the live
  secret), but it does mean a delivery's signature is not reproducible from the row afterwards.
  **IPv6 literals are not checked by `urlSchema`** (§6a rule 33) and `redirect: "manual"` does not change
  that: it closes the redirect hop, not the first hop.
- **Phase 8, Task 13 (recorded, judged out of scope for this task):** **`WebhookDelivery.nextAttemptAt`
  is written by nothing but `prisma/seed.ts`.** The worker's retry path (`mark` in
  `src/worker/deliver-webhook.ts`) never sets it; the only other writer is the DELIVERED path, which
  *clears* it. So the column is indexed (`@@index([status, nextAttemptAt])`), seeded on one fixture, and
  otherwise permanently `NULL` for every delivery the running code has produced — which is why
  `listDeliveries` deliberately does not read it and says so, and why `replayDelivery` clears it on
  reset (§6a rule 60). **Either the worker should maintain it or the column should go**; a "next attempt"
  column sourced from it would look authoritative and be blank in production. The real schedule is the
  job's `runAt`, which `listDeliveries` already fetches for the live-job set and could surface for a few
  lines more. Note this also makes the seed's `RETRYING` fixture a value the running code cannot produce
  — a narrow instance of §6a rule 51, disclosed in the seed's own comment.
  **The deliveries list has no pagination and no per-tab counts.** No pagination is scope decision #12
  (matching `/approvals`), and the page states "Showing N of M" — but unlike `/purchases` and
  `/reservations`, whose `Tabs` carry a count per tab, these do not. Four extra `count`s in the existing
  `Promise.all` would close it; left out because the plan did not ask and `deadReplayable` already
  surfaces the number that matters. **`/admin/webhooks/deliveries` has no sidebar entry**, so no nav item
  highlights while you are on it (`navIsActive` compares whole pathnames) — it is reached from
  `/admin/webhooks` and from `endpoint-editor.tsx`'s `N dead` link, and the breadcrumb goes back. That
  matches every other sub-page in the app, so it is recorded rather than fixed. **`endpoint-editor.tsx`
  hardcodes `?state=DEAD`** rather than deriving it from `DELIVERY_TABS`; harmless while `DEAD` is a
  `DeliveryStatus`, worth knowing if the tab ids ever stop being status names. Lastly, **the batch replay
  is rate-limited per row** (one `checkRate` token for the batch plus one per delivery, against a 60/min
  cap), which is invisible at seed scale and correct at real scale — and now visible when it bites,
  because the action reports `queued` against `attempted` with the reason.
- **Phase 9, Task 5 — the farewell report cannot say WHO decided an item, or WHEN.** `Decision`
  (`src/lib/offboarding.ts:113`) carries `refNo`, `outcome`, `state`, `reason` — no actor, no
  timestamp — so neither the printable report nor the new `.xlsx` export can attribute a decision. For
  a document HR reads and files, that is a real gap. It was declined for Phase 9 deliberately and the
  reasoning is worth keeping: **"decided" is DERIVED from the approvals that exist** (Phase 7 scope
  decision #3 — there is no wizard-state table, which is what makes a half-finished offboarding N
  correct records instead of a lost session). So the actor and the moment are not two fields to add to
  a type; they are a join against the `Approval` row and its `AuditEntry` trail, where the data already
  exists. Widening `Decision` to carry them would touch the wizard, `decisionOf`, and every consumer,
  and would mean a domain type growing fields for an export's benefit. **The data is not lost — it is in
  the audit log.** If HR asks for attribution on the report, this is a small feature against
  `AuditEntry`, not a schema change.
- **Phase 9, Task 4 — the facet-count half of §8's candidate-set rule, for employees.**
  `employeeFacetOptions` never receives `gapsOnly`, so with "Policy gaps only" active the toolbar's
  department/employment counts describe the candidate set while the table and the export show the cut
  set (3 of 10 in the seed). Identical in kind to the assets version already tracked here, and now
  carrying the same explanatory comment in `src/server/modules/employees/queries.ts`. Accepted for the
  same reason: they are read-only display counts, and both consumers that ACT on the set
  (`listEmployees`, `employeeExportRows`) resolve the real cut through `filteredEmployees`. **Pre-existing
  — Phase 9 fixed the list/export half of this pattern and deliberately left the count half**, so a
  future reader has a signal rather than a mystery. Closing it means teaching the facet counts to run
  the same cut, which costs a full resolve per facet. **Phase 24 note:** the assets half has moved on —
  `listAssets`' repair branch pages `repairStageIds`' SQL id set through `pagedSnapshot`, so what these
  two still have in common is only the *facet-count* half of the pattern; the employees `gaps=1` counts
  are unchanged and the cut here is still in memory.
- **Phase 8, Task 14 — a DELIBERATE, STANDING deviation from `design_handover/README.md`, recorded
  here because a CSS comment is not durable enough.** The design handover specifies
  `text-faint` as **`#98A2B3`** (light) and **`#6B7480`** (dark), for "mono metadata, placeholder".
  Both fail WCAG AA: measured **2.40:1** against `--canvas` and **2.575:1** against `--surface` in
  light, **3.41:1** against `--surface-raised` in dark, where AA requires 4.5:1 and grants no relief
  below 18pt. `src/app/globals.css` now ships **`#667085`** (light, 4.64:1 on canvas / 4.98:1 on
  surface) and **`#868f9c`** (dark, 4.93:1). The design doc has NOT been edited — it remains the source
  of truth for everything else, and this is the one place shipped code knowingly disagrees with it.
  **Two consequences worth knowing before anyone "fixes" this back.** (a) *Light mode lost a tier.* At
  4.5:1 against `--canvas` there is no room for a third step: anything lighter than `--text-muted`
  fails, so light-mode `faint` and `muted` now hold the SAME value while dark mode keeps all three. The
  token survives because the semantic tier is still real and a lighter canvas would re-separate them.
  (b) *This overrides a Phase 7 precedent.* Phase 7 hit the same defect on the offboarding wizard's
  locked step-bar entries and fixed it at the CALL SITE (`text-fg-faint` → `text-fg-muted`, recorded in
  §4). Phase 8 fixed it at the token instead, because ~24 usages shared the defect and patching a
  subset leaves two tokens meaning one thing. Both fixes are correct for their scale; the call-site one
  is now redundant but harmless. If the design system is ever revised, revisit this together with the
  `heading-order` violation below — they are the two known standing a11y items.
- **Phase 8, Task 14 — the flake nobody has closed.** `e2e/it-core.spec.ts:127` ("edit writes
  field-level history rows") failed once during Task 14 and then passed on three subsequent runs
  including the full battery. It is the "✓ Saved" self-clearing-flash class that §7 records as fixed in
  Phase 7 with a 20s assertion — so this is either a second site that fix did not cover, or a genuine
  intermittent. **Recorded, not closed**: "it passed on re-run" is not proof, and this project has
  already had one failure of exactly that shape turn out to be a real timing bug with a real cause. If
  it reappears, read the Playwright dump before touching the assertion.
- **Phase 8 leftovers (recorded, judged out of scope):** `/admin/webhooks/deliveries` has **no
  pagination** — scope decision #12, matching `/approvals` (closed by Phase 17); it shows the newest 50
  with a "Showing N of M" line, and unlike `/purchases` and `/reservations` its tabs carry **no per-tab
  counts** (four extra
  `count`s in the existing `Promise.all` would close that). **`replayAllDead` is rate-limited per row**,
  because it calls `replayDelivery` per delivery and each call spends a token against the 60/min cap —
  invisible at seed scale, correct at real scale, and now visible when it bites because the action
  reports `queued` against `attempted`. **✅ CLOSED in Phase 24 — nothing pruned `WebhookDelivery`**, so
  the ledger grew without bound and there was no retention policy anywhere in the schema; the worker now
  deletes `DELIVERED`/`DEAD` deliveries and `DONE`/`DEAD` jobs older than **90 days** in id batches of
  1000, once after `recoverStale` at start and hourly thereafter, with `npm run worker:prune` for a
  one-off pass and `RETENTION_NOTE` on the deliveries page stating the rule. No schema change: the
  policy is the constant in `src/lib/retention.ts`. **`WebhookDelivery.nextAttemptAt`
  is written by nothing but the seed** (§6a rule 60) — the job's `runAt` is the real schedule, so either
  the worker should maintain the column or it should go. (The raw-SQL-only constraints
  `Job_one_live_deliver_per_delivery` and `Job_deliver_payload_shape` are already tracked in the
  Tasks 8-and-9 bullet above — not repeated here.)
- **`/bootstrap`'s copy under-states the lock**: `src/app/(auth)/bootstrap/page.tsx` promises the
  permanent admin's *role* can never be changed, but Phase 8 widened that to access as well. Worth
  aligning when Task 3 lands. The corollary belongs here too — a bootstrapped permanent admin's account
  **can never be revoked in-app** if the holder departs or the credentials leak. That is the accepted
  cost of the lock, not an oversight.
- **Phase 1 gap, found during Phase 8's Task 1 review:** `/signup` is not gated on user count, while
  `/bootstrap` permanently 404s once any `User` row exists. On an empty database, whoever reaches
  `/signup` first creates a `viewer`, closes bootstrap forever, and the system has **zero admins with
  no in-app recovery**. A last-admin guard would not have prevented it — that prevents removing the
  last admin, it cannot conjure one.
- Entra SSO real wiring (needs tenant creds). Real product photography, brand mark, barcode generation (striped placeholders today). Off-device backups (nightly `pg_dump` to a local volume ships; copying elsewhere is the user's call). HR review of the accountability-form acknowledgement copy. `WebhookEndpoint.secret` encryption (Phase 8). CI workflow + jsdom component tests (declined in Phase 1, revisitable).
- **Phase 13 (asset classes) — deferred, with D- references.** An **unassigned-holder detector for
  Purchasing** — IT's Home flags an unassigned `DEPLOYED` laptop; nothing does the same for an
  unassigned `OPERATIONAL` car, and a pool car with no driver is legitimately correct today (D-13).
  A **policy slot naming a type whose empty category was later flipped** to Purchasing — reachable only
  by a direct-DB edit, after which `resolvePolicy` reports a permanent gap (D-14). The **year chip's
  empty-state count** — `purchaseYear` survives the class switch into a view that may have no such
  year, and `hasFilters` counts it while no chip renders it, so the empty state reads "0 active
  filters" (D-16, pre-existing). **One markup for a class switch** — Finance's tab is a `<nav>`, the
  inventory toolbar's is `role="navigation"` (D-16; this is also why the axe sweep's `landmark-unique`
  count is 1). **Task 6's wrong-class register POST and mixed-class bulk gates are unreachable from
  the UI** and are covered only by the trigger and by review, not by e2e (D-13). **`updateAsset`'s
  cross-class guard is likewise unreachable** — Task 7 filtered the edit form's categories to the
  asset's own class first, so case 15 was dropped from Task 11's e2e rather than written (D-15).
  **Home's leaver card pins `cls: "IT"`** on a leaver's holdings while the offboarding queue does not
  — the first seeded leaver holding a car will make the two disagree (D-19). **`worker:once` in e2e
  drains the whole job queue**, so those same cases also fire the seed's webhook delivery — pre-existing
  behaviour, not introduced by this phase, and bounded (D-19).
- **Phase 14** closed the above on 2026-09-07; spec `2026-09-07-department-owned-classes-design.md`.

---

## 9. Stakeholder requirements from the 2026-09-02 Admin meeting (B and C shipped in Phase 18; D's first half shipped in Phase 19, see (l); D2 shipped in Phase 22, see (o))

> ⚠️ **"Admin" below means the PURCHASING DEPARTMENT** — confirmed by the user on 2026-09-06
> (*"remember admin = purchasing"*). In this codebase `admin` is the sysadmin role and Purchasing is
> the `purchasing` workspace / `purchasing_staff` role. Phase 13 built item **A** on that reading;
> nothing here should be read as concerning the `admin` role.

Raised by **Anj, Maynard, Neil, Salem and Mary**. Recorded verbatim-in-substance because none of it is
specced yet and it is the only record. **Four distinct subsystems, not one feature** — the decomposition
below is the important part, and item **D** breaks an assumption the whole codebase rests on.

**Sequencing agreed with the user on 2026-09-02:** finish Phase 12 as scoped, then take **A** as Phase
13. Nothing here was folded into Phase 12 mid-flight.

### ⚠️ D IS A SECOND DOMAIN, NOT AN EXTENSION — read this before anyone models supplies as assets

The pantry workbook reports figures like **"566 available"**. In this schema `Asset.tag` is `@unique` and
there is **one row per physical thing**. 566 bottles of detergent as `Asset` rows would mean 566 unique
tags, each carrying a lifecycle `status` (`SPARE`/`DEPLOYED`/`DEFECTIVE`…), each assignable to an
`Employee`, each collected back by the offboarding wizard, and each entitled to a printed sticker.

**There is no quantity-tracked model anywhere in this schema** — all 24 models are per-instance.
Consumables need a different shape entirely: an item, a ledger of stock movements, and a balance
**derived** from that ledger (never stored — §6a's *derived state beats stored state*, and the meeting's
own complaint is that the stored number cannot be trusted). FIFO for pantry items additionally needs
batch dates on receipts, and "reconcile receipts, movements and physical counts" is a **stocktake**
feature — the one that makes the number believable.

**Modelling supplies as `Asset` would break the label sheet, the offboarding wizard, the approval queue
and the secrets surface simultaneously.** It must live beside the asset register, not inside it.

### The four subsystems

- **A · Asset classes — Phase 13, agreed next.** IT assets versus non-IT (cars, buildings, furniture,
  pantry equipment such as microwaves and air purifiers). Today `Asset` is IT-shaped: offboarding
  collects assets from leavers, `/inventory/[id]/secrets` holds credentials, the label sheet prints a
  sticker per asset, and the scan card answers custody. **A building should not be offboarded; a car has
  no credentials; a desk needs no custody QR.** A class dimension lets non-IT assets register without
  inheriting IT workflows. **Do this first: both B and D need to know what KIND of thing they are
  looking at, and doing it later means each invents its own answer.** The meeting also noted that
  **Finance records some assets differently from Admin**, so the same physical thing may need two views
  — that belongs in this phase's brainstorming, not bolted on after.

- **B · Vendor / supplier master data — Phase 18, shipped 2026-09-08 (see (k)).** `Vendor` **already exists but is a stub** — `id`, `name`,
  `locked`, `assets[]`. Wanted: product/service category, company name, registered name, contact person,
  address, phone, email, registration information, contract status and dates/terms, bank details, and
  uploaded documents (certificates, registration records). Plus **search by supplier name returning the
  profile and past purchase orders**, so purchasing stops retyping company details; and **role-gated
  access** — admin maintains the master list, others get access matching their purchasing or review
  responsibilities. Anj asked whether fields such as bank details can be added; they can. **Admin owes a
  cleaned-up starting dataset** (the current list is several years old and missing suppliers) — chase it
  before building, because an empty master list makes the search unreviewable.

- **C · Purchasing workflow extensions — Phase 18, shipped 2026-09-08 (see (k)).** Mostly small, and some already exists:
  - **Department tagging on requests.** `Department` exists but links only to `Employee` and
    `EquipmentPolicy` — **not to `PurchaseRequest`**. Admin receives requests from HR, Finance, IT and
    others, and wants routing, approval responsibility, reporting and accountability off it.
  - **Attachments on requests.** `AssetDocument` exists for assets; requests have no equivalent.
  - **Serial capture at receipt — ALREADY BUILT** by Phase 12's receive screen. Salem's point that
    receipt entry may still need manual confirmation is satisfied by that screen: nothing is written
    until submit.
  - **Imported assets with no purchase request must stay visible and be marked as such**, so Finance,
    Admin and auditors can tell historical capitalised assets from newly approved purchases. Today
    `Asset.purchaseRequestId` is nullable and **was entirely unused before Phase 12**, so "has no PR" is
    currently indistinguishable from "predates the feature". That distinction needs deciding, not
    inferring.
  - Locating an asset by tag, QR, barcode, serial or other identifier — **tag, QR and serial already
    work**; barcode is the Code 128 on the label sheet, readable by the USB desk scanner.

- **D · Consumables and stock control — first half (D1) shipped in Phase 19, see (l); D2 shipped in
  Phase 22, see (o).** The largest single piece of work in the project so far — bigger than any phase to date.
  Office supplies, pantry supplies. Stock-in and stock-out recording with automatic available quantities
  — **shipped**: items, categories with an automatic code series, an append-only movement ledger
  (opening/receipt/issue/adjustment) with balances always derived, a blind-count stocktake with variance
  review, a spreadsheet importer, and a balances export, all under `/stock`. **D2, Phase 22 (see (o))**:
  FIFO lot allocation with optional expiry (the lots D1 recorded are now consumed earliest-expiry-first,
  then oldest-first), lot costing set once, write-off, receipt documents, and three reports — on hand and
  value, consumption by department and month, expiring and expired lots — each with an xlsx export;
  physical tagging of pantry stock was not built (consumables stay quantity-tracked, per the warning
  above). Reconciliation between receipts, movements and physical counts is the
  stocktake D1 already ships. **automatic item-code series by category or source document** (examples
  raised: separate series for cleaning materials, supplies, furniture and fixtures), searchable and
  supporting new-item creation, and distinguishing existing items from new ones with updates that don't
  require retyping, are also shipped in D1's importer and items list. **See the warning above** (written
  before D1 existed) **for why this had to be a second domain, not an `Asset` extension — D1 followed
  that design.**

### One number worth carrying into D's brainstorming

The meeting's own example is the whole argument for deriving balances rather than storing them: the
workbook says **566 available**, and Anj, Mary and Salem all doubted it, because receipts and issues are
keyed in by hand. A stored total that nobody trusts is worse than no total — it gets used anyway. Design
the stocktake and the variance report **first**, not last.
