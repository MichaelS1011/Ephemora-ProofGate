# Committed Testnet transaction dumps

These three files are the **unmodified `result` objects** returned by the
public NEAR Testnet RPC for the three transactions referenced in the README.
They were fetched on **2026-11-14 (UTC)** from `https://rpc.testnet.near.org`
(independent of the archival endpoints used for anchoring below). Each file
wraps that result in a small `provenance` block (endpoint, method, tx hash,
sender parameter, fetched-at timestamp). Two checkers cover them:

```
python3 apps/api/verify_chain_evidence.py
python3 apps/api/verify_chain_signatures.py
```

The first proves the committed files **agree with each other**: expected:
`"verified": true`, all 21 checks `"pass"`, exit 0 — including
`releaseDigestMatchesReceipt`, which recomputes the canonical-JSON SHA-256 of
the committed live receipt payload
(`apps/api/tests/fixtures/live/proofgate-receipt.json`) and compares it to the
`receipt_digest` argument of the on-chain `release_job` call.

The second runs **structural and pinned-constant checks** offline (24 checks:
signer, receiver, account key, method, gas, deposit, arguments, digest
binding, and an exact byte-for-byte comparison of each dump's transaction
hash, signature, nonce, and priority fee against constants audited in this
file and the README). The offline run performs **no cryptography** — it
proves the committed files are byte-identical to the audited record, nothing
more. Only `--rpc-anchor` is cryptographic: it re-encodes each transaction in
Borsh, reconstructs the signing-block preimage from the live archival Testnet
RPC, and demands that the embedded Ed25519 signature verify over the
transaction hash under the anchored account key — so a dump can only pass if
a transaction with exactly these bytes provably existed on Testnet. Because
it queries the archival node block by block, `--rpc-anchor` takes several
minutes and depends on a reachable archival endpoint.

Neither checker substitutes for refetching from an independent node, which
remains the ultimate anchor:

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
