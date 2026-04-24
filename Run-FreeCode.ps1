<#
.SYNOPSIS
    Launch the free-code CLI from source on Windows 11.

.DESCRIPTION
    Installs npm dependencies when missing, then runs the CLI directly from
    TypeScript source via Bun's native TS execution.  This bypasses the
    compiled-binary build step, which currently fails at runtime due to a
    cacache module-resolution bug in the bundler output.

    Use -Build to attempt a compiled build instead (may not work until the
    bundling issue is resolved upstream).

.PARAMETER Build
    Build a compiled binary first (bun run build), then run it.
    The default is to run from source, which is always reliable.

.PARAMETER Rebuild
    Implies -Build.  Also force-reinstalls dependencies before building.

.PARAMETER Args
    Arguments forwarded to the Claude Code CLI.

.EXAMPLE
    .\Run-FreeCode.ps1
    .\Run-FreeCode.ps1 --dangerously-skip-permissions
    .\Run-FreeCode.ps1 -Build
    .\Run-FreeCode.ps1 -Rebuild
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Rebuild,
    [Parameter(ValueFromRemainingArguments)]
    [string[]]$Args
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

# ---------------------------------------------------------------------------
# 1. Guard — bun must be on PATH
# ---------------------------------------------------------------------------
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "ERROR: bun is not on PATH." -ForegroundColor Red
    Write-Host "  Install: powershell -c `"irm bun.sh/install.ps1 | iex`"" -ForegroundColor Yellow
    Write-Host "  Or visit https://bun.sh" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Install dependencies when node_modules is absent (or on -Rebuild)
# ---------------------------------------------------------------------------
$nodeModules = Join-Path $root 'node_modules'
if ($Rebuild -or -not (Test-Path $nodeModules)) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    & bun install --cwd $root
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: bun install failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

# ---------------------------------------------------------------------------
# 3a. Build path (-Build / -Rebuild): compile then run the native binary.
#     Note: bun run build always passes --compile, producing a standalone
#     native executable.  On Windows the output is cli.exe.
# ---------------------------------------------------------------------------
if ($Build -or $Rebuild) {
    Write-Host "Building free-code..." -ForegroundColor Cyan
    & bun run --cwd $root build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: build failed (exit $LASTEXITCODE)." -ForegroundColor Red
        exit $LASTEXITCODE
    }

    $cli = @('cli.exe', 'cli') |
        ForEach-Object { Join-Path $root $_ } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1

    if (-not $cli) {
        Write-Host "ERROR: build completed but no cli or cli.exe was found." -ForegroundColor Red
        exit 1
    }

    Write-Host "Launching $cli..." -ForegroundColor Cyan
    & $cli @Args
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# 3b. Default: run directly from TypeScript source — always reliable.
# ---------------------------------------------------------------------------
$entrypoint = Join-Path $root 'src\entrypoints\cli.tsx'
& bun $entrypoint @Args
exit $LASTEXITCODE
