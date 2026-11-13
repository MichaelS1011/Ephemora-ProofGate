# Ephemora Cell v1.2 audit

**Snapshot note:** this audit began on 8 November 2026 with three AOT paths.
The 9 November follow-up at the end records the expanded run set; earlier
counts describe the initial audit state.

**Status:** Partial runtime reproduction on a dirty local candidate; Gate 1 is
not accepted.

## Scope and evidence boundary

The audit followed the supplied *Ephemora ProofGate Master Specification*.
The ProofGate target folder began empty. No `START_HERE_DE.md`, separate
`Product_Specification` files, `Official_Rules/HACKATHON_UPLOADED.md`, or local
`Interactive_UI_Prototype/index.html` was found in the inspected home-folder
search. The attached PDF is therefore the only supplied ProofGate source of
requirements in this workspace.

I inspected local Cell source metadata, source files, and documentation, then
ran the existing Cell CLI through the new ProofGate local API. Three separate
language source programs were compiled and executed. These results reproduce
the exact local candidate path only; they do not establish an immutable public
release or a clean-checkout installation.

## Local source identity

| Item | Observation | What it establishes |
|---|---|---|
| Candidate checkout | `<local Cell candidate checkout>`, branch `release/v1.2.0-rc`, commit `5b8a9055397e390956b6ed53c56255e3a2608775` | Identifies the local candidate inspected |
| Candidate worktree | 76 modified/untracked status entries, including runtime, security, release, and test paths | Current files do not form a clean immutable release snapshot |
| Other local checkout | `<second local Cell checkout>`, branch `release/1.2.0-preparation`, commit `13e95a19656b8774c85f885103e52743193cbf06`; runtime CLI/tests also modified | A second local preparation tree, not a clean source of release evidence |
| Version and license metadata | Candidate `pyproject.toml` declares `1.2.0` and `BUSL-1.1`; its `LICENSE` contains Business Source License 1.1 | Local source metadata only; separate legal/redistribution review is still needed |
| Release evidence | The candidate docs describe a not-yet-published v1.2.0 artifact set; no `v1.2*` tag was present in the inspected clone | No immutable release artifact or package checksum was available in this audit |

Do not present the local candidate as an audited or publicly reproducible
release. Do not copy its code into ProofGate.

## Documented runtime and language surface

The candidate source/docs describe:

- A Python API (`WASISandbox`, `run_isolated`, and `ExecutionResult`) and the
  `ephemora` / `ephemora-cell` CLI entry points.
- WebAssembly modules using WASI Preview1, plus opt-in or auto-detected WASI
  0.2 component execution.
- AOT build recipes for Rust, Go, C, AssemblyScript, and Zig. The local
  language document labels these shipped and says their CI recipes build and
  execute modules; none of those paths was reproduced for this audit.
- Python is not an AOT path. Python and JavaScript interpreter/component
  routes depend on separately supplied or versioned guest binaries. They must
  not appear as verified UI choices until the exact package and route are
  installed and run successfully.
- WASI 0.3, threads, and GC-based paths are described as gated or locked in
  local candidate docs.

This is an inventory of claims present in a dirty candidate tree, not an
approved runtime/language matrix. For the first ProofGate slice, the runtime
selector must contain no language until a specific route has Gate 1 evidence.

## Capabilities and constraints described in source

Local candidate docs and code describe fuel, memory, wall-clock, output and
filesystem limits; WASI Preview1 has no socket API, while the WASI 0.2
component path has a separate socket surface and call-time denial behavior.
The source also describes subprocess isolation for untrusted/unknown component
paths. These are design/documentation findings only; this audit did not
reproduce the controls or confirm that a packaged runtime matches the source.

The verifier must use only capability and result fields that the selected
Cell path can actually establish. No UI label may imply broader host isolation,
process integrity, or semantic correctness.

## Evidence/signature compatibility

The candidate has a signed VM evidence path. The inspected source describes a
DSSE/Ed25519 envelope configured through `VmEvidenceOptions`, with a key ID,
private-key path, trust-root path, and a caller-side verification step. That
path is specific to the VM product route. It is not evidence that every
`WASISandbox` or language run produces the ProofGate receipt schema shown in
the PDF.

Before integrating, establish the exact evidence bytes, schema/version,
canonicalization, signer trust and revocation process, freshness policy,
job/run/nonce bindings, and actual result/status semantics for the chosen
runtime. A valid signature authenticates bytes from a key; it does not prove
the host was untampered or that arbitrary program output is correct.

## Licensing and dependency boundary

The local candidate metadata and license text identify Cell as `BUSL-1.1`.
The separate v1.2 license matrix and package contents must be reviewed against
the exact artifact before redistribution or publication. Keep Cell external to
this repository until ownership, availability, and license compatibility are
settled. A dependency on a locally private package would not by itself make a
fresh public checkout reproducible.

