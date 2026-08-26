# Inventory v2

Inventory v2 is The Backroom Offshoring's internal IT asset-management system: it tracks laptops,
monitors, phones and other equipment from purchase through assignment, repair and disposal, and
records who has what. It covers purchase requests (draft through completion), an approvals queue for
lifecycle changes (assign / return / transfer / replace / change-status), employee offboarding, and an
audit trail — all gated by role (`admin`, `it_staff`, `purchasing_staff`, `finance_staff`, `viewer`).

It is built as a single Next.js 15 App Router application backed by PostgreSQL 16, with a small
background worker that executes approved lifecycle changes and delivers outbound webhooks. It is
designed to run as one Docker Compose stack on a single machine — there is no multi-node deployment
story, no object storage, and (see "What does not work" below) no working SSO yet.

## Prerequisites

- Docker Desktop (verified against Docker Engine 29.6.1 on 2026-08-26)
- Node.js >= 22
- npm >= 11

## Secrets

Every deployment (dev and prod) starts the same way:

```bash
cp .env.example .env
```

Then fill in the blanks. `.env.example` documents each value inline — read its comments, they are the
source of truth, not this paragraph:

- `POSTGRES_PASSWORD` — generate with `openssl rand -base64 24`. This is consumed by the `db`
  container's `initdb` on its **first** boot only; changing `.env` later does not change a running
  database's password (`.env.example` has the `\password` command to rotate it).
  **`docker-compose.yml` splices this value unescaped into the container `DATABASE_URL`**
  (`postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}`). A password
  containing `/` breaks the URL — it terminates the authority section early, and Prisma fails with
  `P1013: invalid port number in database URL`, which makes the `migrate` service exit 1. `+` and `=`
  are legal there and will not cause that error, but strip them anyway as a precaution (they are still
  base64 punctuation, not password entropy): `openssl rand -base64 24 | tr -d '/+='`.
- `AUTH_SECRET` — Auth.js's session-signing secret. `.env.example` suggests `npx auth secret` to
  generate one (or use `openssl rand -base64 24`, same shape as the Postgres password — this one is
  never interpolated into a URL, so it does not need the same character stripping).
- `SECRET_ENCRYPTION_KEY` — a 32-byte base64 key used for AES-256-GCM encryption of asset secrets
  (e.g. `openssl rand -base64 32`).

`DATABASE_URL` in `.env` is only read when you run Prisma or `next dev` directly on the host (local
dev). Inside Docker, `docker-compose.yml` derives the container's `DATABASE_URL` from
`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` and overrides whatever is in `.env` — but keep
the password in both places in sync regardless, since local dev needs it directly.

## Dev quickstart

```bash
docker compose up -d db
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed
npm run dev
```

`npm ci` installs from the committed `package-lock.json` — a fresh clone has no `node_modules`, and
this is the one npm invocation in this document that is safe to run on Windows (see the lockfile
hazard in Troubleshooting: the hazard is *regenerating* the lockfile, not installing from it).
`npx prisma generate` is required even though `@prisma/client` is a dependency: its own postinstall
hook does not reliably leave a working client behind, and skipping this step fails later with
`@prisma/client did not initialize yet`. This starts only the database in Docker and runs the app on
the host with hot reload. `npm run dev` serves on `http://localhost:3000`.

## Production deploy

```bash
docker compose --profile prod build
docker compose --profile prod up -d
```

The `build` step matters even on a machine that already has an `inventory-app` image: `worker`
(`docker-compose.yml`) has no `build:` stanza of its own and reuses whatever is tagged `inventory-app`
from `migrate` or `web`'s build — on a genuinely clean clone that tag exists only because you just
built it, and it is in no registry.

`--profile prod up -d` starts five containers: `db` (no `profiles:` entry of its own — it comes up
because `migrate`, `web` and `worker` all depend on it) and the four profile-`prod` services —
`migrate` (runs `prisma migrate deploy` once and exits 0), `web`, `worker` (executes approved
lifecycle changes and delivers webhooks — see "The worker" below), and `backup` (takes a daily
`pg_dump` into `./backups`, keeping the newest 14). `web` and `worker` both wait for `migrate` to
complete successfully before they start.

