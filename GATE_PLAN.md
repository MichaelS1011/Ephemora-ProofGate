# ProofGate outcome and evidence gates

Progress is accepted by evidence, not by dates or estimates. A gate is not
accepted merely because code exists or an implementer reports success.

## Current task traceability

| Task | Gate | User outcome | Required evidence | Status |
|---|---|---|---|---|
| PG-000 | G0 | Owner can review the product promise and proposed trust boundary | Master spec review, architecture decision, source/provenance baseline | Accepted; owner authorized use of Cell and local implementation |
| PG-001 | G1 | A known Cell path runs under a known policy | Cell version/checksum, successful and denied real runs, language matrix, evidence schema | Partial: seven source paths and a signed network-socket denial probe pass; clean immutable Cell package and broader denied-capability matrix remain |
| PG-002 | G2 | Forged, replayed, or mismatched evidence cannot authorize settlement | Canonical schema, trusted signer model, independent verification, tamper/replay vectors | Local verifier implemented; positive reports accepted; independent wrong-key/tamper/replay test matrix still incomplete |
| PG-003 | G3 | Testnet escrow pays at most once or safely refunds | Contract invariants, test results, deployed testnet contract, owner-approved funding, observed chain state | Rust escrow contract implemented; 11 local unit checks and WASM build pass; no sandbox deployment, testnet deployment, or chain receipt yet |
| PG-004 | G4 | A judge can reproduce one honest end-to-end outcome | Cell run ID, receipt hash, contract job ID, confirmed Testnet transaction, clean-checkout guide | Not started; local Cell outcome is reproducible in current checkout, but NEAR portion is not integrated |
| PG-005 | G5 | Critical failure and attack cases do not pay improperly | Independent negative matrix, logs, recovery behavior, reviewer verdict | Not started |
| PG-006 | G6 | A first-time user understands Execute → Verify → Settle | English screens, responsive/light/dark states, keyboard and contrast review, truthful state semantics | Apple 2026-inspired refresh implemented; actual Cell states are wired and UI build passes; keyboard, contrast, and full device matrix remain |
| PG-007 | G7 | A third party can reproduce the public project honestly | Clean setup, license/provenance review, secret scan, release evidence, owner publication decision | BUSL-1.1 project license, third-party notices, clean-checkout instructions, and clean staged secret scan; final release evidence and public publication remain |

## Gate acceptance

### G0 — Governance and evidence baseline

**Desired outcome:** owner and lead agree on the North Star, scope, trust
assumptions, and initial architecture.

**Prepared:** the supplied product spec was read; the Cell audit, decision
proposal, gate plan, UI plan, provenance file, and journal were created.

**Accepted:** the owner approved the architecture baseline and authorized
local ProofGate integration with their separate Ephemora Cell product without
an additional usage fee. Cell remains under BUSL-1.1; this does not grant
permission to copy, redistribute, relicense, or publish Cell source or
binaries. No work in this repository changes Cell or accesses a wallet.

### G1 — Cell v1.2 capability inventory

**Desired outcome:** a known real Cell path launches the intended workload
under policy.

**Required evidence:** exact artifact/version/checksum and license; install and
runtime identity; one successful and one denied capability run; actual
receipt/signature shape and signer provenance; limits; tested runtime/language
matrix; limitations.

**Current result:** the local release candidate produced seven real, signed
Cell reports through the ProofGate API: Rust, C, Zig, Go, and AssemblyScript
WASI Preview1 modules; a Python WASI 0.2 component; and JavaScript through the
QuickJS WASI guest. Each passed its language-specific signed-policy checks and
returned the expected output. A signed network-socket denial probe also
returned `ENOTSOCK` with `/sandbox` as the only preopen. G1 remains partial
because the local Cell candidate is not a clean immutable package and the
broader denied-capability matrix is open. See
[`CELL_V1_2_AUDIT.md`](CELL_V1_2_AUDIT.md).

### G2 — Receipt and verification policy

**Desired outcome:** the verifier accepts only a job-bound, authenticated,
fresh receipt and rejects tampered, replayed, mismatched, or untrusted reports.

**Required evidence:** versioned canonical schema, trust-root model, signer
allowlist/revocation, nonce/job binding, policy and payload matching,
independent tamper/wrong-key/replay results, bounded approval object.

**Dependency:** G1 establishes what Cell actually emits. Do not copy the PDF's
illustrative JSON as though it were a Cell API.

**Current result:** the local ProofGate verifier checks the Cell signature,
schema, timestamp, policy baseline, tenant binding, output, and replay ID, then
emits a signed receipt. Independent negative vectors for wrong keys and
tampered/mismatched evidence remain required.

### G3 — NEAR Testnet escrow

**Desired outcome:** funded jobs have safe single-use payout/refund transitions.

**Required evidence:** contract state invariants; authorized caller checks;
duplicate/concurrent-claim behavior; callback/RPC recovery; expiry/refund
behavior; observed Testnet state and transaction. A human must explicitly
authorize any funding or payout action. No keys enter untrusted code or the
browser.

**Owner gate:** no payout implementation or spending before the specific
contract/key-custody decision is approved. A Rust `near-sdk` contract now
implements a configured verifier authority, funded jobs, single-use release,
owner refund after expiry, pause controls, and callback-based transfer
recovery, with each job capped at 10 NEAR. Eleven unit checks pass. This is
contract logic only: there is no live contract-call adapter or deployment.

### G4 — End-to-end truthful demonstration

One actual Cell run must produce accepted evidence and at most one confirmed
Testnet payout, with instructions a third party can rerun. UI state must follow
the chain confirmation, not the transaction submission response.

### G5 — Attack and failure matrix

At minimum: wrong signer, tampered receipt, wrong job/amount/beneficiary,
failed job, forbidden capability, replay, concurrent claim, expiry, callback
failure, stale state, unavailable RPC, and recovery. Each case maps to a
reproducible result and reviewer.

### G6 — English-first product experience

Build Overview, New Execution, Execution Detail, Receipts, Settlements,
Security, and Settings. Include blocked, pending, refund, empty, offline/demo,
loading, light/dark, mobile, reduced-motion, and reduced-transparency states.
The exact screen plan is in [`UI_IMPLEMENTATION_PLAN.md`](UI_IMPLEMENTATION_PLAN.md).

### G7 — Independent reproducibility and publication

A fresh checkout reproduces documented local checks and the actual Testnet
flow. Complete provenance, license/third-party notices, secret scan, accurate
English README, and owner-controlled publication/submission decisions.

## Decision protocol

Each meaningful task records its gate, outcome, evidence path, commands run,
status, risk, owner decision needed, and next action in the append-only
[`journal`](journal/2026-11-08.md). Critical security blockers remain visible.
No internal delivery estimates are used.
