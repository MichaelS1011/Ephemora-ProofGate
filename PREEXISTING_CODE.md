# Code provenance

## Baseline

Ephemora Cell is pre-existing code maintained in a separate local repository.
The ProofGate repository does not vendor, copy, or modify Cell source.

The local source trees inspected for the initial audit were:

| Local checkout | Branch | Commit observed | Working tree |
|---|---|---|---|
| `/Users/mimiai/ephemora-cell-rc` | `release/v1.2.0-rc` | `5b8a9055397e390956b6ed53c56255e3a2608775` | Dirty; 76 status entries when inspected |
| `/Users/mimiai/ephemora-cell` | `release/1.2.0-preparation` | `13e95a19656b8774c85f885103e52743193cbf06` | Dirty; runtime CLI and test files modified, one test file untracked |

The owner has confirmed that Ephemora Cell remains under `BUSL-1.1`. The v1.2
candidate metadata in the first checkout declares version `1.2.0` and
`BUSL-1.1`. Its local documentation says the v1.2.0 artifact set has not yet
been published. No `v1.2*` tag was present in that checkout when inspected.
These observations identify local working copies; they do not authenticate a
release artifact or establish redistribution rights.

## New ProofGate work

This repository does **not** implement or distribute an Ephemora Cell runtime.
It calls the owner's separate local Cell executable as an external dependency.
The code listed below is ProofGate integration and demonstration code, not a
new Cell distribution or a relicensing of Cell. No ProofGate release has been
published. Its source is licensed separately under this repository's BUSL-1.1
`LICENSE`.

The following are new ProofGate challenge work in this repository:

- `apps/api/proofgate_api.py`, `keygen.py`, and `build_guests.sh` implement the
  local Cell adapter, output and evidence verifier, signed receipt, API, and
  five compiled WASI language build paths plus Python and JavaScript
  interpreter-guest paths.
- `apps/api/examples/` contains seven normalizer source programs, the
  `denied-network.c` security probe, and compiled Rust, C, Zig, Go, and
  AssemblyScript modules. Python and JavaScript use external Cell interpreter
  guests supplied by the owner; those binaries are not copied into this
  repository.
- `apps/web/` contains the original React interface, styles, assets, and Vite
  local development setup.
- `apps/near-escrow/` contains the new Rust NEAR escrow contract. It uses the
  official `near-sdk` 5.30.1 release. Contract tests are local mocked-runtime
  unit checks; there is no deployment or transaction evidence yet.
- Root and `docs/` markdown files record the product, challenge, provenance,
  and evidence decisions.

No Cell source or interpreter guest binary was copied, relicensed, or changed.
Ephemora Cell remains under BUSL-1.1 in its separate repository. The Cell
dependency used for reproduced local runs remains the dirty v1.2.0 candidate
identified above. Seven language paths have been exercised against it; the
Python and JavaScript guest files remain local, separately licensed artifacts
with pinned SHA-256 digests in ProofGate.

## Release disclosure

Before a release, replace local-checkout references above with the exact Cell
artifact and immutable version used, recheck the guest checksums and embedded
third-party notices, and provide reproducible setup instructions. The new
ProofGate work is licensed separately under BUSL-1.1 in this repository's
`LICENSE`; that selection does not change Cell's separate BUSL-1.1 license.
Clearly identify which files are external Cell artifacts and which are new
ProofGate work.
