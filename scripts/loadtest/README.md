# Load test (Phase 43)

Fifteen people working at once against a running app: 10 IT, 2 Purchasing, 2 Finance, 1 admin, signed in as the
scale seed's test accounts `perf01`–`perf15@thebackroomop.com` (spec `docs/superpowers/specs/2026-10-19-performance-at-scale-design.md` §4).

## Laptop safety — read first

- **Run it alone, against staging only** (the Docker stack). Never against the dev database or port 3100.
- **Stop the dev server and the Playwright battery first.** Staging, the load test and the browser battery never
  run at the same time: the i7 laptop crashes under that much load.
- A full run is **8 minutes at most** (`--minutes` refuses more). Both scripts stop hard at `--minutes`.
- The readers are 15 people at most, each with one request in flight and 2–6 s of think time, and a 30 s timeout per
  request. The writers start **one** headless browser, never more.

## What runs

| Script | What it does |
|---|---|
| `run.mjs` | **Readers.** 15 people over plain HTTP. Each signs in through `/api/auth/csrf` + `/api/auth/callback/credentials`, keeps their own cookies, and opens pages from their role's weighted scenario (`scenarios.mjs`): lists with filters, search, sort and page 2, records, Home, Worklist, Approvals, reports, activity. Records `{ user, route, ms, status }` per request; ids in routes become `:id`. |
| `writers.mjs` | **Writers.** One headless Chromium with 3 contexts. perf01 and perf02 (IT) assign a scale-seed spare from its asset page, return it for triage, and triage it back to Spare. perf15 (admin) approves or rejects PENDING requests from the IT Approvals queue (at most `--max-decisions`, default 12, so a second run still finds some). Records `{ user, action, ms, ok }` per step, plus each server action's own POST time. |
| `report.mjs` | **Report.** Reads the JSON files and writes Markdown: targets met or missed, then per route and per action count, p50, p95, max and errors, slowest p95 first. |

`scenarios.mjs` holds the role scenarios and the route normalising; `common.mjs` the shared limits and helpers.
Record ids are never hard-coded: every page a person opens is scanned for record links, and a record step opens one
of those.

## Run it

The test accounts' password comes from `SEED_PASSWORD` (staging's seed password). The scripts never print it and have
no fallback: they refuse to start without it.

PowerShell, on the staging laptop, with nothing else running:

```powershell
$env:SEED_PASSWORD = "<staging's seed password>"
$base = "http://192.168.1.193:3000"
$dir = "$env:TEMP\loadtest"
# Terminal 1 — the readers:
node scripts/loadtest/run.mjs --base $base --minutes 6 --out "$dir\readers.json"
# Terminal 2, started at the same moment (set the same three variables there first) — the writers:
node scripts/loadtest/writers.mjs --base $base --minutes 6 --out "$dir\writers.json"
# When both have finished, the report:
node scripts/loadtest/report.mjs --in "$dir\readers.json" --in "$dir\writers.json" --label baseline --out docs/perf/2026-10-19-baseline.md
Remove-Item Env:SEED_PASSWORD
```

Options:
- `run.mjs --users <1–15>` runs only the first N people (a quick check before the real run).
- `writers.mjs --max-decisions <n>` caps approve/reject decisions per run (default 12).
- Ctrl+C stops either script early. During the load it still writes what it measured; during the sign-ins (it is
  hooked before them) it stops at once and no load runs.

Start the server with `SLOW_QUERY_MS=200` (any positive number of ms) to log every Prisma operation slower than
that as `[slow-query] <Model>.<operation> <ms>ms`. Unset, the log is off. Arguments are never logged.

## Reading the report

- Targets (spec §2 goal 3): p95 ≤ 1.0 s for lists, records and actions; p95 ≤ 1.5 s for Home and the reports
  (equipment by client, depreciation, stock reports); no request over 5 s; no errors.
- Reader times are measured from the request to the last byte of the HTML.
- A successful writer step waits (at most 10 s) for its server-action responses to finish before the next click or
  navigation, so the harness does not cut them off. A server action the browser still aborts (`net::ERR_ABORTED`)
  after its step succeeded is counted under *Aborted after success*: not an error, and not in the timings. The same
  abort on a failed step is an error.
- *Skipped steps, by reason* says why a step did not happen: `assign` — no assignable scale-seed spare on the Spare
  page it read (with the page's row counts), or every candidate opened was passed over (with what each offered
  instead of Assign); `approve or reject` — no unclaimed PENDING request on the queue's first page (with its row
  counts), the decision cap, or the request no longer offered Approve/Reject.
- Writer `server action · …` rows are the server action POSTs alone, from the browser's network timing; these are
  what the targets judge. The other writer rows are the whole step in the browser: from the confirming click to the
  success toast, i.e. the action's round trip and the toast's render. The page refresh (`router.refresh()`) starts
  after the toast, so it is not in that time; its request still adds to the server's load.
- A target with nothing to judge reads CHECK, never MET; so does the action target when the writers ran but recorded
  no server-action timing.
- Home is one row per workspace (`/`, `/ [purchasing]`, `/ [finance]`, `/ [admin]`), and every admin-workspace page
  carries `[admin]`; other shared pages are one row whatever the workspace.
- A redirect counts as an error: a reader should never be bounced (to `/login`, or to its landing page from a page
  its role may not open).
- Database connection timeouts are not visible from outside: check the web container's log for `P2024`.

## What a run changes on staging

- Each IT writer cycle assigns one spare, returns it and triages it back to Spare, so the spare pool ends the same
  size, with new audit and executed-approval rows. No new cycle starts in the last 45 s, but a cycle cut by Ctrl+C
  can leave one device assigned or waiting for triage.
- The approver approves or rejects up to `--max-decisions` PENDING requests; those stay decided. The scale seed
  leaves about 28 unclaimed PENDING requests, so after two default runs the queue is mostly worked; re-seed before a
  third measurement if the approve step is to be part of it.
