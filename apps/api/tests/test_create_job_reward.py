from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
API_DIR = ROOT / "apps" / "api"
FIXTURES = Path(__file__).resolve().parent / "fixtures"


class CreateJobRewardTests(unittest.TestCase):
    """Reward strings must survive validation without silent rounding.

    A reward such as "0.001" used to pass the float-based check and then be
    stored as "0.00" by the two-decimal formatting step. Because
    record_settlement requires an amount greater than zero that equals the
    stored reward, such a job could never be settled. The validation now
    rejects any value that is not representable at two decimal places.
    """

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="proofgate-reward-")
        # proofgate_api captures its key-path configuration from the
        # environment at import time; mirror the negative matrix fixture
        # setup so suite ordering cannot leave the module half-configured.
        if (FIXTURES / "cell-evidence-public.pem").is_file():
            os.environ.setdefault("PROOFGATE_CELL_SIGNING_KEY", str(FIXTURES / "cell-evidence-private.pem"))
            os.environ.setdefault("PROOFGATE_CELL_PUBLIC_KEY", str(FIXTURES / "cell-evidence-public.pem"))
            os.environ.setdefault("PROOFGATE_RECEIPT_SIGNING_KEY", str(FIXTURES / "proofgate-receipt-private.pem"))
            os.environ.setdefault("PROOFGATE_RECEIPT_PUBLIC_KEY", str(FIXTURES / "proofgate-receipt-public.pem"))
        sys.path.insert(0, str(API_DIR))
        import proofgate_api
        cls.api = proofgate_api
        cls.original_data_dir = cls.api.DATA_DIR
        cls.original_db_path = cls.api.DB_PATH
        cls.api.DATA_DIR = Path(cls.temp.name) / "state"
        cls.api.DB_PATH = cls.api.DATA_DIR / "proofgate.sqlite3"
        cls.api.initialize_database()

    @classmethod
    def tearDownClass(cls):
        cls.api.DATA_DIR = cls.original_data_dir
        cls.api.DB_PATH = cls.original_db_path
        cls.temp.cleanup()

    def stored_reward(self, reward: object) -> str:
        job = self.api.create_job(
            {
                "name": "reward regression job",
                "input": "ProofGate verified this line",
                "reward": reward,
                "language": "rust",
            }
        )
        with self.api.db_connection() as db:
            row = db.execute("SELECT reward FROM jobs WHERE job_id = ?", (job["id"],)).fetchone()
        self.assertIsNotNone(row)
        return row["reward"]

    def test_valid_rewards_are_stored_with_two_decimals(self):
        self.assertEqual(self.stored_reward("0.10"), "0.10")
        self.assertEqual(self.stored_reward("0.1"), "0.10")
        self.assertEqual(self.stored_reward("1"), "1.00")
        self.assertEqual(self.stored_reward("10"), "10.00")

    def test_sub_cent_and_non_canonical_rewards_are_rejected(self):
        rejected = ["0.001", "0.005", "0.123", "1e-3", "1e2", "1_0", "0.1.2", "nan", "inf", "-0.10", "", " 0.10", "0.10 "]
        for reward in rejected:
            with self.subTest(reward=reward):
                with self.assertRaises(self.api.ApiError) as ctx:
                    self.stored_reward(reward)
                self.assertEqual(ctx.exception.status, 400)

    def test_zero_out_of_range_and_non_string_rewards_are_rejected(self):
        for reward in ["0", "0.00", "10.01", "10.5", None, 0.1, {"amount": "0.10"}]:
            with self.subTest(reward=reward):
                with self.assertRaises(self.api.ApiError) as ctx:
                    self.stored_reward(reward)
                self.assertEqual(ctx.exception.status, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
