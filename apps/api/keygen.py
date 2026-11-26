from __future__ import annotations

import argparse
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _create_exclusive(path: Path, payload: bytes, mode: int) -> None:
    # Create atomically with the final mode from the first byte onward: no
    # world-readable window, and a pre-created path — including a planted
    # symlink — is refused instead of followed.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, "wb") as handle:
        handle.write(payload)


def write_pair(directory: Path, stem: str) -> None:
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    private_path = directory / f"{stem}-private.pem"
    public_path = directory / f"{stem}-public.pem"
    private_bytes = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    _create_exclusive(private_path, private_bytes, 0o600)
    _create_exclusive(
        public_path,
        public.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo),
        0o644,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Create local-only development signing keys.")
    parser.add_argument("--out", type=Path, default=Path(".local/devkeys"))
    args = parser.parse_args()
    args.out.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(args.out, 0o700)
    try:
        write_pair(args.out, "cell-evidence")
        write_pair(args.out, "proofgate-receipt")
    except FileExistsError as exc:
        parser.exit(1, f"Refusing to overwrite existing key file: {exc.filename}. Remove it first if regeneration is intended.\n")
    print(f"Development keys created under {args.out.resolve()}")
    print("Private keys are restricted to the current user. Do not use these keys for production or NEAR accounts.")


if __name__ == "__main__":
    main()
