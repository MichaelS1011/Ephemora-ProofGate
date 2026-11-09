# Third-party notices

The root [LICENSE](LICENSE) covers original Ephemora ProofGate work only.
Third-party software and Cell remain under their own terms. License texts
referenced below are in [`licenses/`](licenses/).

## Sample guests and compiled runtimes

| Component | Use in ProofGate | License |
|---|---|---|
| Go 1.27.3 standard library/runtime | Linked into `normalizer-go.wasm` | BSD-3-Clause; see [GO-BSD-3-Clause.txt](licenses/GO-BSD-3-Clause.txt) |
| Rust standard library | Linked into the Rust sample and NEAR contract build | MIT OR Apache-2.0; see [RUST-MIT.txt](licenses/RUST-MIT.txt) and [RUST-APACHE-2.0.txt](licenses/RUST-APACHE-2.0.txt) |
| Zig 0.16.0 runtime and C toolchain | Builds the Zig and C samples | MIT; see [ZIG-MIT.txt](licenses/ZIG-MIT.txt) |
| AssemblyScript 0.28.20 compiler/runtime | Builds `normalizer-assemblyscript.wasm` | Apache-2.0; see [ASSEMBLYSCRIPT-APACHE-2.0.txt](licenses/ASSEMBLYSCRIPT-APACHE-2.0.txt) |
| NEAR SDK 5.30.1 | Contract source and runtime | MIT OR Apache-2.0; the source crate also carries its license texts |
| near-parameters 0.38.0 | Contract unit-test dependency | MIT OR Apache-2.0 |

The Rust, Go, Zig, and AssemblyScript files in `apps/api/examples/` are source
programs written for this project. Their generated WASI modules are checked
in as demonstration build artifacts. Third-party runtime portions retain the
licenses shown above.

## Web and API dependencies

The locked direct web dependencies are React 19.3.1, React DOM 19.3.1, Vite
8.3.6, and `@vitejs/plugin-react` 6.2.1; each is MIT licensed. Their versions
and transitive dependency graph are recorded in
[`apps/web/package-lock.json`](apps/web/package-lock.json).

The local API uses `cryptography` (Apache-2.0 OR BSD-3-Clause), `cffi`
(MIT-0), and `pycparser` (BSD-3-Clause). The dependency constraint is recorded
in `apps/api/pyproject.toml`; license texts from the local verified install
are included as `CRYPTOGRAPHY*.txt`, `CFFI.txt`, and `PYCPARSER.txt`.

## Ephemora Cell

Ephemora Cell is a separate product and remains under BUSL-1.1 in its own
repository. ProofGate calls the owner's local Cell executable. The Python and
JavaScript interpreter guest binaries used for local runs are separately
licensed Cell artifacts, supplied by the owner and pinned by SHA-256 in the
API configuration. They are not stored or distributed in this repository.
Their licenses and embedded-runtime notices remain with the Cell distributions.