## Runtime evidence reproduced — 8 Nov 2026

The installed CLI reports Cell `1.2.0`, Wasmtime `50.0.1`, native runtime
identity match, macOS arm64 qualification, and a passing smoke run. The doctor
reported eight checks OK and one warning. Python and JavaScript interpreter
guest distributions were absent. The API therefore exposes only reviewed Rust,
C, and Zig sample guests.

| Language source | Compiler path | ProofGate job | Cell report ID | Output |
|---|---|---|---|---|
| Rust | `rustc` → `wasm32-wasip1` | `PG-C37E9413` | `c5ce9faa81ce4c4eb4fe2108b07e65eb` | `{"normalized":"ephemora proofgate","wordCount":2}` |
| C | Zig C compiler → `wasm32-wasi` | `PG-165119A6` | `e0315fd02b4243c3a3b910196882579d` | `{"normalized":"ephemora proofgate","wordCount":2}` |
| Zig | Zig → `wasm32-wasi` | `PG-07F81809` | `78112edb69c34a1883b4e004a42b370f` | `{"normalized":"ephemora proofgate","wordCount":2}` |

All three received the same input and used Wasmtime `50.0.1`, subprocess
execution, WASI Preview1, a 300,000 fuel limit, 128 MiB memory cap, 64 MiB I/O
budget, 2 CPU-second I/O budget, 256 MiB disk quota, 1 MiB module limit, a
single `/sandbox` preopen, no environment variables, disabled threads,
memory64, exceptions, function references, GC, multi-memory, stack switching,
tail calls, and fsync, plus an enforced sync blockade. Each produced a distinct
signed Cell report and a signed ProofGate receipt. All show `Verified · unpaid`
and no NEAR transaction. The Cell report did not measure resident memory; the
receipt records the value as null.

These are three source-language guest runs, not three independent Cell
runtimes: each guest was compiled to WebAssembly and executed by the same Cell
boundary. Python and JavaScript remain unavailable because the optional Cell
guest packages were absent. No forbidden-capability attempt has been
reproduced.

## Gate 1 evidence still required

1. A clean immutable Cell v1.2 source/package identity, checksum, license, and
   install route suitable for a fresh ProofGate checkout. The current local RC
   is dirty and does not satisfy this requirement.
2. Exact runtime and platform identity used by that install.
3. One successful run and one denied-capability run on the selected real Cell
   path, with bounded logs and retained evidence. Successful runs exist across
   seven source paths. A signed socket-denial probe returned `ENOTSOCK` and
   confirmed `/sandbox` was the sole preopen; this is one narrow negative case,
   not a complete denied-capability matrix.
4. A language/runtime matrix tied to those executed paths. Seven source paths
   are now reproduced; Python and JavaScript require separately supplied,
   digest-matching Cell guest artifacts on a clean checkout.
5. The exact receipt format and signer provenance available from that path.
6. Reproduced limits and explicit known limitations.

**Gate decision as of 8 November:** partial, not accepted. Successful runtime
and evidence behavior was reproduced for three WASI guest languages on the
current dirty candidate. At that snapshot, a denied-capability result was not
available. The ProofGate integration does not assume the PDF's generic
receipt; it validates the actual Cell evidence emitted on the selected local
path. The 9 November follow-up below records subsequent evidence.

## 9 November 2026 follow-up

The API now verifies seven source paths against the same local Cell candidate:
Rust, C, Zig, Go, and AssemblyScript as WASI Preview1 modules; Python as a
WASI 0.2 component; and JavaScript through the QuickJS WASI guest. All seven
received the same bounded text and returned the same expected normalization.
Each Cell report signature, tenant, ABI, profile limits, freshness, output, and
replay state passed ProofGate's checks.

Go uses the `build-tool` profile because its WASI runtime exceeds the
2-second worker CPU budget. ProofGate records its 10-second CPU ceiling,
1 GiB disk quota, 256 MiB I/O budget, 512 MiB memory ceiling, and 100-million
fuel limit explicitly. The other compiled modules use `agent-readonly`; Python
and JavaScript use the interpreter profile with their language-specific ABI.

The Python and JavaScript guests came from owner-held local Cell artifacts and
were checked against pinned SHA-256 digests. They are not committed, bundled,
or relicensed by ProofGate. A clean clone needs the owner to supply those two
separately licensed artifacts before those paths become available.

The current Gate 1 decision is still **partial**: Cell is a locally installed
release candidate rather than a clean immutable package, and the broader
denied-capability matrix remains open. The network probe only shows that the
socket accept call receives `ENOTSOCK` and that `/sandbox` is the only preopen;
it does not establish every network or capability denial behavior.
