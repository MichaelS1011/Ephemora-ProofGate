# Decision DEC-001 — ProofGate architecture baseline

**Status:** Approved by the owner for local implementation on 2026-11-08.

## Proposal

Build ProofGate as a separate, local-first integration around Ephemora Cell.
Keep Cell source untouched and outside this repository. Use only a Cell runtime
path established by Gate 1. Put receipt validation, policy decisions, and NEAR
authorization outside the untrusted workload. Keep the browser read-only for
trust decisions and settlement eligibility.

The first product promise is:

> Run untrusted agent code inside a constrained execution boundary, inspect
> signed execution evidence, and authorize exactly one NEAR payment only when
> an independently enforced job policy accepts that evidence.

The word “verified” means that the configured verifier accepted the trusted
signer, receipt bindings, freshness, and required policy checks that are
actually implemented. It does not mean arbitrary program correctness is
proved. `Verified` and `Settled` remain separate states.

## Proposed trust flow

```text
Untrusted agent workload
  -> audited Cell execution path
  -> actual Cell result/evidence (schema to be established at Gate 1)
  -> ProofGate verifier and explicit policy
  -> bounded one-time approval
  -> NEAR Testnet escrow
  -> confirmed chain state
  -> evidence UI
```

The workload receives no verifier or payment key. The approval must bind the
job, run, nonce, policy and payload digests, beneficiary, amount, expiry, and a
single-use claim identifier to the extent the chosen Cell evidence and contract
can support them. The exact signature and contract authorization mechanism is
still an open decision.

## Implementation boundary

- **Cell integration:** a thin adapter normalizes a verified, real Cell path;
  it does not change Cell or claim all languages are supported.
- **Verifier:** fail closed on unknown schemas, signer mismatch, altered or
  stale receipts, replay, job/policy/result mismatch, or unavailable trust
  state.
- **Settlement:** Testnet only. A new Rust escrow contract now accepts deposits,
  allows only a configured verifier account to release an open job, records the
  receipt digest, prevents a second release, and returns expired escrow to its
  owner. Payout and refund use callbacks: successful transfer is finalized;
  failed transfer restores the open state for retry. Unit checks pass, but
  local sandbox and Testnet behavior remain to be verified. The contract trusts
  the configured verifier to have validated Cell evidence off-chain; it does
  not prove that evidence itself.
- **UI:** shows evidence and backend-owned state. It never decides signer trust
  or payout eligibility. Demo data is persistently labelled.
- **Storage:** local service/database is the source of truth; browser
  `localStorage` is not the audit store. No public-Internet deployment is in
  scope for the MVP.
- **Framework:** defer the web framework choice until the API boundary and
  implementation environment are reviewed. The target folder is empty; no
  existing framework constrains the choice.

## Options considered

| Option | Benefits | Risks | Recommendation |
|---|---|---|---|
| Separate adapter/verifier/contract/UI with Cell external | Clear code provenance; verifier stays outside workload; product can evolve without a core fork | Requires a reproducible Cell package and explicit API contract | **Recommended** |
| Browser-only demo that locally toggles receipt/settlement state | Fast visual mock | Browser would be the trust authority; risks implying fake verification or payment | Reject for any non-demo mode |
| Modify Cell to emit a new generic ProofGate receipt | Could simplify an adapter | Changes a separate pre-existing security boundary and may not match every runtime path | Defer; no core change without separate owner approval |

## Open risks

1. The available local v1.2 checkouts are dirty candidate trees, not an
   immutable release; Gate 1 is incomplete.
2. The signed Cell report is an operator-generated execution record. It does
   not itself contain job input/output digests or attest host integrity;
   ProofGate binds observed inputs and outputs in a separate signed receipt.
3. The local Cell license is BUSL-1.1; distribution and dependency rights need
   review against the actual package.
4. NEAR finality tracking and live API flows have not been implemented. Unit
   checks do not prove sandbox or Testnet transfer behavior.
5. Signer custody, key rotation/revocation, and operator authorization need a
   separate threat-model decision before any payout route.

## Owner decision

**Owner decision:** Approved. The owner confirmed Ephemora Cell is their own
product, authorized local ProofGate integration without an additional usage
fee, and directed work to proceed with winning the NEAR Challenge as the top
priority. This authorization is not a grant to copy, redistribute, relicense,
or publish Cell source code or binaries. Cell remains under BUSL-1.1; its source
and runtime distribution stay outside this project unless separately reviewed
and authorized.

This approves local ProofGate implementation and integration work using the
existing Cell product. It does not authorize signing a transaction, spending
tokens, deploying to Mainnet, publishing the repository, posting on X, or
submitting the project. Those remain separate human-controlled steps under the
official challenge instructions.

**Related gate:** G0 / G1
