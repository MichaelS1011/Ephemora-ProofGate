from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


ROOT = Path(__file__).resolve().parents[2]
API_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = ROOT / ".local" / "state"
DATA_DIR = Path(os.environ.get("PROOFGATE_DATA_DIR", DEFAULT_DATA_DIR)).resolve()
DB_PATH = DATA_DIR / "proofgate.sqlite3"

MAX_INPUT_BYTES = 512
MAX_WASM_BYTES = 32 * 1024 * 1024
MAX_FUEL = 300_000
INTERPRETER_FUEL = 1_000_000_000
RUN_TIMEOUT_SECONDS = 15
INTERPRETER_TIMEOUT_SECONDS = 60
EVIDENCE_MAX_AGE = timedelta(seconds=90)
CELL_GUEST_DIR = ROOT / ".local" / "cell-language-guests"

PROGRAMS = {
    "rust": {
        "label": "Rust",
        "kind": "module",
        "path": API_DIR / "examples" / "normalizer-rust.wasm",
        "source": API_DIR / "examples" / "normalizer.rs",
        "compiler": "rustc · wasm32-wasip1",
        "abi": "preview1",
        "profile": "agent-readonly",
        "fuel": MAX_FUEL,
        "memory_bytes": 134_217_728,
        "timeout": RUN_TIMEOUT_SECONDS,
    },
    "c": {
        "label": "C",
        "kind": "module",
        "path": API_DIR / "examples" / "normalizer-c.wasm",
        "source": API_DIR / "examples" / "normalizer.c",
        "compiler": "Zig C compiler · wasm32-wasi",
        "abi": "preview1",
        "profile": "agent-readonly",
        "fuel": MAX_FUEL,
        "memory_bytes": 134_217_728,
        "timeout": RUN_TIMEOUT_SECONDS,
    },
    "zig": {
        "label": "Zig",
        "kind": "module",
        "path": API_DIR / "examples" / "normalizer-zig.wasm",
        "source": API_DIR / "examples" / "normalizer.zig",
        "compiler": "Zig · wasm32-wasi",
        "abi": "preview1",
        "profile": "agent-readonly",
        "fuel": MAX_FUEL,
        "memory_bytes": 134_217_728,
        "timeout": RUN_TIMEOUT_SECONDS,
    },
    "go": {
        "label": "Go",
        "kind": "module",
        "path": API_DIR / "examples" / "normalizer-go.wasm",
        "source": API_DIR / "examples" / "normalizer.go",
        "compiler": "Go · GOOS=wasip1 GOARCH=wasm",
        "abi": "preview1",
        "profile": "build-tool",
        "fuel": 100_000_000,
        "memory_bytes": 536_870_912,
        "timeout": 30,
        "disk_quota_bytes": 1_073_741_824,
        "io_budget_bytes": 268_435_456,
    },
    "assemblyscript": {
        "label": "AssemblyScript",
        "kind": "module",
        "path": API_DIR / "examples" / "normalizer-assemblyscript.wasm",
        "source": API_DIR / "examples" / "normalizer.ts",
        "compiler": "AssemblyScript · asc --runtime stub",
        "abi": "preview1",
        "profile": "agent-readonly",
        "fuel": MAX_FUEL,
        "memory_bytes": 134_217_728,
        "timeout": RUN_TIMEOUT_SECONDS,
    },
    "python": {
        "label": "Python",
        "kind": "source-guest",
        "path": Path(os.environ.get("PROOFGATE_PYTHON_GUEST", CELL_GUEST_DIR / "python-guest.wasm")).expanduser().resolve(),
        "source": API_DIR / "examples" / "normalizer.py",
        "compiler": "CPython 3.14 · Cell WASI 0.2 component guest",
        "abi": "component",
        "profile": "interpreter",
        "fuel": INTERPRETER_FUEL,
        "memory_bytes": 1_073_741_824,
        "timeout": INTERPRETER_TIMEOUT_SECONDS,
        "input_mode": "stdin",
        "guest_sha256": "42984274746ee96e9855049f5d0370b9515fa13e4ce9610c29083c9a8a558935",
    },
    "javascript": {
        "label": "JavaScript",
        "kind": "source-guest",
        "path": Path(os.environ.get("PROOFGATE_JAVASCRIPT_GUEST", CELL_GUEST_DIR / "javascript-guest.wasm")).expanduser().resolve(),
        "source": API_DIR / "examples" / "normalizer.js",
        "compiler": "QuickJS-ng 0.14.0 · Cell WASI Preview1 guest",
        "abi": "preview1",
        "profile": "interpreter",
        "fuel": INTERPRETER_FUEL,
        "memory_bytes": 1_073_741_824,
        "timeout": INTERPRETER_TIMEOUT_SECONDS,
        "input_mode": "json-file",
        "guest_sha256": "53037972a42c1c562dad6a5162a40e41d16e8b9b9d42f1494e1540a367fe5646",
    },
}
CELL_BIN = os.environ.get("EPHEMORA_BIN") or shutil.which("ephemora") or ""
CELL_PRIVATE_KEY = os.environ.get("PROOFGATE_CELL_SIGNING_KEY", "")
CELL_PUBLIC_KEY = os.environ.get("PROOFGATE_CELL_PUBLIC_KEY", "")
RECEIPT_PRIVATE_KEY = os.environ.get("PROOFGATE_RECEIPT_SIGNING_KEY", "")
RECEIPT_PUBLIC_KEY = os.environ.get("PROOFGATE_RECEIPT_PUBLIC_KEY", "")
PORT = int(os.environ.get("PROOFGATE_PORT", "8000"))
NEAR_TESTNET_RPC_URL = os.environ.get("NEAR_TESTNET_RPC_URL", "https://archival-rpc.testnet.near.org")
ALLOWED_ORIGINS = {
    "http://127.0.0.1:4173",
    "http://127.0.0.1:4174",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://localhost:4174",
    "http://localhost:5173",
}
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}

