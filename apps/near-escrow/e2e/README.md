# Escrow end-to-end

This harness deploys the ProofGate escrow contract to a local NEAR sandbox and
exercises the real chain path:

1. deploy and initialize the contract with a verifier account;
2. create a funded job;
3. release exactly once from the verifier account and observe `Paid`;
4. reject an attacker release and a second release;
5. refund the owner after expiry;
6. reject job creation while the contract is paused.

The output is a JSON summary with the contract account, transaction hashes,
job states and the exact beneficiary balance delta.

## Run

```sh
cd apps/near-escrow
cargo test
cargo build --target wasm32-unknown-unknown --release
cd e2e
npm install
npm run e2e
```

`npm run e2e` first runs `setup-sandbox.mjs`. The `near-sandbox` package bundled
with `near-workspaces` 5.0.0 ships nearcore 2.6.2 (protocol 77), which cannot
prepare the current near-sdk contract. The contract pins NEAR SDK 5.20.0 to
match nearcore 2.14.0, the protocol-88 sandbox release used by the harness.
The setup script downloads nearcore 2.14.0 from the official NEAR build bucket
and replaces only the local binary under `node_modules/`. The check is
idempotent; `npm install` can restore the old binary and the next run repairs it.

Supported sandbox platforms: Darwin arm64 and Linux x86_64. Set
`NEAR_SANDBOX_VERSION` to use a different nearcore release.

## Testnet

Testnet is optional and uses only throwaway testnet accounts and faucet funds.

Run these commands from `apps/near-escrow/e2e/`:

```sh
node create-testnet-master.mjs
NEAR_TESTNET_RPC_URL="https://test.rpc.fastnear.com" node testnet.mjs
```

The master script creates a top-level `proofgate-*.testnet` account through the
official testnet helper (10 testnet NEAR). The first `testnet.mjs` run creates
fixed owner, verifier, beneficiary, and attacker subaccounts, deploys the
escrow, and exercises funding, verifier-only release, attacker and
double-release rejection, expiry refund, and pause. It prints the contract ID
and explorer links for every transaction. To reuse the deployed contract for
another job:

```sh
NEAR_TESTNET_RPC_URL="https://test.rpc.fastnear.com" \
NEAR_TESTNET_CONTRACT_ID="escrow-...testnet" \
node testnet.mjs
```

The testnet keys are stored in `.local/near-testnet/` (ignored) and are never
mainnet keys. The archival Testnet RPC is deprecated and rate-limited; use
`https://test.rpc.fastnear.com`.

## Optional: record the settlement in ProofGate

With the local ProofGate API running, a verified job can be used as the escrow
source. The bridge fetches the signed receipt, computes the receipt digest,
uses the job reward and beneficiary, then posts the confirmed settlement back
to the API. The API accepts settlement records only with the bridge token.
`run.mjs` records a `sandbox` settlement; `testnet.mjs` records a `testnet`
settlement with an explorer link. For a Testnet bridge run, create the
ProofGate job with beneficiary `beneficiary.<master>.testnet` and pass
`NEAR_TESTNET_CONTRACT_ID` so the existing contract is reused. The beneficiary
must match this address exactly because the bridge rejects a mismatch.

```sh
# In the API terminal, start with a bridge token:
export PROOFGATE_BRIDGE_TOKEN="$(openssl rand -hex 32)"
python3 apps/api/proofgate_api.py

# Create and run a verified job whose beneficiary is beneficiary.<master>.testnet, then:
cd apps/near-escrow/e2e
PROOFGATE_API="http://127.0.0.1:8000" \
PROOFGATE_JOB_ID="PG-XXXXXXXX" \
PROOFGATE_BRIDGE_TOKEN="$PROOFGATE_BRIDGE_TOKEN" \
npm run e2e
```

The API validates the receipt digest, amount and beneficiary before storing the
settlement. The interface shows `Settled` only from that stored record. A
sandbox settlement is labeled as such; it is not a Mainnet payment.

## Boundaries

- Local sandbox only. No Testnet account, Mainnet account, or real funds are
  used by `npm run e2e`.
- The contract trusts the configured verifier account to have validated the
  ProofGate receipt off-chain. The contract records the receipt digest and
  enforces single-use payout, expiry refund, pause and callback recovery; it
  does not verify Cell evidence itself.
- A sandbox transaction hash is not a public explorer link. The interface
  labels it `NEAR sandbox` and does not construct an explorer URL.
