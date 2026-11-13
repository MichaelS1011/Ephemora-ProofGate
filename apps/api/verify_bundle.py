"""Offline verifier for a Cell evidence envelope and a ProofGate receipt.

This tool exists so a clean checkout can inspect a recorded proof bundle
without the separately licensed Cell runtime. It verifies the DSSE signature
over the exact evidence bytes, the tenant and freshness bindings, the signed
receipt, and every digest that ties the receipt to the evidence and the job.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

EVIDENCE_PAYLOAD_TYPE = "https://ephemora.dev/execution-report.v1"
EVIDENCE_SCHEMA = "ephemora-execution-evidence.v1"
RECEIPT_SCHEMA = "proofgate-receipt.v1"
EVIDENCE_MAX_AGE = timedelta(seconds=90)
EVIDENCE_MAX_SKEW = timedelta(seconds=10)
HEX_DIGEST = set("0123456789abcdef")


class CheckLog:
    def __init__(self) -> None:
        self.checks: dict[str, str] = {}
        self.errors: list[str] = []

    def record(self, name: str, ok: bool, error: str | None = None) -> bool:
        self.checks[name] = "pass" if ok else "fail"
        if not ok and error:
            self.errors.append(error)
        return ok

    def skip(self, name: str) -> None:
        self.checks[name] = "skip"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def is_hex_digest(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and set(value) <= HEX_DIGEST


def public_key_id(public_key: Ed25519PublicKey) -> str:
    raw = public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return sha256_hex(raw)[:16]


def load_public_key(path: Path) -> Ed25519PublicKey:
    key = serialization.load_pem_public_key(path.read_bytes())
    if not isinstance(key, Ed25519PublicKey):
        raise ValueError(f"{path} is not an Ed25519 public key.")
    return key


def dsse_pae(payload: bytes, payload_type: str) -> bytes:
    encoded_type = payload_type.encode("utf-8")
    return (
        b"DSSEv1"
        + len(encoded_type).to_bytes(4, "little")
        + encoded_type
        + len(payload).to_bytes(4, "little")
        + payload
    )


def parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def decode_envelope(envelope: Any, log: CheckLog) -> tuple[bytes, dict[str, Any]] | None:
    if not isinstance(envelope, dict):
        log.record("envelopeShape", False, "Evidence is not a DSSE envelope object.")
        return None
    payload_type = envelope.get("payloadType")
    payload_b64 = envelope.get("payload")
    signatures = envelope.get("signatures")
    if (
        payload_type != EVIDENCE_PAYLOAD_TYPE
        or not isinstance(payload_b64, str)
        or not isinstance(signatures, list)
        or not signatures
    ):
        log.record("envelopeShape", False, "Evidence is not a DSSE envelope with the expected payload type.")
        return None
    try:
        payload = base64.b64decode(payload_b64, validate=True)
        report = json.loads(payload)
    except (ValueError, TypeError, json.JSONDecodeError):
        log.record("envelopeShape", False, "Evidence payload is not valid base64-encoded JSON.")
        return None
    if not isinstance(report, dict):
        log.record("envelopeShape", False, "Evidence payload is not a JSON object.")
        return None
    log.record("envelopeShape", True)
    return payload, report


def verify_envelope_signature(
    envelope: dict[str, Any], public_key: Ed25519PublicKey, log: CheckLog
) -> bool:
    try:
        payload = base64.b64decode(envelope["payload"], validate=True)
        pae = dsse_pae(payload, envelope["payloadType"])
        for entry in envelope["signatures"]:
            if not isinstance(entry, dict) or not isinstance(entry.get("sig"), str):
                raise ValueError("signature entry is malformed")
            if entry.get("alg") not in (None, "EdDSA"):
                raise ValueError("signature algorithm is not EdDSA")
            public_key.verify(base64.b64decode(entry["sig"], validate=True), pae)
    except Exception:
        return log.record("signature", False, "Evidence signature does not verify under the trusted key.")
    return log.record("signature", True)


def verify_evidence(
    envelope: Any,
    public_key: Ed25519PublicKey,
    expected_tenant: str | None,
    now: datetime,
    log: CheckLog,
    *,
    check_freshness: bool = True,
) -> tuple[bytes, dict[str, Any]] | None:
    decoded = decode_envelope(envelope, log)
    if decoded is None:
        return None
    payload, report = decoded
    if not verify_envelope_signature(envelope, public_key, log):
        return payload, report

    evidence = report.get("evidence")
    baseline = report.get("security_baseline")
    if not isinstance(evidence, dict) or not isinstance(baseline, dict):
        log.record("schema", False, "Evidence has no evidence or security_baseline object.")
        return payload, report

    log.record(
        "schema",
        evidence.get("schema") == EVIDENCE_SCHEMA,
        "Evidence schema is not accepted.",
    )
    log.record(
        "reportStatus",
        report.get("status") == "success" and report.get("exit_code") == 0,
        "Evidence does not report a successful execution.",
    )
    log.record(
        "reportId",
        isinstance(evidence.get("report_id"), str)
        and len(evidence["report_id"]) == 32
        and set(evidence["report_id"]) <= HEX_DIGEST,
        "Evidence report ID is malformed.",
    )
    if expected_tenant is None:
        log.skip("tenantBinding")
    else:
        log.record(
            "tenantBinding",
            baseline.get("tenant") == expected_tenant,
            "Evidence is not bound to the expected job tenant.",
        )
    if not check_freshness:
        log.skip("freshness")
        return payload, report
    issued = parse_timestamp(evidence.get("issued_at"))
    if issued is None:
        log.record("freshness", False, "Evidence issue time is malformed.")
    else:
        log.record(
            "freshness",
            now - issued <= EVIDENCE_MAX_AGE and issued - now <= EVIDENCE_MAX_SKEW,
            "Evidence is stale or has an invalid issue time.",
        )
    return payload, report


def verify_receipt(
    receipt: Any,
    receipt_key: Ed25519PublicKey,
    cell_key: Ed25519PublicKey,
    evidence_bytes: bytes,
    evidence_report: dict[str, Any] | None,
    expected_tenant: str | None,
    input_bytes: bytes | None,
    output_bytes: bytes | None,
    log: CheckLog,
) -> dict[str, Any] | None:
    if not isinstance(receipt, dict):
        log.record("receiptShape", False, "Receipt is not an object.")
        return None
    payload = receipt.get("payload")
    signatures = receipt.get("signatures")
    if not isinstance(payload, dict) or not isinstance(signatures, list) or not signatures:
        log.record("receiptShape", False, "Receipt has no payload or signature.")
        return None
    log.record("receiptShape", True)

    expected_key_id = public_key_id(receipt_key)
    signature_ok = True
    for entry in signatures:
        if (
            not isinstance(entry, dict)
            or entry.get("algorithm") != "Ed25519"
            or entry.get("keyId") != expected_key_id
            or not isinstance(entry.get("signature"), str)
        ):
            signature_ok = False
            break
        try:
            receipt_key.verify(base64.b64decode(entry["signature"], validate=True), canonical_json(payload))
        except Exception:
            signature_ok = False
            break
    log.record("receiptSignature", signature_ok, "Receipt signature does not verify under the trusted key.")

    log.record(
        "receiptSchema",
        payload.get("schema") == RECEIPT_SCHEMA,
        "Receipt schema is not accepted.",
    )
    log.record(
        "receiptDecision",
        payload.get("result") == "success" and payload.get("decision") == "verified; not paid",
        "Receipt does not record a verified, unpaid decision.",
    )
    log.record(
        "evidenceDigest",
        payload.get("cellEvidenceDigest") == "sha256:" + sha256_hex(evidence_bytes),
        "Receipt evidence digest does not match the supplied evidence bytes.",
    )
    if evidence_report is None:
        log.record("reportBinding", False, "Receipt cannot bind an unreadable evidence report.")
    else:
        report_id = evidence_report.get("evidence", {}).get("report_id")
        log.record(
            "reportBinding",
            payload.get("cellReportId") == report_id,
            "Receipt cell report ID does not match the evidence.",
        )
    if expected_tenant is None:
        log.skip("jobBinding")
    else:
        log.record(
            "jobBinding",
            payload.get("jobId") == expected_tenant,
            "Receipt job ID does not match the expected tenant.",
        )
    log.record(
        "cellSigner",
        payload.get("cellSignerKeyId") == public_key_id(cell_key),
        "Receipt does not name the trusted Cell signer.",
    )
    if input_bytes is None:
        log.skip("inputDigest")
    else:
        log.record(
            "inputDigest",
            payload.get("inputDigest") == "sha256:" + sha256_hex(input_bytes),
            "Receipt input digest does not match the supplied input.",
        )
    if output_bytes is None:
        log.skip("outputDigest")
    else:
        try:
            output_value = json.loads(output_bytes)
        except json.JSONDecodeError:
            log.record("outputDigest", False, "Supplied output is not valid JSON.")
        else:
            log.record(
                "outputDigest",
                payload.get("outputDigest") == "sha256:" + sha256_hex(canonical_json(output_value)),
                "Receipt output digest does not match the supplied output.",
            )
    return payload


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify a recorded Cell evidence and ProofGate receipt bundle.")
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--cell-key", type=Path, required=True)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--receipt-key", type=Path)
    parser.add_argument("--expect-tenant")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--now", help="ISO-8601 verification time; defaults to the current time.")
    args = parser.parse_args(argv)

    if args.receipt is not None and args.receipt_key is None:
        parser.error("--receipt requires --receipt-key")
    now = parse_timestamp(args.now) if args.now else datetime.now(timezone.utc)
    if now is None:
        parser.error("--now must be an ISO-8601 timestamp with a timezone")

    log = CheckLog()
    cell_key = load_public_key(args.cell_key)
    evidence_bytes = args.evidence.read_bytes()
    try:
        envelope = json.loads(evidence_bytes)
    except json.JSONDecodeError:
        log.record("envelopeShape", False, "Evidence file is not valid JSON.")
        envelope = None
    decoded = None
    evidence_report = None
    if envelope is not None:
        decoded = verify_evidence(envelope, cell_key, args.expect_tenant, now, log)
        if decoded is not None:
            evidence_report = decoded[1]

    if args.receipt is not None:
        receipt_key = load_public_key(args.receipt_key)
        input_bytes = args.input.read_bytes() if args.input else None
        output_bytes = args.output.read_bytes() if args.output else None
        verify_receipt(
            read_json(args.receipt),
            receipt_key,
            cell_key,
            evidence_bytes,
            evidence_report,
            args.expect_tenant,
            input_bytes,
            output_bytes,
            log,
        )

    verified = not log.errors
    print(json.dumps({"verified": verified, "checks": log.checks, "errors": log.errors}, indent=2, sort_keys=True))
    return 0 if verified else 1


if __name__ == "__main__":
    raise SystemExit(main())
