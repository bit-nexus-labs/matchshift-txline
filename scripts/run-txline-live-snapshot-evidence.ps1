[CmdletBinding()]
param(
    [ValidateSet("mainnet", "devnet")]
    [string]$Network = "mainnet",

    [ValidateRange(1, 180)]
    [int]$Minutes = 30
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
    "TXLINE_LIVE_OBSERVE_MS",
    "TXLINE_LIVE_SNAPSHOT_POLL_MS",
    "TXLINE_LIVE_SNAPSHOT_MAX_FIXTURES"
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

    Write-Host "MatchShift TxLINE live snapshot change evidence" -ForegroundColor Green
    Write-Host "Network: $Network"
    Write-Host "Observation window: $Minutes minute(s)"
    Write-Host "This command never prints provider values, fixture identifiers, teams, scores, odds, or credentials."

    $secureToken = Read-Host "TxLINE API token" -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "The TxLINE API token cannot be empty."
    }

    $env:TXLINE_NETWORK = $Network
    $env:TXLINE_API_TOKEN = $plainToken
    $env:TXLINE_LIVE_OBSERVE_MS = [string]($Minutes * 60 * 1000)
    $env:TXLINE_LIVE_SNAPSHOT_POLL_MS = "5000"
    $env:TXLINE_LIVE_SNAPSHOT_MAX_FIXTURES = "8"

    & pnpm "txline:live-snapshot-observe"
    $exitCode = $LASTEXITCODE
    if ($exitCode -notin @(0, 2)) {
        throw "Live snapshot observer failed with exit code $exitCode."
    }
    if ($exitCode -eq 2) {
        Write-Host "Live snapshot change was not observed in the configured window." -ForegroundColor Yellow
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
