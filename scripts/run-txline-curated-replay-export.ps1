[CmdletBinding()]
param(
    [ValidateSet("mainnet", "devnet")]
    [string]$Network = "mainnet",

    [string]$SideA = "France",

    [string]$SideB = "England",

    [string]$MatchDateUtc = "2026-07-18",

    [string]$FixtureId = "",

    [string]$PublicFixtureId = "curated-france-england-2026-07-18",

    [string]$PublicLabel = "France vs England - curated TxLINE completed-match replay",

    [ValidateRange(1, 240)]
    [int]$DurationMinutes = 120,

    [ValidateRange(1, 60)]
    [int]$OddsSampleMinutes = 10,

    [string]$OutputPath = "src/replay/curated-real-match.ts",

    [bool]$AllowPartialOpening = $true,

    [switch]$RequireOdds
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertFrom-SecureStringPlainText {
    param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$plainToken = $null
$secureToken = $null
$previousEnvironment = @{}
$environmentNames = @(
    "TXLINE_NETWORK",
    "TXLINE_API_TOKEN",
    "TXLINE_CURATED_SIDE_A",
    "TXLINE_CURATED_SIDE_B",
    "TXLINE_CURATED_MATCH_DATE_UTC",
    "TXLINE_CURATED_FIXTURE_ID",
    "TXLINE_CURATED_PUBLIC_FIXTURE_ID",
    "TXLINE_CURATED_PUBLIC_LABEL",
    "TXLINE_CURATED_DURATION_MINUTES",
    "TXLINE_CURATED_ODDS_SAMPLE_MINUTES",
    "TXLINE_CURATED_OUTPUT_PATH",
    "TXLINE_CURATED_REQUIRE_ODDS",
    "TXLINE_CURATED_ALLOW_PARTIAL_OPENING"
)
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable(
        $name,
        [EnvironmentVariableTarget]::Process
    )
}

Push-Location $repoRoot
try {
    if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm is not available in this terminal."
    }

    Write-Host "MatchShift curated completed-match replay export" -ForegroundColor Green
    Write-Host "Network: $Network"
    Write-Host "Target: $SideA vs $SideB ($MatchDateUtc UTC)"
    Write-Host "Output: $OutputPath"
    Write-Host "The generated module is allowlisted MatchShift product data only."
    Write-Host "Raw provider payloads and provider identifiers are never written."
    if ($AllowPartialOpening) {
        Write-Host "Partial opening policy: disclosed local 0-0 baseline is allowed only when the provider archive starts later."
    }

    $secureToken = Read-Host "TxLINE API token" -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "The TxLINE API token cannot be empty."
    }

    $env:TXLINE_NETWORK = $Network
    $env:TXLINE_API_TOKEN = $plainToken
    $env:TXLINE_CURATED_SIDE_A = $SideA
    $env:TXLINE_CURATED_SIDE_B = $SideB
    $env:TXLINE_CURATED_MATCH_DATE_UTC = $MatchDateUtc
    $env:TXLINE_CURATED_FIXTURE_ID = $FixtureId
    $env:TXLINE_CURATED_PUBLIC_FIXTURE_ID = $PublicFixtureId
    $env:TXLINE_CURATED_PUBLIC_LABEL = $PublicLabel
    $env:TXLINE_CURATED_DURATION_MINUTES = [string]$DurationMinutes
    $env:TXLINE_CURATED_ODDS_SAMPLE_MINUTES = [string]$OddsSampleMinutes
    $env:TXLINE_CURATED_OUTPUT_PATH = $OutputPath
    $env:TXLINE_CURATED_REQUIRE_ODDS = if ($RequireOdds) { "true" } else { "false" }
    $env:TXLINE_CURATED_ALLOW_PARTIAL_OPENING = if ($AllowPartialOpening) { "true" } else { "false" }

    & pnpm "txline:export-curated-replay"
    if ($LASTEXITCODE -ne 0) {
        throw "Curated replay export failed with exit code $LASTEXITCODE."
    }

    Write-Host ""
    Write-Host "Curated replay module generated successfully." -ForegroundColor Green
    Write-Host "Review git diff before committing the generated product artifact."
}
finally {
    foreach ($name in $environmentNames) {
        $previousValue = $previousEnvironment[$name]
        if ($null -eq $previousValue) {
            Remove-Item "Env:$name" -ErrorAction SilentlyContinue
        }
        else {
            [Environment]::SetEnvironmentVariable(
                $name,
                [string]$previousValue,
                [EnvironmentVariableTarget]::Process
            )
        }
    }
    $plainToken = $null
    $secureToken = $null
    Pop-Location
}
