from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API_DIR = ROOT / "apps" / "api"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
FIXTURE_TENANT = "PG-67F9819A"
REPLAY_TENANT = "PG-REPLAY-TENANT"
FIXTURE_NOW = datetime(2026, 11, 9, 10, 9, 57, tzinfo=timezone.utc)
CORRECT_OUTPUT = 'RESULT_JSON:{"normalized":"proofgate verified this line","wordCount":4}\n'
WRONG_OUTPUT = 'RESULT_JSON:{"normalized":"wrong output","wordCount":2}\n'


def doctor_report() -> dict:
    return {
        "ok": True,
        "checks": [
            {"name": "package", "data": {"version": "1.2.0"}},
            {"name": "runtime-import", "data": {"version": "50.0.1"}},
            {"name": "runtime-identity", "data": {"match": True}},
            {"name": "smoke-run", "data": {"status": "success"}},
            {"name": "platform", "detail": "test platform"},
            {"name": "language-guests", "data": {"guests": {}}},
        ],
    }


@unittest.skipUnless(
    (FIXTURES / "cell-evidence-private.pem").is_file()
    and (FIXTURES / "proofgate-receipt-private.pem").is_file(),
    "the committed fixture key pairs are required for the API-level negative matrix",
)
class VerifierNegativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="proofgate-negative-")
        cls.data_dir = Path(cls.temp.name) / "state"
        os.environ["PROOFGATE_DATA_DIR"] = str(cls.data_dir)
        os.environ["EPHEMORA_BIN"] = str(Path(cls.temp.name) / "unused-cell")
        # Both key pairs are committed test artifacts under
        # apps/api/tests/fixtures/, so the matrix runs deterministically on a
        # clean clone. The evidence fixtures are signed with the Cell fixture
        # pair, which is also the API's verification trust anchor; mixing in
        # any other private key would fail the health gate or verification.
        os.environ["PROOFGATE_CELL_SIGNING_KEY"] = str(FIXTURES / "cell-evidence-private.pem")
        os.environ["PROOFGATE_CELL_PUBLIC_KEY"] = str(FIXTURES / "cell-evidence-public.pem")
        os.environ["PROOFGATE_RECEIPT_SIGNING_KEY"] = str(FIXTURES / "proofgate-receipt-private.pem")
        os.environ["PROOFGATE_RECEIPT_PUBLIC_KEY"] = str(FIXTURES / "proofgate-receipt-public.pem")
        os.environ["PROOFGATE_BRIDGE_TOKEN"] = "test-bridge-token"
        sys.path.insert(0, str(API_DIR))
        import proofgate_api
        cls.api = proofgate_api
        # The module captures DATA_DIR/DB_PATH at import time; pin them
        # explicitly so this class stays isolated no matter whether another
        # test module already imported proofgate_api with other defaults.
        cls.api.DATA_DIR = cls.data_dir
        cls.api.DB_PATH = cls.data_dir / "proofgate.sqlite3"
        cls.api.BRIDGE_TOKEN = "test-bridge-token"
        cls.api.initialize_database()
        cls.original_now = cls.api.now_utc
        cls.api.now_utc = lambda: FIXTURE_NOW

    @classmethod
    def tearDownClass(cls):
        cls.api.now_utc = cls.original_now
        cls.temp.cleanup()

    def setUp(self):
        with self.api.db_connection() as db:
            db.execute("DELETE FROM settlements")
            db.execute("DELETE FROM accepted_reports")
            db.execute("DELETE FROM jobs")
        self.api._health_cache = None

    def scenario(self, name: str, evidence: str, stderr: str = CORRECT_OUTPUT) -> None:
        directory = Path(self.temp.name) / name
        directory.mkdir(exist_ok=True)
        script = directory / "fake_cell.py"
        shutil.copyfile(Path(__file__).parent / "fake_cell.py", script)
        script.chmod(0o755)
        (directory / "scenario.json").write_text(
            json.dumps(
                {
                    "api_dir": str(API_DIR),
                    "evidence": str(FIXTURES / evidence),
                    "stderr": stderr,
                    "now": FIXTURE_NOW.isoformat().replace("+00:00", "Z"),
                    "doctor": doctor_report(),
                }
            ),
            encoding="utf-8",
        )
        # Launch the stand-in with the same interpreter that runs this suite
        # so its ``verify_bundle`` import resolves inside the project venv
        # instead of the host ``python3`` picked by the shebang.
        launcher = directory / "fake_cell"
        launcher.write_text(
            '#!/bin/sh\n' + f'exec "{sys.executable}" "{script}" "$@"\n',
            encoding="utf-8",
        )
        launcher.chmod(0o755)
        self.api.CELL_BIN = str(launcher)
        self.api._health_cache = None

    def new_job(self, tenant: str = FIXTURE_TENANT) -> str:
        job = self.api.create_job(
            {
                "name": "Negative matrix",
                "input": (FIXTURES / "input.txt").read_text(encoding="utf-8"),
                "reward": "0.10",
                "beneficiary": "agent.testnet",
                "language": "rust",
            }
        )
        if tenant != job["id"]:
            with self.api.db_connection() as db:
                db.execute("UPDATE jobs SET job_id = ? WHERE job_id = ?", (tenant, job["id"]))
        return tenant

    def run_blocked(self, evidence: str, stderr: str = CORRECT_OUTPUT, tenant: str = FIXTURE_TENANT, error_code: str | None = None):
        label = evidence + ("-wrong-output" if stderr == WRONG_OUTPUT else "")
        self.scenario("case-" + label, evidence, stderr)
        job_id = self.new_job(tenant)
        with self.assertRaises(self.api.ApiError):
            self.api.run_job(job_id)
        row = self.api.get_job(job_id)
        self.assertEqual(row["state"], "Blocked")
        if error_code:
            self.assertEqual(row["error_code"], error_code)
        return row

    def test_positive_control_reaches_verified(self):
        self.scenario("positive", "cell-evidence.json")
        job_id = self.new_job()
        result = self.api.run_job(job_id)
        self.assertEqual(result["job"]["state"], "Verified")
        self.assertEqual(result["receipt"]["payload"]["decision"], "verified; not paid")

    def settlement_payload(self, receipt: dict, **overrides: str) -> dict[str, str]:
        payload = {
            "network": "sandbox",
            "contractId": "escrow.test.near",
            "receiptDigest": self.api.receipt_digest(receipt),
            "amount": "0.10",
            "beneficiary": "agent.testnet",
            "status": "Paid",
            "txHash": "1" * 44,
        }
        payload.update(overrides)
        return payload

    def test_settlement_rejects_mismatches_and_records_once(self):
        self.scenario("settlement", "cell-evidence.json")
        job_id = self.new_job()
        result = self.api.run_job(job_id)
        receipt = result["receipt"]

        bad_digest = "sha256:" + "b" * 64
        for override in (
            {"receiptDigest": bad_digest},
            {"amount": "9.99"},
            {"beneficiary": "attacker.testnet"},
            {"network": "mainnet"},
            {"status": "Refunded"},
            {"txHash": "not-a-transaction"},
        ):
            with self.assertRaises(self.api.ApiError):
                self.api.record_settlement(job_id, self.settlement_payload(receipt, **override))

        response = self.api.record_settlement(job_id, self.settlement_payload(receipt))
        self.assertEqual(response["settlement"]["status"], "Paid")
        self.assertEqual(response["settlement"]["network"], "sandbox")
        self.assertTrue(response["job"]["settled"])
        with self.assertRaises(self.api.ApiError):
            self.api.record_settlement(job_id, self.settlement_payload(receipt))

    def test_wrong_signature_is_blocked(self):
        self.run_blocked("cell-evidence-wrong-key.json", error_code="cell_signature_rejected")

    def test_tampered_payload_is_blocked(self):
        self.run_blocked("cell-evidence-tampered.json", error_code="cell_signature_rejected")

    def test_wrong_tenant_is_blocked(self):
        self.run_blocked("cell-evidence-wrong-tenant.json", error_code="cell_signature_rejected")

    def test_stale_evidence_is_blocked(self):
        self.run_blocked("cell-evidence-stale.json", error_code="verification_rejected")

    def test_wrong_output_is_blocked(self):
        self.run_blocked("cell-evidence.json", stderr=WRONG_OUTPUT, error_code="output_mismatch")

    def test_replay_is_blocked(self):
        self.scenario("replay-first", "cell-evidence.json")
        first = self.new_job()
        self.api.run_job(first)

        self.scenario("replay-second", "cell-evidence-replay.json")
        second = self.new_job(REPLAY_TENANT)
        with self.assertRaises(self.api.ApiError):
            self.api.run_job(second)
        row = self.api.get_job(second)
        self.assertEqual(row["state"], "Blocked")
        self.assertEqual(row["error_code"], "replay")

    def test_float_output_variant_is_blocked(self):
        # Python equality is type-permissive (4.0 == 4); the receipt digest
        # hashes canonical JSON, so such variants must never verify.
        self.run_blocked(
            "cell-evidence.json",
            stderr='RESULT_JSON:{"normalized":"proofgate verified this line","wordCount":4.0}\n',
            error_code="output_mismatch",
        )

    def test_boolean_output_variant_is_blocked(self):
        # True == 1 in Python; the canonical-bytes comparison must still reject it.
        self.run_blocked(
            "cell-evidence.json",
            stderr='RESULT_JSON:{"normalized":"proofgate verified this line","wordCount":true}\n',
            error_code="output_mismatch",
        )

    def test_settlement_amount_is_canonicalized_and_ascii_only(self):
        self.scenario("amount-canonical", "cell-evidence.json")
        job_id = self.new_job()
        result = self.api.run_job(job_id)
        receipt = result["receipt"]

        # Non-canonical but numerically equal forms are accepted and stored
        # canonically, so the payment ledger holds one shape per value.
        response = self.api.record_settlement(job_id, self.settlement_payload(receipt, amount="0.1"))
        self.assertEqual(response["settlement"]["amount"], "0.10")

        for hostile in ("0.١٠", "0.１０", "0.1_0", "+0.10", " 0.10"):
            with self.subTest(amount=hostile):
                with self.assertRaises(self.api.ApiError):
                    self.api.record_settlement(job_id + "X", self.settlement_payload(receipt, amount=hostile))

    def test_empty_input_is_rejected(self):
        for hostile in ("", "   ", "\t\n"):
            with self.subTest(input=hostile):
                with self.assertRaises(self.api.ApiError):
                    self.api.create_job(
                        {
                            "name": "Empty input",
                            "input": hostile,
                            "reward": "0.10",
                            "beneficiary": "agent.testnet",
                            "language": "rust",
                        }
                    )


