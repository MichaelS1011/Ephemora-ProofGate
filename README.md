# Ephemora ProofGate

Local policy verification for constrained agent execution, with a NEAR escrow
prototype.

**ProofGate is not a new Cell, execution runtime, or replacement for Cell.** It
is a separate integration prototype that calls the owner's existing, locally
installed Ephemora Cell runtime. Cell is maintained in a different repository
under **BUSL-1.1**; no Cell source has been copied or modified here. The new
work in this folder is the ProofGate adapter, verifier and receipts, sample
guest programs, interface, and an undeployed NEAR escrow contract.

The new ProofGate work is under BUSL-1.1 as well, in its own [LICENSE](LICENSE).
Evaluation, development, research, and testing are permitted without a fee;
production or business use before the applicable change date requires a
commercial license. This repository has not been published publicly. The NEAR rules
accept any project license and require a LICENSE file; using BUSL-1.1 keeps the
code reviewable for the challenge while preserving the commercial boundary.

## Current state

- **Cell:** the local Cell 1.2.0 candidate is an external dependency; its
  Wasmtime 50.0.1 runtime identity matches. ProofGate has run and verified
  seven source paths: Rust, C, Zig, Go, and AssemblyScript as WASI Preview1
  modules, Python as a WASI 0.2 component, and JavaScript on the Cell QuickJS
  WASI guest. Each returned the same checked result and a signed Cell report.
  Profiles and resource ceilings are recorded per language. Python and
  JavaScript guest binaries are owner-supplied, digest-checked Cell artifacts;
  they are not included or relicensed by this repository.
- **NEAR:** the official Testnet JSON-RPC status method responded to a
  read-only request with `chain_id: testnet` and `syncing: false`. A new Rust
  escrow contract caps each job at 10 NEAR and implements verifier-only
  release, single-use state transitions, expiry refund, and failed-transfer
  recovery. Its 11 local unit checks pass and the contract WASM builds. There
  is no deployed contract, account signer, funding transaction, or payout yet.
  The local UI can check the Testnet RPC status; that status route is read-only
  and does not call a ProofGate contract.
- **Challenge API:** the live application endpoint is only for final
  submissions. Its `OPTIONS` response was checked without sending an
  application. It has no documented dry-run endpoint; do not test it with a
  sample `POST`.
- **User interface:** responsive local-first app with light and dark themes,
  honest demo labels, and separate verified and unpaid states. NEAR actions
  remain visibly offline until the contract flow is implemented and approved.

The selected tracks are **AI Security & Defense** (`security`) and **Agent
Economy** (`agents`). The product concept and Cell runtime predate the event;
the NEAR integration in this repository is the challenge work. See
[`docs/CHALLENGE_STRATEGY.md`](docs/CHALLENGE_STRATEGY.md) and
[`PREEXISTING_CODE.md`](PREEXISTING_CODE.md) for exact boundaries.

## Run the local Cell flow

Requirements: Python 3.12+, Node.js 22+, Rust with the `wasm32-wasip1`
target, Zig, Go 1.27.3 with `GOOS=wasip1 GOARCH=wasm`, AssemblyScript 0.28.20,
and the owner's local Ephemora Cell 1.2.0 candidate. The Cell candidate is an
external, separately licensed dependency; set `EPHEMORA_BIN` to its
executable. Python and JavaScript require the matching owner-supplied Cell
guest artifacts and are enabled only when their configured SHA-256 digests
match the reviewed values. A clean checkout does not contain those binaries.

