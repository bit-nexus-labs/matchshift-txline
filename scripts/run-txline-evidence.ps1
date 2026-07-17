[CmdletBinding()]
param(
    [ValidateSet("mainnet", "devnet")]
    [string]$Network = "mainnet",

    [switch]$SkipProvenance,
    [switch]$SkipLive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:LastEvidenceExitCode = 0

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
    $script:LastEvidenceExitCode = $LASTEXITCODE
    if ($AllowedExitCodes -notcontains $script:LastEvidenceExitCode) {
        throw "$Label failed with exit code $script:LastEvidenceExitCode."
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$plainToken = $null
$secureToken = $null
$environmentNames = @(
    "TXLINE_NETWORK",
    "TXLINE_API_TOKEN",
    "TXLINE_FIXTURE_ID",
    "TXLINE_WALLET_PUBKEY",
    "TXLINE_SUBSCRIPTION_TX_SIG",
    "TXLINE_LIVE_FIXTURE_ID"
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
        throw "pnpm is not available in this terminal. Install or activate pnpm before running the evidence workflow."
    }

    Write-Host "MatchShift TxLINE evidence runner" -ForegroundColor Green
    Write-Host "Network: $Network"
    Write-Host "The API token is requested as a hidden value and restored or removed when the script finishes."

    Invoke-PnpmStep -Label "Install locked dependencies" -Arguments @(
        "install",
        "--frozen-lockfile",
        "--reporter=silent"
    )

    $secureToken = Read-Host "TxLINE API token (press Enter if you need to create one)" -AsSecureString
    $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken

    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        if ($Network -ne "mainnet") {
            throw "The Phantom activation helper currently supports the mainnet free tier only."
        }

        $startActivation = Read-Host "Start the localhost Phantom activation helper now? [Y/n]"
        if ([string]::IsNullOrWhiteSpace($startActivation) -or $startActivation.Trim().ToLowerInvariant() -in @("y", "yes")) {
            Write-Host "A localhost browser page will open. Connect only the dedicated MatchShift Phantom wallet." -ForegroundColor DarkYellow
            Invoke-PnpmStep -Label "Create TxLINE API token with Phantom" -Arguments @(
                "txline:activate"
            )
            $secureToken = Read-Host "Paste the new TxLINE API token" -AsSecureString
            $plainToken = ConvertFrom-SecureStringPlainText -SecureValue $secureToken
        }
    }

    if ([string]::IsNullOrWhiteSpace($plainToken)) {
        throw "The TxLINE API token cannot be empty."
    }

    $env:TXLINE_NETWORK = $Network
    $env:TXLINE_API_TOKEN = $plainToken

    $fixtureOverride = Read-Host "Historical fixture ID override (press Enter for official TxLINE reference fixture 18213979)"
    if ([string]::IsNullOrWhiteSpace($fixtureOverride)) {
        Remove-Item Env:TXLINE_FIXTURE_ID -ErrorAction SilentlyContinue
    }
    else {
        $env:TXLINE_FIXTURE_ID = $fixtureOverride.Trim()
    }

    Invoke-PnpmStep -Label "Historical TxLINE integration smoke" -Arguments @(
        "txline:smoke-reference"
    )

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
            )
        }
        else {
            Write-Host "Solana provenance: SKIPPED" -ForegroundColor Yellow
        }
    }

    if (-not $SkipLive) {
        Remove-Item Env:TXLINE_LIVE_FIXTURE_ID -ErrorAction SilentlyContinue
        Invoke-PnpmStep -Label "Literal TxLINE live-input observation" -Arguments @(
            "txline:live-observe"
        ) -AllowedExitCodes @(0, 2)
        $liveExitCode = $script:LastEvidenceExitCode

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
