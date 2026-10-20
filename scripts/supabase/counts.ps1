<#
.SYNOPSIS
  Print an exact row count for every table in schema public (cloud staging spec 4.6, step 4).

.DESCRIPTION
  Read-only. One line per table, sorted by name (byte order, the same on every
  server):  <table><TAB><count>
  Counts are exact: the query runs `select count(*)` on each table (generated in
  SQL with format('%I') and query_to_xml), never the pg_stat estimates. No row
  data is printed, only table names and numbers.

  -Target laptop    psql inside inventory-db-1 against the local staging
                    database, as the container's own POSTGRES_USER and
                    POSTGRES_DB.
  -Target supabase  psql inside inventory-db-1 against $env:SUPABASE_DB_URL,
                    which YOU set in your own terminal. The URL is never
                    printed and never put on a command line: it reaches the
                    container as `docker exec -e PGURL`. The transaction pooler
                    (port 6543) is refused; use the session pooler (port 5432).

  Run both and compare the two lists: they must match table by table.

.PARAMETER Target
  laptop or supabase.

.PARAMETER Out
  Also save the lines to this file (UTF-8). Refused if it exists, unless -Force.

.PARAMETER Force
  Replace an existing -Out file.

.EXAMPLE
  .\scripts\supabase\counts.ps1 -Target laptop

.EXAMPLE
  $env:SUPABASE_DB_URL = '<Supabase session pooler URI, port 5432>'
  .\scripts\supabase\counts.ps1 -Target supabase -Out .\backups\counts-supabase.txt
  Remove-Item Env:SUPABASE_DB_URL
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('laptop', 'supabase')][string]$Target,
  [string]$Out,
  [switch]$Force
)

# NOT "Stop": see scripts/deploy-staging.ps1 (native stderr under PowerShell 5.1).
$ErrorActionPreference = 'Continue'

$Container = 'inventory-db-1'

function Fail([string]$Message) {
  Write-Host "counts: $Message" -ForegroundColor Red
  exit 1
}

if ($Target -eq 'supabase') {
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DB_URL)) {
    Fail ('SUPABASE_DB_URL is not set. In THIS terminal run' + [Environment]::NewLine +
      '    $env:SUPABASE_DB_URL = ''<Supabase session pooler URI, port 5432>''' + [Environment]::NewLine +
      '  then run this script again. (Supabase -> Connect -> Session pooler.)')
  }
  if ($env:SUPABASE_DB_URL -notmatch '^postgres(ql)?://') {
    Fail 'SUPABASE_DB_URL does not look like a postgresql:// URI (its value is not shown).'
  }
  if ($env:SUPABASE_DB_URL -match ':6543(/|\?|$)') {
    Fail 'SUPABASE_DB_URL points at the TRANSACTION pooler (port 6543). Use the SESSION pooler (port 5432).'
  }
}

$full = $null
if ($Out) {
  $full = $PSCmdlet.GetUnresolvedProviderPathFromPSPath($Out)
  if ((Test-Path -LiteralPath $full) -and -not $Force) {
    Fail "refusing to overwrite $full; choose a new file name, or add -Force."
  }
  $parent = Split-Path -Parent $full
  if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    Fail "folder does not exist: $parent"
  }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail 'docker is not on PATH. Start Docker Desktop and open a new terminal.'
}
$running = docker inspect -f '{{.State.Running}}' $Container 2>$null
if ($running -ne 'true') {
  Fail "container $Container is not running. From the repo root: docker compose up -d db"
}

# Sent to psql on stdin, so no quoting has to survive PowerShell, docker and sh.
# collate "C" makes the order identical on the laptop and on Supabase.
$sql = @'
select c.relname || chr(9) || (xpath('/row/n/text()',
         query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text
from pg_class c
join pg_namespace s on s.oid = c.relnamespace
where s.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname collate "C";
'@

$lines = $null
$code = 1
if ($Target -eq 'laptop') {
  # $POSTGRES_USER / $POSTGRES_DB are the container's own environment (single quotes: not PowerShell's).
  $lines = $sql | docker exec -i $Container sh -c 'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB'
  $code = $LASTEXITCODE
}
else {
  $env:PGURL = $env:SUPABASE_DB_URL
  try {
    # `set -f` turns off globbing for the unquoted URL (a ? in it is not a wildcard).
    $lines = $sql | docker exec -i -e PGURL $Container sh -c 'set -f; exec psql -X -q -A -t -v ON_ERROR_STOP=1 -d $PGURL'
    $code = $LASTEXITCODE
  }
  finally {
    Remove-Item Env:PGURL -ErrorAction SilentlyContinue
  }
}

if ($code -ne 0) {
  Fail "psql failed (exit $code; see above). Before pasting an error anywhere, check it does not contain your password."
}
$lines = @($lines | Where-Object { "$_".Trim() -ne '' })
if ($lines.Count -eq 0) {
  Fail 'no tables found in schema public.'
}

$lines | ForEach-Object { Write-Output $_ }
if ($full) {
  [System.IO.File]::WriteAllLines($full, [string[]]$lines)
}
Write-Host ("counts: {0} tables ({1})" -f $lines.Count, $Target) -ForegroundColor Green