The database is bound to **127.0.0.1 only** (`docker-compose.yml`'s `db.ports`), deliberately — it is
never reachable from outside the host, prod or dev.

Seed the production database. A fresh clone's *host* has no `node_modules` at all, so run it inside
the `web` container instead, where it already has what it needs: `Dockerfile` builds the runtime tree
with `npm ci --omit=dev` and copies it in, `tsx` is a regular dependency (survives `--omit=dev`), and
`prisma/` is copied in alongside it:

```bash
docker compose --profile prod exec web node_modules/.bin/tsx prisma/seed.ts
```

## Migrations

Migrations are hand-written, additive SQL directories under `prisma/migrations/`, applied with:

```bash
npx prisma migrate deploy
```

(the `migrate` service runs the same operation in prod, via the image's own
`node_modules/.bin/prisma`, not `npx`). `prisma migrate reset` is destructive and unnecessary here —
`npm run db:seed` is the sanctioned reset: it `TRUNCATE`s the seeded tables and reinserts fixture
data.

## The worker

Approvals that reach `APPROVED` sit there forever unless something executes them, and outbound
webhook deliveries need the same background process. In production this is the compose `worker`
service (started automatically by `--profile prod up -d`). In dev, run it yourself:

```bash
npm run worker
```

(`npm run worker:once` drains the queue once and exits — useful for scripts and tests, not for a
running deployment.)

## Seeded accounts

`npm run db:seed` (or the containerized equivalent above) creates five accounts, all
`@thebackroomop.com`, all sharing the password in `SEED_PASSWORD` (`prisma/fixtures.ts`):

| Email                          | Role               |
| ------------------------------- | ------------------ |
| `admin@thebackroomop.com`       | `admin`             |
| `it@thebackroomop.com`          | `it_staff`          |
| `purchasing@thebackroomop.com`  | `purchasing_staff`  |
| `finance@thebackroomop.com`     | `finance_staff`     |
| `viewer@thebackroomop.com`      | `viewer`            |

That password is `admin123` — **8 characters**, deliberately shorter than the 10-character minimum
`src/server/auth/actions.ts` enforces on signup (sign-in has no length rule; only signup does). It is
a fixture for a loopback-only dev database in a public repo, not a real credential. **Change every
seeded password before the app is reachable from anywhere but localhost.**

## Troubleshooting

**`failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`** — Docker Desktop
is not running. It needs an interactive desktop session and elevation to start, so it cannot be
launched from a terminal; open it from the Start menu and wait for it to report "running" before
retrying.

**`migrate` exits 1 with `Error: P1013: ... invalid port number in database URL`** —
`POSTGRES_PASSWORD` contains a `/` that breaks the unescaped `DATABASE_URL` compose builds for the
container (see Secrets above). Regenerate the password without that character,
`docker compose -p <project> down -v` to drop the volume `initdb` already used the bad password on,
and start over.

**Port 5432 already in use** — another Postgres (often another instance of this same stack, or a
different compose project) is already bound to `127.0.0.1:5432`. Stop it (`docker compose stop db` in
whichever project owns it) or change the port mapping.

**Stale `.next` after switching between `npm run dev` and `npm run build`** — the two commands share
the same `.next` directory and their outputs are incompatible; running one after the other without
clearing `.next` produces confusing errors or a broken dev server. Delete `.next` and restart the one
you actually want.

**`npm install` / lockfile changes on Windows** — `package-lock.json` is generated by CI on Linux, and
running `npm install` on Windows can rewrite it in ways that break the Linux Docker build. This is
about *regenerating* the lockfile, not installing from it: `npm ci` (as used in the dev quickstart
above) installs strictly from the committed lockfile and never rewrites it, so it is safe on Windows.
Only reach for the command below if you actually need to add, remove, or update a dependency and
therefore change `package-lock.json` — do it inside a Linux container instead of on the host (run this
from Git Bash or WSL; PowerShell needs `"${PWD}:/app"` instead of `"$PWD:/app"`):

```bash
docker run --rm -v "$PWD:/app" -w /app node:22-alpine sh -c "npm i -g npm@11 && npm install --package-lock-only"
```

## What does not work

- **Entra (Microsoft 365) SSO does not work.** `src/server/auth/index.ts` registers the
  `MicrosoftEntraID` provider once `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET` and
  `AUTH_MICROSOFT_ENTRA_ID_ISSUER` are all set, but there is no `signIn` callback that maps an Entra
  profile to a `User` row. A successful Entra login currently arrives with no role and cannot use the
  app. Do not set those three variables in a real deployment expecting SSO to work — it will not.
- **Uploaded asset documents (`uploads/`) do not survive recreating the `web` container.**
  `document-actions.ts` writes them to `process.cwd()/uploads` inside the container, but
  `docker-compose.yml`'s `web` service declares no volume for that path, unlike `backup`'s
  `./backups` mount. Every `docker compose --profile prod up` that recreates `web` (an image rebuild,
  `docker compose down` + `up`, etc.) discards whatever was uploaded. Until `web` gets a bind mount for
  `uploads/`, treat uploaded documents as ephemeral.
