<#
.SYNOPSIS
  Restore a laptop pg_dump (-Fc) into the Supabase database (cloud staging spec 4.6, step 3).

.DESCRIPTION
  Runs pg_restore 16 inside the laptop's existing postgres:16-alpine container
  (inventory-db-1), so nothing new is installed on this machine:

    1. docker cp the dump to inventory-db-1:/tmp/restore.dump
    2. pg_restore --no-owner --no-privileges --schema=public --exit-on-error
       --single-transaction into the Supabase SESSION pooler (port 5432)
    3. remove /tmp/restore.dump from the container, whatever happened

  The target URL is read from $env:SUPABASE_DB_URL, which YOU set in your own
  terminal. It is never printed, never written to a file and never put on a
  command line: it reaches the container as `docker exec -e PGURL`, which copies
  the variable from this process's environment.

  --single-transaction makes the restore all or nothing: if any statement fails
  (for example because the tables already exist), nothing is left behind.

  After it succeeds, run scripts/supabase/lockdown.sql AGAIN in the Supabase SQL
  editor (docs/CLOUD-STAGING.md, step 4).

.PARAMETER Dump
  Path to the pg_dump -Fc file taken from the laptop database.

.EXAMPLE
  $env:SUPABASE_DB_URL = '<Supabase session pooler URI, port 5432>'
  .\scripts\supabase\restore.ps1 -Dump .\backups\staging-before-cloud.dump
  Remove-Item Env:SUPABASE_DB_URL
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dump
)

# NOT "Stop": in Windows PowerShell 5.1 a native command writing to stderr can
# become a terminating NativeCommandError. Every native call checks
# $LASTEXITCODE instead (the same rule as scripts/deploy-staging.ps1).
$ErrorActionPreference = 'Continue'

$Container = 'inventory-db-1'
$Remote = '/tmp/restore.dump'

function Fail([string]$Message) {
  Write-Host "restore: $Message" -ForegroundColor Red
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
  Fail 'SUPABASE_DB_URL points at the TRANSACTION pooler (port 6543). A restore needs the SESSION pooler (port 5432).'
}
if (-not (Test-Path -LiteralPath $Dump -PathType Leaf)) {
  Fail "dump file not found: $Dump"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'docker is not on PATH. Start Docker Desktop and open a new terminal.'
}
$running = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($running -ne 'true') {
  Fail "container $Container is not running. From the repo root: docker compose up -d db"
}

$full = (Resolve-Path -LiteralPath $Dump).Path
Write-Host "restore: copying $full into ${Container}:$Remote"
docker cp "$full" "${Container}:$Remote" | Out-Host
if ($LASTEXITCODE -ne 0) { Fail 'docker cp into the container failed.' }

$code = 1
$env:PGURL = $env:SUPABASE_DB_URL
try {
  Write-Host 'restore: running pg_restore into Supabase (the URL is not shown)...'
  # Single quotes: $PGURL is expanded by the container's shell, not by PowerShell.
  # `set -f` turns off globbing for the unquoted URL (a ? in it is not a wildcard).
  docker exec -e PGURL $Container sh -c 'set -f; exec pg_restore --no-owner --no-privileges --schema=public --exit-on-error --single-transaction -d $PGURL /tmp/restore.dump'
  $code = $LASTEXITCODE
}
finally {
  Remove-Item Env:PGURL -ErrorAction SilentlyContinue
  docker exec $Container rm -f $Remote | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "restore: WARNING could not remove ${Container}:$Remote; remove it with: docker exec $Container rm -f $Remote" -ForegroundColor Yellow
  }
}

if ($code -ne 0) {
  Fail "pg_restore failed (exit $code). Nothing was kept: the restore runs in one transaction. Read the error above, fix it, run again."
}
Write-Host 'restore: OK. Next: run scripts/supabase/lockdown.sql AGAIN in the Supabase SQL editor.' -ForegroundColor Green