BASE_POLICY = {
    "id": "proofgate-normalize-v1",
    "ioBudgetBytes": 67_108_864,
    "ioCpuSeconds": 2,
    "diskQuotaBytes": 268_435_456,
    "maxInputBytes": MAX_INPUT_BYTES,
    "maxModuleBytes": MAX_WASM_BYTES,
    "executionMode": "subprocess",
    "allowedCapabilities": ["stdin", "stdout", "ephemeral per-run sandbox"],
    "deniedCapabilities": ["ambient host filesystem", "network", "process spawning", "environment variables"],
}


def policy_for(language: str) -> dict[str, Any]:
    program = PROGRAMS[language]
    policy = {
        **BASE_POLICY,
        "runtimeProfile": program["profile"],
        "fuelLimit": program["fuel"],
        "memoryLimitBytes": program["memory_bytes"],
        "timeoutSeconds": program["timeout"],
        "ioBudgetBytes": program.get("io_budget_bytes", BASE_POLICY["ioBudgetBytes"]),
        "ioCpuSeconds": 30 if program["profile"] == "interpreter" else 10 if program["profile"] == "build-tool" else 2,
        "diskQuotaBytes": program.get("disk_quota_bytes", BASE_POLICY["diskQuotaBytes"]),
        "abi": program["abi"],
        "language": language,
        "compiler": program["compiler"],
        "source": "ProofGate reviewed sample catalog",
    }
    if program["kind"] == "source-guest":
        policy["interpreterGuestSha256"] = program["guest_sha256"]
    return policy


def policy_digest(policy: dict[str, Any]) -> str:
    return sha256_hex(canonical_json(policy))


