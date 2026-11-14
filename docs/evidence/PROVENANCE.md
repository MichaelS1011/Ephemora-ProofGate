# Committed Testnet transaction dumps

These three files are the **unmodified `result` objects** returned by the
public NEAR Testnet RPC for the three transactions referenced in the README.
Each file wraps that result in a small `provenance` block (endpoint, method,
tx hash, sender parameter, fetched-at timestamp). They let anyone re-check —
fully offline — that what happened on-chain matches the committed signed
bundle:

```
python3 apps/api/verify_chain_evidence.py
```

Expected: `"verified": true`, all 21 checks `"pass"`, exit 0 — including
`releaseDigestMatchesReceipt`, which recomputes the canonical-JSON SHA-256 of
the committed live receipt payload
(`apps/api/tests/fixtures/live/proofgate-receipt.json`) and compares it to the
`receipt_digest` argument of the on-chain `release_job` call.

The dumps were fetched on **2026-11-14 (UTC)** from `https://rpc.testnet.near.org`.
To refetch and compare yourself:

```bash
curl -sS https://rpc.testnet.near.org -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"pg","method":"EXPERIMENTAL_tx_status","params":["kkByopop4xEhGqiZhsNGr29GBpNhvzhbFu2pb7GS8kf","verifier.proofgate-mw952xad.testnet"]}'
```

and likewise for the other two:

| File | Method | Transaction hash | Signer |
|---|---|---|---|
| `create_job.tx.json` | `create_job` (0.10 NEAR deposit) | `4dT5X1qmaVeBmYpLiQEnF9MWGDdRteJREvGDFuc9mwHD` | `owner.proofgate-mw952xad.testnet` |
| `release_job.tx.json` | `release_job` (payout) | `kkByopop4xEhGqiZhsNGr29GBpNhvzhbFu2pb7GS8kf` | `verifier.proofgate-mw952xad.testnet` |
| `refund_expired.tx.json` | `refund_expired` (separate expiry-path test job `PG-TESTNET-REFUND-mwflhg9x`, **not** part of this settlement) | `GTi73Y5Zt6WccKki2C2FJKoGHctLD9E7H5nm8zVygek4` | `owner.proofgate-mw952xad.testnet` |

All accounts are throwaway Testnet accounts funded by the faucet; the
transactions ran against `escrow-mw956wm0.proofgate-mw952xad.testnet`.
Note: `EXPERIMENTAL_tx_status` requires the *sender account that the query is
routed by* as its second parameter (see the `sender_id_param` values in each
file's `provenance` block); the authoritative signer is inside the dump
itself and is what the checker verifies.
