# Run all TxLINE evidence checks on Windows

The repository includes a PowerShell helper that minimizes manual secret handling:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-txline-evidence.ps1
```

Run it from the repository root in the VS Code terminal.

## What the helper does

1. installs the locked dependencies;
2. asks for the TxLINE API token as hidden input;
3. runs the historical integration smoke;
4. optionally runs Solana subscription provenance using only the public wallet address and public transaction signature;
5. runs the literal live-input observer;
6. restores or removes every environment value it changed;
7. leaves only allowlist receipts under `artifacts/private/`.

The token is not placed in PowerShell history, printed, written to `.env`, committed, or included in receipts. PowerShell must temporarily expose it as a process string so Node can receive the environment variable; the script clears its local reference and restores the previous process environment in `finally`.

## Prompts

For the historical fixture override, press Enter to let the smoke test choose an eligible completed fixture automatically.

For Solana provenance, provide both public values or leave both empty:

- subscription wallet public address;
- subscription transaction signature.

The live observer runs automatically. Exit code `2` from that step means no real SSE data record was observed; it is reported honestly and does not become PASS.

## Optional switches

Skip public-chain provenance:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-txline-evidence.ps1 -SkipProvenance
```

Skip live observation:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-txline-evidence.ps1 -SkipLive
```

Use devnet:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-txline-evidence.ps1 -Network devnet
```

Do not send the API token, raw provider output, or private wallet material through chat, issues, screenshots, or commits.
