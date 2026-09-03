# Staging Hosting — Comparison and Recommendation

**Status:** decision document. Nothing is built. Prepared 2026-09-03 at the user's request
("compare them properly first").

**The decision:** where a staging deployment of Inventory v2 should run, so that a phone can scan a
printed label without depending on the office network.

**Why it came up:** making the QR work on the office LAN needs a Windows firewall change, a UniFi
client-isolation change, a DHCP reservation and a VLAN check, and even then it only works on site and
over plain HTTP. A hosted URL removes all of that at once. The question is what it costs to get there.

---

## 1. What this application actually requires

Every line below was read out of the repository, not assumed. **This table is the actual test** — a
platform is suitable exactly to the degree it satisfies it.

| # | Requirement | Where it comes from | Hard? |
|---|---|---|---|
| R1 | **Node 22 or newer** | `Dockerfile:1` (`node:22-alpine`). The QR dependency is ESM-only with no `"type":"module"` in this package, and works *because* Node ≥22 allows `require()` of ESM. | **Hard.** A platform pinned to Node 20 breaks the label QR. |
| R2 | **A long-running background worker** | `src/worker/index.ts` — polls every **3 s** (`POLL_MS`), recovers stale leases after **5 min** (`STALE_MS`), leases jobs with `FOR UPDATE SKIP LOCKED`. Executes approvals and delivers webhooks. | **Hard.** Approvals do not execute without it. |
| R3 | **A persistent, writable filesystem** for asset documents | `document-actions.ts:56-57` writes `process.cwd()/uploads/assets/<id>/…`; `download/route.ts:22` reads it back. | **Hard**, unless replaced by object storage. |
| R4 | **PostgreSQL 16** | `docker-compose.yml`, Prisma schema, raw SQL using `substring()` and `FOR UPDATE SKIP LOCKED`. | Hard. Managed is fine. |
| R5 | **Migrations on release** | `prisma migrate deploy`, currently the `migrate` compose service. 11 migrations. | Hard. |
| R6 | **A single server action that may run long** | `IMPORT_ROW_CAP = 2_000` with `bodySizeLimit: "4mb"`. A 2,000-row import is one action doing per-row work. | Soft — but it fails loudly if the platform's function timeout is short. |
| R7 | **7 environment variables** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `AUTH_SECRET`, `SECRET_ENCRYPTION_KEY`, `APP_BASE_URL` | Trivial everywhere. |
| R8 | **Backups of both database and uploads** | The `backup` service now dumps the DB *and* tars `./uploads` in one cycle. | Soft — managed providers replace the DB half; the uploads half depends on R3's answer. |

Two things that are *not* requirements, and are worth saying so nobody optimises for them:

- **`output: "standalone"`** in `next.config.ts` exists for the Docker image. It is harmless anywhere else.
- **The `backup` compose service** is replaceable by any provider's managed backups for the DB half.

---

## 2. The candidates

1. **Vercel** — the native Next.js platform, serverless.
2. **Railway** — runs containers, always-on, volumes, managed Postgres.
3. **Render** — runs containers, has an explicit "background worker" service type, persistent disks.
4. **Fly.io** — runs containers close to the metal, volumes, multiple processes.
5. **Stay self-hosted** — the office network, per the runbook already delivered.

---

## 3. How each one scores against section 1

| | Vercel | Railway | Render | Fly.io | Self-host |
|---|---|---|---|---|---|
| R1 Node 22 | ✅ | ✅ (own Dockerfile) | ✅ (own Dockerfile) | ✅ (own Dockerfile) | ✅ |
| R2 Worker | ❌ **no long-running processes** — becomes a cron-triggered endpoint | ✅ runs as-is | ✅ dedicated worker type | ✅ runs as-is | ✅ |
| R3 Uploads | ❌ **ephemeral, read-only** outside `/tmp` — must move to blob storage | ✅ volume | ✅ persistent disk | ✅ volume | ✅ |
| R4 Postgres | ✅ via Neon/partner | ✅ managed | ✅ managed | ✅ managed | ✅ |
| R5 Migrations | ✅ build/release step | ✅ | ✅ pre-deploy command | ✅ release command | ✅ |
| R6 Long action | ⚠️ needs raised `maxDuration`; short on the free tier | ✅ no function timeout | ✅ | ✅ | ✅ |
| R7 Env vars | ✅ | ✅ | ✅ | ✅ | ✅ |
| R8 Backups | ⚠️ DB managed; uploads become the storage provider's problem | ⚠️ DB managed; volume backups need checking | ⚠️ same | ⚠️ same | ✅ already built |
| **HTTPS URL** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Off-site scanning** | ✅ | ✅ | ✅ | ✅ | ❌ |