class OfflineVerifierTests(unittest.TestCase):
    def run_verifier(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(API_DIR / "verify_bundle.py"), *args],
            capture_output=True,
            text=True,
            check=False,
        )

    def base_args(self) -> list[str]:
        return [
            "--evidence", str(FIXTURES / "cell-evidence.json"),
            "--cell-key", str(FIXTURES / "cell-evidence-public.pem"),
            "--expect-tenant", FIXTURE_TENANT,
            "--now", "2026-11-09T10:09:57Z",
        ]

    def test_valid_bundle_verifies(self):
        result = self.run_verifier(
            *self.base_args(),
            "--receipt", str(FIXTURES / "proofgate-receipt.json"),
            "--receipt-key", str(FIXTURES / "proofgate-receipt-public.pem"),
            "--input", str(FIXTURES / "input.txt"),
            "--output", str(FIXTURES / "output.json"),
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"verified": true', result.stdout)

    def test_tampered_receipt_is_rejected(self):
        receipt = json.loads((FIXTURES / "proofgate-receipt.json").read_text(encoding="utf-8"))
        receipt["payload"]["reward"] = "9.99"
        with tempfile.TemporaryDirectory(prefix="proofgate-receipt-") as temporary:
            path = Path(temporary) / "tampered-receipt.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            result = self.run_verifier(
                *self.base_args(),
                "--receipt", str(path),
                "--receipt-key", str(FIXTURES / "proofgate-receipt-public.pem"),
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn('"receiptSignature": "fail"', result.stdout)

    def test_wrong_key_is_rejected(self):
        result = self.run_verifier(
            *self.base_args(),
            "--cell-key", str(FIXTURES / "cell-evidence-wrong-public.pem"),
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn('"signature": "fail"', result.stdout)


    def signed_receipt(self, mutate) -> Path:
        # Re-sign a tampered payload with the committed test key so the
        # signature check passes and only the intended binding check fails.
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives import serialization

        receipt = json.loads((FIXTURES / "proofgate-receipt.json").read_text(encoding="utf-8"))
        payload = receipt["payload"]
        mutate(payload)
        preimage = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        private = serialization.load_pem_private_key(
            (FIXTURES / "proofgate-receipt-private.pem").read_bytes(), password=None
        )
        signature = base64.b64encode(private.sign(preimage)).decode("ascii")
        if "signatures" in receipt:
            receipt["signatures"] = [dict(receipt["signatures"][0], signature=signature)]
        else:
            receipt["signature"] = signature
        temporary = tempfile.TemporaryDirectory(prefix="proofgate-signed-tamper-")
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "receipt.json"
        path.write_text(json.dumps(receipt), encoding="utf-8")
        return path

    def run_signed_tamper(self, mutate, failing_check: str) -> None:
        path = self.signed_receipt(mutate)
        result = self.run_verifier(
            *self.base_args(),
            "--receipt", str(path),
            "--receipt-key", str(FIXTURES / "proofgate-receipt-public.pem"),
        )
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(f'"{failing_check}": "fail"', result.stdout)

    def test_receipt_job_binding_mismatch_is_rejected(self):
        self.run_signed_tamper(lambda p: p.update(jobId="PG-00000000"), "jobBinding")

    def test_receipt_report_binding_mismatch_is_rejected(self):
        self.run_signed_tamper(lambda p: p.update(cellReportId="0" * 32), "reportBinding")

    def test_receipt_evidence_digest_mismatch_is_rejected(self):
        self.run_signed_tamper(lambda p: p.update(cellEvidenceDigest="sha256:" + "a" * 64), "evidenceDigest")

    def test_receipt_signer_binding_mismatch_is_rejected(self):
        self.run_signed_tamper(lambda p: p.update(cellSignerKeyId="0" * 16), "cellSigner")

    def test_receipt_paid_decision_is_rejected(self):
        self.run_signed_tamper(lambda p: p.update(decision="verified; paid"), "receiptDecision")

    def test_receipt_missing_signature_is_rejected(self):
        receipt = json.loads((FIXTURES / "proofgate-receipt.json").read_text(encoding="utf-8"))
        receipt["signatures"] = []
        with tempfile.TemporaryDirectory(prefix="proofgate-nosig-") as temporary:
            path = Path(temporary) / "receipt.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            result = self.run_verifier(
                *self.base_args(),
                "--receipt", str(path),
                "--receipt-key", str(FIXTURES / "proofgate-receipt-public.pem"),
            )
        self.assertEqual(result.returncode, 1)
        # An empty signatures list fails the shape gate before extraction.
        self.assertIn('"receiptShape": "fail"', result.stdout)


class ChainSignatureVerifierTests(unittest.TestCase):
    EVIDENCE = ROOT / "docs" / "evidence"
    LIVE_RECEIPT = FIXTURES / "live" / "proofgate-receipt.json"

    def run_verifier(self, evidence_dir: Path, live_receipt: Path) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable,
                str(API_DIR / "verify_chain_signatures.py"),
                "--evidence-dir", str(evidence_dir),
                "--live-receipt", str(live_receipt),
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def sandbox(self) -> tuple[tempfile.TemporaryDirectory, Path, Path]:
        temporary = tempfile.TemporaryDirectory(prefix="proofgate-anchor-")
        evidence_dir = Path(temporary.name) / "evidence"
        shutil.copytree(self.EVIDENCE, evidence_dir)
        receipt = Path(temporary.name) / "proofgate-receipt.json"
        shutil.copyfile(self.LIVE_RECEIPT, receipt)
        return temporary, evidence_dir, receipt

    def test_committed_dumps_verify_offline(self):
        result = self.run_verifier(self.EVIDENCE, self.LIVE_RECEIPT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"verified": true', result.stdout)

    def test_edited_release_digest_fails_closed(self):
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            path = evidence_dir / "release_job.tx.json"
            dump = json.loads(path.read_text(encoding="utf-8"))
            call = dump["result"]["transaction"]["actions"][0]["FunctionCall"]
            args = json.loads(base64.b64decode(call["args"]))
            args["receipt_digest"] = "sha256:" + "f" * 64
            call["args"] = base64.b64encode(json.dumps(args).encode()).decode()
            path.write_text(json.dumps(dump), encoding="utf-8")
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"release_jobCallAnchored": "fail"', result.stdout)

    def test_edited_signer_fails_closed(self):
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            path = evidence_dir / "create_job.tx.json"
            dump = json.loads(path.read_text(encoding="utf-8"))
            dump["result"]["transaction"]["signer_id"] = "attacker.testnet"
            path.write_text(json.dumps(dump), encoding="utf-8")
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"create_jobSignerAnchored": "fail"', result.stdout)

    def test_tampered_live_receipt_breaks_digest_binding(self):
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            data = json.loads(receipt.read_text(encoding="utf-8"))
            data["payload"]["reward"] = "9.99"
            receipt.write_text(json.dumps(data), encoding="utf-8")
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"releaseDigestMatchesLiveReceipt": "fail"', result.stdout)

    def test_missing_dump_fails_closed(self):
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            (evidence_dir / "refund_expired.tx.json").unlink()
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"refund_expiredDumpPresent": "fail"', result.stdout)

    def test_single_byte_signature_tamper_fails_closed(self):
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            path = evidence_dir / "release_job.tx.json"
            dump = json.loads(path.read_text(encoding="utf-8"))
            signature = dump["result"]["transaction"]["signature"]
            dump["result"]["transaction"]["signature"] = signature[:-1]
            path.write_text(json.dumps(dump), encoding="utf-8")
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"release_jobPinnedBytesAnchored": "fail"', result.stdout)

    def test_edited_transaction_hash_fails_closed(self):
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            path = evidence_dir / "create_job.tx.json"
            dump = json.loads(path.read_text(encoding="utf-8"))
            dump["result"]["transaction"]["hash"] = "1" * 44
            path.write_text(json.dumps(dump), encoding="utf-8")
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"create_jobPinnedBytesAnchored": "fail"', result.stdout)

    def test_grafted_foreign_signature_fails_closed(self):
        # Swap another real transaction's signature into the release dump:
        # structurally valid, but pinned bytes catch it.
        temporary, evidence_dir, receipt = self.sandbox()
        try:
            create = json.loads((evidence_dir / "create_job.tx.json").read_text(encoding="utf-8"))
            path = evidence_dir / "release_job.tx.json"
            dump = json.loads(path.read_text(encoding="utf-8"))
            dump["result"]["transaction"]["signature"] = create["result"]["transaction"]["signature"]
            path.write_text(json.dumps(dump), encoding="utf-8")
            result = self.run_verifier(evidence_dir, receipt)
        finally:
            temporary.cleanup()
        self.assertEqual(result.returncode, 1)
        self.assertIn('"release_jobPinnedBytesAnchored": "fail"', result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
