<#
.SYNOPSIS
  Pull the current branch and redeploy the prod compose stack on this host.

.DESCRIPTION
  For the dedicated staging laptop. Run it after pushing from a development
  machine, or on a Task Scheduler timer to poll.

  Deliberately does NOT seed. `prisma/seed.ts` opens with a TRUNCATE of every
  table, so a deploy that seeded would wipe staging on every run. Migrations
  are safe and already automatic: the `migrate` service runs
  `prisma migrate deploy` and must exit 0 before `web` and `worker` start.

.PARAMETER Force
  Rebuild even when `git pull` brought nothing new. Without this, an unchanged
  commit exits early -- which is what makes a polling timer cheap.

.PARAMETER CheckOnly
  Report what would happen and touch nothing. No pull, no build, no restart.

.EXAMPLE
  .\scripts\deploy-staging.ps1
  .\scripts\deploy-staging.ps1 -Force
  .\scripts\deploy-staging.ps1 -CheckOnly
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

function Say([string]$m) { Write-Host "[deploy] $m" }
function Die([string]$m) { Write-Host "[deploy] FAILED: $m" -ForegroundColor Red; exit 1 }

# Run from the repository root regardless of where this was invoked.
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
Say "repository: $root"

if (-not (Test-Path ".env")) {
  Die ".env is missing. Copy .env.example and fill it in -- see README's Secrets section."
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$before = (git rev-parse HEAD).Trim()
Say "branch: $branch at $($before.Substring(0,7))"

# A staging host with local commits means someone edited the server. Stop
# rather than resolving it silently -- --ff-only would fail anyway, but the
# message it prints does not say what to do about it.
$dirty = git status --porcelain
if ($dirty) {
  Say "working tree is NOT clean:"
  $dirty | ForEach-Object { Say "  $_" }
  Die "commit, stash or discard these on the host first. A staging box should have no local edits."
}

$upstream = git rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>$null
if (-not $upstream) {
  Die "branch '$branch' has no upstream. Set one: git branch --set-upstream-to=origin/$branch"
}
Say "upstream: $upstream"

if ($CheckOnly) {
  git fetch --quiet
  $behind = (git rev-list --count "HEAD..@{u}").Trim()
  Say "CheckOnly: $behind commit(s) waiting on $upstream"
  if ($behind -ne "0") { git --no-pager log --oneline "HEAD..@{u}" }
  Say "CheckOnly: nothing was changed."
  exit 0
}

Say "pulling..."
git pull --ff-only
if ($LASTEXITCODE -ne 0) {
  Die "git pull --ff-only failed. The host has diverged from $upstream; reconcile it by hand."
}

$after = (git rev-parse HEAD).Trim()

if ($after -eq $before -and -not $Force) {
  Say "already at $($after.Substring(0,7)) -- nothing new. Use -Force to rebuild anyway."
  exit 0
}
if ($after -ne $before) { Say "updated $($before.Substring(0,7)) -> $($after.Substring(0,7))" }

# Build BEFORE up: `up -d` builds only when a tag is missing, so a host that
# already has an inventory-app image would silently keep running the old one.
Say "building..."
docker compose --profile prod build
if ($LASTEXITCODE -ne 0) { Die "docker compose build failed. Nothing was restarted; the old stack is still serving." }

Say "starting..."
docker compose --profile prod up -d
if ($LASTEXITCODE -ne 0) { Die "docker compose up failed. Check 'docker compose --profile prod logs migrate' first -- a failed migration stops web and worker by design." }

# `migrate` exits 0 on success, so a stopped `migrate` container is correct and
# must not be read as a failure. Poll the app itself instead.
Say "waiting for the app to answer..."
$ok = $false
foreach ($attempt in 1..40) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}

docker compose --profile prod ps

if (-not $ok) {
  Die "the app did not answer on http://localhost:3000/ within 2 minutes. Try 'docker compose --profile prod logs web'."
}

Say "deployed $($after.Substring(0,7)) on branch $branch -- app is answering."
Say "reminder: this script never seeds. Seeding truncates every table."
