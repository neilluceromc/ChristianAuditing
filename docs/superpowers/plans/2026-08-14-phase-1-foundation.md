# Inventory v2 — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js app with Docker/Postgres/Prisma (full schema + append-only audit trigger + seed), the complete design-token sheet, the six-family status system, and the primitive UI layer — proven on a `/dev/kitchen-sink` page that passes axe.

**Architecture:** Modular monolith per the approved spec (`docs/superpowers/specs/2026-08-14-inventory-v2-design.md`). This phase builds no screens and no server actions — only the foundation every later phase consumes: database schema, tokens, `status.ts`, and `src/components/ui/*`. The design source of truth for all pixel values is `design_handover/README.md`.

**Tech Stack:** Next.js 15 (App Router, TS, standalone output) · Tailwind v4 (CSS-first, tokens as custom properties) · PostgreSQL 16 (Docker) · Prisma 6 · Vitest · Playwright + @axe-core/playwright · bcryptjs · clsx · tsx.

**Conventions for every task:** work on branch `phase-1-foundation`; run `npx tsc --noEmit` before each commit; commit messages `feat(scope): …`. Node 22+ and Docker Desktop are prerequisites. All paths are relative to the repo root.

**Deliberate phase-1 scope cuts (build later, in the phase that first uses them):** `Combobox`, `DatePicker`, `CommandPalette`, `CopyLinkButton`, `EmployeePicker`, `PageHeader` (built with the shell in Phase 2) and all composite patterns (`ActivityFeed`, `FacetDropdown`, `ChipFilterRow`, …). `Modal` from the handover's existing-primitives list is subsumed by `Dialog` — one overlay primitive, not two. The worker in this phase is a stub process so Docker Compose is complete; job execution logic is Phase 4.

---

## File structure created in this phase

```
package.json  tsconfig.json  next.config.ts  postcss.config.mjs  vitest.config.ts
playwright.config.ts  .gitignore  .dockerignore  .env  .env.example
docker-compose.yml  Dockerfile
prisma/schema.prisma
prisma/seed.ts
prisma/migrations/<ts>_init/            (generated)
prisma/migrations/<ts>_append_only_triggers/migration.sql   (hand-written SQL)
src/app/layout.tsx  src/app/globals.css  src/app/page.tsx
src/app/dev/kitchen-sink/page.tsx
src/lib/cn.ts
src/lib/status.ts          src/lib/status.test.ts
src/server/db/client.ts
src/worker/index.ts        (stub)
src/components/ui/
  status.tsx icon.tsx spinner.tsx button.tsx
  input.tsx textarea.tsx select.tsx checkbox.tsx radio.tsx switch.tsx form-field.tsx
  card.tsx pill.tsx avatar.tsx kbd.tsx description-list.tsx stat.tsx banner.tsx
  empty-state.tsx skeleton.tsx progress-bar.tsx breadcrumb.tsx tooltip.tsx
  tabs.tsx segmented-control.tsx
  use-focus-trap.ts dialog.tsx drawer.tsx menu.tsx toast.tsx
  table.tsx pagination.tsx theme-toggle.tsx density-toggle.tsx
e2e/kitchen-sink.spec.ts
```

Responsibilities: `src/lib/status.ts` is the ONLY place an enum value maps to a colour family; `globals.css` is the ONLY place a hex value appears; `components/ui/*` are presentation-only (no data fetching, no Prisma imports); `src/server/db/client.ts` is the only Prisma client construction site.

---

### Task 1: Scaffold the Next.js app manually

The repo root is non-empty (design_handover/, docs/), so `create-next-app` cannot run here — we write the scaffold files directly.

> **Post-review amendments (approved and applied after code review):**
> 1. `.gitignore` uses `.env*` + `!.env.example` (covers `.env.local` variants — the encryption key must never be committable), anchors `/out/` and `/build/`, and adds `uploads/`, `/coverage`, `*.log`, `.DS_Store`.
> 2. `vitest.config.ts` include is `src/**/*.test.{ts,tsx}`; unit tests stay node-env by design (component behaviour is covered by Playwright).
> 3. `src/lib/cn.ts` wraps `twMerge(clsx(...))` (dep: `tailwind-merge`) so caller `className` overrides win over component defaults — primitives depend on this.
> 4. `<html>` carries `suppressHydrationWarning` (theme/density become cookie-driven in Phase 2).
> 5. `package.json` adds `"engines": {"node": ">=22"}`, a `lint` script, and devDeps `eslint`, `eslint-config-next`, `@eslint/eslintrc` with a flat `eslint.config.mjs` (`next/core-web-vitals` + `next/typescript` — includes jsx-a11y at authoring time).
> 6. Recorded decisions: jsdom component tests declined for Phase 1 (revisit in Phase 2); CI workflow deferred; `/dev/kitchen-sink` gets a production `notFound()` guard in Task 16; `color-scheme` added to tokens in Task 7.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `src/app/layout.tsx`, `src/app/globals.css` (minimal now, tokens in Task 7), `src/app/page.tsx`, `src/lib/cn.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout -b phase-1-foundation
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "inventory-v2",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "db:migrate": "prisma migrate dev",
    "db:seed": "tsx prisma/seed.ts",
    "worker": "tsx src/worker/index.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.13.0",
    "bcryptjs": "^3.0.2",
    "clsx": "^2.1.1",
    "next": "^15.4.5",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.10.2",
    "@playwright/test": "^1.54.0",
    "@tailwindcss/postcss": "^4.1.11",
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "postcss": "^8.5.6",
    "prisma": "^6.13.0",
    "tailwindcss": "^4.1.11",
    "tsx": "^4.20.0",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 5: Write `postcss.config.mjs`**

```js
export default {
  plugins: { "@tailwindcss/postcss": {} },
};
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 7: Write `.gitignore`**

```
node_modules/
.next/
out/
build/
.env
*.tsbuildinfo
next-env.d.ts
test-results/
playwright-report/
backups/
```

- [ ] **Step 8: Write `src/app/globals.css` (placeholder — full tokens land in Task 7)**

```css
@import "tailwindcss";
```

- [ ] **Step 9: Write `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backroom IT — Inventory",
  description: "IT asset management for The Backroom Offshoring",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" data-density="comfortable">
      <body className="bg-canvas text-fg font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 10: Write `src/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold tracking-tight">Inventory v2</h1>
      <p className="mt-2 text-sm text-fg-secondary">
        Foundation phase. See /dev/kitchen-sink for the primitive layer.
      </p>
    </main>
  );
}
```

- [ ] **Step 11: Write `src/lib/cn.ts`**

```ts
import { clsx, type ClassValue } from "clsx";

