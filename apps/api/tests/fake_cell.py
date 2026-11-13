#!/usr/bin/env python3
"""Deterministic Cell stand-in for verifier tests.

It answers the three commands ProofGate uses (`doctor`, `run`, `verify`).
The scenario file next to this script selects the evidence fixture, the
guest's stderr line, and the doctor report. Signature checks are delegated
to the offline verifier, so the test does not need the Cell runtime.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCENARIO = json.loads((HERE / "scenario.json").read_text(encoding="utf-8"))
sys.path.insert(0, SCENARIO["api_dir"])

from verify_bundle import CheckLog, load_public_key, verify_evidence  # noqa: E402


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["doctor"]:
        print(json.dumps(SCENARIO["doctor"]))
        return 0
    if args[:1] == ["run"]:
        evidence_path = Path(args[args.index("--evidence") + 1])
        evidence_path.write_bytes((HERE / SCENARIO["evidence"]).read_bytes())
        sys.stderr.write(SCENARIO["stderr"])
        sys.stdout.write("{}")
        return 0
    if args[:1] == ["verify"]:
        evidence_path = Path(args[1])
        key_path = Path(args[args.index("--key") + 1])
        expected_tenant = None
        if "--expect" in args:
            expectation = args[args.index("--expect") + 1]
            if expectation.startswith("tenant="):
                expected_tenant = expectation.split("=", 1)[1]
        log = CheckLog()
        envelope = json.loads(evidence_path.read_bytes())
        now = datetime.fromisoformat(SCENARIO["now"].replace("Z", "+00:00")) if SCENARIO.get("now") else datetime.now(timezone.utc)
        verify_evidence(envelope, load_public_key(key_path), expected_tenant, now, log, check_freshness=False)
        print(json.dumps({"verified": not log.errors, "errors": log.errors}))
        return 0 if not log.errors else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