INPUT_PATTERN = re.compile(r"^[A-Za-z0-9 \t\r\n.,_-]*$")
_health_cache: tuple[datetime, dict[str, Any]] | None = None
_health_lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def timestamp(value: datetime | None = None) -> str:
    return (value or now_utc()).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def db_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    if DB_PATH.exists():
        os.chmod(DB_PATH, 0o600)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize_database() -> None:
    with db_connection() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                job_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                job_name TEXT NOT NULL,
                input_text TEXT NOT NULL,
                reward TEXT NOT NULL,
                beneficiary TEXT NOT NULL,
                language TEXT NOT NULL,
                nonce TEXT NOT NULL UNIQUE,
                policy_json TEXT NOT NULL,
                policy_digest TEXT NOT NULL,
                state TEXT NOT NULL,
                run_id TEXT,
                output_json TEXT,
                cell_report_id TEXT,
                receipt_json TEXT,
                cell_evidence_json TEXT,
                error_code TEXT,
                error_message TEXT
            );
            CREATE TABLE IF NOT EXISTS accepted_reports (
                report_id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL UNIQUE REFERENCES jobs(job_id),
                accepted_at TEXT NOT NULL
            );
            """
        )
        columns = {item["name"] for item in db.execute("PRAGMA table_info(jobs)").fetchall()}
        if "language" not in columns:
            db.execute("ALTER TABLE jobs ADD COLUMN language TEXT NOT NULL DEFAULT 'rust'")


def row_to_job(row: sqlite3.Row) -> dict[str, Any]:
    language = row["language"]
    language_info = PROGRAMS.get(language, {"label": language, "compiler": "unknown"})
    return {
        "id": row["job_id"],
        "name": row["job_name"],
        "input": row["input_text"],
        "reward": row["reward"],
        "beneficiary": row["beneficiary"],
        "language": language,
        "languageLabel": language_info["label"],
        "compiler": language_info["compiler"],
        "abi": language_info.get("abi", "unknown"),
        "runtimeProfile": json.loads(row["policy_json"]).get("runtimeProfile", "unknown"),
        "state": row["state"],
        "createdAt": row["created_at"],
        "runId": row["run_id"],
        "output": json.loads(row["output_json"]) if row["output_json"] else None,
        "reportId": row["cell_report_id"],
        "policy": json.loads(row["policy_json"]),
        "policyDigest": row["policy_digest"],
        "error": {"code": row["error_code"], "message": row["error_message"]} if row["error_code"] else None,
        "settlement": "Not funded",
        "demo": False,
    }


def get_job(job_id: str) -> sqlite3.Row:
    with db_connection() as db:
        row = db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    if row is None:
        raise ApiError(404, "Job not found.")
    return row


def _configured_path(value: str, label: str) -> Path:
    if not value:
        raise ApiError(503, f"{label} is not configured.")
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ApiError(503, f"{label} file is unavailable.")
    return path


def _load_private_key(value: str, label: str) -> Ed25519PrivateKey:
    path = _configured_path(value, label)
    try:
        key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    except (ValueError, TypeError) as exc:
        raise ApiError(503, f"{label} is not a readable PEM key.") from exc
    if not isinstance(key, Ed25519PrivateKey):
        raise ApiError(503, f"{label} must be an Ed25519 private key.")
    return key


def _load_public_key(value: str, label: str) -> Ed25519PublicKey:
    path = _configured_path(value, label)
    try:
        key = serialization.load_pem_public_key(path.read_bytes())
    except (ValueError, TypeError) as exc:
        raise ApiError(503, f"{label} is not a readable PEM key.") from exc
    if not isinstance(key, Ed25519PublicKey):
        raise ApiError(503, f"{label} must be an Ed25519 public key.")
    return key


def _key_id(key: Ed25519PublicKey) -> str:
    raw = key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return sha256_hex(raw)[:16]


def _key_pair_matches(private_path: str, public_path: str, label: str) -> bool:
    private_key = _load_private_key(private_path, f"{label} private key")
    public_key = _load_public_key(public_path, f"{label} public key")
    return _key_id(private_key.public_key()) == _key_id(public_key)


def _cell_health(force: bool = False) -> dict[str, Any]:
    global _health_cache
    with _health_lock:
        if not force and _health_cache and now_utc() - _health_cache[0] < timedelta(seconds=30):
            return dict(_health_cache[1])
        if not CELL_BIN:
            result = {"connected": False, "cell": {"available": False, "detail": "Set EPHEMORA_BIN to the Cell CLI."}}
            _health_cache = (now_utc(), result)
            return result
        try:
            doctor = subprocess.run(
                [CELL_BIN, "doctor", "--json"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            report = json.loads(doctor.stdout)
            runtime = next((item for item in report.get("checks", []) if item.get("name") == "runtime-identity"), {})
            smoke = next((item for item in report.get("checks", []) if item.get("name") == "smoke-run"), {})
            language_guests = next((item for item in report.get("checks", []) if item.get("name") == "language-guests"), {})
            cell = {
                "available": doctor.returncode == 0 and report.get("ok") is True,
                "version": next((item.get("data", {}).get("version") for item in report.get("checks", []) if item.get("name") == "package"), None),
                "runtime": next((item.get("data", {}).get("version") for item in report.get("checks", []) if item.get("name") == "runtime-import"), None),
                "runtimeIdentity": runtime.get("data", {}).get("match") is True,
                "smokeRun": smoke.get("data", {}).get("status") == "success",
                "platform": next((item.get("detail") for item in report.get("checks", []) if item.get("name") == "platform"), None),
                "interpreterGuests": language_guests.get("data", {}).get("guests", {}),
            }
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
            cell = {"available": False, "detail": "Cell health check did not complete."}
        try:
            keys = _key_pair_matches(CELL_PRIVATE_KEY, CELL_PUBLIC_KEY, "Cell evidence") and _key_pair_matches(
                RECEIPT_PRIVATE_KEY, RECEIPT_PUBLIC_KEY, "ProofGate receipt"
            )
        except (ApiError, OSError):
            keys = False
        result = {"connected": cell.get("available") is True and keys, "cell": cell, "signersConfigured": keys}
        _health_cache = (now_utc(), result)
        return dict(result)


def health_report(force: bool = False) -> dict[str, Any]:
    status = _cell_health(force=force)
    runnable_languages = [
        {
            "id": language,
            "label": program["label"],
            "source": program["source"].name,
            "compiler": program["compiler"],
            "available": program["source"].is_file() and _program_artifact_available(program),
            "abi": "WASI 0.2 component" if program["abi"] == "component" else "WASI Preview1",
            "runtimeProfile": program["profile"],
        }
        for language, program in PROGRAMS.items()
    ]
    return {
        "service": "ProofGate local API",
        "mode": "local-preview",
        "connected": status["connected"],
        "cell": status["cell"],
        "signersConfigured": status["signersConfigured"],
        "network": "NEAR Testnet RPC is available by explicit read-only check; no contract is configured",
        "runnableLanguages": runnable_languages,
        "interpreterLanguages": [
            {
                "id": language,
                "label": PROGRAMS[language]["label"],
                "available": _program_artifact_available(PROGRAMS[language]),
                "detail": _interpreter_guest_status(PROGRAMS[language]),
            }
            for language in ("python", "javascript")
        ],
        "demo": False,
    }


def near_testnet_status() -> dict[str, Any]:
    parsed = urlparse(NEAR_TESTNET_RPC_URL)
    allowed_hosts = {"archival-rpc.testnet.near.org", "test.rpc.fastnear.com"}
    if parsed.scheme != "https" or parsed.hostname not in allowed_hosts or parsed.port:
        raise ApiError(503, "The configured NEAR endpoint is not an approved Testnet RPC host.")

    request_body = canonical_json({"jsonrpc": "2.0", "id": "proofgate-status", "method": "status", "params": []})
    request = Request(
        NEAR_TESTNET_RPC_URL,
        data=request_body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    class RejectRedirect(HTTPRedirectHandler):
        def redirect_request(self, _req: Any, _fp: Any, _code: int, _message: str, _headers: Any, _newurl: str) -> None:
            return None

    try:
        with build_opener(RejectRedirect).open(request, timeout=8) as response:
            response_json = json.loads(response.read(256_000))
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise ApiError(503, "NEAR Testnet RPC did not return a valid status response.") from exc

    result = response_json.get("result") if isinstance(response_json, dict) else None
    if not isinstance(result, dict) or result.get("chain_id") != "testnet":
        raise ApiError(502, "The configured NEAR RPC did not identify itself as Testnet.")
    sync_info = result.get("sync_info") if isinstance(result.get("sync_info"), dict) else {}
    return {
        "connected": True,
        "readOnly": True,
        "chainId": result["chain_id"],
        "protocolVersion": result.get("protocol_version"),
        "latestBlockHeight": sync_info.get("latest_block_height"),
        "latestBlockTime": sync_info.get("latest_block_time"),
        "syncing": sync_info.get("syncing"),
        "provider": parsed.hostname,
        "checkedAt": timestamp(),
    }


def list_jobs() -> list[dict[str, Any]]:
    with db_connection() as db:
        rows = db.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
    return [row_to_job(row) for row in rows]


def create_job(payload: dict[str, Any]) -> dict[str, Any]:
    name = payload.get("name")
    input_text = payload.get("input")
    reward = str(payload.get("reward", "0.10"))
    beneficiary = str(payload.get("beneficiary", "local-agent.testnet"))
    language = payload.get("language", "rust")
    if not isinstance(language, str) or language not in PROGRAMS:
        raise ApiError(400, "Choose a runnable language from the local catalog.")
    if not PROGRAMS[language]["source"].is_file() or not _program_artifact_available(PROGRAMS[language]):
        raise ApiError(503, f"The {PROGRAMS[language]['label']} guest is not built. Run apps/api/build_guests.sh.")
    if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80:
        raise ApiError(400, "Job name must contain 2 to 80 characters.")
    if not isinstance(input_text, str):
        raise ApiError(400, "Input must be text.")
    try:
        encoded = input_text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise ApiError(400, "Input must contain valid UTF-8 text.") from exc
    if len(encoded) > MAX_INPUT_BYTES:
        raise ApiError(400, f"Input must be {MAX_INPUT_BYTES} bytes or smaller.")
    if not INPUT_PATTERN.fullmatch(input_text):
        raise ApiError(400, "This sample accepts ASCII letters, numbers, whitespace, periods, commas, underscores, and hyphens.")
    try:
        reward_value = float(reward)
    except ValueError as exc:
        raise ApiError(400, "Sample reward must be a number.") from exc
    if not (0 < reward_value <= 10):
        raise ApiError(400, "Sample reward must be greater than 0 and no more than 10 NEAR.")
    if not re.fullmatch(r"[a-z0-9._-]{2,64}", beneficiary):
        raise ApiError(400, "Beneficiary must be a lowercase NEAR-style account name.")

    job_id = f"PG-{uuid.uuid4().hex[:8].upper()}"
    nonce = uuid.uuid4().hex
    created = timestamp()
    job_policy = policy_for(language)
    job_policy_digest = policy_digest(job_policy)
    with db_connection() as db:
        db.execute(
            "INSERT INTO jobs (job_id, created_at, job_name, input_text, reward, beneficiary, language, nonce, policy_json, policy_digest, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, created, name.strip(), input_text, f"{reward_value:.2f}", beneficiary, language, nonce, json.dumps(job_policy, sort_keys=True), job_policy_digest, "Ready"),
        )
    return row_to_job(get_job(job_id))


def _parse_cell_report(envelope: dict[str, Any]) -> dict[str, Any]:
    if envelope.get("payloadType") != "https://ephemora.dev/execution-report.v1":
        raise ApiError(422, "Cell evidence payload type is not supported.")
    payload = envelope.get("payload")
    if not isinstance(payload, str):
        raise ApiError(422, "Cell evidence has no payload.")
    try:
        report = json.loads(base64.b64decode(payload, validate=True))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ApiError(422, "Cell evidence payload is malformed.") from exc
    if not isinstance(report, dict):
        raise ApiError(422, "Cell evidence report is not an object.")
    return report


def _expected_normalized(input_text: str) -> dict[str, Any]:
    normalized = " ".join(input_text.split()).lower()
    return {"normalized": normalized, "wordCount": len(normalized.split())}


def _program_artifact_available(program: dict[str, Any]) -> bool:
    path = program["path"]
    if not path.is_file():
        return False
    if program["kind"] != "source-guest":
        return True
    try:
        return sha256_hex(path.read_bytes()) == program["guest_sha256"]
    except OSError:
        return False


def _interpreter_guest_status(program: dict[str, Any]) -> str:
    if not program["path"].is_file():
        return "Install the matching Cell interpreter guest and set its path."
    if not _program_artifact_available(program):
        return "Interpreter guest digest does not match the reviewed artifact."
    return "Reviewed guest is installed and its SHA-256 digest matches."


def _validate_report(report: dict[str, Any], job: sqlite3.Row, program: dict[str, Any], work_dir: Path) -> None:
    evidence = report.get("evidence")
    baseline = report.get("security_baseline")
    if not isinstance(evidence, dict) or evidence.get("schema") != "ephemora-execution-evidence.v1":
        raise ApiError(422, "Cell evidence schema is not accepted by this verifier.")
    if report.get("status") != "success" or report.get("exit_code") != 0:
        raise ApiError(422, "Cell did not report a successful execution.")
    if not isinstance(baseline, dict):
        raise ApiError(422, "Cell evidence has no security baseline.")
    interpreter = program["profile"] == "interpreter"
    language = job["language"]
    if language == "python":
        expected_preopens = [str(work_dir.resolve())]
    elif language == "javascript":
        expected_preopens = [str(work_dir.resolve()), "/sandbox"]
    else:
        expected_preopens = ["/sandbox"]
    expected_baseline = {
        "wasmtime_version": "50.0.1",
        "fuel": program["fuel"],
        "memory_limit_bytes": program["memory_bytes"],
        "io_budget_bytes": program.get("io_budget_bytes", BASE_POLICY["ioBudgetBytes"]),
        "io_cpu_seconds": 30 if interpreter else 10 if program["profile"] == "build-tool" else 2,
        "disk_quota_bytes": program.get("disk_quota_bytes", BASE_POLICY["diskQuotaBytes"]),
        "max_wasm_bytes": MAX_WASM_BYTES,
        "max_wasm_bytes_unlimited": False,
        "threads_enabled": False,
        "memory64": False,
        "exceptions_enabled": False,
        "function_references_enabled": False,
        "gc_enabled": False,
        "gc_heap_mb": None,
        "multi_memory": False,
        "stack_switching_enabled": False,
        "tail_calls_enabled": False,
        "sync_blockade_enforced": language != "python",
        "allow_fsync": language == "python",
        "allow_env_names": [],
        "preopens": expected_preopens,
        "execution_mode": "subprocess",
        "abi": program["abi"],
        "tenant": job["job_id"],
    }
    mismatches = [key for key, value in expected_baseline.items() if baseline.get(key) != value]
    if mismatches:
        raise ApiError(422, "Cell evidence does not match the required runtime policy: " + ", ".join(mismatches) + ".")
    if report.get("fuel_budget") != program["fuel"]:
        raise ApiError(422, "Cell report fuel budget does not match the job policy.")
    if evidence.get("tool") != f"normalizer-{language}.wasm":
        raise ApiError(422, "Cell evidence tool name does not match the selected language artifact.")
    if report.get("warnings") not in (None, []):
        raise ApiError(422, "Cell reported warnings for this execution.")
    report_id = evidence.get("report_id")
    if not isinstance(report_id, str) or not re.fullmatch(r"[a-f0-9]{32}", report_id):
        raise ApiError(422, "Cell report ID is malformed.")
    try:
        issued = datetime.fromisoformat(str(evidence.get("issued_at")).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ApiError(422, "Cell evidence issue time is malformed.") from exc
    if issued.tzinfo is None or now_utc() - issued > EVIDENCE_MAX_AGE or issued - now_utc() > timedelta(seconds=10):
        raise ApiError(422, "Cell evidence is stale or has an invalid issue time.")
    fuel = report.get("fuel_consumed")
    if isinstance(fuel, bool) or not isinstance(fuel, int) or fuel < 0 or fuel > program["fuel"]:
        raise ApiError(422, "Cell execution exceeded the approved fuel limit.")


def run_job(job_id: str) -> dict[str, Any]:
    health = health_report()
    if not health["connected"]:
        raise ApiError(503, "Cell or local signing keys are unavailable. Check the local API setup.")

    cell_signing_key = _configured_path(CELL_PRIVATE_KEY, "Cell evidence signing key")
    cell_public_key = _configured_path(CELL_PUBLIC_KEY, "Cell evidence trusted public key")
    receipt_signing_key = _load_private_key(RECEIPT_PRIVATE_KEY, "ProofGate receipt signing key")
    receipt_public_key = _load_public_key(RECEIPT_PUBLIC_KEY, "ProofGate receipt public key")
    receipt_key_id = _key_id(receipt_public_key)
    run_id = str(uuid.uuid4())

    with db_connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
        if row is None:
            db.rollback()
            raise ApiError(404, "Job not found.")
        if row["state"] != "Ready":
            db.rollback()
            raise ApiError(409, "This job has already been run or is not ready.")
        db.execute("UPDATE jobs SET state = 'Executing', run_id = ? WHERE job_id = ?", (run_id, job_id))
        db.commit()

    job = get_job(job_id)
    try:
        guest = PROGRAMS.get(job["language"])
        if guest is None or not _program_artifact_available(guest) or not guest["source"].is_file():
            _set_blocked(job_id, "guest_unavailable", "The selected language guest is no longer available.")
            raise ApiError(503, "The selected language guest is no longer available.")
        guest_bytes = guest["path"].read_bytes()
        expected_magic = b"\0asm\r\0\x01\0" if guest["abi"] == "component" else b"\0asm\x01\0\0\0"
        if len(guest_bytes) > MAX_WASM_BYTES or not guest_bytes.startswith(expected_magic):
            _set_blocked(job_id, "guest_invalid", "The selected language artifact is not a supported WebAssembly v1 module.")
            raise ApiError(503, "The selected language artifact is not a supported WebAssembly v1 module.")
        with tempfile.TemporaryDirectory(prefix="proofgate-cell-") as temporary:
            work = Path(temporary)
            module_path = work / f"normalizer-{job['language']}.wasm"
            source_dir = work / "source"
            source_dir.mkdir(mode=0o700)
            input_path = work / "job-input.txt"
            evidence_path = work / "cell-evidence.dsse.json"
            tenant_book = DATA_DIR / "tenant-books" / f"{job_id}.jsonl"
            tenant_book.parent.mkdir(parents=True, exist_ok=True)
            module_path.write_bytes(guest_bytes)
            input_path.write_text(job["input_text"], encoding="utf-8")
            source_bytes = guest["source"].read_bytes()
            if guest["kind"] == "source-guest":
                if guest["input_mode"] == "stdin":
                    (source_dir / "main.py").write_bytes(source_bytes)
                elif guest["input_mode"] == "json-file":
                    (source_dir / "main.js").write_bytes(source_bytes)
                    (source_dir / "input.json").write_bytes(canonical_json({"text": job["input_text"]}))
            command = [
                CELL_BIN, "run", str(module_path), "--stdin", str(input_path),
                "--trust", "untrusted", "--profile", guest["profile"],
                "--fuel", str(guest["fuel"]), "--memory-mb", str(guest["memory_bytes"] // (1024 * 1024)),
                "--timeout", str(guest["timeout"]), "--max-wasm-bytes", str(MAX_WASM_BYTES),
                "--abi", guest["abi"], "--json",
                "--tenant", job_id, "--tenant-book", str(tenant_book),
                "--evidence", str(evidence_path), "--evidence-key", str(cell_signing_key),
            ]
            if guest["kind"] == "source-guest":
                command.extend(["--allow-dirs", f"{source_dir}::/work"])
            if job["language"] == "python":
                command.append("--allow-fsync")
            # Keep service key paths and other application secrets out of the
            # Cell CLI environment. The guest also receives no WASI env names.
            child_env = {
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "HOME": os.environ.get("HOME", str(Path.home())),
                "TMPDIR": str(work),
                "LANG": "C.UTF-8",
                "PYTHONUNBUFFERED": "1",
            }
            process = subprocess.run(
                command,
                cwd=work,
                capture_output=True,
                text=True,
                timeout=guest["timeout"] + 12,
                check=False,
                env=child_env,
            )
            if process.returncode != 0 or not evidence_path.is_file():
                detail = "Cell run failed or did not produce signed evidence."
                _set_blocked(job_id, "cell_run_failed", detail)
                raise ApiError(422, detail)

            verify = subprocess.run(
                [CELL_BIN, "verify", str(evidence_path), "--key", str(cell_public_key), "--expect", f"tenant={job_id}", "--json"],
                cwd=work,
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            try:
                verdict = json.loads(verify.stdout)
            except json.JSONDecodeError as exc:
                _set_blocked(job_id, "verifier_unavailable", "Cell evidence verifier returned an unreadable result.")
                raise ApiError(503, "Cell evidence verifier returned an unreadable result.") from exc
            if verify.returncode != 0 or verdict.get("verified") is not True or verdict.get("errors"):
                _set_blocked(job_id, "cell_signature_rejected", "Cell evidence signature or job binding was rejected.")
                raise ApiError(422, "Cell evidence signature or job binding was rejected.")

            envelope_bytes = evidence_path.read_bytes()
            envelope = json.loads(envelope_bytes)
            report = _parse_cell_report(envelope)
            _validate_report(report, job, guest, source_dir)
            output_lines = re.findall(r"^RESULT_JSON:(.+)$", process.stderr, flags=re.MULTILINE)
            if len(output_lines) != 1:
                _set_blocked(job_id, "output_unavailable", "The expected bounded output was not observed exactly once.")
                raise ApiError(422, "The expected bounded output was not observed exactly once.")
            try:
                output = json.loads(output_lines[0])
            except json.JSONDecodeError as exc:
                _set_blocked(job_id, "output_invalid", "The Cell output was not valid JSON.")
                raise ApiError(422, "The Cell output was not valid JSON.") from exc
            expected_output = _expected_normalized(job["input_text"])
            if output != expected_output:
                _set_blocked(job_id, "output_mismatch", "The output did not match the job's expected normalization.")
                raise ApiError(422, "The output did not match the job's expected normalization.")

            report_id = report["evidence"]["report_id"]
            with db_connection() as db:
                existing = db.execute("SELECT 1 FROM accepted_reports WHERE report_id = ?", (report_id,)).fetchone()
            if existing:
                _set_blocked(job_id, "replay", "This Cell report ID has already been accepted.")
                raise ApiError(409, "This Cell report ID has already been accepted.")

            issued_at = report["evidence"]["issued_at"]
            program_digest = sha256_hex(guest_bytes)
            source_digest = sha256_hex(source_bytes)
            input_digest = sha256_hex(job["input_text"].encode("utf-8"))
            output_bytes = canonical_json(output)
            cell_evidence_digest = sha256_hex(envelope_bytes)
            receipt_payload = {
                "schema": "proofgate-receipt.v1",
                "jobId": job_id,
                "runId": run_id,
                "nonce": job["nonce"],
                "runtimeVersion": report["security_baseline"]["wasmtime_version"],
                "runtimeProfile": guest["profile"],
                "language": job["language"],
                "abi": guest["abi"],
                "compiler": guest["compiler"],
                "programDigest": f"sha256:{program_digest}",
                "sourceDigest": f"sha256:{source_digest}",
                "guestSha256": f"sha256:{program_digest}",
                "inputDigest": f"sha256:{input_digest}",
                "outputDigest": f"sha256:{sha256_hex(output_bytes)}",
                "policyDigest": f"sha256:{job['policy_digest']}",
                "cellEvidenceDigest": f"sha256:{cell_evidence_digest}",
                "cellReportId": report_id,
                "cellSignerKeyId": _key_id(_load_public_key(CELL_PUBLIC_KEY, "Cell evidence trusted public key")),
                "result": "success",
                "resourceUsage": {"fuel": report["fuel_consumed"], "memoryMb": report.get("memory_mb")},
                "issuedAt": timestamp(),
                "cellIssuedAt": issued_at,
                "beneficiary": job["beneficiary"],
                "reward": job["reward"],
                "asset": "NEAR",
                "decision": "verified; not paid",
                "limitations": [
                    "The signature authenticates an operator report, not host integrity or arbitrary program correctness.",
                    "The Cell host report does not itself contain the input or output digest; ProofGate binds the bytes observed by this local service.",
                    "The language label identifies the reviewed local build artifact; Cell attests the module run, not source-language semantics.",
                    "No NEAR contract or transaction is connected in this local preview.",
                ],
            }
            signature = base64.b64encode(receipt_signing_key.sign(canonical_json(receipt_payload))).decode("ascii")
            signed_receipt = {
                "payload": receipt_payload,
                "signatures": [{"keyId": receipt_key_id, "algorithm": "Ed25519", "signature": signature}],
            }
            try:
                receipt_public_key.verify(base64.b64decode(signature), canonical_json(receipt_payload))
            except Exception as exc:
                _set_blocked(job_id, "receipt_signature_failed", "ProofGate could not verify its own receipt signature.")
                raise ApiError(500, "ProofGate could not verify its own receipt signature.") from exc

            with db_connection() as db:
                db.execute("BEGIN IMMEDIATE")
                db.execute(
                    "INSERT INTO accepted_reports (report_id, job_id, accepted_at) VALUES (?, ?, ?)",
                    (report_id, job_id, timestamp()),
                )
                db.execute(
                    "UPDATE jobs SET state = 'Verified', output_json = ?, cell_report_id = ?, receipt_json = ?, cell_evidence_json = ?, error_code = NULL, error_message = NULL WHERE job_id = ? AND state = 'Executing'",
                    (json.dumps(output, sort_keys=True), report_id, json.dumps(signed_receipt, sort_keys=True), envelope_bytes.decode("utf-8"), job_id),
                )
                db.commit()
            return {"job": row_to_job(get_job(job_id)), "receipt": signed_receipt, "cellEvidence": envelope, "demo": False}
    except ApiError as exc:
        _set_blocked(job_id, "verification_rejected", exc.message)
        raise
    except subprocess.TimeoutExpired as exc:
        _set_blocked(job_id, "cell_timeout", "Cell did not finish within the configured time limit.")
        raise ApiError(422, "Cell did not finish within the configured time limit.") from exc
    except (OSError, sqlite3.Error, ValueError, TypeError) as exc:
        _set_blocked(job_id, "verification_error", "ProofGate could not validate the execution evidence.")
        raise ApiError(500, "ProofGate could not validate the execution evidence.") from exc


def _set_blocked(job_id: str, code: str, message: str) -> None:
    with db_connection() as db:
        db.execute(
            "UPDATE jobs SET state = 'Blocked', error_code = ?, error_message = ? WHERE job_id = ? AND state = 'Executing'",
            (code, message, job_id),
        )


def get_receipt(job_id: str) -> dict[str, Any]:
    row = get_job(job_id)
    if not row["receipt_json"]:
        raise ApiError(404, "No accepted receipt exists for this job.")
    receipt = json.loads(row["receipt_json"])
    envelope = json.loads(row["cell_evidence_json"])
    return {"receipt": receipt, "cellEvidence": envelope, "demo": False}


class Handler(BaseHTTPRequestHandler):
    server_version = "ProofGateLocal/0.1"
    sys_version = ""

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _headers(self, status: int, length: int, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send(self, status: int, value: Any) -> None:
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._headers(status, len(data))
        self.wfile.write(data)

    def _request_context_allowed(self) -> bool:
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin")
        if host not in ALLOWED_HOSTS or (origin is not None and origin not in ALLOWED_ORIGINS):
            self._send(403, {"error": "Requests are accepted only from the local ProofGate interface."})
            return False
        return True

    def _body(self) -> dict[str, Any]:
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ApiError(400, "Content-Length is invalid.") from exc
        if size <= 0 or size > 12_000:
            raise ApiError(413, "Request body must be between 1 and 12,000 bytes.")
        try:
            value = json.loads(self.rfile.read(size))
        except json.JSONDecodeError as exc:
            raise ApiError(400, "Request body must be JSON.") from exc
        if not isinstance(value, dict):
            raise ApiError(400, "Request body must be a JSON object.")
        return value

    def do_OPTIONS(self) -> None:
        if not self._request_context_allowed():
            return
        self._headers(204, 0)

    def do_GET(self) -> None:
        try:
            if not self._request_context_allowed():
                return
            parts = [part for part in self.path.split("?", 1)[0].strip("/").split("/") if part]
            if parts == ["api", "health"]:
                return self._send(200, health_report())
            if parts == ["api", "near", "status"]:
                return self._send(200, near_testnet_status())
            if parts == ["api", "jobs"]:
                return self._send(200, {"jobs": list_jobs(), "demo": False})
            if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
                return self._send(200, {"job": row_to_job(get_job(parts[2]))})
            if len(parts) == 4 and parts[:2] == ["api", "jobs"] and parts[3] == "receipt":
                return self._send(200, get_receipt(parts[2]))
            if parts == ["api", "keys"]:
                public = _load_public_key(RECEIPT_PUBLIC_KEY, "ProofGate receipt public key")
                pem = public.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode("ascii")
                return self._send(200, {"keyId": _key_id(public), "algorithm": "Ed25519", "publicKeyPem": pem})
            return self._send(404, {"error": "Route not found."})
        except ApiError as exc:
            return self._send(exc.status, {"error": exc.message})
        except Exception:
            return self._send(500, {"error": "The local API could not complete the request."})

    def do_POST(self) -> None:
        try:
            if not self._request_context_allowed():
                return
            parts = [part for part in self.path.split("?", 1)[0].strip("/").split("/") if part]
            if parts == ["api", "jobs"]:
                return self._send(201, {"job": create_job(self._body()), "demo": False})
            if len(parts) == 4 and parts[:2] == ["api", "jobs"] and parts[3] == "run":
                if int(self.headers.get("Content-Length", "0")) != 0:
                    return self._send(400, {"error": "Run requests do not accept a body."})
                return self._send(200, run_job(parts[2]))
            return self._send(404, {"error": "Route not found."})
        except ApiError as exc:
            return self._send(exc.status, {"error": exc.message})
        except Exception:
            return self._send(500, {"error": "The local API could not complete the request."})


def main() -> None:
    initialize_database()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"ProofGate local API listening on http://127.0.0.1:{PORT}")
    print("This service binds to loopback and is not hardened for public-network exposure.")
    server.serve_forever()


if __name__ == "__main__":
    main()
