# ProofGate — known limitations and trust boundaries (audited 2026-11-26)

Honest inventory of what ProofGate does **not** enforce, produced by a
three-track security audit (contract, verifier, API) on 2026-11-26. Nothing
here contradicts the claims in the README; it marks exactly where each claim
stops and trust begins.

## NEAR escrow contract (`apps/near-escrow/src/lib.rs`)

The deployed WASM (SHA-256 `da2a8d36…`, pinned in the README) is frozen as
evidence; these limitations are documented and pinned by unit tests, not
patched.

1. **The receipt digest is not job-bound on-chain.** `release_job` validates
   the digest *shape* only (`sha256:` + 64 lowercase hex). A compromised or
   mistaken verifier key could pay any Open job with any well-formed digest.
   The job↔receipt binding lives in the verifier API, which records a
   settlement only when the digest equals the canonical-JSON SHA-256 of the
   receipt it itself signed. Pinned by
   `documents_shape_only_digest_validation_on_chain`.
2. **No contract-side dust floor or job-count limit.** Anyone can open
   thousands of 1-yoctoNEAR jobs; storage staking makes each cost the opener
   real NEAR, and the verifier API enforces the ≥ 0.01 reward floor and a
   10 NEAR ceiling. Pinned by `documents_dust_escrow_acceptance_contract_side`.
3. **Stuck intermediate states need the verifier.** If the payout transfer
   fails in a way that never reaches the `#[private]` callback, a job can sit
   in `Releasing`/`Refunding`; the owner cannot force-reset it. Recovery is
   operational: the verifier re-invokes, or the owner waits for expiry +
   `refund_expired` (which works from `Open`, not from `Releasing`).
4. **`set_verifier` is owner-only and unchecked.** Rotating the verifier is a
   single-owner action; treat the owner key as the root of the trust chain.
   Consider handing it to a multisig before mainnet.
5. **Sub-cent and formatting rules are API-side.** The contract accepts any
   positive deposit ≤ 10 NEAR; canonical decimal validation (two places,
   ASCII digits) is enforced by the verifier API.

## Verifier API (`apps/api/proofgate_api.py`)

Binds to 127.0.0.1 and is documented as a local single-operator service, not
a hardened public endpoint.

6. **The settlement ledger trusts the bridge.** `POST /api/jobs/<id>/settlement`
   is authorized by a static shared secret (`PROOFGATE_BRIDGE_TOKEN`) delivered
   over loopback HTTP; the token must be ASCII (HTTP headers are decoded as
   latin-1, so exotic tokens can never match). Since 2026-11-26 the API also
   canonicalizes amounts, enforces `(network, tx_hash)` uniqueness **per
   network** (the sandbox and Testnet are separate ledgers), optionally pins
   `PROOFGATE_CONTRACT_ID`, and — with `PROOFGATE_SETTLEMENT_RPC_CHECK=1` —
   asks the allowlisted Testnet RPC to confirm the claimed tx is a successful
   single `release_job` call for exactly this job and receipt digest, refusing
   any contradiction; only a genuinely unreachable RPC is tolerated (the
   bridge remains the payment authority in that case, and the bridge could lie
   outright anyway). `PROOFGATE_SETTLEMENT_SIGNER` should name the verifier
   account that signs releases so the lookup is routed by the right account.
   The API never moves funds itself; funds move only through the contract,
   which only obeys the verifier key.
7. **Sandbox attestations are self-reported.** The Cell CLI's
   `security_baseline` fields and the `SOCK_ACCEPT_ERRNO:57` denial marker
   originate from the operator's own toolchain. A malicious guest could in
   principle print the marker; what makes the proof meaningful is that every
   executed artifact is digest-pinned in code and checked against the exact
   bytes handed to Cell — since 2026-11-26 all six guest modules including the
   probe (against `examples/CHECKSUMS.txt`), and for the two interpreter
   profiles the executed program text as well (`source_sha256` for
   `normalizer.py`/`normalizer.js`) — and that the receipt names the pinned
   `programDigest`, which `verify_bundle.py` re-checks offline. The API also
   rejects guest output JSON with duplicate keys, so the output digest commits
   to one unambiguous object for any conforming parser. A third party who
   distrusts the operator's Cell binary should re-run the guest from the
   reviewed source against their own Cell installation.
8. **Committed test keys are test-only.** The fixture Ed25519 private keys
   under `apps/api/tests/fixtures/` exist solely for the offline test matrix;
   their public halves are published so `verify_bundle.py` can prove the
   matrix verifies signatures from exactly those keys. `main()` refuses to
   start if a configured signing key *path* points into that directory — a
   footgun guard, not a security boundary: anyone can copy the committed test
   key, which is why production keys live in the gitignored `.local/` tree at
   mode 0600 (created by `keygen.py` with exclusive-create, so no
   world-readable window and no symlink or overwrite surprises).
9. **The single-instance assumption is operational.** The startup sweep that
   reclaims jobs stuck in `Executing` runs only when the server process starts
   (never from library/test paths), but two API processes sharing one SQLite
   file would still interfere; run exactly one API per data directory.

## Chain evidence (`docs/evidence/`)

10. **Committed transaction dumps are not self-authenticating offline.**
   `verify_chain_evidence.py` proves the committed files agree with each
   other; `verify_chain_signatures.py` additionally pins each dump's
   transaction hash, signature, nonce, and fee byte-for-byte to the audited
   record — but its default run performs no cryptography. Since 2026-11-26
   `--rpc-anchor` closes the real gap: it re-encodes each transaction in
   Borsh and demands the embedded Ed25519 signature verify over the hash under
   the anchored account key against signing blocks fetched from the archival
   Testnet RPC; it is best-effort (throttled archival nodes degrade it to a
   fail-closed check, capped at minutes per transaction). The ultimate anchor
   remains the refetch command in `PROVENANCE.md` run against a node you do
   not control.

## Not bugs, deliberate scope choices

- One normalization sample (`normalize-and-count`) as the executable contract;
  the policy/digest/attestation machinery is sample-agnostic.
- Testnet only; the deploy key for the evidence contract was burned after the
  recorded settlement so the evidence cannot be silently replaced.
