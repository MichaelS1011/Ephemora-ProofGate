#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES="$SCRIPT_DIR/examples"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUSTC="${RUSTC:-rustc}"
ZIG="${ZIG:-zig}"
GO="${GO_BIN:-$REPO_ROOT/.local/toolchains/go/bin/go}"
if [[ ! -x "$GO" ]] && command -v go >/dev/null; then GO="$(command -v go)"; fi
ASC="${ASC:-$REPO_ROOT/.local/toolchains/assemblyscript/node_modules/.bin/asc}"

command -v "$RUSTC" >/dev/null || { echo "rustc is required" >&2; exit 1; }
command -v "$ZIG" >/dev/null || { echo "zig is required for the C and Zig WASI builds" >&2; exit 1; }
command -v "$GO" >/dev/null || { echo "Go is required; set GO_BIN to a Go toolchain with WASI support" >&2; exit 1; }
test -x "$ASC" || { echo "AssemblyScript is required; install the pinned compiler with npm install --prefix .local/toolchains/assemblyscript assemblyscript@0.28.20" >&2; exit 1; }

"$RUSTC" --edition=2021 --target wasm32-wasip1 -C opt-level=s -C strip=symbols \
  "$EXAMPLES/normalizer.rs" -o "$EXAMPLES/normalizer-rust.wasm"
"$ZIG" cc -target wasm32-wasi -O2 "$EXAMPLES/normalizer.c" \
  -Wl,--strip-all -o "$EXAMPLES/normalizer-c.wasm"
"$ZIG" cc -target wasm32-wasi -O2 "$EXAMPLES/denied-network.c" \
  -o "$EXAMPLES/denied-network.wasm"
"$ZIG" build-exe -target wasm32-wasi -lc "$EXAMPLES/normalizer.zig" \
  -femit-bin="$EXAMPLES/normalizer-zig.wasm" -O ReleaseSmall
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 "$GO" build -trimpath -ldflags='-s -w' \
  -o "$EXAMPLES/normalizer-go.wasm" "$EXAMPLES/normalizer.go"
"$ASC" "$EXAMPLES/normalizer.ts" --outFile "$EXAMPLES/normalizer-assemblyscript.wasm" \
  --baseDir "$EXAMPLES" --use abort=normalizer/myAbort --runtime stub -O1

printf 'Built five WASI language samples and the denied-network probe in %s\n' "$EXAMPLES"