/** Join class names; false/undefined values drop out. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
```

- [ ] **Step 12: Create the public dir, install, and verify**

`public/` must exist (the Dockerfile copies it; Next serves it).

```bash
mkdir -p public
touch public/.gitkeep
npm install
npx tsc --noEmit
```

Expected: install succeeds; typecheck passes with no errors. (`bg-canvas`/`text-fg` classes don't exist yet — that's CSS, not TS; fine until Task 7.)

- [ ] **Step 13: Verify dev server**

```bash
npm run dev
```

Expected: compiles, `http://localhost:3000` renders the placeholder page. Stop the server.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(scaffold): Next.js 15 app skeleton with Tailwind v4 and Vitest"
```

---

### Task 2: Docker Compose, env files, Dockerfile

**Files:**
- Create: `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `.env`, `.env.example`

> **Post-review amendments (approved and applied after code review — the committed files supersede the snippets below where they differ):**
> 1. **Migrations reach prod** via a one-shot `migrate` compose service (`prisma migrate deploy`, prod profile); `web`/`worker` depend on `service_completed_successfully`.
> 2. **Backups are atomic and rotated**: pg_dump `-Fc` to a temp file, promoted on success only, timestamped names, keep-14 rotation, failures logged loudly. 24h-sleep cadence kept (drift accepted).
> 3. **Postgres binds loopback only** (`127.0.0.1:5432`) — LAN access would let anyone drop the append-only audit triggers. `.env.example` ships an EMPTY password with generate instructions plus a rotation-footgun note (initdb reads it on first boot only); DATABASE_URL documented as local-dev-only (compose overrides it in containers).
> 4. **Runtime image uses prod-only node_modules** (extra `proddeps` stage, `npm ci --omit=dev`); `tsx` and `prisma` moved to dependencies (runtime needs); run-stage `npx prisma generate`; container runs as `node`, not root; compose project pinned `name: inventory` so the volume doesn't key off the folder name; `web` gets an HTTP healthcheck; `worker` gets `stop_grace_period: 30s`; `.dockerignore` uses `.env*`/`!.env.example` and excludes more build-context noise.
> 5. **The image is knowingly unbuildable until Task 3** (no prisma/schema.prisma yet) — `docker compose build` is Task 3's verification, not Task 2's. Task 2 verifies with `docker compose --profile prod config --quiet` + db up.
> 6. Recorded decisions: worker code must use **relative imports** (tsx ignores tsconfig paths at runtime); backup-restore drill added to the phase checklist; full deployment README deferred to Phase 8.

- [ ] **Step 1: Write `.env.example`** (committed; `.env` is the same content, uncommitted)

```
# Postgres — used by the db container AND composed into DATABASE_URL
POSTGRES_USER=inventory
POSTGRES_PASSWORD=change-me-locally
POSTGRES_DB=inventory
DATABASE_URL=postgresql://inventory:change-me-locally@localhost:5432/inventory

# Phase 2+: Auth.js
AUTH_SECRET=generate-with--npx-auth-secret

# Phase 3+: AES-256-GCM key for asset secrets (32 bytes, base64)
SECRET_ENCRYPTION_KEY=generate-32-byte-base64-key
```

- [ ] **Step 2: Copy to `.env`**

```bash
cp .env.example .env
```

- [ ] **Step 3: Write `docker-compose.yml`**

Dev workflow: `docker compose up -d db` (app runs via `npm run dev`). Full stack for the deploy machine: `docker compose --profile prod up -d`.

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 10

  web:
    profiles: ["prod"]
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
      HOSTNAME: 0.0.0.0
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy

  worker:
    profiles: ["prod"]
    build: .
    restart: unless-stopped
    command: ["node_modules/.bin/tsx", "src/worker/index.ts"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy

  backup:
    profiles: ["prod"]
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: .env
    entrypoint: >
      sh -c 'while true; do
        pg_dump -h db -U $${POSTGRES_USER} $${POSTGRES_DB} > /backups/inventory-$$(date +%Y%m%d).sql;
        sleep 86400;
      done'
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./backups:/backups
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 4: Write `Dockerfile`** (standalone Next build; worker runs from the same image via tsx)

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src/worker ./src/worker
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 5: Write `.dockerignore`**

```
node_modules
.next
.git
backups
docs
design_handover
e2e
test-results
playwright-report
.env
```

- [ ] **Step 6: Start and verify the database**

```bash
docker compose up -d db
docker compose exec db psql -U inventory -d inventory -c "select version();"
```

Expected: a PostgreSQL 16.x version string.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(infra): Docker Compose (db/web/worker/backup) and Dockerfile"
```

---

### Task 3: Prisma schema + initial migration

**Files:**
- Create: `prisma/schema.prisma`, `src/server/db/client.ts`, `src/worker/index.ts`

> **Post-review amendments (approved and applied — the committed schema supersedes the snippet below where they differ):**
> 1. **`MISSING` added as the 8th `AssetStatus`** — the offboarding wizard's first-class "Missing" outcome needs a schema home. It maps to the **fault** family in the status system (Tasks 6/16 updated accordingly).
> 2. **Job leases**: `lockedAt`/`lockedBy` columns + `@@index([status, lockedAt])` so a died-holding-a-job worker can be reaped without double-execution; partial unique = one live EXECUTE_APPROVAL job per approval. Phase 4's claim must be one raw `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING *` that sets the lease atomically; the reaper keys on `lockedAt`, never `updatedAt`.
> 3. **All `@updatedAt` columns carry `@default(now())`** so raw-SQL inserts don't violate NOT NULL.
> 4. **Cascade rule — evidence is Restrict, secrets/prefs are Cascade**: AssetDocument, NoteEntry, WebhookDelivery, Approval.asset/employee, Asset.assignee/type/vendor/purchaseRequest, PolicySlot.assetType are all `Restrict`; AssetSecret/UserPreference/RateEvent stay Cascade. Hard deletes are the exception the schema resists — terminal states (`DISPOSE`, `OFFBOARDED`, `CANCELLED`, `active=false`, `disabled=true`) are the intended paths.
> 5. **Index pass** for the brief's query patterns: Asset(status/assignee/category/type), Approval(claimedBy/employee/asset), NoteEntry(request), Employee(employment), PurchaseRequest(state/requestedBy), WebhookDelivery(status,nextAttemptAt), AuditEntry(entityType+createdAt, actorId).
> 6. **Integrity SQL migration**: one-ACTIVE-hold-per-asset partial unique on Reservation; `lower(email)` unique on User; `purchase_request_ref_seq`/`approval_ref_seq` sequences for atomic PR-/APR- numbers; CHECK constraints on qty/prices.
> 7. **User hardened for Phase 2**: `disabled` flag, `entraObjectId String? @unique`, `updatedAt`; `reviewedById` and `Asset.purchaseRequestId` became real relations; `Asset.serial` unique (nullable); `locked` on AssetType + Vendor.
> 8. **Recorded decisions**: Employee↔User stay UNLINKED (logins are staff-only; offboarding never touches accounts); WebhookEndpoint.secret encryption deferred to Phase 8; seed's EXECUTION_FAILED `workerError` text corrected (Task 5) — there is deliberately no unique on Asset.assigneeId; `engines.npm >=11` guards lockfile regeneration.

- [ ] **Step 1: Write `prisma/schema.prisma`** (complete — this is the whole domain from spec §3)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Enums (brief §5 — values are verbatim) ────────────────────────────

enum Role {
  admin
  it_staff
  purchasing_staff
  finance_staff
  viewer
}

enum AssetStatus {
  DEPLOYED
  SPARE
  DEFECTIVE
  DONATED
  TEMPORARY
  BUYOUT
  DISPOSE
}

enum PurchaseRequestState {
  DRAFT
  SUBMITTED
  IT_REVIEWED
  COMPLETED
  CANCELLED
}

enum PurchaseUnitState {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

enum ApprovalState {
  PENDING
  CLAIMED
  APPROVED
  REJECTED
  EXECUTED
  EXECUTION_FAILED
}

enum ApprovalType {
  lifecycle_assign         @map("lifecycle.assign")
  lifecycle_replace        @map("lifecycle.replace")
  lifecycle_transfer       @map("lifecycle.transfer")
  lifecycle_return         @map("lifecycle.return")
  lifecycle_change_status  @map("lifecycle.change-status")
}

enum ReservationState {
  ACTIVE
  FULFILLED
  RELEASED
  EXPIRED
}

enum EmploymentStatus {
  ACTIVE
  OFFBOARDING
  OFFBOARDED
}

enum Priority {
  NORMAL
  HIGH
  URGENT
}

enum NoteKind {
  COMMENT
  SUBMIT
  IT_REVIEW
  IT_REJECT
  REQUEST_INFO
  CANCEL
  COMPLETE
}

enum JobType {
  EXECUTE_APPROVAL
  DELIVER_WEBHOOK
}

enum JobStatus {
  PENDING
  RUNNING
  DONE
  FAILED
  DEAD
}

enum DeliveryStatus {
  PENDING
  RETRYING
  DELIVERED
  DEAD
}

// ── Identity & access ─────────────────────────────────────────────────

model User {
  id               String           @id @default(cuid())
  email            String           @unique
  name             String
  passwordHash     String?          // null = SSO-only account
  role             Role
  isPermanentAdmin Boolean          @default(false)
  createdAt        DateTime         @default(now())
  preferences      UserPreference[]
  purchaseRequests PurchaseRequest[] @relation("requestedBy")
  notes            NoteEntry[]
  claimedApprovals Approval[]       @relation("claimedBy")
  requestedApprovals Approval[]     @relation("approvalRequestedBy")
  documents        AssetDocument[]
  rateEvents       RateEvent[]
}

model UserPreference {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  key    String // e.g. "columns:inventory"
  value  Json

  @@unique([userId, key])
}

model RateEvent {
  id     String   @id @default(cuid())
  userId String
  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind   String   // "mutation" | "import"
  at     DateTime @default(now())

  @@index([userId, kind, at])
}

// ── Reference data ────────────────────────────────────────────────────

model Department {
  id        String     @id @default(cuid())
  name      String     @unique
  locked    Boolean    @default(false)
  employees Employee[]
  policies  EquipmentPolicy[]
}

model AssetCategory {
  id     String      @id @default(cuid())
  name   String      @unique
  locked Boolean     @default(false)
  types  AssetType[]
  assets Asset[]
}

model AssetType {
  id         String        @id @default(cuid())
  name       String
  categoryId String
  category   AssetCategory @relation(fields: [categoryId], references: [id])
  assets     Asset[]
  policySlots PolicySlot[]

  @@unique([categoryId, name])
}

model Vendor {
  id     String  @id @default(cuid())
  name   String  @unique
  assets Asset[]
}

// ── People ────────────────────────────────────────────────────────────

model Employee {
  id           String           @id @default(cuid())
  employeeNo   String           @unique // EMP-0042
  name         String
  title        String
  departmentId String
  department   Department       @relation(fields: [departmentId], references: [id])
  m365Status   String?          // canonical: pending|active|offboarding|inactive; custom stored as-is; null = never synced
  employment   EmploymentStatus @default(ACTIVE)
  joinedAt     DateTime
  assets       Asset[]
  reservations Reservation[]
  approvals    Approval[]
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
}

// ── Assets ────────────────────────────────────────────────────────────

model Asset {
  id                String        @id @default(cuid())
  tag               String        @unique // BR-LT-0148
  model             String
  serial            String?
  categoryId        String
  category          AssetCategory @relation(fields: [categoryId], references: [id])
  typeId            String?
  type              AssetType?    @relation(fields: [typeId], references: [id])
  status            AssetStatus   @default(SPARE)
  assigneeId        String?
  assignee          Employee?     @relation(fields: [assigneeId], references: [id])
  purchasedAt       DateTime?
  cost              Decimal?      @db.Decimal(12, 2)
  purchaseRequestId String?
  warrantyUntil     DateTime?
  // repair fields (repairs view = saved filter over status=DEFECTIVE; no new enum)
  vendorId          String?
  vendor            Vendor?       @relation(fields: [vendorId], references: [id])
  rmaRef            String?
  repairQuote       Decimal?      @db.Decimal(12, 2)
  defectiveSince    DateTime?
  notes             String?
  secrets           AssetSecret[]
  documents         AssetDocument[]
  reservations      Reservation[]
  approvals         Approval[]
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
}

model AssetSecret {
  id         String   @id @default(cuid())
  assetId    String
  asset      Asset    @relation(fields: [assetId], references: [id], onDelete: Cascade)
  label      String
  ciphertext String   // AES-256-GCM: base64(iv || tag || data), key from SECRET_ENCRYPTION_KEY
  createdAt  DateTime @default(now())
}

model AssetDocument {
  id           String   @id @default(cuid())
  assetId      String
  asset        Asset    @relation(fields: [assetId], references: [id], onDelete: Cascade)
  kind         String   // "receipt" | "accountability-form" | ...
  fileName     String
  path         String   // relative path under uploads/ volume
  checksum     String
  signed       Boolean  @default(false)
  uploadedById String?
  uploadedBy   User?    @relation(fields: [uploadedById], references: [id])
  createdAt    DateTime @default(now())
}

model Reservation {
  id         String           @id @default(cuid())
  assetId    String
  asset      Asset            @relation(fields: [assetId], references: [id])
  employeeId String
  employee   Employee         @relation(fields: [employeeId], references: [id])
  state      ReservationState @default(ACTIVE)
  reason     String?
  expiresAt  DateTime?
  resolvedAt DateTime?
  createdAt  DateTime         @default(now())
}

// ── Purchasing ────────────────────────────────────────────────────────

model PurchaseRequest {
  id            String               @id @default(cuid())
  refNo         String               @unique // PR-0188
  state         PurchaseRequestState @default(DRAFT)
  requestedById String
  requestedBy   User                 @relation("requestedBy", fields: [requestedById], references: [id])
  submittedAt   DateTime?
  reviewedAt    DateTime?
  reviewedById  String?
  completedAt   DateTime?
  cancelledAt   DateTime?
  cancelReason  String?
  units         PurchaseUnit[]
  notes         NoteEntry[]
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt
}

model PurchaseUnit {
  id           String            @id @default(cuid())
  requestId    String
  request      PurchaseRequest   @relation(fields: [requestId], references: [id], onDelete: Cascade)
  description  String
  specs        String?
  qty          Int               @default(1)
  unitPrice    Decimal?          @db.Decimal(12, 2)
  state        PurchaseUnitState @default(PENDING)
  itSlotNotes  String?
  financeNotes String?
  createdAt    DateTime          @default(now())
}

// Append-only conversation thread (enforced by DB trigger, Task 4)
model NoteEntry {
  id        String          @id @default(cuid())
  requestId String
  request   PurchaseRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  authorId  String
  author    User            @relation(fields: [authorId], references: [id])
  kind      NoteKind
  text      String
  createdAt DateTime        @default(now())
}

// ── Approvals ─────────────────────────────────────────────────────────

model Approval {
  id               String        @id @default(cuid())
  refNo            String        @unique // APR-2039
  type             ApprovalType
  state            ApprovalState @default(PENDING)
  payload          Json          // before→after change description
  priority         Priority      @default(NORMAL)
  slaAt            DateTime
  requestedById    String
  requestedBy      User          @relation("approvalRequestedBy", fields: [requestedById], references: [id])
  claimedById      String?
  claimedBy        User?         @relation("claimedBy", fields: [claimedById], references: [id])
  claimedAt        DateTime?
  resolvedAt       DateTime?
  resolutionReason String?
  workerError      String?       // verbatim error for EXECUTION_FAILED retry UI
  assetId          String?
  asset            Asset?        @relation(fields: [assetId], references: [id])
  employeeId       String?
  employee         Employee?     @relation(fields: [employeeId], references: [id])
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([state, slaAt])
}

// ── Audit (append-only by DB trigger, Task 4) ─────────────────────────

model AuditEntry {
  id         String   @id @default(cuid())
  actorId    String?  // null = system
  actorLabel String   // denormalized display name, survives user deletion
  entityType String   // "asset" | "employee" | "approval" | ...
  entityId   String
  action     String   // "create" | "update" | "SECRET_READ" | ...
  diff       Json?    // { field: { from, to } } per changed field
  createdAt  DateTime @default(now())

  @@index([entityType, entityId])
  @@index([createdAt])
}

// ── Equipment policies ────────────────────────────────────────────────

model EquipmentPolicy {
  id                    String       @id @default(cuid())
  name                  String       @unique
  appliesToDepartmentId String?
  appliesToDepartment   Department?  @relation(fields: [appliesToDepartmentId], references: [id])
  appliesToTitle        String?      // role policy beats department policy
  slots                 PolicySlot[]
}

model PolicySlot {
  id          String          @id @default(cuid())
  policyId    String
  policy      EquipmentPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  name        String          // "laptop", "monitor", ...
  assetTypeId String?
  assetType   AssetType?      @relation(fields: [assetTypeId], references: [id])
  required    Boolean         @default(true)
}

// ── Admin ─────────────────────────────────────────────────────────────

model WebhookEndpoint {
  id         String            @id @default(cuid())
  url        String
  secret     String
  events     String[]          // event names this endpoint subscribes to
  active     Boolean           @default(true)
  deliveries WebhookDelivery[]
  createdAt  DateTime          @default(now())
}

model WebhookDelivery {
  id            String          @id @default(cuid())
  endpointId    String
  endpoint      WebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  event         String
  payload       Json
  status        DeliveryStatus  @default(PENDING)
  attempts      Int             @default(0)
  lastError     String?
  nextAttemptAt DateTime?
  deliveredAt   DateTime?
  createdAt     DateTime        @default(now())
}

model FeatureFlag {
  id          String  @id @default(cuid())
  key         String  @unique // "m365_sso", ...
  enabled     Boolean @default(false)
  description String
  value       Json?
}

// ── Worker queue (polled with FOR UPDATE SKIP LOCKED) ─────────────────

model Job {
  id        String    @id @default(cuid())
  type      JobType
  payload   Json
  status    JobStatus @default(PENDING)
  attempts  Int       @default(0)
  runAt     DateTime  @default(now())
  lastError String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([status, runAt])
}
```

- [ ] **Step 2: Write `src/server/db/client.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Write `src/worker/index.ts`** (stub — real executors are Phase 4)

NOTE: worker code must use **relative imports only** — tsx does not honour tsconfig `paths` at runtime, so `@/…` imports would crash in the container.

```ts
import { prisma } from "../server/db/client";

const POLL_MS = 5000;

let shuttingDown = false;

async function tick() {
  // Phase 4 replaces this with FOR UPDATE SKIP LOCKED job claiming.
  const pending = await prisma.job.count({ where: { status: "PENDING" } });
  if (pending > 0) {
    console.log(`[worker] ${pending} pending job(s) — executors arrive in Phase 4`);
  }
}

async function main() {
  console.log("[worker] started (stub); polling every", POLL_MS, "ms");
  // Finish the current tick before exiting so a SIGTERM never tears down mid-write.
  process.on("SIGTERM", () => {
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
  });
  while (!shuttingDown) {
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await prisma.$disconnect();
  console.log("[worker] stopped cleanly");
}

main();
```

- [ ] **Step 4: Run the initial migration**

```bash
npx prisma migrate dev --name init
```

Expected: migration created under `prisma/migrations/`, client generated, DB in sync.

- [ ] **Step 5: Verify typecheck AND that the production image now builds**

The schema and worker now exist, so the Dockerfile's inputs are complete — this is the deferred Task 2 build verification:

```bash
npx tsc --noEmit
docker compose --profile prod build
```

Expected: typecheck PASS; image builds to completion (prisma generate + next build + run-stage generate all succeed). Note: the `--profile prod` flag is required — the buildable services are profile-gated, so a bare `docker compose build` silently builds nothing. The Dockerfile pins `npm@11` in its `npm ci` stages so the image build matches the npm that generated the lockfile (node:22-alpine bundles npm 10, which rejects this lockfile's bundleDependencies entries).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): full Prisma schema, db client singleton, worker stub"
```

---

### Task 4: Append-only triggers for AuditEntry and NoteEntry

The audit trail and the purchase notes thread must be immutable at the database level, not by convention.

**Files:**
- Create: `prisma/migrations/<timestamp>_append_only_triggers/migration.sql` (via `prisma migrate dev --create-only`)

- [ ] **Step 1: Create an empty migration**

```bash
npx prisma migrate dev --create-only --name append_only_triggers
```

- [ ] **Step 2: Write the migration SQL** (into the generated empty `migration.sql`)

```sql
-- Append-only enforcement: UPDATE/DELETE on audit entries and note entries
-- raise at the database level. Inserts are unaffected.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_entry_append_only
  BEFORE UPDATE OR DELETE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER note_entry_append_only
  BEFORE UPDATE OR DELETE ON "NoteEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
```

- [ ] **Step 3: Apply it**

```bash
npx prisma migrate dev
```

Expected: migration applied cleanly.

- [ ] **Step 4: Verify the trigger actually blocks mutation**

```bash
docker compose exec db psql -U inventory -d inventory -c "INSERT INTO \"AuditEntry\" (id, \"actorLabel\", \"entityType\", \"entityId\", action) VALUES ('trigger-test', 'system', 'test', 't1', 'create');"
docker compose exec db psql -U inventory -d inventory -c "UPDATE \"AuditEntry\" SET action = 'tampered' WHERE id = 'trigger-test';"
```

Expected: INSERT succeeds; UPDATE fails with `ERROR:  AuditEntry is append-only: UPDATE not allowed`. Then clean up is impossible by design — leave the test row; the seed (Task 5) resets the DB anyway.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(db): append-only triggers on AuditEntry and NoteEntry"
```

---

### Task 5: Seed script with realistic fixtures

One dataset serves manual review, e2e, and every later phase: assets in all 7 statuses, requests in all 5 states (including a bounce-back note thread), approvals in all 6 states, reservations in all 4.

**Files:**
- Create: `prisma/seed.ts`

- [ ] **Step 1: Write `prisma/seed.ts`**

```ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);

async function main() {
  // Dev-only reset. Row-level append-only triggers don't intercept TRUNCATE.
  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditEntry", "NoteEntry", "Job", "WebhookDelivery", "WebhookEndpoint",
      "RateEvent", "UserPreference", "Approval", "Reservation", "AssetSecret",
      "AssetDocument", "PurchaseUnit", "PurchaseRequest", "Asset", "PolicySlot",
      "EquipmentPolicy", "Employee", "AssetType", "AssetCategory", "Vendor",
      "Department", "FeatureFlag", "User" CASCADE`);

  const hash = await bcrypt.hash("ChangeMe123!", 10);

  const [admin, itStaff, purchasing, finance] = await Promise.all([
    prisma.user.create({ data: { email: "admin@thebackroomop.com", name: "System Admin", role: "admin", isPermanentAdmin: true, passwordHash: hash } }),
    prisma.user.create({ data: { email: "it@thebackroomop.com", name: "J. Sarmiento", role: "it_staff", passwordHash: hash } }),
    prisma.user.create({ data: { email: "purchasing@thebackroomop.com", name: "A. Reyes", role: "purchasing_staff", passwordHash: hash } }),
    prisma.user.create({ data: { email: "finance@thebackroomop.com", name: "L. Domingo", role: "finance_staff", passwordHash: hash } }),
  ]);
  await prisma.user.create({ data: { email: "viewer@thebackroomop.com", name: "V. Cruz", role: "viewer", passwordHash: hash } });

  await prisma.featureFlag.createMany({
    data: [
      { key: "m365_sso", enabled: false, description: "Microsoft 365 single sign-on with domain allowlist" },
      { key: "allowed_domain", enabled: true, description: "Signup domain restriction", value: "thebackroomop.com" },
    ],
  });

  const deptList = await Promise.all(
    ["IT", "Finance", "Sales", "HR", "Operations"].map((name) =>
      prisma.department.create({ data: { name } }),
    ),
  );
  const depts = Object.fromEntries(deptList.map((d) => [d.name, d]));

  const catData: Record<string, string[]> = {
    Laptop: ["Dell Latitude", "ThinkPad"],
    Monitor: ["24-inch", "27-inch"],
    Phone: ["iPhone", "Android"],
    Dock: ["USB-C Dock"],
    Headset: ["Wired", "Wireless"],
    Peripheral: ["Keyboard", "Mouse"],
  };
  const cats: Record<string, { id: string; typeIds: string[] }> = {};
  for (const [name, types] of Object.entries(catData)) {
    const cat = await prisma.assetCategory.create({ data: { name } });
    const typeIds: string[] = [];
    for (const t of types) {
      typeIds.push((await prisma.assetType.create({ data: { name: t, categoryId: cat.id } })).id);
    }
    cats[name] = { id: cat.id, typeIds };
  }
  await prisma.assetCategory.create({ data: { name: "Uncategorised", locked: true } });

  const vendors = await Promise.all(
    ["TechServe PH", "Octagon Repairs"].map((name) => prisma.vendor.create({ data: { name } })),
  );

  const employeeRows: Array<[string, string, string, string, string | null, number, "ACTIVE" | "OFFBOARDING" | "OFFBOARDED"]> = [
    ["EMP-0042", "Marites Bautista", "Accountant", "Finance", "active", -900, "ACTIVE"],
    ["EMP-0051", "Ramon Cruz", "Account Executive", "Sales", "active", -700, "ACTIVE"],
    ["EMP-0063", "Grace Lim", "HR Generalist", "HR", "active", -500, "ACTIVE"],
    ["EMP-0071", "Paolo Santos", "IT Support", "IT", "active", -400, "ACTIVE"],
    ["EMP-0088", "Karen Uy", "Bookkeeper", "Finance", "pending", -20, "ACTIVE"],
    ["EMP-0090", "Dennis Ong", "Ops Coordinator", "Operations", "offboarding", -1100, "OFFBOARDING"],
    ["EMP-0093", "Faith Mercado", "Sales Associate", "Sales", "inactive", -1300, "OFFBOARDED"],
    ["EMP-0095", "Leo Tan", "Contractor", "Operations", "contractor", -60, "ACTIVE"],
    ["EMP-0097", "Nina Robles", "Analyst", "Finance", null, -10, "ACTIVE"],
    ["EMP-0099", "Carlo Dizon", "Team Lead", "Operations", "active", -800, "ACTIVE"],
  ];
  const employees = await Promise.all(
    employeeRows.map(([no, name, title, dept, m365, joined, employment]) =>
      prisma.employee.create({
        data: {
          employeeNo: no, name, title,
          departmentId: depts[dept].id,
          m365Status: m365, employment, joinedAt: day(joined),
        },
      }),
    ),
  );
  const emp = (no: string) => employees.find((e) => e.employeeNo === no)!;

  // Assets: every status represented; DEFECTIVE rows carry repair fields.
  const mk = (
    tag: string, model: string, cat: string, status: string, extra: Record<string, unknown> = {},
  ) => ({
    tag, model, categoryId: cats[cat].id, typeId: cats[cat].typeIds[0],
    status: status as never,
    purchasedAt: day(-720), cost: 55_000, warrantyUntil: day(180), ...extra,
  });

  await prisma.asset.createMany({
    data: [
      mk("BR-LT-0148", "Dell Latitude 5420", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0042").id }),
      mk("BR-LT-0181", "ThinkPad T14 Gen 4", "Laptop", "SPARE", { warrantyUntil: day(600) }),
      mk("BR-LT-0122", "Dell Latitude 5420", "Laptop", "DEFECTIVE", { defectiveSince: day(-12), notes: "No POST after power surge" }),
      mk("BR-LT-0118", "ThinkPad T14 Gen 3", "Laptop", "DEFECTIVE", { defectiveSince: day(-21), vendorId: vendors[1].id, rmaRef: "RMA-8802", notes: "Battery swelling" }),
      mk("BR-LT-0090", "Dell Latitude 5410", "Laptop", "DEFECTIVE", { defectiveSince: day(-44), repairQuote: 18_400, notes: "Board failure, out of warranty", warrantyUntil: day(-200) }),
      mk("BR-LT-0201", "MacBook Air M3", "Laptop", "DEPLOYED", { assigneeId: emp("EMP-0099").id, warrantyUntil: day(700) }),
      mk("BR-LT-0075", "Dell Latitude 5400", "Laptop", "DONATED", { warrantyUntil: day(-400) }),
      mk("BR-LT-0060", "ThinkPad E14", "Laptop", "BUYOUT", { warrantyUntil: day(-500) }),
      mk("BR-LT-0031", "Acer Aspire 5", "Laptop", "DISPOSE", { warrantyUntil: day(-900) }),
      mk("BR-LT-0027", "HP ProBook 440", "Laptop", "MISSING", { notes: "Not returned at offboarding — investigation open", warrantyUntil: day(-300) }),
      mk("BR-LT-0210", "ThinkPad T14 Gen 4", "Laptop", "TEMPORARY", { assigneeId: emp("EMP-0095").id }),
      mk("BR-MN-0902", "Dell P2422H", "Monitor", "DEPLOYED", { assigneeId: emp("EMP-0042").id, cost: 9_500 }),
      mk("BR-MN-0731", "Dell P2419H", "Monitor", "DEFECTIVE", { defectiveSince: day(-9), vendorId: vendors[1].id, rmaRef: "RMA-8841", cost: 8_000, notes: "Backlight flicker" }),
      mk("BR-MN-0910", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000 }),
      mk("BR-MN-0911", "LG 27UL500", "Monitor", "SPARE", { cost: 12_000 }),
      mk("BR-PH-0287", "iPhone 12", "Phone", "TEMPORARY", { assigneeId: emp("EMP-0042").id, cost: 30_000, warrantyUntil: day(-100) }),
      mk("BR-PH-0301", "Samsung A54", "Phone", "SPARE", { cost: 18_000 }),
      mk("BR-DK-0071", "WD19S Dock", "Dock", "DEPLOYED", { assigneeId: emp("EMP-0042").id, cost: 11_000 }),
      mk("BR-DK-0033", "WD19S Dock", "Dock", "DEFECTIVE", { defectiveSince: day(-31), vendorId: vendors[1].id, rmaRef: "RMA-8790", cost: 11_000, notes: "Intermittent DisplayPort" }),
      mk("BR-HS-0501", "Jabra Evolve2 65", "Headset", "DEPLOYED", { assigneeId: emp("EMP-0051").id, cost: 7_500 }),
      mk("BR-HS-0502", "Jabra Evolve2 40", "Headset", "SPARE", { cost: 5_500 }),
      mk("BR-KB-0402", "Logitech MX Keys", "Peripheral", "DEFECTIVE", { defectiveSince: day(-2), cost: 6_000, notes: "Two keys unresponsive" }),
    ],
  });
  const asset = (tag: string) => prisma.asset.findUniqueOrThrow({ where: { tag } });

  // Purchase requests — one per state; the SUBMITTED one is a bounce-back with a note thread.
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0201", state: "DRAFT", requestedById: purchasing.id,
      units: { create: [{ description: "Laptop for new analyst", specs: "16GB RAM min", qty: 1, unitPrice: 62_000 }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0198", state: "SUBMITTED", requestedById: purchasing.id,
      submittedAt: day(-4), reviewedAt: day(-2), reviewedById: itStaff.id,
      units: {
        create: [
          { description: "27-inch monitors", qty: 4, unitPrice: 12_000, state: "PENDING" },
          { description: "USB-C docks", qty: 4, unitPrice: 11_000, state: "PENDING", itSlotNotes: "Confirm wattage for T14" },
        ],
      },
      notes: {
        create: [
          { authorId: purchasing.id, kind: "SUBMIT", text: "Batch for the July hires.", createdAt: day(-4) },
          { authorId: itStaff.id, kind: "IT_REVIEW", text: "Specs confirmed, docks need wattage check.", createdAt: day(-2) },
          { authorId: finance.id, kind: "REQUEST_INFO", text: "Unit 02: quote exceeds standing rate — attach vendor quote.", createdAt: day(-1) },
        ],
      },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0195", state: "IT_REVIEWED", requestedById: purchasing.id,
      submittedAt: day(-6), reviewedAt: day(-3), reviewedById: itStaff.id,
      units: { create: [{ description: "Wireless headsets", qty: 6, unitPrice: 7_500, state: "APPROVED" }] },
      notes: { create: [{ authorId: purchasing.id, kind: "SUBMIT", text: "Replacement cycle for Sales.", createdAt: day(-6) }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0188", state: "COMPLETED", requestedById: purchasing.id,
      submittedAt: day(-40), reviewedAt: day(-35), reviewedById: itStaff.id, completedAt: day(-30),
      units: { create: [{ description: "Dell Latitude 5420", qty: 2, unitPrice: 55_000, state: "APPROVED" }] },
    },
  });
  await prisma.purchaseRequest.create({
    data: {
      refNo: "PR-0183", state: "CANCELLED", requestedById: purchasing.id,
      submittedAt: day(-50), cancelledAt: day(-48), cancelReason: "Duplicate of PR-0184",
      units: { create: [{ description: "Spare chargers", qty: 10, unitPrice: 1_800, state: "CANCELLED" }] },
    },
  });

  // Approvals — all six states; one PENDING past SLA; EXECUTION_FAILED with verbatim error.
  const a0148 = await asset("BR-LT-0148");
  const a0181 = await asset("BR-LT-0181");
  await prisma.approval.createMany({
    data: [
      { refNo: "APR-2041", type: "lifecycle_assign", state: "PENDING", priority: "NORMAL", slaAt: day(2), requestedById: itStaff.id, assetId: a0181.id, employeeId: emp("EMP-0097").id, payload: { to: { assignee: "EMP-0097", status: "DEPLOYED" } } },
      { refNo: "APR-2040", type: "lifecycle_return", state: "PENDING", priority: "URGENT", slaAt: day(-1), requestedById: itStaff.id, employeeId: emp("EMP-0090").id, payload: { reason: "offboarding" } },
      { refNo: "APR-2039", type: "lifecycle_change_status", state: "CLAIMED", priority: "NORMAL", slaAt: day(1), requestedById: itStaff.id, claimedById: admin.id, claimedAt: day(0), assetId: a0148.id, payload: { from: { status: "DEPLOYED" }, to: { status: "TEMPORARY" } } },
      { refNo: "APR-2035", type: "lifecycle_assign", state: "APPROVED", priority: "NORMAL", slaAt: day(1), requestedById: itStaff.id, claimedById: admin.id, claimedAt: day(-1), payload: { note: "queued for execution" } },
      { refNo: "APR-2031", type: "lifecycle_transfer", state: "EXECUTED", priority: "NORMAL", slaAt: day(-2), requestedById: itStaff.id, claimedById: admin.id, resolvedAt: day(-2), payload: { from: "EMP-0042", to: "EMP-0051" } },
      { refNo: "APR-2028", type: "lifecycle_replace", state: "REJECTED", priority: "HIGH", slaAt: day(-5), requestedById: itStaff.id, claimedById: admin.id, resolvedAt: day(-5), resolutionReason: "Replacement not justified; repair quote pending", payload: {} },
      { refNo: "APR-2025", type: "lifecycle_assign", state: "EXECUTION_FAILED", priority: "NORMAL", slaAt: day(-3), requestedById: itStaff.id, claimedById: admin.id, workerError: "Execution guard: target employee EMP-0093 is OFFBOARDED — assignment refused", payload: {} },
    ],
  });

  // Job queued for the APPROVED approval (worker executes it in Phase 4)
  const apr2035 = await prisma.approval.findUniqueOrThrow({ where: { refNo: "APR-2035" } });
  await prisma.job.create({ data: { type: "EXECUTE_APPROVAL", payload: { approvalId: apr2035.id } } });

  // Reservations — all four states
  await prisma.reservation.createMany({
    data: [
      { assetId: (await asset("BR-MN-0910")).id, employeeId: emp("EMP-0097").id, state: "ACTIVE", reason: "New hire setup", expiresAt: day(7) },
      { assetId: (await asset("BR-MN-0911")).id, employeeId: emp("EMP-0088").id, state: "FULFILLED", resolvedAt: day(-3) },
      { assetId: (await asset("BR-HS-0502")).id, employeeId: emp("EMP-0051").id, state: "RELEASED", resolvedAt: day(-5) },
      { assetId: (await asset("BR-PH-0301")).id, employeeId: emp("EMP-0063").id, state: "EXPIRED", expiresAt: day(-2) },
    ],
  });

  // Equipment policy for Finance (drives the loadout view in Phase 3)
  await prisma.equipmentPolicy.create({
    data: {
      name: "Finance standard", appliesToDepartmentId: depts["Finance"].id,
      slots: { create: [
        { name: "laptop", assetTypeId: cats["Laptop"].typeIds[0], required: true },
        { name: "monitor", assetTypeId: cats["Monitor"].typeIds[0], required: true },
        { name: "dock", assetTypeId: cats["Dock"].typeIds[0], required: true },
        { name: "headset", assetTypeId: cats["Headset"].typeIds[0], required: true },
        { name: "phone", assetTypeId: cats["Phone"].typeIds[0], required: true },
        { name: "second monitor", assetTypeId: cats["Monitor"].typeIds[1], required: false },
      ] },
    },
  });

  // Audit entries so /audit and history views have data before Phase 3 writes real ones
  await prisma.auditEntry.createMany({
    data: [
      { actorLabel: "system", entityType: "asset", entityId: a0148.id, action: "create", diff: { status: { from: null, to: "SPARE" } } },
      { actorId: itStaff.id, actorLabel: "J. Sarmiento", entityType: "asset", entityId: a0148.id, action: "update", diff: { status: { from: "SPARE", to: "DEPLOYED" }, assignee: { from: null, to: "EMP-0042" } } },
      { actorId: admin.id, actorLabel: "System Admin", entityType: "asset", entityId: a0148.id, action: "SECRET_READ" },
    ],
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run it**

```bash
npm run db:seed
```

Expected: `Seed complete.` with no errors.

- [ ] **Step 3: Spot-check counts**

```bash
docker compose exec db psql -U inventory -d inventory -c "select 'assets', count(*) from \"Asset\" union all select 'approvals', count(*) from \"Approval\" union all select 'prs', count(*) from \"PurchaseRequest\";"
```

Expected: assets 22, approvals 7, prs 5.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(db): seed with fixtures covering every enum state"
```

---

### Task 6: Status system (TDD)

The single source of truth mapping every domain enum value to one of six semantic families. Nothing else in the app may pick a status colour.

> **Phase 3 caveat (from review):** `EmploymentStatus` values (`ACTIVE`/`OFFBOARDING`/`OFFBOARDED`) are deliberately NOT in the map. If the employees table later renders them as status pills, they must be added explicitly — uppercase `OFFBOARDING`/`OFFBOARDED` would otherwise fall through to neutral, and `ACTIVE` would collide with the reservation key (inflight — semantically wrong for employment).

**Files:**
- Create: `src/lib/status.test.ts`, then `src/lib/status.ts`

- [ ] **Step 1: Write the failing test — `src/lib/status.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { statusFamily, isSystemFailure, STATUS_FAMILIES } from "./status";

describe("statusFamily", () => {
  const cases: Array<[string, string]> = [
    // Asset status (8 — MISSING is the approved schema extension for the offboarding wizard)
    ["DEPLOYED", "settled"], ["SPARE", "neutral"], ["DEFECTIVE", "fault"], ["MISSING", "fault"],
    ["DONATED", "closed"], ["TEMPORARY", "attention"], ["BUYOUT", "closed"], ["DISPOSE", "closed"],
    // Purchase request state (5)
    ["DRAFT", "neutral"], ["SUBMITTED", "inflight"], ["IT_REVIEWED", "inflight"],
    ["COMPLETED", "settled"], ["CANCELLED", "closed"],
    // Purchase unit / approval shared values
    ["PENDING", "attention"], ["APPROVED", "settled"], ["REJECTED", "fault"],
    // Approval-specific
    ["CLAIMED", "inflight"], ["EXECUTED", "settled"], ["EXECUTION_FAILED", "fault"],
    // Reservation (4)
    ["ACTIVE", "inflight"], ["FULFILLED", "settled"], ["RELEASED", "closed"], ["EXPIRED", "closed"],
    // M365 (lowercase — case-sensitive on purpose: reservation ACTIVE is inflight, M365 active is settled)
    ["pending", "attention"], ["active", "settled"], ["offboarding", "inflight"], ["inactive", "closed"],
  ];

  it.each(cases)("%s → %s", (value, family) => {
    expect(statusFamily(value)).toBe(family);
  });

  it("maps unknown/custom values to neutral", () => {
    expect(statusFamily("contractor")).toBe("neutral");
    expect(statusFamily("")).toBe("neutral");
    expect(statusFamily("SOMETHING_NEW")).toBe("neutral");
  });

  it("flags EXECUTION_FAILED as a system failure (dashed diamond treatment)", () => {
    expect(isSystemFailure("EXECUTION_FAILED")).toBe(true);
    expect(isSystemFailure("REJECTED")).toBe(false);
  });

  it("exports exactly six families", () => {
    expect(STATUS_FAMILIES).toEqual(["neutral", "inflight", "settled", "attention", "fault", "closed"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/status.test.ts
```

Expected: FAIL — cannot resolve `./status`.

- [ ] **Step 3: Write `src/lib/status.ts`**

```ts
/**
 * The six-family status system (design_handover/README.md, "The status system").
 * Every enum value in the app maps into exactly one family; nothing gets a
 * bespoke colour. Unknown/client-defined values map to neutral.
 *
 * Case-sensitive by design: reservation "ACTIVE" is inflight (someone owes an
 * action), M365 "active" is settled (account is in the right state).
 */
