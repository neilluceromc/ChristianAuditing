<#
.SYNOPSIS
  Take and validate a pg_dump -Fc backup of the Supabase database (cloud staging spec 4.8).

.DESCRIPTION
  The rule: before any push to main that adds a migration, take one of these and
  check it. Supabase Free keeps no backups of its own.

    1. pg_dump -Fc --schema=public from the Supabase SESSION pooler
    2. validate it: pg_restore -l | grep -c 'TABLE DATA', printed; zero fails
    3. move it to -Out (only after it validated, so a failed run never
       replaces a good file)
    4. remove every temporary file, whatever happened

  Where pg_dump runs depends on -Image:
    - the same image as the laptop's db container (inventory-db-1, normally
      postgres:16-alpine): `docker exec` into that container;
    - any other image (postgres:17-alpine for a Postgres 17 project): a
      throwaway `docker run --rm` container of that image, writing into the
      -Out folder through a bind mount. Docker downloads the image once.
  pg_dump refuses a server newer than itself ("server version mismatch"), so a
  Supabase project on Postgres 17 needs -Image postgres:17-alpine.

  The source URL is read from $env:SUPABASE_DB_URL, which YOU set in your own
  terminal. It is never printed, never written to a file and never put on a
  command line: it reaches the container as `-e PGURL`, which copies the
  variable from this process's environment.

.PARAMETER Out
  Where to write the dump on this machine. Refused if it exists, unless -Force.

.PARAMETER Image
  The postgres image whose pg_dump to use. Default postgres:16-alpine.

.PARAMETER Force
  Replace an existing -Out file (only once the new dump has validated).

.EXAMPLE
  $env:SUPABASE_DB_URL = '<Supabase session pooler URI, port 5432>'
  .\scripts\supabase\dump.ps1 -Out .\backups\supabase-2026-10-21-before-migration-37.dump -Image postgres:17-alpine
  Remove-Item Env:SUPABASE_DB_URL
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Image = 'postgres:16-alpine',
  [switch]$Force
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
if ($Image -notmatch '^[A-Za-z0-9][A-Za-z0-9._/:@-]*$') {
  Fail "not an image name: $Image"
}

$full = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($Out)
if ((Test-Path -LiteralPath $full) -and -not $Force) {
  Fail "refusing to overwrite $full; choose a new file name, or add -Force."
}
if (Test-Path -LiteralPath $full -PathType Container) {
  Fail "-Out is a folder: $full"
}
$parent = Split-Path -Parent $full
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
  Fail "folder does not exist: $parent"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'docker is not on PATH. Start Docker Desktop and open a new terminal.'
}

# Same image as the laptop's db container: exec into it. Anything else: a throwaway container.
$containerImage = docker inspect -f '{{.Config.Image}}' $Container 2>$null
$useExec = ($LASTEXITCODE -eq 0) -and ("$containerImage".Trim() -eq $Image)
if ($useExec) {
  $running = docker inspect -f '{{.State.Running}}' $Container 2>$null
  if ($running -ne 'true') {
    Fail "container $Container is not running. From the repo root: docker compose up -d db"
  }
  Write-Host "dump: using pg_dump in $Container ($Image)"
}
else {
  Write-Host "dump: using pg_dump in a throwaway $Image container"
}

# The dump lands here first and is moved to -Out only after it validated.
$tmpName = '.tmp-supabase-' + [guid]::NewGuid().ToString('N') + '.dump'
$tmpFull = Join-Path $parent $tmpName

# Each step says why and returns $false on failure; the caller's finally always cleans up.
# (A bare `return` at script scope would end the script before `exit 1` and report success.)
function Invoke-Dump {
  Write-Host 'dump: running pg_dump -Fc against Supabase (the URL is not shown)...'
  # Single quotes: $PGURL is expanded by the container's shell, not by PowerShell.
  # `set -f` turns off globbing for the unquoted URL (a ? in it is not a wildcard).
  if ($useExec) {
    docker exec -e PGURL $Container sh -c 'set -f; exec pg_dump -Fc --schema=public -d $PGURL -f /tmp/supabase-backup.dump' | Out-Host
  }
  else {
    docker run --rm -e PGURL -v "${parent}:/out" $Image sh -c "set -f; exec pg_dump -Fc --schema=public -d `$PGURL -f /out/$tmpName" | Out-Host
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "dump: pg_dump failed (see above; check it for your password before pasting it anywhere). `"server version mismatch`" means Supabase runs a newer Postgres than $Image`: run again with -Image postgres:17-alpine." -ForegroundColor Red
    return $false
  }

  if ($useExec) {
    $count = docker exec $Container sh -c 'pg_restore -l /tmp/supabase-backup.dump | grep -c ''TABLE DATA'''
  }
  else {
    $count = docker run --rm -v "${parent}:/out" $Image sh -c "pg_restore -l /out/$tmpName | grep -c 'TABLE DATA'"
  }
  $n = 0
  if (-not [int]::TryParse(("$count").Trim(), [ref]$n) -or $n -le 0) {
    Write-Host "dump: the dump did not validate (TABLE DATA entries: '$count'). -Out was not written." -ForegroundColor Red
    return $false
  }
  Write-Host "dump: validated, TABLE DATA entries: $n"
  $script:TableData = $n

  if ($useExec) {
    docker cp "${Container}:$Remote" "$tmpFull" | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'dump: docker cp out of the container failed.' -ForegroundColor Red
      return $false
    }
  }
  try {
    Move-Item -LiteralPath $tmpFull -Destination $full -Force:$Force -ErrorAction Stop
  }
  catch {
    Write-Host "dump: could not move the dump to ${full}: $($_.Exception.Message)" -ForegroundColor Red
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
  if (Test-Path -LiteralPath $tmpFull) {
    Remove-Item -LiteralPath $tmpFull -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $tmpFull) {
      Write-Host "dump: WARNING could not remove $tmpFull; delete it by hand." -ForegroundColor Yellow
    }
  }
  if ($useExec) {
    docker exec $Container rm -f $Remote | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "dump: WARNING could not remove ${Container}:$Remote; remove it with: docker exec $Container rm -f $Remote" -ForegroundColor Yellow
    }
  }
}

if (-not $ok) { exit 1 }
$size = (Get-Item -LiteralPath $full).Length
Write-Host ("dump: OK. {0} ({1:N0} bytes, {2} TABLE DATA entries)" -f $full, $size, $TableData) -ForegroundColor Green
