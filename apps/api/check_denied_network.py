from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "apps" / "api" / "examples" / "denied-network.wasm"
MAX_WASM_BYTES = 32 * 1024 * 1024
FUEL = 300_000


def main() -> int:
    cell = os.environ.get("EPHEMORA_BIN") or shutil.which("ephemora")
    signing_key = os.environ.get("PROOFGATE_CELL_SIGNING_KEY")
    public_key = os.environ.get("PROOFGATE_CELL_PUBLIC_KEY")
    if not cell or not signing_key or not public_key:
        raise SystemExit("Set EPHEMORA_BIN, PROOFGATE_CELL_SIGNING_KEY, and PROOFGATE_CELL_PUBLIC_KEY.")
    if not MODULE.is_file():
        raise SystemExit("Build the sample first with apps/api/build_guests.sh.")

    tenant = f"PG-DENY-{uuid.uuid4().hex[:12].upper()}"
    tenant_book = ROOT / ".local" / "state" / "tenant-books" / f"{tenant}.jsonl"
    tenant_book.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    module_digest = hashlib.sha256(MODULE.read_bytes()).hexdigest()

    with tempfile.TemporaryDirectory(prefix="proofgate-denied-network-") as temporary:
        work = Path(temporary)
        evidence_path = work / "cell-evidence.dsse.json"
        command = [
            cell, "run", str(MODULE), "--trust", "untrusted", "--profile", "agent-readonly",
            "--fuel", str(FUEL), "--memory-mb", "128", "--timeout", "15",
            "--max-wasm-bytes", str(MAX_WASM_BYTES), "--abi", "preview1", "--json",
            "--tenant", tenant, "--tenant-book", str(tenant_book),
            "--evidence", str(evidence_path), "--evidence-key", signing_key,
        ]
        process = subprocess.run(command, cwd=work, capture_output=True, text=True, timeout=30, check=False)
        if process.returncode != 0 or not evidence_path.is_file():
            raise SystemExit(f"Cell did not accept the denial probe: {process.stderr.strip()}")

        try:
            report = json.loads(process.stdout)
            envelope = json.loads(evidence_path.read_bytes())
        except (json.JSONDecodeError, OSError) as exc:
            raise SystemExit("Cell returned malformed report or evidence JSON.") from exc
        if report.get("status") != "success" or report.get("exit_code") != 0:
            raise SystemExit("The denial probe did not complete with its expected guest exit status.")
        if not re.search(r"^SOCK_ACCEPT_ERRNO:57$", process.stderr, flags=re.MULTILINE):
            raise SystemExit("The guest did not receive WASI ENOTSOCK (57) for the socket attempt.")

        baseline = report.get("security_baseline", {})
        expected = {
            "abi": "preview1",
            "execution_mode": "subprocess",
            "fuel": FUEL,
            "memory_limit_bytes": 128 * 1024 * 1024,
            "io_cpu_seconds": 2.0,
            "preopens": ["/sandbox"],
            "allow_env_names": [],
            "tenant": tenant,
            "sync_blockade_enforced": True,
        }
        mismatches = [key for key, value in expected.items() if baseline.get(key) != value]
        if mismatches:
            raise SystemExit("Cell security baseline mismatch: " + ", ".join(mismatches))

        verified = subprocess.run(
            [cell, "verify", str(evidence_path), "--key", public_key, "--expect", f"tenant={tenant}", "--json"],
            cwd=work, capture_output=True, text=True, timeout=10, check=False,
        )
        try:
            verdict = json.loads(verified.stdout)
        except json.JSONDecodeError as exc:
            raise SystemExit("Cell evidence verifier returned malformed JSON.") from exc
        if verified.returncode != 0 or verdict.get("verified") is not True or verdict.get("errors"):
            raise SystemExit("Cell evidence signature or tenant binding did not verify.")

        print(json.dumps({
            "result": "verified",
            "capability": "network socket",
            "wasiErrno": "ENOTSOCK",
            "preopens": baseline["preopens"],
            "moduleSha256": f"sha256:{module_digest}",
            "cellReportId": report["evidence"]["report_id"],
            "cellEvidenceSignature": "verified",
        }, sort_keys=True))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