**The pattern is the whole finding.** This app is already a working container stack with a background
process and a disk volume. **Platforms that run containers satisfy the table nearly unchanged.
Vercel is the only candidate that fails two hard requirements** — not because it is worse, but because
the app was not built for its model.

---

## 4. What each option actually costs in work

### Option A — Railway / Render / Fly (container platforms)

Configuration, not development:

1. Point the platform at the repo; it builds the existing `Dockerfile`.
2. Provision managed Postgres, set `DATABASE_URL`.
3. Add `prisma migrate deploy` as a pre-deploy / release command (replaces the `migrate` service).
4. Declare a second service running `npm run worker` from the same image (replaces the `worker` service).
5. Mount a volume at `/app/uploads`.
6. Set the 7 env vars, with `APP_BASE_URL` = the platform hostname.
7. Change the seeded passwords. **Not optional** — see §6.

**Code changes: none.** The one thing to confirm rather than assume is whether the platform's volume
can be mounted by **two** services at once (web writes uploads, backup reads them) — Render disks
attach to a single service, so the tar half of R8 may need rethinking there.

### Option B — Vercel

A real development phase, in this order:

1. **Uploads → blob storage.** Replace the two filesystem call sites with Vercel Blob or S3. Contained
   to `document-actions.ts` and the download route — genuinely small, and the download route already
   exists as the single read path, which is what makes it small.
2. **Worker → cron endpoint.** `--once` already **drains the queue and exits** (`index.ts:107`), so the
   logic is done. Needs an authenticated route running one pass, plus a schedule.
   ⚠️ **Cron interval is the sticking point.** Free-tier cron on Vercel is daily; useful intervals need
   the paid plan. Even at one minute, that is a **20× degradation** from today's 3-second poll — which
   is probably fine for approvals, and should be a conscious choice rather than a surprise.
3. **Import.** Raise `maxDuration` for the import action, or chunk it. R6.
4. **Prisma connection pooling.** Serverless exhausts Postgres connections; use a pooled connection
   string.
5. Migrations as a build step; seeded passwords changed.

### Option C — Self-host

Already documented in the delivered runbook. No new work here; it is the baseline being compared against.

---

## 5. Cost

⚠️ **Verify these before deciding — they move, and this document was written from knowledge with a
cutoff.** The *shape* is what matters:

- **Vercel** effectively requires the paid tier, because free-tier cron intervals make R2 useless.
- **Railway / Render / Fly** land in the small-single-digit dollars per month for a staging-sized app,
  and Render's free tier **spins services down when idle**, which is disqualifying for a worker.
- **Self-hosting** costs nothing in money and a few hours in network configuration.

---

## 6. The two non-technical considerations, which may outrank everything above

**Staff data leaves the office.** The database holds employee names, which equipment each person
holds, acquisition costs, vendors and repair history. Hosting it externally is a decision about staff
data and company records — including which country it sits in — and it belongs to whoever owns that
policy, not to a deployment preference. **If the answer is "it must stay on premises", sections 2–5 are
moot and the runbook is the plan.**

**The seeded password becomes urgent the moment anything is public.** All seeded accounts share one
password that `README.md` publishes, in a public repository. On the office LAN this is defensible; on a
public URL it is not, and there is no Cloudflare Access equivalent in front of these platforms. The
guard added on 2026-09-03 refuses to *seed* a production stack without `SEED_PASSWORD`, but it does
nothing about accounts that already exist. **Changing them is a prerequisite of any hosted option, not
a follow-up.**

---

## 7. Recommendation

**Railway or Render for staging, if hosting externally is permitted at all.**

The reasoning is section 3's pattern: the requirement table was written by an app that already runs as
containers with a worker and a volume, so container platforms satisfy it with configuration alone.
That gets the actual goal — a stable HTTPS URL a phone can reach from anywhere — for roughly an hour
of setup and no code changes, and it does not commit anyone to anything.

**Vercel is the better long-term home** for a Next.js application, and the two blockers are both
tractable. But it is a development phase with its own spec and plan, and it should be chosen because
someone wants Vercel — not as a lift-and-shift, which it cannot be.

**Do not treat this as urgent.** The prototype works on the LAN today, and the runbook covers it. The
hosted question is worth answering properly, and section 6 is the part to answer first.

---

## 8. What is needed to move forward

1. **Is external hosting permitted for staff and asset data?** §6. This gates everything.
2. If yes: **Railway or Render**, and I write the deployment plan.
3. If Vercel: it becomes its own phase, with `brainstorming` → `writing-plans` for the blob-storage and
   cron work.
4. Either way: **the seeded passwords change first.**
