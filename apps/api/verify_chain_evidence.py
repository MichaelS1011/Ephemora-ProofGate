#!/usr/bin/env python3
"""Offline check that the committed NEAR Testnet transaction dumps back the
receipt digest produced by the committed live receipt.

Stdlib only. The three dumps under docs/evidence/*.tx.json are the unmodified
`result` objects returned by `EXPERIMENTAL_tx_status` on the public Testnet
RPC (see docs/evidence/PROVENANCE.md for the exact refetch commands). This
script never touches the network; it proves that what is on-chain matches what
the offline verifier verifies:

  1. the canonical-JSON SHA-256 of the live receipt payload equals the
     `receipt_digest` argument of the on-chain `release_job` call;
  2. that call was signed by the configured verifier account and targeted the
     escrow contract, and it succeeded;
  3. the escrow job was created by the owner account with exactly a 0.10 NEAR
     deposit for this job and beneficiary;
  4. the expiry-refund path is evidenced by a separate `refund_expired` call
     for its own test job (never presented as part of this settlement).

Exit code 0 and `"verified": true` on success.
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "docs" / "evidence"
FIXTURES = REPO_ROOT / "apps" / "api" / "tests" / "fixtures" / "live"

JOB_ID = "PG-73D0D44B"
CONTRACT_ID = "escrow-mw956wm0.proofgate-mw952xad.testnet"
VERIFIER_ACCOUNT = "verifier.proofgate-mw952xad.testnet"
OWNER_ACCOUNT = "owner.proofgate-mw952xad.testnet"
BENEFICIARY_ACCOUNT = "beneficiary.proofgate-mw952xad.testnet"
CREATE_DEPOSIT_YOCTO = "100000000000000000000000"  # 0.10 NEAR
REFUND_TEST_JOB = "PG-TESTNET-REFUND-mwflhg9x"
SUCCESS_TRUE = "dHJ1ZQ=="  # base64("true")


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class CheckLog:
    def __init__(self) -> None:
        self.checks: dict[str, str] = {}
        self.errors: list[str] = []

    def record(self, name: str, ok: bool, error: str | None = None) -> bool:
        self.checks[name] = "pass" if ok else "fail"
        if not ok:
            self.errors.append(error or f"{name} failed")
        return ok


def load_tx(name: str) -> dict[str, Any] | None:
    path = EVIDENCE_DIR / name
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8")).get("result")


def function_call(result: dict[str, Any]) -> tuple[str, str, dict[str, Any], str, str]:
    """Return (signer, receiver, first FunctionCall args, method_name, deposit)."""
    tx = result.get("transaction", {})
    signer = tx.get("signer_id", "")
    receiver = tx.get("receiver_id", "")
    for action in tx.get("actions", []):
        if "FunctionCall" in action:
            call = action["FunctionCall"]
            args = json.loads(base64.b64decode(call.get("args", "")))
            return signer, receiver, args, call.get("method_name", ""), call.get("deposit", "")
    return signer, receiver, {}, "", ""


def main() -> int:
    log = CheckLog()

    receipt_path = FIXTURES / "proofgate-receipt.json"
    if not receipt_path.is_file():
        log.record("receiptPresent", False, "Live receipt fixture is missing.")
        payload_digest = None
    else:
        log.record("receiptPresent", True)
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        payload = receipt.get("payload")
        payload_digest = "sha256:" + sha256_hex(canonical_json(payload)) if isinstance(payload, dict) else None
        log.record("receiptPayload", payload_digest is not None, "Receipt payload is not an object.")

    release = load_tx("release_job.tx.json")
    log.record("releaseTxDumpPresent", release is not None, "docs/evidence/release_job.tx.json is missing.")
    if release is not None and payload_digest is not None:
        signer, receiver, args, method, _deposit = function_call(release)
        log.record("releaseMethod", method == "release_job", f"Expected release_job, got {method!r}.")
        log.record("releaseSigner", signer == VERIFIER_ACCOUNT, f"release_job signer is {signer!r}.")
        log.record("releaseContract", receiver == CONTRACT_ID, f"release_job receiver is {receiver!r}.")
        log.record(
            "releaseJobBinding",
            args.get("job_id") == JOB_ID,
            f"release_job carries job {args.get('job_id')!r}.",
        )
        log.record(
            "releaseDigestMatchesReceipt",
            args.get("receipt_digest") == payload_digest,
            "On-chain receipt_digest does not equal the canonical-JSON SHA-256 of the committed receipt payload.",
        )
        log.record(
            "releaseSucceeded",
            release.get("status", {}).get("SuccessValue") == SUCCESS_TRUE,
            "release_job did not return true (escrow reports the payout transfer finalized).",
        )

    create = load_tx("create_job.tx.json")
    log.record("createTxDumpPresent", create is not None, "docs/evidence/create_job.tx.json is missing.")
    if create is not None:
        signer, receiver, args, method, deposit = function_call(create)
        log.record("createMethod", method == "create_job", f"Expected create_job, got {method!r}.")
        log.record("createSigner", signer == OWNER_ACCOUNT, f"create_job signer is {signer!r}.")
        log.record("createContract", receiver == CONTRACT_ID, f"create_job receiver is {receiver!r}.")
        log.record("createJobBinding", args.get("job_id") == JOB_ID, f"create_job carries job {args.get('job_id')!r}.")
        log.record(
            "createBeneficiary",
            args.get("beneficiary_id") == BENEFICIARY_ACCOUNT,
            f"create_job beneficiary is {args.get('beneficiary_id')!r}.",
        )
        log.record("createDeposit", deposit == CREATE_DEPOSIT_YOCTO, f"create_job deposit is {deposit!r}.")

    refund = load_tx("refund_expired.tx.json")
    log.record("refundTxDumpPresent", refund is not None, "docs/evidence/refund_expired.tx.json is missing.")
    if refund is not None:
        signer, receiver, args, method, _deposit = function_call(refund)
        log.record("refundMethod", method == "refund_expired", f"Expected refund_expired, got {method!r}.")
        log.record("refundSigner", signer == OWNER_ACCOUNT, f"refund_expired signer is {signer!r}.")
        log.record(
            "refundIsSeparateJob",
            args.get("job_id") == REFUND_TEST_JOB,
            f"refund_expired carries job {args.get('job_id')!r}; it must not reference the settled job.",
        )
        log.record(
            "refundSucceeded",
            refund.get("status", {}).get("SuccessValue") == SUCCESS_TRUE,
            "refund_expired did not return true.",
        )

    verified = all(value == "pass" for value in log.checks.values()) and bool(log.checks)
    print(json.dumps({"verified": verified, "checks": log.checks, "errors": log.errors}, indent=2))
    return 0 if verified else 1


if __name__ == "__main__":
    sys.exit(main())
