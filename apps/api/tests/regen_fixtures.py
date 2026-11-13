#!/usr/bin/env python3
"""Regenerate the API-level negative-matrix evidence fixtures.

The API-level negative matrix (`test_verifier_negative.py`) drives a
deterministic in-process stand-in for the Cell CLI (`fake_cell.py`). That
stand-in delegates the `verify` command to the offline verifier, and the
verifier's trust anchor for the whole test class is the committed
`fixtures/cell-evidence-public.pem`. The API matrix therefore passes only
when every evidence fixture is signed with the matching private key.

This script regenerates the fixtures deterministically:

- the positive bundle (`cell-evidence.json`) and every negative variant are
  signed with ONE dedicated fixture key pair whose public half is
  `fixtures/cell-evidence-public.pem` (committed, and the trust anchor of the
  standalone offline bundle check);
- digests inside the report are computed from the committed reviewed guest
  artifacts and input/output fixtures, so the API's report validation sees a
  coherent report;
- the negative variants keep their exact intended failure:
  * `cell-evidence-wrong-key.json`   — signed with an ephemeral foreign key;
  * `cell-evidence-tampered.json`    — payload modified after signing (the
    signature no longer covers the bytes);
  * `cell-evidence-wrong-tenant.json`— bound to another tenant;
  * `cell-evidence-stale.json`       — issued far outside the freshness
    window;
  * `cell-evidence-replay.json`      — same report ID as the positive run,
    bound to the replay tenant.

The fixture key pair is a test artifact, not a production key: the private
half lives in `apps/api/tests/fixtures/` alongside its public half and is
used only to sign recorded, deterministic test evidence.

Usage (from the repository root):
    python3 apps/api/tests/regen_fixtures.py
"""
from __future__ import annotations

import base64
import copy
import hashlib
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parents[3]
API_DIR = ROOT / "apps" / "api"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(API_DIR))

from verify_bundle import dsse_pae  # noqa: E402

PAYLOAD_TYPE = "https://ephemora.dev/execution-report.v1"
REPORT_ID = "74d6e500f5754a06a25a5818ba279b5a"
ISSUED_AT = "2026-11-09T10:09:27.357916+00:00"
STALE_ISSUED_AT = "2026-11-08T00:00:00+00:00"


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def envelope(payload_bytes: bytes, key: Ed25519PrivateKey) -> dict:
    signature = key.sign(dsse_pae(payload_bytes, PAYLOAD_TYPE))
    return {
        "payloadType": PAYLOAD_TYPE,
        "payload": base64.b64encode(payload_bytes).decode("ascii"),
        "signatures": [{"alg": "EdDSA", "sig": base64.b64encode(signature).decode("ascii")}],
    }


def build_report(tenant: str, issued_at: str) -> dict:
    module = (API_DIR / "examples" / "normalizer-rust.wasm").read_bytes()
    source = (API_DIR / "examples" / "normalizer.rs").read_bytes()
    input_bytes = (FIXTURES / "input.txt").read_text(encoding="utf-8").encode("utf-8")
    output_obj = json.loads((FIXTURES / "output.json").read_text(encoding="utf-8"))
    output_digest = sha256_hex(canonical(output_obj))
    policy = json.loads((API_DIR / "policy.json").read_text(encoding="utf-8")) if (API_DIR / "policy.json").is_file() else None
    if policy is None:
        import proofgate_api  # noqa: F401  (only for BASE_POLICY constants)

        policy = {
            "abi": "preview1",
            "fuel": proofgate_api.MAX_FUEL,
            "memory_limit_bytes": proofgate_api.PROGRAMS["rust"]["memory_bytes"],
            "io_budget_bytes": proofgate_api.BASE_POLICY["ioBudgetBytes"],
            "io_cpu_seconds": proofgate_api.BASE_POLICY["ioCpuSeconds"],
            "disk_quota_bytes": proofgate_api.BASE_POLICY["diskQuotaBytes"],
            "max_wasm_bytes": proofgate_api.MAX_WASM_BYTES,
            "execution_mode": proofgate_api.BASE_POLICY["executionMode"],
        }
    report = {
        "elapsed_ms": 24.59,
        "evidence": {
            "issued_at": issued_at,
            "report_id": REPORT_ID,
            "schema": "ephemora-execution-evidence.v1",
            "tool": "normalizer-rust.wasm",
        },
        "exit_code": 0,
        "exit_status_fidelity": "exact",
        "fuel_budget": policy["fuel"],
        "fuel_consumed": 26154,
        "fuel_utilization": round(26154 / policy["fuel"], 4),
        "memory_mb": None,
        "security_baseline": {
            "abi": policy["abi"],
            "allow_env_names": [],
            "allow_fsync": False,
            "disk_quota_bytes": policy["disk_quota_bytes"],
            "exceptions_enabled": False,
            "execution_mode": policy["execution_mode"],
            "fuel": policy["fuel"],
            "function_references_enabled": False,
            "gc_enabled": False,
            "gc_heap_mb": None,
            "io_budget_bytes": policy["io_budget_bytes"],
            "io_cpu_seconds": policy["io_cpu_seconds"],
            "max_wasm_bytes": policy["max_wasm_bytes"],
            "max_wasm_bytes_unlimited": False,
            "memory64": False,
            "memory_limit_bytes": policy["memory_limit_bytes"],
            "multi_memory": False,
            "preopens": ["/sandbox"],
            "stack_switching_enabled": False,
            "sync_blockade_enforced": True,
            "tail_calls_enabled": False,
            "tenant": tenant,
            "threads_enabled": False,
            "wasmtime_version": "50.0.1",
        },
        "status": "success",
        "stderr_bytes": 0,
        "stdout_bytes": len(canonical(output_obj)),
        "warnings": [],
        "digests": {
            "input": sha256_hex(input_bytes),
            "output": output_digest,
            "program": sha256_hex(module),
            "source": sha256_hex(source),
        },
    }
    return report


def write(name: str, env: dict) -> None:
    path = FIXTURES / name
    path.write_bytes((json.dumps(env, indent=1) + "\n").encode("utf-8"))
    print(f"wrote {path.relative_to(ROOT)}")


def main() -> int:
    key = serialization.load_pem_private_key(
        (FIXTURES / "cell-evidence-private.pem").read_bytes(), password=None
    )
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("fixture private key is not Ed25519")

    positive = build_report("PG-67F9819A", ISSUED_AT)
    write("cell-evidence.json", envelope(canonical(positive), key))

    foreign = Ed25519PrivateKey.generate()
    write("cell-evidence-wrong-key.json", envelope(canonical(copy.deepcopy(positive)), foreign))

    tampered = copy.deepcopy(positive)
    tampered["fuel_consumed"] = tampered["fuel_consumed"] + 1  # one value changed after signing
    env = envelope(canonical(copy.deepcopy(positive)), key)
    env["payload"] = base64.b64encode(canonical(tampered)).decode("ascii")  # signature now covers the pre-tamper bytes
    write("cell-evidence-tampered.json", env)

    write(
        "cell-evidence-wrong-tenant.json",
        envelope(canonical(build_report("PG-OTHER-TENANT", ISSUED_AT)), key),
    )
    write(
        "cell-evidence-stale.json",
        envelope(canonical(build_report("PG-67F9819A", STALE_ISSUED_AT)), key),
    )
    write(
        "cell-evidence-replay.json",
        envelope(canonical(build_report("PG-REPLAY-TENANT", ISSUED_AT)), key),
    )
    print("fixtures regenerated; run apps/api/tests/test_verifier_negative.py to verify")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
