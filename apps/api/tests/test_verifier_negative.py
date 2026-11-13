from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
