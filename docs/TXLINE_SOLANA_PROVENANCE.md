# TxLINE Solana provenance verification

This command verifies the public on-chain provenance of a TxLINE subscription transaction without loading a wallet file or private key:

```bash
pnpm txline:provenance
```

## Inputs

Set these only in the local terminal environment:

```text
TXLINE_NETWORK=mainnet
TXLINE_WALLET_PUBKEY=<public wallet address>
TXLINE_SUBSCRIPTION_TX_SIG=<public subscription transaction signature>
TXLINE_EXPECTED_SERVICE_LEVEL_ID=<optional expected u16 value>
TXLINE_EXPECTED_DURATION_WEEKS=<optional expected u8 value>
TXLINE_PROVENANCE_RECEIPT_PATH=artifacts/private/txline-solana-provenance.md
```

The command never requests a seed phrase, private key, wallet file, or message-signing operation.

## Verification performed

For the selected network, the verifier uses a fixed official Solana RPC origin and the fixed TxLINE program address documented by TxLINE. It checks that:

1. the transaction signature exists in Solana history;
2. the transaction is confirmed or finalized;
3. transaction execution succeeded;
4. the supplied transaction signature matches the returned transaction;
5. the configured wallet appears as a transaction signer;
6. the transaction contains a TxLINE `subscribe` instruction for that wallet;
7. the instruction discriminator matches the official Anchor IDL;
8. the encoded service-level and duration arguments can be decoded;
9. optional expected service-level and duration values match.

## Evidence boundary

This proves that the configured public wallet signed a successful TxLINE `subscribe` transaction on the selected network. It does not prove that a later API token belongs to that wallet. The receipt therefore states:

```text
API token linkage: NOT CLAIMED
```

The activation flow remains a separate off-chain step that signs a message containing the subscription transaction, league selection, and guest JWT.

## Data handling

The Solana RPC response is processed in memory and is not printed or saved. The generated receipt contains no wallet address, transaction signature, program address, instruction bytes, or raw RPC JSON. The default receipt path is ignored by Git.

CI uses mocked public-chain responses only and never contacts a Solana RPC endpoint.
