"""Structural plus pinned-record checks for the committed Testnet dumps.

verify_chain_evidence.py proves the committed files agree with each other.
This script first pins each dump byte-for-byte to the audited record —
signer, receiver, account key, method, gas, deposit, arguments, transaction
hash, signature, nonce, and priority fee are compared against constants that
are audited in the README and docs/evidence/PROVENANCE.md. The default (no
flag) run performs **no cryptography**: it proves the committed files are the
audited files, nothing more.

With --rpc-anchor it becomes cryptographic: each transaction is re-encoded in
Borsh exactly as NEAR does, the signing-block preimage is reconstructed from
the live archival Testnet RPC, and the embedded Ed25519 signature must verify
over the 32-byte transaction hash under the anchored account key — a dump can
then only pass if a transaction with exactly these bytes provably existed on
Testnet. The ultimate anchor remains refetching with the commands in
docs/evidence/PROVENANCE.md.

Run from apps/api (cryptography is installed there):
    uv run python verify_chain_signatures.py [--rpc-anchor]
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener
from urllib.request import HTTPRedirectHandler

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = ROOT / "docs" / "evidence"
LIVE_FIXTURES = ROOT / "apps" / "api" / "tests" / "fixtures" / "live"

BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

# Values audited in README section "Verify the live settlement offline" and
# docs/evidence/PROVENANCE.md. These are the trusted anchors: nothing inside
# the dumps is taken at face value.
CONTRACT_ID = "escrow-mw956wm0.proofgate-mw952xad.testnet"
EXPECTED = {
    "create_job": {
        "tx_hash": "4dT5X1qmaVeBmYpLiQEnF9MWGDdRteJREvGDFuc9mwHD",
        "signature": "ed25519:STAcCMqehwXtKTKmgT5ruZU2wuH8H9iqorfY5cHgbxAJvfY77SFcdezgRsx29H9ePLqhtXLB6UhXJ2yPTazsESG",
        "nonce": 276910273000013,
        "priority_fee": 0,
        "signer_id": "owner.proofgate-mw952xad.testnet",
        "public_key": "ed25519:5aGFKSFjSwdEjgrX3u2neepJWpi1SsDEFW8eoZGF5LMg",
        "method_name": "create_job",
        "gas": 30_000_000_000_000,
        "deposit": "100000000000000000000000",
        "args": {
            "job_id": "PG-73D0D44B",
            "beneficiary_id": "beneficiary.proofgate-mw952xad.testnet",
            "expires_at_ns": "1794615324257000000",
        },
    },
    "release_job": {
        "tx_hash": "kkByopop4xEhGqiZhsNGr29GBpNhvzhbFu2pb7GS8kf",
        "signature": "ed25519:2pcZEF7TrfUWQL315Shg5rG4DT969Wd6mgto6nKuCmGf314xG6uLjVwb8iNdRNriaDCfR9CuPWP5REWGuHFpx4QY",
        "nonce": 276910461000005,
        "priority_fee": 0,
        "signer_id": "verifier.proofgate-mw952xad.testnet",
        "public_key": "ed25519:65WmQBDKBr7Ligh7s9ZJV8mn4RZnXh2ALaEgDYSKKWoA",
        "method_name": "release_job",
        "gas": 100_000_000_000_000,
        "deposit": "0",
        "args": {
            "job_id": "PG-73D0D44B",
            "receipt_digest": "sha256:452fe3d48475a868bb1e3d9bdec914d08fa16dbf390747eb3ba1925e8400a09b",
        },
    },
    "refund_expired": {
        "tx_hash": "GTi73Y5Zt6WccKki2C2FJKoGHctLD9E7H5nm8zVygek4",
        "signature": "ed25519:dvHwU3dudXpLKq9auwXsDnx5sDXfCPvowirb4vm8SfmvMJGXTY5497eSjR6S1WMCYfHdNXWkjcEJVe5qM4cm6VK",
        "nonce": 276910273000016,
        "priority_fee": 0,
        "signer_id": "owner.proofgate-mw952xad.testnet",
        "public_key": "ed25519:5aGFKSFjSwdEjgrX3u2neepJWpi1SsDEFW8eoZGF5LMg",
        "method_name": "refund_expired",
        "gas": 100_000_000_000_000,
        "deposit": "0",
        "args": {"job_id": "PG-TESTNET-REFUND-mwflhg9x"},
    },
}

# The canonical-JSON SHA-256 of the committed live receipt; the release
# transaction must commit to exactly this digest.
LIVE_RECEIPT = LIVE_FIXTURES / "proofgate-receipt.json"


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def base58_encode(payload: bytes) -> str:
    number = int.from_bytes(payload, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded
    pad = 0
    for byte in payload:
        if byte:
            break
        pad += 1
    return BASE58_ALPHABET[0] * pad + encoded


def base58_decode(value: str) -> bytes:
    number = 0
    for char in value:
        number = number * 58 + BASE58_ALPHABET.index(char)
    body = number.to_bytes((number.bit_length() + 7) // 8, "big")
    pad = 0
    for char in value:
        if char != BASE58_ALPHABET[0]:
            break
        pad += 1
    return b"\x00" * pad + body


def borsh_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    return len(raw).to_bytes(4, "little") + raw


def borsh_public_key(value: str) -> bytes:
    scheme, _, body = value.partition(":")
    if scheme != "ed25519":
        raise ValueError(f"unsupported key scheme {scheme}")
    raw = base58_decode(body)
    if len(raw) != 32:
        raise ValueError("ed25519 key must decode to 32 bytes")
    return bytes([0]) + raw  # KeyType::ED25519 == 0


def borsh_function_call(action: dict[str, Any]) -> bytes:
    call = action["FunctionCall"]
    args = base64.b64decode(call["args"], validate=True)
    return (
        borsh_string(call["method_name"])
        + len(args).to_bytes(4, "little")
        + args
        + int(call["gas"]).to_bytes(8, "little")
        + int(call["deposit"]).to_bytes(16, "little")
    )


def preimage_candidates(transaction: dict[str, Any], block_hash: bytes) -> list[bytes]:
    """Borsh preimages matching a signing-block hash, per nearcore's Transaction enum.

    TransactionV0 is tagless; TransactionV1 carries a 1_u8 tag and a trailing
    priority_fee. The nonce is plain u64 or the TransactionNonce::Nonce enum.
    The FunctionCall action discriminant is 2. The transaction hash is
    base58(sha256(preimage)) and the Ed25519 signature covers the same bytes.
    """
    actions = transaction["actions"]
    if len(actions) != 1 or "FunctionCall" not in actions[0]:
        raise ValueError("expected exactly one FunctionCall action")
    head = borsh_string(transaction["signer_id"]) + borsh_public_key(transaction["public_key"])
    tail = (1).to_bytes(4, "little") + bytes([2]) + borsh_function_call(actions[0])
    nonce_raw = int(transaction["nonce"]).to_bytes(8, "little")
    priority_fee = int(transaction.get("priority_fee", 0)).to_bytes(8, "little")
    core_tail = borsh_string(transaction["receiver_id"]) + block_hash + tail
    return [
        head + nonce_raw + core_tail,
        head + (bytes([0]) + nonce_raw) + core_tail,
        bytes([1]) + head + nonce_raw + core_tail + priority_fee,
        bytes([1]) + head + (bytes([0]) + nonce_raw) + core_tail + priority_fee,
    ]


class CheckLog:
    def __init__(self) -> None:
        self.checks: dict[str, str] = {}
        self.errors: list[str] = []

    def record(self, name: str, ok: bool, error: str | None = None) -> bool:
        self.checks[name] = "pass" if ok else "fail"
        if not ok:
            self.errors.append(error or f"Check '{name}' failed.")
        return ok


def verify_dump(name: str, log: CheckLog) -> None:
    expected = EXPECTED[name]
    dump_path = EVIDENCE_DIR / f"{name}.tx.json"
    if not log.record(
        f"{name}DumpPresent", dump_path.is_file(), f"Missing {dump_path}."
    ):
        return
    try:
        payload = json.loads(dump_path.read_text(encoding="utf-8"))
        transaction = payload["result"]["transaction"]
        provenance = payload["provenance"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        log.record(f"{name}DumpPresent", False, f"{dump_path.name} is unreadable: {exc}")
        return

    log.record(
        f"{name}SignerAnchored",
        transaction.get("signer_id") == expected["signer_id"] and provenance.get("tx_hash") == expected["tx_hash"],
        f"{name}: signer or provenance tx hash deviates from the audited anchor.",
    )
    log.record(
        f"{name}KeyAnchored",
        transaction.get("public_key") == expected["public_key"],
        f"{name}: transaction public key deviates from the audited account key.",
    )
    log.record(
        f"{name}ReceiverAnchored",
        transaction.get("receiver_id") == CONTRACT_ID,
        f"{name}: transaction was not addressed to the audited escrow contract.",
    )
    try:
        actions = transaction["actions"]
        log.record(
            f"{name}SingleAction",
            len(actions) == 1 and "FunctionCall" in actions[0],
            f"{name}: expected exactly one FunctionCall action.",
        )
        call = actions[0]["FunctionCall"]
        decoded_args = json.loads(base64.b64decode(call["args"], validate=True))
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        log.record(f"{name}SingleAction", False, f"{name}: action structure invalid: {exc}")
        return
    log.record(
        f"{name}CallAnchored",
        call.get("method_name") == expected["method_name"]
        and int(call.get("gas", -1)) == expected["gas"]
        and str(call.get("deposit")) == expected["deposit"]
        and decoded_args == expected["args"],
        f"{name}: method, gas, deposit, or arguments deviate from the audited settlement.",
    )

    try:
        signature = base58_decode(transaction["signature"].split(":", 1)[1])
    except (ValueError, KeyError, IndexError) as exc:
        log.record(f"{name}SignatureShape", False, f"{name}: signature malformed: {exc}")
        return
    log.record(f"{name}SignatureShape", len(signature) == 64, f"{name}: signature is not 64 bytes.")
    log.record(
        f"{name}PinnedBytesAnchored",
        transaction.get("hash") == expected["tx_hash"]
        and transaction.get("signature") == expected["signature"]
        and int(transaction.get("nonce", -1)) == expected["nonce"]
        and int(transaction.get("priority_fee", 0)) == expected["priority_fee"],
        f"{name}: transaction hash, signature, nonce, or priority fee deviate from the audited on-chain record.",
    )
    # Cryptographic verification (Borsh preimage + Ed25519 over the hash)
    # needs the signing block hash, which the RPC view omits; it runs only
    # with --rpc-anchor in verify_signature_against_chain().


def verify_release_digest_binding(log: CheckLog) -> None:
    """The release tx must commit to the digest of the real committed receipt."""
    if not log.record("liveReceiptPresent", LIVE_RECEIPT.is_file(), "Missing committed live receipt."):
        return
    try:
        receipt = json.loads(LIVE_RECEIPT.read_text(encoding="utf-8"))
        digest = "sha256:" + hashlib.sha256(canonical_json(receipt["payload"])).hexdigest()
    except (OSError, ValueError, KeyError, TypeError) as exc:
        log.record("liveReceiptPresent", False, f"Live receipt unreadable: {exc}")
        return
    log.record(
        "releaseDigestMatchesLiveReceipt",
        digest == EXPECTED["release_job"]["args"]["receipt_digest"],
        "The anchored release transaction commits to a different digest than the committed live receipt.",
    )


ANCHOR_RPC_SOURCES = (
    "https://rpc.testnet.near.org",
    "https://archival-rpc.testnet.near.org",
    "https://test.rpc.fastnear.com",
)


def _rpc_call(method: str, params: Any) -> Any:
    """Query the Testnet RPC sources in order; the first answer wins.

    One source being busy (429) or missing an old block must not sink the
    anchor: every source is tried, with backoff against rate limits.
    """
    class RejectRedirect(HTTPRedirectHandler):
        def redirect_request(self, _req: Any, _fp: Any, _code: int, _message: str, _headers: Any, _newurl: str) -> None:
            return None

    body = canonical_json({"jsonrpc": "2.0", "id": "proofgate-anchor", "method": method, "params": params})
    for source in ANCHOR_RPC_SOURCES:
        request = Request(
            source,
            data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        opener = build_opener(RejectRedirect)
        delay = 4.0
        for attempt in range(8):
            try:
                with opener.open(request, timeout=15) as response:
                    payload = json.loads(response.read(2_000_000))
                result = payload.get("result") if isinstance(payload, dict) else None
                if result is not None:
                    return result
                # A well-formed answer that lacks a result (e.g. UNKNOWN_BLOCK
                # on a non-archival node) is a miss for THIS source; try the
                # next one instead of stopping the failover chain.
                break
            except HTTPError as exc:
                if exc.code != 429 or attempt == 7:
                    break
                time.sleep(delay)
                delay = min(delay * 1.8, 60)
            except (URLError, TimeoutError, OSError, json.JSONDecodeError):
                if attempt == 7:
                    break
                time.sleep(delay)
                delay = min(delay * 1.8, 60)
    return None


_BLOCK_CACHE: dict[int, Any] = {}


def _block_by_height(height: int) -> Any:
    # Only successful lookups are cached; failures stay retryable so the
    # second pass can recover heights lost to archival-node throttling.
    if height not in _BLOCK_CACHE:
        block = _rpc_call("block", [height])
        if isinstance(block, dict) and "header" in block:
            _BLOCK_CACHE[height] = block
    return _BLOCK_CACHE.get(height)


def verify_signature_against_chain(name: str, log: CheckLog) -> None:
    """Reconstruct the signing-block preimage from the live archival chain.

    The transaction hash and the Ed25519 signature cover the Borsh encoding
    including the 32-byte signing block hash, which the RPC view omits. The
    script therefore walks the small window of blocks around the transaction's
    outcome block, re-encodes the transaction under each candidate block hash,
    and demands that one candidate reproduces the embedded hash and validates
    the embedded signature under the anchored account key. This ties each dump
    to a transaction that provably existed on Testnet.
    """
    expected = EXPECTED[name]
    try:
        payload = json.loads((EVIDENCE_DIR / f"{name}.tx.json").read_text(encoding="utf-8"))
        transaction = payload["result"]["transaction"]
        outcome_block = payload["result"]["transaction_outcome"]["block_hash"]
    except (OSError, ValueError, KeyError, TypeError):
        return  # the offline checks already flagged this dump
    try:
        # --rpc-anchor is opt-in best-effort: cap each transaction so a
        # throttled archival node degrades to a fail-closed check instead of
        # hanging the auditor for hours.
        deadline = time.monotonic() + 240
        header = _rpc_call("block", [outcome_block])
        if not isinstance(header, dict) or "header" not in header:
            log.record(f"{name}ArchivalReachable", False, "The archival RPC did not return the outcome block.")
            return
        height = header["header"]["height"]
        signature = base58_decode(transaction["signature"].split(":", 1)[1])
        public_key = Ed25519PublicKey.from_public_bytes(base58_decode(expected["public_key"].split(":", 1)[1]))
        verified = False
        # A transaction is signed against a recently final block, typically a
        # few blocks before inclusion; 16 covers finality lag plus retries.
        window = range(height, max(height - 16, 0), -1)
        pending = list(window)
        for attempt in (1, 2):  # second pass retries heights lost to throttling
            if verified or not pending or time.monotonic() > deadline:
                break
            for candidate_height in list(pending):
                if time.monotonic() > deadline:
                    break
                block = _block_by_height(candidate_height)
                if not isinstance(block, dict) or "header" not in block:
                    continue
                pending.remove(candidate_height)
                block_hash = base58_decode(block["header"]["hash"])
                for preimage in preimage_candidates(transaction, block_hash):
                    digest = hashlib.sha256(preimage).digest()
                    if base58_encode(digest) != transaction["hash"]:
                        continue
                    try:
                        # NEAR signs the 32-byte hash of the Borsh encoding,
                        # not the encoding itself (nearcore's CryptoHash).
                        public_key.verify(signature, digest)
                        verified = True
                    except InvalidSignature:
                        pass
                if verified:
                    break
                time.sleep(1.5)  # archival nodes throttle; steady pace wins
        log.record(
            f"{name}SignatureAnchoredOnChain",
            verified,
            f"{name}: no archival block produced a preimage matching the embedded hash and signature.",
        )
    except Exception as exc:  # per-transaction fault isolation; never abort the run
        log.record(
            f"{name}ArchivalReachable",
            False,
            f"{name}: archival anchoring failed: {exc.__class__.__name__}",
        )


def main() -> int:
    global EVIDENCE_DIR, LIVE_RECEIPT
    arguments = sys.argv[1:]
    if "--evidence-dir" in arguments:
        EVIDENCE_DIR = Path(arguments[arguments.index("--evidence-dir") + 1]).resolve()
    if "--live-receipt" in arguments:
        LIVE_RECEIPT = Path(arguments[arguments.index("--live-receipt") + 1]).resolve()
    log = CheckLog()
    anchor = "--rpc-anchor" in arguments
    try:
        for name in EXPECTED:
            verify_dump(name, log)
        verify_release_digest_binding(log)
        if anchor:
            for name in EXPECTED:
                verify_signature_against_chain(name, log)
    except Exception as exc:  # fail closed: no traceback, no exit 0
        log.errors.append(f"unexpected error: {exc.__class__.__name__}")
        log.checks.setdefault("completed", "fail")
    verified = not log.errors and all(value == "pass" for value in log.checks.values()) and bool(log.checks)
    print(json.dumps({"verified": verified, "checks": log.checks, "errors": log.errors}, indent=2, sort_keys=True))
    return 0 if verified else 1


if __name__ == "__main__":
    raise SystemExit(main())
