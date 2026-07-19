[CmdletBinding()]
param(
    [ValidateSet("mainnet", "devnet")]
    [string]$Network = "mainnet",

    [string]$SideA = "Spain",

    [string]$SideB = "Argentina",

    [ValidateRange(1, 360)]
    [int]$RecordMinutes = 180,

    [ValidateRange(1, 12)]
    [int]$FixtureWindowHours = 3,

    [string]$OutputPath = "artifacts/private/txline-live-match-capture.jsonl"
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
$environmentNames = @(
    "TXLINE_NETWORK",
    "TXLINE_API_TOKEN",
    "TXLINE_LIVE_SIDE_A",
    "TXLINE_LIVE_SIDE_B",
    "TXLINE_LIVE_RECORD_MS",
    "TXLINE_LIVE_WINDOW_HOURS",
    "TXLINE_LIVE_CAPTURE_PATH"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable(
        $name,
        [EnvironmentVariableTarget]::Process
    )
}

Push-Location $repoRoot
try {
    if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm is not available in this terminal. Run this script from the VS Code terminal where pnpm works."
    }

    Write-Host "MatchShift continuous TxLINE live match recorder" -ForegroundColor Green
    Write-Host "Network: $Network"
    Write-Host "Target: $SideA vs $SideB"
    Write-Host "Recording window: $RecordMinutes minutes"
    Write-Host "Private output: $OutputPath"
    Write-Host "The recorder keeps running after the first event."
    Write-Host "Only normalized allowlisted data is written; raw payloads and provider identifiers are not persisted."

    $secureToken = Read-Host "TxLINE API token" -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "The TxLINE API token cannot be empty."
    }

    $env:TXLINE_NETWORK = $Network
    $env:TXLINE_API_TOKEN = $plainToken
    $env:TXLINE_LIVE_SIDE_A = $SideA
    $env:TXLINE_LIVE_SIDE_B = $SideB
    $env:TXLINE_LIVE_RECORD_MS = [string]($RecordMinutes * 60 * 1000)
    $env:TXLINE_LIVE_WINDOW_HOURS = [string]$FixtureWindowHours
    $env:TXLINE_LIVE_CAPTURE_PATH = $OutputPath

    & pnpm "txline:live-record"
    if ($LASTEXITCODE -ne 0) {
        throw "Live match recorder failed with exit code $LASTEXITCODE."
    }
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
