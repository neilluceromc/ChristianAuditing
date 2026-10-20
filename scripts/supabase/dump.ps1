<#
.SYNOPSIS
  Take and validate a pg_dump -Fc backup of the Supabase database (cloud staging spec 4.8).

.DESCRIPTION
  The rule: before any push to main that adds a migration, take one of these and
  check it. Supabase Free keeps no backups of its own.

  Runs inside the laptop's existing postgres:16-alpine container (inventory-db-1):

    1. pg_dump -Fc --schema=public from the Supabase SESSION pooler to /tmp
    2. validate it: pg_restore -l | grep -c 'TABLE DATA', printed; zero fails
    3. docker cp it out to -Out
    4. remove the temporary file from the container, whatever happened

  The source URL is read from $env:SUPABASE_DB_URL, which YOU set in your own
  terminal. It is never printed, never written to a file and never put on a
  command line: it reaches the container as `docker exec -e PGURL`.

  pg_dump refuses a server newer than itself. If Supabase runs Postgres 17 the
  dump stops with "server version mismatch"; docs/CLOUD-STAGING.md (Backups)
  has the one-line postgres:17 fallback.

.PARAMETER Out
  Where to write the dump on this machine. Must not exist yet.

.EXAMPLE
  $env:SUPABASE_DB_URL = '<Supabase session pooler URI, port 5432>'
  .\scripts\supabase\dump.ps1 -Out .\backups\supabase-2026-10-21-before-migration-37.dump
  Remove-Item Env:SUPABASE_DB_URL
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Out
)

# NOT "Stop": see scripts/deploy-staging.ps1 (native stderr under PowerShell 5.1).
$ErrorActionPreference = 'Continue'

$Container = 'inventory-db-1'
$Remote = '/tmp/supabase-backup.dump'

function Fail([string]$Message) {
  Write-Host "dump: $Message" -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
  Fail ('SUPABASE_DB_URL is not set. In THIS terminal run' + [Environment]::NewLine +
    '    $env:SUPABASE_DB_URL = ''<Supabase session pooler URI, port 5432>''' + [Environment]::NewLine +
    '  then run this script again. (Supabase -> Connect -> Session pooler.)')
}
if ($env:SUPABASE_DB_URL -notmatch '^postgres(ql)?://') {
  Fail 'SUPABASE_DB_URL does not look like a postgresql:// URI (its value is not shown).'
}
if ($env:SUPABASE_DB_URL -match ':6543(/|\?|$)') {
  Fail 'SUPABASE_DB_URL points at the TRANSACTION pooler (port 6543). A dump needs the SESSION pooler (port 5432).'
}

$full = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($Out)
if (Test-Path -LiteralPath $full) {
  Fail "refusing to overwrite $full; choose a new file name."
}
$parent = Split-Path -Parent $full
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
  Fail "folder does not exist: $parent"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'docker is not on PATH. Start Docker Desktop and open a new terminal.'
}
$running = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($running -ne 'true') {
  Fail "container $Container is not running. From the repo root: docker compose up -d db"
}

# Each step says why and returns $false on failure; the caller's finally always cleans up.
# (A bare `return` at script scope would end the script before `exit 1` and report success.)
function Invoke-Dump {
  Write-Host 'dump: running pg_dump -Fc against Supabase (the URL is not shown)...'
  # Single quotes: $PGURL is expanded by the container's shell, not by PowerShell.
  # `set -f` turns off globbing for the unquoted URL (a ? in it is not a wildcard).
  docker exec -e PGURL $Container sh -c 'set -f; exec pg_dump -Fc --schema=public -d $PGURL -f /tmp/supabase-backup.dump' | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'dump: pg_dump failed (see above). "server version mismatch" means Supabase runs a newer Postgres than 16: see docs/CLOUD-STAGING.md, Backups.' -ForegroundColor Red
    return $false
  }

  $count = docker exec $Container sh -c 'pg_restore -l /tmp/supabase-backup.dump | grep -c ''TABLE DATA'''
  $n = 0
  if (-not [int]::TryParse(("$count").Trim(), [ref]$n) -or $n -le 0) {
    Write-Host "dump: the dump did not validate (TABLE DATA entries: '$count'). Nothing was copied out." -ForegroundColor Red
    return $false
  }
  Write-Host "dump: validated, TABLE DATA entries: $n"
  $script:TableData = $n

  docker cp "${Container}:$Remote" "$full" | Out-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'dump: docker cp out of the container failed.' -ForegroundColor Red
    return $false
  }
  return $true
}

$ok = $false
$TableData = 0
$env:PGURL = $env:SUPABASE_DB_URL
try {
  # Only the final `return` value counts; native output is sent to Out-Host above.
  $ok = (Invoke-Dump | Select-Object -Last 1) -eq $true
}
finally {
  Remove-Item Env:PGURL -ErrorAction SilentlyContinue
  docker exec $Container rm -f $Remote | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "dump: WARNING could not remove ${Container}:$Remote; remove it with: docker exec $Container rm -f $Remote" -ForegroundColor Yellow
  }
}

if (-not $ok) { exit 1 }
$size = (Get-Item -LiteralPath $full).Length
Write-Host ("dump: OK. {0} ({1:N0} bytes, {2} TABLE DATA entries)" -f $full, $size, $TableData) -ForegroundColor Green