export const STATUS_FAMILIES = [
  "neutral", "inflight", "settled", "attention", "fault", "closed",
] as const;

export type StatusFamily = (typeof STATUS_FAMILIES)[number];

const MAP: Record<string, StatusFamily> = {
  // Asset status (MISSING: custody lost — a fault demanding investigation, not "fine for now")
  DEPLOYED: "settled", SPARE: "neutral", DEFECTIVE: "fault", MISSING: "fault", DONATED: "closed",
  TEMPORARY: "attention", BUYOUT: "closed", DISPOSE: "closed",
  // Purchase request state
  DRAFT: "neutral", SUBMITTED: "inflight", IT_REVIEWED: "inflight",
  COMPLETED: "settled", CANCELLED: "closed",
  // Purchase unit + approval (shared values agree by design: the family is
  // what the row needs from the reader, not which enum it came from)
  PENDING: "attention", APPROVED: "settled", REJECTED: "fault",
  CLAIMED: "inflight", EXECUTED: "settled", EXECUTION_FAILED: "fault",
  // Reservation
  ACTIVE: "inflight", FULFILLED: "settled", RELEASED: "closed", EXPIRED: "closed",
  // Microsoft 365 (lowercase, canonical four)
  pending: "attention", active: "settled", offboarding: "inflight", inactive: "closed",
};

