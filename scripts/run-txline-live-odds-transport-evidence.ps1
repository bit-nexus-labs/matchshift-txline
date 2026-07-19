[CmdletBinding()]
param(
    [ValidateSet("mainnet", "devnet")]
    [string]$Network = "mainnet",

    [ValidateRange(1, 60)]
    [int]$Minutes = 5
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
    "TXLINE_LIVE_TRANSPORT_OBSERVE_MS",
    "TXLINE_LIVE_TRANSPORT_RECONNECT_MS"
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

    Write-Host "MatchShift TxLINE live odds transport evidence" -ForegroundColor Green
    Write-Host "Network: $Network"
    Write-Host "Observation window: $Minutes minute(s)"
    Write-Host "No live match or fixture selection is required."
    Write-Host "This command never prints provider values, fixture identifiers, teams, scores, odds, or credentials."

    $secureToken = Read-Host "TxLINE API token" -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "The TxLINE API token cannot be empty."
    }

    $env:TXLINE_NETWORK = $Network
    $env:TXLINE_API_TOKEN = $plainToken
    $env:TXLINE_LIVE_TRANSPORT_OBSERVE_MS = [string]($Minutes * 60 * 1000)
    $env:TXLINE_LIVE_TRANSPORT_RECONNECT_MS = "1000"

    & pnpm "txline:live-odds-transport-observe"
    $exitCode = $LASTEXITCODE
    if ($exitCode -notin @(0, 2)) {
        throw "Live odds transport observer failed with exit code $exitCode."
    }
    if ($exitCode -eq 2) {
        Write-Host "A structurally valid odds data event was not observed in the configured window." -ForegroundColor Yellow
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