Install Go 1.27.3 from the [official Go downloads](https://go.dev/dl/) and
put `go` on `PATH` or set `GO_BIN` to its executable. The build script uses
`.local/toolchains/go/bin/go` when present, otherwise it checks `PATH`.

From the repository root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install 'cryptography>=42,<51'
npm ci --prefix apps/web
npm install --prefix .local/toolchains/assemblyscript --no-save assemblyscript@0.28.20
cd apps/web && npm run build:guests && npm run build
cd ../..
python3 apps/api/keygen.py --out .local/devkeys
```

To enable the two interpreter paths, set `PROOFGATE_PYTHON_GUEST` and
`PROOFGATE_JAVASCRIPT_GUEST` to the separately licensed Cell guest files. The
API rejects a guest whose digest does not match the pinned value in its
catalog. Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

In one terminal, start the loopback-only API with the local Cell executable and
development keys:

```sh
export EPHEMORA_BIN="/absolute/path/to/ephemora"
export PROOFGATE_CELL_SIGNING_KEY="$PWD/.local/devkeys/cell-evidence-private.pem"
export PROOFGATE_CELL_PUBLIC_KEY="$PWD/.local/devkeys/cell-evidence-public.pem"
export PROOFGATE_RECEIPT_SIGNING_KEY="$PWD/.local/devkeys/proofgate-receipt-private.pem"
export PROOFGATE_RECEIPT_PUBLIC_KEY="$PWD/.local/devkeys/proofgate-receipt-public.pem"
python3 apps/api/proofgate_api.py
```

To reproduce the network-capability denial independently of the UI, build the
guest and run the signed probe from a second terminal with the same Cell and
evidence-key paths. The guest attempts `sock_accept` on stdin; Cell returns
`ENOTSOCK` because the workload has no socket descriptor, and its signed
baseline lists only `/sandbox` as a preopen. No network request is made.

```sh
export EPHEMORA_BIN="/absolute/path/to/ephemora"
export PROOFGATE_CELL_SIGNING_KEY="$PWD/.local/devkeys/cell-evidence-private.pem"
export PROOFGATE_CELL_PUBLIC_KEY="$PWD/.local/devkeys/cell-evidence-public.pem"
python3 apps/api/check_denied_network.py
```

Expected output contains `"result":"verified"`, `"wasiErrno":"ENOTSOCK"`,
`"preopens":["/sandbox"]`, and `"cellEvidenceSignature":"verified"`.

In another terminal, start the interface:

```sh
cd apps/web && npm run dev
```

Open the local URL printed by Vite, create a job, select an available language,
then choose **Run in Ephemora Cell**. Expected result: a verified output, Cell
report ID, signed ProofGate receipt, and `Verified · unpaid` status. Every
language uses its own recorded ABI, runtime profile, memory, fuel, timeout,
and I/O budgets. Python and JavaScript run their reviewed source through the
Cell interpreter guest; the host Python and Node.js runtimes do not execute the
job source.

Development keys and the SQLite database stay under ignored `.local/` paths.
Never reuse these keys for production or a NEAR account.

## Build and check the NEAR escrow contract

From the repository root:

```sh
cd apps/near-escrow
cargo test
cargo build --target wasm32-unknown-unknown --release
```

The first command runs the local contract unit checks. The second produces
`target/wasm32-unknown-unknown/release/proofgate_escrow.wasm`. This artifact has
not been deployed or exercised by a NEAR sandbox or Testnet transaction.

## NEAR HACKATHON compliance

The official rules allow existing products when the new NEAR integration is
built during the event window. Testnet-only projects are eligible; mandatory
partner integrations are not required; an original NEAR contract that fits the
track is enough. A public repository, public X demo post with
`@NEARProtocol` and `#NEARHackathon`, and one final submission are required by
**14 November 2026, 23:59 UTC**.

The challenge submission API is
`POST https://nearhackathon.com/api/applications`. A successful request saves
the project's one submission; duplicate repositories are rejected. The API
documentation defines no validation-only or dry-run mode. Required human
details, personal data, and consent must be confirmed before sending the exact
payload. No application has been submitted.

No public release, X post, transaction signing, spending, or final application
submission has been performed.

## Review package

- [Cell v1.2 audit](CELL_V1_2_AUDIT.md)
- [Architecture decision 001](DECISION_RECORD_001.md)
- [Gate plan](GATE_PLAN.md)
- [UI implementation plan](UI_IMPLEMENTATION_PLAN.md)
- [Challenge strategy and API check](docs/CHALLENGE_STRATEGY.md)
- [Code provenance](PREEXISTING_CODE.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Work journal](journal/2026-11-08.md)

## Safety boundary

- Only the NEAR Testnet is in scope for the prototype; Mainnet is never
  selected implicitly.
- The untrusted workload never receives verifier or payment signing keys.
- A signed receipt authenticates a statement; it does not prove arbitrary
  program correctness or host integrity.
- `Verified` and `Settled` are separate states. Show `Settled` only after final
  chain confirmation.
- Offline sample data must carry a persistent `Demo data` label.
- The escrow contract records a verifier-approved receipt digest; the
  off-chain verifier remains responsible for validating Cell evidence.