export function statusFamily(value: string): StatusFamily {
  return MAP[value] ?? "neutral";
}

/** EXECUTION_FAILED must not look like REJECTED: dashed border + diamond mark. */
export function isSystemFailure(value: string): boolean {
  return value === "EXECUTION_FAILED";
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/status.test.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/status.ts src/lib/status.test.ts
git commit -m "feat(status): six-family status map with exhaustive tests"
```

---

### Task 7: Design tokens — the complete `globals.css`

Every hex/duration/curve from `design_handover/README.md` becomes a custom property here. This file is the ONLY place a hex value may appear.

**Files:**
- Modify: `src/app/globals.css` (replace entire contents)

- [ ] **Step 1: Replace `src/app/globals.css` with:**

```css
@import "tailwindcss";

/* ── Colour tokens — light (design_handover/README.md "Design tokens") ── */
:root {
  --canvas: #f6f7f9;
  --surface: #ffffff;
  --surface-subtle: #fcfcfd;
  --surface-accent: #f8fbfe;
  --surface-raised: #ffffff;
  --border: #e4e7ec;
  --border-strong: #d0d5dd;
  --border-faint: #f2f4f7;
  --text: #101828;
  --text-secondary: #475467;
  --text-muted: #667085;
  --text-faint: #98a2b3;
  --accent: #2563a8;
  --accent-hover: #1d4e87;
  --accent-fg: #ffffff;
  --accent-soft-bg: #eff6fc;
  --accent-soft-border: #cfe2f4;
  --accent-soft-text: #1d4e87;
  --accent-tint: #f2f7fc;

  /* status dots */
  --st-neutral-dot: #667085;
  --st-inflight-dot: #2563a8;
  --st-settled-dot: #079455;
  --st-attention-dot: #dc6803;
  --st-fault-dot: #d92d20;
  --st-closed-ring: #98a2b3;
  /* status pills: bg / text / border */
  --st-neutral-bg: #f2f4f7;   --st-neutral-text: #475467;   --st-neutral-border: #e4e7ec;
  --st-inflight-bg: #eff6fc;  --st-inflight-text: #1d4e87;  --st-inflight-border: #cfe2f4;
  --st-settled-bg: #ecfdf3;   --st-settled-text: #067647;   --st-settled-border: #abefc6;
  --st-attention-bg: #fffaeb; --st-attention-text: #b54708; --st-attention-border: #fedf89;
  --st-fault-bg: #fef3f2;     --st-fault-text: #b42318;     --st-fault-border: #fecdca;
  --st-closed-bg: transparent; --st-closed-text: #667085;   --st-closed-border: #d0d5dd;
  --st-failed-border: #f97066; /* dashed, EXECUTION_FAILED only */

  /* tooltip is deliberately theme-invariant: always dark bubble, light text */
  --tooltip-bg: #101828;

  /* form feedback */
  --error-border: #fda29b;
  --error-shadow: rgba(217, 45, 32, 0.08);
  --required-mark: #d92d20;
  --error-text: #b42318;
  --focus-shadow: rgba(37, 99, 168, 0.12);

  /* elevation */
  --elev-card: 0 1px 2px rgba(16, 24, 40, 0.05);
  --elev-pop: 0 12px 30px -10px rgba(16, 24, 40, 0.3);
  --elev-drawer: -14px 0 34px -10px rgba(16, 24, 40, 0.28);
  --elev-dialog: 0 28px 60px -16px rgba(16, 24, 40, 0.5);
  --elev-toast: 0 16px 32px -12px rgba(16, 24, 40, 0.55);

  /* motion */
  --dur-1: 90ms;   /* hover, focus ring, checkbox, pill tint — linear */
  --dur-2: 140ms;  /* menu, popover, tooltip, chip removal */
  --dur-3: 200ms;  /* row enter, skeleton swap, tab underline */
  --dur-4: 260ms;  /* drawer, dialog, mobile nav */
  --dur-exit: 340ms;
  --dur-earn: 420ms;
  --dur-press: 70ms; /* button :active scale — below noticing, above feeling */
  --ease-std: cubic-bezier(0.2, 0, 0, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
  --ease-seg: cubic-bezier(0.34, 1.3, 0.64, 1);

  /* density: the ONLY thing the toggle changes (41px → 33px) */
  --row-h: 41px;

  /* placeholder stripes for product imagery */
  --placeholder-stripes: repeating-linear-gradient(135deg, #eef1f5 0 6px, #f7f9fb 6px 12px);
}

[data-density="compact"] {
  --row-h: 33px;
}

/* ── Colour tokens — dark (re-derived, not inverted) ── */
[data-theme="dark"] {
  --canvas: #0f1115;
  --surface: #171a20;
  --surface-subtle: #1a1e25;
  --surface-accent: #152435;
  --surface-raised: #1d2129;
  --border: #262b33;
  --border-strong: #333a45;
  --border-faint: #1e232b;
  --text: #e6e9ef;
  --text-secondary: #c7cdd8;
  --text-muted: #9aa4b2;
  --text-faint: #6b7480;
  --accent: #6aa9e0;
  --accent-hover: #8fc0ea;
  --accent-fg: #0b1119;
  --accent-soft-bg: #152435;
  --accent-soft-border: #274864;
  --accent-soft-text: #8fc0ea;
  --accent-tint: #152435;

  --st-neutral-dot: #8b95a2;
  --st-inflight-dot: #6aa9e0;
  --st-settled-dot: #34b47c;
  --st-attention-dot: #e79c33;
  --st-fault-dot: #ef6a5f;
  --st-closed-ring: #6b7480;
  --st-neutral-bg: #1d2129;   --st-neutral-text: #a8b2c0;   --st-neutral-border: #333a45;
  --st-inflight-bg: #152435;  --st-inflight-text: #8fc0ea;  --st-inflight-border: #274864;
  --st-settled-bg: #0f2a1e;   --st-settled-text: #5fd39b;   --st-settled-border: #1d4634;
  --st-attention-bg: #2d2214; --st-attention-text: #e7b168; --st-attention-border: #4a3a1d;
  --st-fault-bg: #2d1917;     --st-fault-text: #f28b80;     --st-fault-border: #4d2622;
  --st-closed-bg: transparent; --st-closed-text: #8b95a2;   --st-closed-border: #3a424e;

  --placeholder-stripes: repeating-linear-gradient(135deg, #1a1e25 0 6px, #1d2129 6px 12px);
}

/* ── Map tokens into Tailwind utility namespaces ── */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-surface-subtle: var(--surface-subtle);
  --color-surface-accent: var(--surface-accent);
  --color-surface-raised: var(--surface-raised);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-border-faint: var(--border-faint);
  --color-fg: var(--text);
  --color-fg-secondary: var(--text-secondary);
  --color-fg-muted: var(--text-muted);
  --color-fg-faint: var(--text-faint);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft-bg);
  --color-accent-soft-border: var(--accent-soft-border);
  --color-accent-soft-text: var(--accent-soft-text);
  --color-accent-tint: var(--accent-tint);

  --font-sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, Menlo, monospace;

  --shadow-card: var(--elev-card);
  --shadow-pop: var(--elev-pop);
  --shadow-drawer: var(--elev-drawer);
  --shadow-dialog: var(--elev-dialog);
  --shadow-toast: var(--elev-toast);

  --radius-card: 8px;   /* cards and inputs */
  --radius-btn: 7px;    /* buttons and selects */
  --radius-ctl: 6px;    /* small controls and pills */
  --radius-micro: 5px;  /* micro pills */
}

/* ── Base rules ── */
:root {
  color-scheme: light;
}
[data-theme="dark"] {
  color-scheme: dark;
}

body {
  background: var(--canvas);
  color: var(--text);
  font-size: 13px;
  line-height: 1.65;
}

/* Focus ring is always this — never a colour swap. */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Mono metadata always aligns its digits */
.font-mono {
  font-variant-numeric: tabular-nums;
}

/* ── Named keyframes (design_handover/README.md "Motion spec") ── */
@keyframes fade {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pop {
  0% { opacity: 0; transform: scale(0.84); }
  70% { transform: scale(1.05); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes ringout {
  from { box-shadow: 0 0 0 0 rgba(37, 99, 168, 0.4); }
  to { box-shadow: 0 0 0 10px transparent; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes shim {
  from { background-position: -220px 0; }
  to { background-position: 220px 0; }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes toastIn {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes sheet {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
@keyframes veil {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Hard requirement, not an enhancement. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: Verify the dev server compiles and tokens apply**

```bash
npm run dev
```

Expected: home page shows canvas-grey background, dark text; setting `data-theme="dark"` on `<html>` in devtools flips the palette. Stop the server.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(tokens): full light/dark token sheet, motion keyframes, reduced-motion kill switch"
```

---

### Task 8: StatusDot, StatusPill, ThemeToggle, DensityToggle

**Files:**
- Create: `src/components/ui/status.tsx`, `src/components/ui/theme-toggle.tsx`, `src/components/ui/density-toggle.tsx`

- [ ] **Step 1: Write `src/components/ui/status.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { statusFamily, isSystemFailure } from "@/lib/status";

/**
 * Dot = status as an attribute (dense tables): 7px dot, text elsewhere in the row.
 * Pill = status as the subject (headers, cards, timelines).
 * Closed renders hollow; EXECUTION_FAILED renders a dashed-border diamond.
 */

export function StatusDot({ value, className }: { value: string; className?: string }) {
  const family = statusFamily(value);
  if (isSystemFailure(value)) {
    return (
      <span
        aria-hidden
        className={cn("inline-block size-[7px] rotate-45", className)}
        style={{ background: "var(--st-fault-dot)" }}
      />
    );
  }
  if (family === "closed") {
    return (
      <span
        aria-hidden
        className={cn("inline-block size-[7px] rounded-full", className)}
        style={{ border: "1.5px solid var(--st-closed-ring)", background: "transparent" }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("inline-block size-[7px] rounded-full", className)}
      style={{ background: `var(--st-${family}-dot)` }}
    />
  );
}

export function StatusPill({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const family = statusFamily(value);
  const failed = isSystemFailure(value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-(--radius-ctl) px-2 py-0.5",
        "font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
        className,
      )}
      style={{
        background: `var(--st-${family}-bg)`,
        color: `var(--st-${family}-text)`,
        border: failed
          ? "1px dashed var(--st-failed-border)"
          : `1px solid var(--st-${family}-border)`,
      }}
    >
      <StatusDot value={value} className="size-[6px]" />
      {label ?? value}
    </span>
  );
}
```

- [ ] **Step 2: Write `src/components/ui/theme-toggle.tsx`**

Cookie-backed (`br.theme`) so the server layout can render the attribute in Phase 2; the attribute flips instantly client-side.

```tsx
"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const getTheme = () => document.documentElement.dataset.theme ?? "light";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  const toggle = useCallback(() => {
    const next = getTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `br.theme=${next};path=/;max-age=31536000;samesite=lax`;
  }, []);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
```

- [ ] **Step 3: Write `src/components/ui/density-toggle.tsx`**

```tsx
"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-density"] });
  return () => obs.disconnect();
}
const getDensity = () => document.documentElement.dataset.density ?? "comfortable";

export function DensityToggle() {
  const density = useSyncExternalStore(subscribe, getDensity, () => "comfortable");
  const toggle = useCallback(() => {
    const next = getDensity() === "compact" ? "comfortable" : "compact";
    document.documentElement.dataset.density = next;
    document.cookie = `br.density=${next};path=/;max-age=31536000;samesite=lax`;
  }, []);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${density === "compact" ? "comfortable" : "compact"} density`}
      className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
    >
      {density === "compact" ? "Comfortable" : "Compact"}
    </button>
  );
}
```

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui
git commit -m "feat(ui): StatusDot/StatusPill and theme/density toggles"
```

---

### Task 9: Icon set + Spinner

16 icons, 18×18 grid, 1.4px stroke, square terminals, geometry only. Anything not in this set ships as a text label.

**Files:**
- Create: `src/components/ui/icon.tsx`, `src/components/ui/spinner.tsx`

- [ ] **Step 1: Write `src/components/ui/icon.tsx`**

```tsx
import { cn } from "@/lib/cn";

export type IconName =
  | "laptop" | "monitor" | "phone" | "dock" | "headset" | "inventory"
  | "employee" | "approval" | "audit" | "search" | "filter" | "sla"
  | "alert" | "secret" | "export" | "add";

const PATHS: Record<IconName, React.ReactNode> = {
  laptop: (<><rect x="3" y="4" width="12" height="8" /><line x1="1.5" y1="14.5" x2="16.5" y2="14.5" /></>),
  monitor: (<><rect x="2.5" y="3" width="13" height="9" /><line x1="9" y1="12" x2="9" y2="15" /><line x1="6" y1="15" x2="12" y2="15" /></>),
  phone: (<><rect x="5.5" y="2" width="7" height="14" rx="1" /><line x1="8" y1="13.5" x2="10" y2="13.5" /></>),
  dock: (<><rect x="2.5" y="10" width="13" height="4" /><line x1="9" y1="10" x2="9" y2="4" /><line x1="6" y1="4" x2="12" y2="4" /></>),
  headset: (<><path d="M4 10 V7 a5 5 0 0 1 10 0 v3" /><rect x="2.5" y="10" width="3" height="4" /><rect x="12.5" y="10" width="3" height="4" /></>),
  inventory: (<><rect x="3" y="5" width="12" height="10" /><polyline points="3,5 9,2.5 15,5" /><line x1="9" y1="8" x2="9" y2="12" /></>),
  employee: (<><circle cx="9" cy="6" r="3" /><path d="M3.5 15.5 V13 a5.5 4 0 0 1 11 0 v2.5" /></>),
  approval: (<><rect x="3" y="3" width="12" height="12" /><polyline points="6,9 8.2,11.2 12,7" /></>),
  audit: (<><line x1="4" y1="4.5" x2="14" y2="4.5" /><line x1="4" y1="9" x2="14" y2="9" /><line x1="4" y1="13.5" x2="10" y2="13.5" /></>),
  search: (<><circle cx="8" cy="8" r="4.5" /><line x1="11.5" y1="11.5" x2="15.5" y2="15.5" /></>),
  filter: (<><line x1="3" y1="5" x2="15" y2="5" /><line x1="5.5" y1="9" x2="12.5" y2="9" /><line x1="7.5" y1="13" x2="10.5" y2="13" /></>),
  sla: (<><circle cx="9" cy="9" r="6.5" /><polyline points="9,5.5 9,9 12,10.5" /></>),
  alert: (<><polyline points="9,2.5 16,15 2,15 9,2.5" /><line x1="9" y1="7.5" x2="9" y2="10.5" /><circle cx="9" cy="12.8" r="0.7" fill="currentColor" stroke="none" /></>),
  secret: (<><circle cx="6.5" cy="9" r="3.5" /><line x1="10" y1="9" x2="15.5" y2="9" /><line x1="13" y1="9" x2="13" y2="12" /><line x1="15.5" y1="9" x2="15.5" y2="11.5" /></>),
  export: (<><line x1="9" y1="11.5" x2="9" y2="2.5" /><polyline points="5.5,6 9,2.5 12.5,6" /><polyline points="3,11 3,15 15,15 15,11" /></>),
  add: (<><line x1="9" y1="3.5" x2="9" y2="14.5" /><line x1="3.5" y1="9" x2="14.5" y2="9" /></>),
};

export function Icon({
  name,
  size = 18,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 2: Write `src/components/ui/spinner.tsx`**

```tsx
import { cn } from "@/lib/cn";

/** 1.7px ring, top border in accent, 700ms linear spin. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block rounded-full", className)}
      style={{
        width: size,
        height: size,
        border: "1.7px solid var(--border-strong)",
        borderTopColor: "var(--accent)",
        animation: "spin 700ms linear infinite",
      }}
    />
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui/icon.tsx src/components/ui/spinner.tsx
git commit -m "feat(ui): 16-icon geometric set and spinner"
```

---

### Task 10: Button + IconButton

Sizes sm 6×10/11.5px · md 9×14/13px · lg 11×18/14px; variants primary/secondary/ghost/danger; loading keeps width; icon-only 34×34; press scale(.965) 70ms.

**Files:**
- Create: `src/components/ui/button.tsx`

- [ ] **Step 1: Write `src/components/ui/button.tsx`**

```tsx
"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg border border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary:
    "bg-surface text-fg-secondary border border-border-strong hover:bg-surface-subtle",
  ghost: "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-subtle",
  danger:
    "bg-[var(--st-fault-dot)] text-white border border-[var(--st-fault-dot)] hover:opacity-90",
};

const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-[11.5px]",
  md: "px-3.5 py-[9px] text-[13px]",
  lg: "px-[18px] py-[11px] text-[14px]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center gap-1.5 rounded-(--radius-btn) font-medium",
        "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,opacity_var(--dur-1)_linear,scale_var(--dur-press)_linear]",
        "active:scale-[.965] disabled:pointer-events-none disabled:opacity-55",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {/* loading keeps width: content goes invisible, spinner overlays */}
      <span className={cn("inline-flex items-center gap-1.5", loading && "invisible")}>
        {children}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={11} />
        </span>
      )}
    </button>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string; // required: icon-only buttons must be named
  variant?: Variant;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { variant = "ghost", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex size-[34px] items-center justify-center rounded-(--radius-btn)",
        "[transition:background_var(--dur-1)_linear,border-color_var(--dur-1)_linear,scale_var(--dur-press)_linear] active:scale-[.965]",
        "disabled:pointer-events-none disabled:opacity-55",
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui/button.tsx
git commit -m "feat(ui): Button and IconButton with loading/press states"
```

---

### Task 11: Form controls

Input, Textarea, Select, Checkbox, Radio, Switch, FormField (+FormError). Focus = accent border + 3px soft shadow; error = #FDA29B border + red shadow. Label 12px/500, required `*` in `--required-mark`, hint 11px, error 11px/500.

**Files:**
- Create: `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/select.tsx`, `src/components/ui/checkbox.tsx`, `src/components/ui/radio.tsx`, `src/components/ui/switch.tsx`, `src/components/ui/form-field.tsx`

- [ ] **Step 1: Write `src/components/ui/input.tsx`**

```tsx
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const fieldClasses = (invalid?: boolean) =>
  cn(
    "w-full rounded-(--radius-card) border bg-surface px-3 py-2 text-[13px] text-fg",
    "placeholder:text-fg-faint transition-[border-color,box-shadow] duration-(--dur-1)",
    "focus:outline-none disabled:opacity-55",
    invalid
      ? "border-[var(--error-border)] focus:border-[var(--error-border)] focus:shadow-[0_0_0_3px_var(--error-shadow)]"
      : "border-border-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--focus-shadow)]",
  );

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, className, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(fieldClasses(invalid), className)} {...rest} />;
});
```

- [ ] **Step 2: Write `src/components/ui/textarea.tsx`**

```tsx
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "./input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(fieldClasses(invalid), "resize-y", className)}
      {...rest}
    />
  );
});
```

- [ ] **Step 3: Write `src/components/ui/select.tsx`** (native select, styled; Combobox arrives with the screens that need typeahead)

```tsx
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "./input";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(fieldClasses(invalid), "rounded-(--radius-btn) appearance-none pr-8", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%23667085' stroke-width='1.4'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
      }}
      {...rest}
    >
      {children}
    </select>
  );
});
```

- [ ] **Step 4: Write `src/components/ui/checkbox.tsx`** (16–17px, radius 4–5, tick pops)

```tsx
"use client";

import { forwardRef, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate, className, ...rest },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      type="checkbox"
      ref={(node) => {
        inner.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn(
        "size-4 appearance-none rounded-[4px] border border-border-strong bg-surface align-middle",
        "transition-[background,border-color] duration-(--dur-1)",
        "checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent",
        "checked:bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='8' fill='none' stroke='white' stroke-width='1.8'%3E%3Cpath d='M1 4l2.7 2.7L9 1'/%3E%3C/svg%3E\")] checked:bg-center checked:bg-no-repeat",
        "indeterminate:bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='2' fill='white'%3E%3Crect width='8' height='2'/%3E%3C/svg%3E\")] indeterminate:bg-center indeterminate:bg-no-repeat",
        className,
      )}
      {...rest}
    />
  );
});
```

- [ ] **Step 5: Write `src/components/ui/radio.tsx`**

```tsx
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Radio = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">>(
  function Radio({ className, ...rest }, ref) {
    return (
      <input
        type="radio"
        ref={ref}
        className={cn(
          "size-4 appearance-none rounded-full border border-border-strong bg-surface align-middle",
          "transition-[border-color,box-shadow] duration-(--dur-1)",
          "checked:border-[5px] checked:border-accent",
          className,
        )}
        {...rest}
      />
    );
  },
);
```

- [ ] **Step 6: Write `src/components/ui/switch.tsx`** (32×18 track, 14px knob, 180ms spring)

```tsx
"use client";

import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  id?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-[18px] w-[32px] rounded-full border transition-colors duration-(--dur-1)",
        "disabled:pointer-events-none disabled:opacity-55",
        checked ? "border-accent bg-accent" : "border-border-strong bg-border-faint",
      )}
    >
      <span
        className="absolute top-[1px] size-[14px] rounded-full bg-white shadow-sm"
        style={{
          left: checked ? "15px" : "1px",
          transition: "left 180ms var(--ease-spring)",
        }}
      />
    </button>
  );
}
```

- [ ] **Step 7: Write `src/components/ui/form-field.tsx`**

```tsx
import { useId } from "react";
import { cn } from "@/lib/cn";

export function FormError({ children, id }: { children: React.ReactNode; id?: string }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>
      {children}
    </p>
  );
}

export function FormField({
  label,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; invalid: boolean }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint && !error ? `${id}-hint` : undefined; // error suppresses the hint, so its id must leave aria-describedby too
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg">
        {label}
        {required && (
          <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy, invalid: !!error })}
      {hint && !error && (
        <p id={hintId} className="text-[11px] text-fg-muted">{hint}</p>
      )}
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui
git commit -m "feat(ui): form control primitives with focus/error treatments"
```

---

### Task 12: Static display primitives

Card, Pill, Avatar, Kbd, DescriptionList, Stat, Banner, EmptyState, Skeleton, ProgressBar, Breadcrumb, Tooltip.

**Files:**
- Create: `src/components/ui/card.tsx`, `pill.tsx`, `avatar.tsx`, `kbd.tsx`, `description-list.tsx`, `stat.tsx`, `banner.tsx`, `empty-state.tsx`, `skeleton.tsx`, `progress-bar.tsx`, `breadcrumb.tsx`, `tooltip.tsx` (all under `src/components/ui/`)

- [ ] **Step 1: Write `src/components/ui/card.tsx`**

```tsx
import { cn } from "@/lib/cn";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-(--radius-card) border border-border bg-surface shadow-card", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  actions,
  className,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-border-faint px-4 py-3", className)}>
      <h3 className="text-[15px] font-semibold leading-tight text-fg">{title}</h3>
      {actions}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}
```

- [ ] **Step 2: Write `src/components/ui/pill.tsx`** (generic accent/neutral pill — status pills come from status.tsx)

```tsx
import { cn } from "@/lib/cn";

export function Pill({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]",
        tone === "accent"
          ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
          : "border-border bg-border-faint text-fg-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Write `src/components/ui/avatar.tsx`** (sizes 19/20/24/26/34/62, initials mono 600)

```tsx
import { cn } from "@/lib/cn";

const SIZES = { xs: 19, sm: 20, md: 24, lg: 26, xl: 34, xxl: 62 } as const;

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-accent-soft font-mono font-semibold text-accent-soft-text",
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.max(8.5, px * 0.36) }}
    >
      {initials}
    </span>
  );
}
```

- [ ] **Step 4: Write `src/components/ui/kbd.tsx`**

```tsx
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded-[5px] border border-border-strong bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
      {children}
    </kbd>
  );
}
```

- [ ] **Step 5: Write `src/components/ui/description-list.tsx`** (96–104px label column)

```tsx
export function DescriptionList({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode; mono?: boolean }>;
}) {
  return (
    <dl className="flex flex-col gap-2">
      {items.map(({ label, value, mono }) => (
        <div key={label} className="flex items-baseline gap-3">
          <dt className="w-[100px] shrink-0 text-[11px] text-fg-muted">{label}</dt>
          <dd className={mono ? "font-mono text-xs text-fg-secondary" : "text-[13px] text-fg-secondary"}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 6: Write `src/components/ui/stat.tsx`**

```tsx
export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-faint">
        {label}
      </span>
      <span className="font-mono text-lg font-semibold leading-tight text-fg">{value}</span>
      {hint && <span className="text-[10.5px] text-fg-muted">{hint}</span>}
    </div>
  );
}
```

- [ ] **Step 7: Write `src/components/ui/banner.tsx`** (Banner/Alert; the bounce-back banner in Phase 5 composes this)

```tsx
import { cn } from "@/lib/cn";
import type { StatusFamily } from "@/lib/status";

export function Banner({
  tone = "neutral",
  title,
  children,
  actions,
  className,
}: {
  tone?: StatusFamily;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "fault" || tone === "attention" ? "alert" : "status"}
      className={cn("rounded-(--radius-card) border px-4 py-3", className)}
      style={{
        background: `var(--st-${tone}-bg)`,
        borderColor: `var(--st-${tone}-border)`,
        borderLeft: `3px solid var(--st-${tone === "closed" ? "neutral" : tone}-dot)`,
      }}
    >
      {title && (
        <p className="text-[13px] font-semibold" style={{ color: `var(--st-${tone}-text)` }}>{title}</p>
      )}
      {children && <div className="mt-0.5 text-xs text-fg-secondary">{children}</div>}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 8: Write `src/components/ui/empty-state.tsx`** (two sentences: nothing-exists vs filters-matched-nothing are the CALLER's copy; this is the shell)

```tsx
export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {description && <p className="max-w-[360px] text-xs text-fg-muted">{description}</p>}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 9: Write `src/components/ui/skeleton.tsx`** (shimmer, not spin; heights match final rhythm)

```tsx
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded-[4px]", className)}
      style={{
        background:
          "linear-gradient(90deg, var(--border-faint) 25%, var(--surface-subtle) 45%, var(--border-faint) 65%)",
        backgroundSize: "220px 100%",
        animation: "shim 1.2s linear infinite",
      }}
    />
  );
}

/** A table-row skeleton that matches --row-h exactly so the swap is a cross-fade, not a jump. */
export function SkeletonRow({ columns = 4 }: { columns?: number }) {
  return (
    <div
      className="flex items-center gap-4 border-b border-border-faint px-3"
      style={{ height: "var(--row-h)" }}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton key={i} className={i === 1 ? "h-3 flex-1" : "h-3 w-20"} />
      ))}
    </div>
  );
}
```

- [ ] **Step 10: Write `src/components/ui/progress-bar.tsx`** (6px, radius 99, grow reveal)

```tsx
export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className="h-[6px] w-full overflow-hidden rounded-full bg-border-faint"
    >
      <div
        className="h-full rounded-full bg-accent origin-left"
        style={{ width: `${pct}%`, animation: "grow var(--dur-3) var(--ease-std)" }}
      />
    </div>
  );
}
```

- [ ] **Step 11: Write `src/components/ui/breadcrumb.tsx`** (`/` separators in border-strong colour)

```tsx
import Link from "next/link";
import { Fragment } from "react";

export function Breadcrumb({
  items,
}: {
  items: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-2 text-xs">
        {items.map((item, i) => (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && (
              <li aria-hidden className="text-border-strong select-none">/</li>
            )}
            <li>
              {item.href ? (
                <Link href={item.href} className="text-fg-muted hover:text-accent">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="font-medium text-fg">{item.label}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 12: Write `src/components/ui/tooltip.tsx`** (dark bg, 11px, radius 5; hover AND focus)

```tsx
"use client";

import { cloneElement, useId, useState } from "react";
import { cn } from "@/lib/cn";

type TriggerProps = {
  "aria-describedby"?: string;
  onFocus?: React.FocusEventHandler;
  onBlur?: React.FocusEventHandler;
};

/**
 * The trigger child must itself be focusable (button, link, input…) for the
 * keyboard path to work — tooltips on non-interactive elements are an axe
 * violation anyway. The child is cloned to carry aria-describedby.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
  children: React.ReactElement<TriggerProps>;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const child = cloneElement(children, {
    "aria-describedby": id,
    onFocus: (e: React.FocusEvent<Element>) => {
      children.props.onFocus?.(e);
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent<Element>) => {
      children.props.onBlur?.(e);
      setOpen(false);
    },
  });
  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {child}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap",
          "rounded-[5px] px-2 py-1 text-[11px] text-white",
          open ? "opacity-100" : "opacity-0",
        )}
        style={{
          background: "var(--tooltip-bg)",
          transition: "opacity var(--dur-2) var(--ease-std)",
        }}
      >
        {content}
      </span>
    </span>
  );
}
```

- [ ] **Step 13: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui
git commit -m "feat(ui): static display primitives"
```

---

### Task 13: Tabs + SegmentedControl

**Files:**
- Create: `src/components/ui/tabs.tsx`, `src/components/ui/segmented-control.tsx`

- [ ] **Step 1: Write `src/components/ui/tabs.tsx`** (2px inset underline; link-based so tabs write URL state per the brief)

```tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export interface TabItem {
  label: React.ReactNode;
  href: string;
  active: boolean;
}

export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <nav className={cn("flex gap-1 border-b border-border", className)}>
      {items.map((item, i) => (
        <Link
          key={i}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
            item.active ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          {item.label}
          {item.active && (
            <span
              aria-hidden
              className="absolute inset-x-2 bottom-0 h-[2px] bg-accent"
              style={{ animation: "grow var(--dur-3) var(--ease-std)" }}
            />
          )}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write `src/components/ui/segmented-control.tsx`** (sliding indicator, 220ms seg curve)

```tsx
"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

export function SegmentedControl({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
  className?: string;
}) {
  const id = useId();
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "relative inline-grid auto-cols-fr grid-flow-col rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 rounded-[5px] bg-surface shadow-card"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          left: `calc(2px + (100% - 4px) / ${options.length} * ${idx})`,
          transition: "left 220ms var(--ease-seg)",
        }}
      />
      {options.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            "relative z-10 cursor-pointer rounded-[5px] px-3 py-1 text-center text-xs font-medium transition-colors duration-(--dur-1)",
            // the radio is sr-only (clipped), so its focus ring must paint on the label
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
            opt.value === value ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          <input
            type="radio"
            name={id}
            value={opt.value}
            checked={opt.value === value}
            onChange={() => onChange(opt.value)}
            className="sr-only"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui/tabs.tsx src/components/ui/segmented-control.tsx
git commit -m "feat(ui): Tabs and SegmentedControl"
```

---

### Task 14: Overlays — focus trap, Dialog, Drawer, Menu, Toast

ESC closes every overlay; focus is trapped while open and returned on close. Dialog is reserved for irreversible decisions (352px, pop). Drawer is the right-side sheet (376px default, sheet+veil 260ms fired together).

**Files:**
- Create: `src/components/ui/use-focus-trap.ts`, `src/components/ui/dialog.tsx`, `src/components/ui/drawer.tsx`, `src/components/ui/menu.tsx`, `src/components/ui/toast.tsx`

- [ ] **Step 1: Write `src/components/ui/use-focus-trap.ts`**

```ts
"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab focus inside `ref` while `active`; ESC calls onClose; focus
 * returns to the previously focused element on deactivation. Body scroll
 * locks while active.
 */
export function useFocusTrap(active: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = container.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container).focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previous?.focus();
    };
  }, [active, onClose]);

  return ref;
}
```

- [ ] **Step 2: Write `src/components/ui/dialog.tsx`**

```tsx
"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useFocusTrap } from "./use-focus-trap";

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useFocusTrap(open, onClose);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        style={{ animation: "veil var(--dur-4) var(--ease-std)" }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-[352px] rounded-(--radius-card) border border-border bg-surface-raised p-4 shadow-dialog"
        style={{ animation: "pop var(--dur-4) var(--ease-std)" }}
      >
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        <div className="mt-2 text-[13px] text-fg-secondary">{children}</div>
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Write `src/components/ui/drawer.tsx`**

```tsx
"use client";

import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { useFocusTrap } from "./use-focus-trap";

export function Drawer({
  open,
  onClose,
  title,
  width = 376,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  const ref = useFocusTrap(open, onClose);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        style={{ animation: "veil var(--dur-4) var(--ease-std)" }}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex flex-col border-l border-border bg-surface-raised shadow-drawer"
        style={{ width, animation: "sheet var(--dur-4) var(--ease-std)" }}
      >
        <div className="flex items-center justify-between border-b border-border-faint px-4 py-3">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-(--radius-ctl) px-2 py-1 text-fg-muted hover:bg-surface-subtle"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 4: Write `src/components/ui/menu.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({
  trigger,
  items,
  align = "end",
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => React.ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([aria-disabled])") ?? []);
        if (nodes.length === 0) return;
        const i = nodes.indexOf(document.activeElement as HTMLElement);
        const next = e.key === "ArrowDown" ? nodes[(i + 1) % nodes.length] : nodes[(i - 1 + nodes.length) % nodes.length];
        next.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({ onClick: () => setOpen((v) => !v), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div
          ref={listRef}
          role="menu"
          className={cn(
            "absolute top-full z-40 mt-1 min-w-[160px] rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop",
            align === "end" ? "right-0" : "left-0",
          )}
          style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "block w-full rounded-[5px] px-2.5 py-1.5 text-left text-xs",
                "disabled:pointer-events-none disabled:opacity-55",
                item.danger
                  ? "text-[var(--error-text)] hover:bg-[var(--st-fault-bg)]"
                  : "text-fg-secondary hover:bg-surface-subtle",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `src/components/ui/toast.tsx`**

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { StatusDot } from "./status";

interface ToastItem {
  id: number;
  message: string;
  tone: "settled" | "fault" | "neutral";
}

const ToastContext = createContext<(message: string, tone?: ToastItem["tone"]) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastItem["tone"] = "neutral") => {
    const id = nextId++;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-(--radius-card) border border-border bg-surface-raised px-3.5 py-2.5 text-xs text-fg shadow-toast"
            style={{ animation: "toastIn var(--dur-3) var(--ease-std)" }}
          >
            <StatusDot value={t.tone === "settled" ? "EXECUTED" : t.tone === "fault" ? "REJECTED" : "SPARE"} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui
git commit -m "feat(ui): overlay primitives with focus trap and ESC handling"
```

---

### Task 15: Table + Pagination

Density-aware rows via `--row-h`; sticky header; column headers mono 10px uppercase; selection with indeterminate; numbered multi-sort badges (2 keys max — enforced by callers via the URL helper in Phase 2, the primitive just renders).

**Files:**
- Create: `src/components/ui/table.tsx`, `src/components/ui/pagination.tsx`

- [ ] **Step 1: Write `src/components/ui/table.tsx`**

```tsx
import { cn } from "@/lib/cn";

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto rounded-(--radius-card) border border-border bg-surface shadow-card", className)}>
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-10 bg-surface-subtle">{children}</thead>;
}

export function Th({
  className,
  align = "left",
  width,
  children,
  sort,
  sortIndex,
  onSort,
}: {
  className?: string;
  align?: "left" | "right";
  width?: number;
  children?: React.ReactNode;
  /** "asc" | "desc" when this column participates in the sort */
  sort?: "asc" | "desc";
  /** 1-based position in a multi-sort (max 2 keys) — renders the numbered badge */
  sortIndex?: number;
  onSort?: () => void;
}) {
  const content = (
    <span className="inline-flex items-center gap-1">
      {children}
      {sort && (
        <span aria-hidden className="text-accent">{sort === "asc" ? "↑" : "↓"}</span>
      )}
      {sort && sortIndex && (
        <span
          aria-hidden
          className="inline-flex size-3.5 items-center justify-center rounded-full bg-accent-soft font-mono text-[8.5px] text-accent-soft-text"
        >
          {sortIndex}
        </span>
      )}
    </span>
  );
  return (
    <th
      scope="col"
      style={{ width }}
      aria-sort={sort ? (sort === "asc" ? "ascending" : "descending") : undefined}
      className={cn(
        "border-b border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-fg-muted",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {onSort ? (
        <button type="button" onClick={onSort} className="hover:text-fg-secondary">
          {content}
        </button>
      ) : (
        content
      )}
    </th>
  );
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({
  selected,
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "group border-b border-border-faint transition-colors duration-(--dur-1)",
        selected ? "bg-accent-tint" : "hover:bg-surface-subtle",
        className,
      )}
      style={{ height: "var(--row-h)" }}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({
  className,
  align = "left",
  mono,
  children,
}: {
  className?: string;
  align?: "left" | "right";
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <td
      className={cn(
        "px-3 py-0 text-fg-secondary",
        mono && "font-mono text-xs text-fg-faint",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}
```

- [ ] **Step 2: Write `src/components/ui/pagination.tsx`**

```tsx
import Link from "next/link";
import { cn } from "@/lib/cn";

export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const item = (p: number, label?: string, disabled?: boolean) => (
    <Link
      key={label ?? p}
      href={hrefFor(p)}
      aria-disabled={disabled || undefined}
      aria-current={!label && p === page ? "page" : undefined}
      className={cn(
        "inline-flex min-w-7 items-center justify-center rounded-(--radius-ctl) border px-1.5 py-1 font-mono text-[11px]",
        disabled && "pointer-events-none opacity-45",
        !label && p === page
          ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
          : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
      )}
    >
      {label ?? p}
    </Link>
  );
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1,
  );
  const withGaps: Array<number | "gap"> = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) withGaps.push("gap");
    withGaps.push(p);
  });
  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      {item(page - 1, "‹", page === 1)}
      {withGaps.map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 font-mono text-[11px] text-fg-faint">…</span>
        ) : (
          item(p)
        ),
      )}
      {item(page + 1, "›", page === pageCount)}
    </nav>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/ui/table.tsx src/components/ui/pagination.tsx
git commit -m "feat(ui): density-aware Table and Pagination"
```

---

### Task 16: Kitchen-sink page

Renders every primitive in the current theme + density, with the toggles at the top. This page is the review surface for the whole phase — and the axe target.

**Files:**
- Create: `src/app/dev/kitchen-sink/page.tsx`

- [ ] **Step 1: Write `src/app/dev/kitchen-sink/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DensityToggle } from "@/components/ui/density-toggle";
import { DescriptionList } from "@/components/ui/description-list";
import { Dialog } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Menu } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { Pill } from "@/components/ui/pill";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Radio } from "@/components/ui/radio";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Stat } from "@/components/ui/stat";
import { StatusDot, StatusPill } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";

const ALL_STATUSES = [
  "DEPLOYED", "SPARE", "DEFECTIVE", "MISSING", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE",
  "DRAFT", "SUBMITTED", "IT_REVIEWED", "COMPLETED", "CANCELLED",
  "PENDING", "APPROVED", "REJECTED", "CLAIMED", "EXECUTED", "EXECUTION_FAILED",
  "ACTIVE", "FULFILLED", "RELEASED", "EXPIRED",
  "pending", "active", "offboarding", "inactive", "contractor",
];

const ICONS: IconName[] = [
  "laptop", "monitor", "phone", "dock", "headset", "inventory", "employee",
  "approval", "audit", "search", "filter", "sla", "alert", "secret", "export", "add",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Demos() {
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState("returned");
  const [checked, setChecked] = useState<boolean[]>([true, false, false]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Kitchen sink</h1>
          <p className="text-xs text-fg-muted">Every primitive, both themes, both densities.</p>
        </div>
        <div className="flex gap-2">
          <DensityToggle />
          <ThemeToggle />
        </div>
      </header>

      <Section title="Status system — pills">
        <div className="flex flex-wrap gap-1.5">
          {ALL_STATUSES.map((s) => <StatusPill key={s} value={s} />)}
        </div>
      </Section>

      <Section title="Status system — dots">
        <div className="flex flex-wrap items-center gap-3">
          {ALL_STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-fg-secondary">
              <StatusDot value={s} /> {s}
            </span>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Request swap</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Clear filters</Button>
          <Button variant="danger">Reject</Button>
          <Button variant="primary" loading>Saving…</Button>
          <Button variant="secondary" disabled>Disabled</Button>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="lg">Large</Button>
          <IconButton aria-label="Add asset"><Icon name="add" size={16} /></IconButton>
          <Spinner />
        </div>
      </Section>

      <Section title="Icons">
        <div className="flex flex-wrap gap-3 text-fg-secondary">
          {ICONS.map((name) => (
            <span key={name} className="inline-flex flex-col items-center gap-1">
              <Icon name={name} />
              <span className="font-mono text-[8.5px] text-fg-faint">{name}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title="Form controls">
        <Card className="max-w-md">
          <CardBody className="flex flex-col gap-4">
            <FormField label="Asset tag" required hint="Format BR-XX-0000">
              {(p) => <Input {...p} placeholder="BR-LT-0148" invalid={p.invalid} />}
            </FormField>
            <FormField label="Model" error="Model is required">
              {(p) => <Input {...p} invalid={p.invalid} />}
            </FormField>
            <FormField label="Notes">
              {(p) => <Textarea {...p} placeholder="Append-only elsewhere; plain here." />}
            </FormField>
            <FormField label="Category">
              {(p) => (
                <Select {...p}>
                  <option>Laptop</option>
                  <option>Monitor</option>
                </Select>
              )}
            </FormField>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <Checkbox checked={checked[0]} onChange={(e) => setChecked([e.target.checked, checked[1], checked[2]])} /> Checked
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <Checkbox indeterminate readOnly checked={false} /> Indeterminate
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-secondary">
                <Radio name="demo" defaultChecked /> Radio
              </label>
              <span className="flex items-center gap-2 text-xs text-fg-secondary">
                <Switch checked={switchOn} onCheckedChange={setSwitchOn} aria-label="Demo switch" /> Switch
              </span>
            </div>
            <SegmentedControl
              aria-label="Condition on return"
              value={segment}
              onChange={setSegment}
              options={[
                { value: "returned", label: "Returned" },
                { value: "defective", label: "Defective" },
                { value: "buyout", label: "Buyout" },
                { value: "missing", label: "Missing" },
              ]}
            />
          </CardBody>
        </Card>
      </Section>

      <Section title="Table (density-aware)">
        <Table>
          <THead>
            <Tr>
              <Th width={36}><Checkbox aria-label="Select all" indeterminate readOnly checked={false} /></Th>
              <Th width={20} />
              <Th width={104} sort="desc" sortIndex={1} onSort={() => {}}>Tag</Th>
              <Th>Model</Th>
              <Th width={168}>Assigned</Th>
              <Th width={88}>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {[
              ["BR-LT-0148", "Dell Latitude 5420", "Marites Bautista", "DEPLOYED"],
              ["BR-LT-0181", "ThinkPad T14 Gen 4", "—", "SPARE"],
              ["BR-LT-0122", "Dell Latitude 5420", "—", "DEFECTIVE"],
              ["BR-LT-0075", "Dell Latitude 5400", "—", "DONATED"],
            ].map(([tag, model, holder, status], i) => (
              <Tr key={tag} selected={i === 0}>
                <Td><Checkbox aria-label={`Select ${tag}`} checked={i === 0} readOnly /></Td>
                <Td><StatusDot value={status} /></Td>
                <Td mono>{tag}</Td>
                <Td>{model}</Td>
                <Td className="text-fg-muted">{holder}</Td>
                <Td mono>{status}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="flex justify-end">
          <Pagination page={3} pageCount={12} hrefFor={(p) => `?page=${p}`} />
        </div>
      </Section>

      <Section title="Loading states">
        <Card className="max-w-md">
          <CardBody className="flex flex-col gap-2 p-0">
            <SkeletonRow columns={4} />
            <SkeletonRow columns={4} />
            <div className="px-3 pb-3"><Skeleton className="h-3 w-40" /></div>
          </CardBody>
        </Card>
      </Section>

      <Section title="Cards, stats, description list">
        <div className="grid max-w-3xl grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Fleet" actions={<Pill tone="accent">IT</Pill>} />
            <CardBody className="grid grid-cols-2 gap-3">
              <Stat label="Items held" value="6" hint="of 8 slots" />
              <Stat label="Book value" value="₱214k" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="BR-LT-0148" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Model", value: "Dell Latitude 5420" },
                  { label: "Serial", value: "7GXK123", mono: true },
                  { label: "Status", value: <StatusPill value="DEPLOYED" /> },
                ]}
              />
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Banners">
        <div className="flex max-w-xl flex-col gap-2">
          <Banner tone="fault" title="Sent back by Finance" actions={<Button size="sm">Jump to unit 04</Button>}>
            IT_REVIEWED → SUBMITTED · nothing was cleared.
          </Banner>
          <Banner tone="attention" title="You've made 60 changes this minute — the cap">
            Nothing was lost: this form still holds your input.
          </Banner>
          <Banner tone="settled" title="Audit entry written" />
        </div>
      </Section>

      <Section title="Progress, breadcrumb, misc">
        <div className="flex max-w-md flex-col gap-4">
          <ProgressBar value={6} max={8} label="Loadout vs policy" />
          <Breadcrumb items={[{ label: "Inventory", href: "#" }, { label: "Repairs" }]} />
          <div className="flex items-center gap-3">
            <Avatar name="Marites Bautista" size="xl" />
            <Avatar name="J. Sarmiento" size="md" />
            <Tooltip content="Reads are audited">
              <Button variant="ghost" size="sm"><Icon name="secret" size={14} /> Reveal</Button>
            </Tooltip>
            <Kbd>⌘K</Kbd>
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          items={[
            { label: "Overview", href: "#", active: true },
            { label: "History", href: "#", active: false },
            { label: "Timeline", href: "#", active: false },
            { label: <>Secrets <Pill>AUDITED</Pill></>, href: "#", active: false },
          ]}
        />
      </Section>

      <Section title="Overlays">
        <div className="flex gap-2">
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button onClick={() => setDrawerOpen(true)}>Open drawer</Button>
          <Menu
            trigger={(p) => <Button {...p}>Row actions ⋯</Button>}
            items={[
              { label: "Open", onSelect: () => toast("Opened") },
              { label: "Request return", onSelect: () => toast("Return requested", "settled") },
              { label: "Dispose", danger: true, onSelect: () => toast("Not allowed", "fault") },
            ]}
          />
          <Button onClick={() => toast("Audit entry written", "settled")}>Toast</Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Cancel request PR-0198?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>Keep it</Button>
              <Button variant="danger" onClick={() => setDialogOpen(false)}>Cancel request</Button>
            </>
          }
        >
          This can't be undone. A reason is required and will be appended to the thread.
        </Dialog>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Fill slot — headset">
          <EmptyState
            title="No spares available"
            description="All Jabra Evolve2 units are deployed. Reserve from the next purchase instead."
            actions={<Button variant="primary" size="sm">Reserve incoming</Button>}
          />
        </Drawer>
      </Section>

      <Section title="Empty state">
        <Card className="max-w-md">
          <EmptyState
            title="Your filters matched nothing"
            description="3 filters are active."
            actions={<Button variant="ghost" size="sm">Clear filters</Button>}
          />
        </Card>
      </Section>
    </main>
  );
}

export default function KitchenSinkPage() {
  // Dev-only review surface — never served in production builds.
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <ToastProvider>
      <Demos />
    </ToastProvider>
  );
}
```

(Note the extra import this needs at the top of the file: `import { notFound } from "next/navigation";`)

- [ ] **Step 2: Verify in the browser**

```bash
npm run dev
```

Open `http://localhost:3000/dev/kitchen-sink`. Check: all 28 status values render (closed hollow, EXECUTION_FAILED dashed diamond); theme toggle flips every colour; density toggle changes table row height only; dialog and drawer trap focus and close on ESC; loading button keeps width. Stop the server.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/dev
git commit -m "feat(ui): kitchen-sink review page for the primitive layer"
```

---

### Task 17: Playwright + axe smoke suite

**Files:**
- Create: `playwright.config.ts`, `e2e/kitchen-sink.spec.ts`

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Install browsers**

```bash
npx playwright install chromium
```

- [ ] **Step 3: Write `e2e/kitchen-sink.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("kitchen sink", () => {
  test("renders and passes axe in light theme", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await expect(page.getByRole("heading", { name: "Kitchen sink" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious).toEqual([]);
  });

  test("passes axe in dark theme", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await page.getByRole("button", { name: /Switch to dark/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious).toEqual([]);
  });

  test("density toggle changes row height only", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    const row = page.getByRole("row").nth(1);
    const before = (await row.boundingBox())!.height;
    await page.getByRole("button", { name: /Switch to compact/ }).click();
    const after = (await row.boundingBox())!.height;
    expect(Math.round(before)).toBe(41);
    expect(Math.round(after)).toBe(33);
  });

  test("dialog traps focus and closes on ESC", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await page.getByRole("button", { name: "Open dialog" }).click();
    await expect(page.getByRole("dialog", { name: "Cancel request PR-0198?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // focus returned to the trigger
    await expect(page.getByRole("button", { name: "Open dialog" })).toBeFocused();
  });

  test("drawer closes on ESC", async ({ page }) => {
    await page.goto("/dev/kitchen-sink");
    await page.getByRole("button", { name: "Open drawer" }).click();
    await expect(page.getByRole("dialog", { name: "Fill slot — headset" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
```

- [ ] **Step 4: Run the suite**

```bash
npm run e2e
```

Expected: 5 passed. If axe reports contrast violations from token values, fix the offending usage (not the token) and re-run.

- [ ] **Step 5: Run the full check battery**

```bash
npx tsc --noEmit
npm run lint
npm run test
npm run build
```

Expected: all pass; build completes with standalone output.

- [ ] **Step 6: Commit and push the branch**

```bash
git add -A
git commit -m "test(e2e): kitchen-sink axe + interaction smoke suite"
git push -u origin phase-1-foundation
```

---

## Phase completion checklist

- [ ] `npm run lint` green
- [ ] `npm run test` green (status map unit tests)
- [ ] `npm run e2e` green (axe light + dark, density, dialog, drawer)
- [ ] `npm run build` succeeds
- [ ] `npm run db:seed` idempotent (run twice, no errors)
- [ ] `docker compose --profile prod build` succeeds against the final phase-1 tree (re-run after the schema integrity pass)
- [ ] Backup-restore drill once: run the backup service's pg_dump manually, restore it into a scratch database, confirm row counts match (an untested backup is not a backup)
- [ ] Kitchen sink eyeballed in both themes at both densities, and at 375px width
- [ ] Merge `phase-1-foundation` (use superpowers:finishing-a-development-branch)

**Non-goals of this phase (do not build):** screens, server actions, auth, middleware, the shell/sidebar, activity feeds, command palette. Those are Phases 2+, each with its own plan that builds on these primitives.
