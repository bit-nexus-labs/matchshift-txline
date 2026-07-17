[CmdletBinding()]
param(
    [ValidateSet("mainnet", "devnet")]
    [string]$Network = "mainnet",

    [switch]$SkipProvenance,
    [switch]$SkipLive
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

function Invoke-PnpmStep {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [int[]]$AllowedExitCodes = @(0)
    )

    Write-Host ""
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    & pnpm @Arguments
    $exitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "$Label failed with exit code $exitCode."
    }
    return $exitCode
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$plainToken = $null
$secureToken = $null
$environmentNames = @(
    "TXLINE_NETWORK",
    "TXLINE_API_TOKEN",
    "TXLINE_FIXTURE_ID",
    "TXLINE_WALLET_PUBKEY",
    "TXLINE_SUBSCRIPTION_TX_SIG"
)

Push-Location $repoRoot
try {
    if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
        throw "pnpm is not available in this terminal. Install or activate pnpm before running the evidence workflow."
    }

    Write-Host "MatchShift TxLINE evidence runner" -ForegroundColor Green
    Write-Host "Network: $Network"
    Write-Host "The API token is requested as a hidden value and removed from the process environment when the script finishes."

    Invoke-PnpmStep -Label "Install locked dependencies" -Arguments @(
        "install",
        "--frozen-lockfile",
        "--reporter=silent"
    ) | Out-Null

    $secureToken = Read-Host "TxLINE API token" -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken
    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "The TxLINE API token cannot be empty."
    }

    $env:TXLINE_NETWORK = $Network
    $env:TXLINE_API_TOKEN = $plainToken

    $fixtureOverride = Read-Host "Historical fixture ID override (press Enter for automatic selection)"
    if ([string]::IsNullOrWhiteSpace($fixtureOverride)) {
        Remove-Item Env:TXLINE_FIXTURE_ID -ErrorAction SilentlyContinue
    }
    else {
        $env:TXLINE_FIXTURE_ID = $fixtureOverride.Trim()
    }

    Invoke-PnpmStep -Label "Historical TxLINE integration smoke" -Arguments @(
        "txline:smoke"
    ) | Out-Null

    if (-not $SkipProvenance) {
        Write-Host ""
        Write-Host "Solana provenance uses only public values. Press Enter twice to skip it for now." -ForegroundColor DarkYellow
        $walletPublicKey = Read-Host "Subscription wallet public address"
        $transactionSignature = Read-Host "Subscription transaction signature"

        $walletProvided = -not [string]::IsNullOrWhiteSpace($walletPublicKey)
        $signatureProvided = -not [string]::IsNullOrWhiteSpace($transactionSignature)
        if ($walletProvided -xor $signatureProvided) {
            throw "Provide both the public wallet address and transaction signature, or leave both empty."
        }

        if ($walletProvided -and $signatureProvided) {
            $env:TXLINE_WALLET_PUBKEY = $walletPublicKey.Trim()
            $env:TXLINE_SUBSCRIPTION_TX_SIG = $transactionSignature.Trim()
            Invoke-PnpmStep -Label "Solana subscription provenance" -Arguments @(
                "txline:provenance"
            ) | Out-Null
        }
        else {
            Write-Host "Solana provenance: SKIPPED" -ForegroundColor Yellow
        }
    }

    if (-not $SkipLive) {
        Remove-Item Env:TXLINE_LIVE_FIXTURE_ID -ErrorAction SilentlyContinue
        $liveExitCode = Invoke-PnpmStep -Label "Literal TxLINE live-input observation" -Arguments @(
            "txline:live-observe"
        ) -AllowedExitCodes @(0, 2)

        if ($liveExitCode -eq 2) {
            Write-Host "Live input was not observed in this run. This is not recorded as PASS and may be repeated during a covered match." -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Evidence workflow completed." -ForegroundColor Green
    Write-Host "Private receipts are under: artifacts/private/"
    Write-Host "Do not share raw provider data or the API token."
}
finally {
    foreach ($name in $environmentNames) {
        Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    $plainToken = $null
    $secureToken = $null
    Pop-Location
}
