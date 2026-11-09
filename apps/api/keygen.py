from __future__ import annotations

import argparse
import os
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def write_pair(directory: Path, stem: str) -> None:
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    private_path = directory / f"{stem}-private.pem"
    public_path = directory / f"{stem}-public.pem"
    private_path.write_bytes(
        private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    os.chmod(private_path, 0o600)
    public_path.write_bytes(
        public.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Create local-only development signing keys.")
    parser.add_argument("--out", type=Path, default=Path(".local/devkeys"))
    args = parser.parse_args()
    args.out.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(args.out, 0o700)
    write_pair(args.out, "cell-evidence")
    write_pair(args.out, "proofgate-receipt")
    print(f"Development keys created under {args.out.resolve()}")
    print("Private keys are restricted to the current user. Do not use these keys for production or NEAR accounts.")


if __name__ == "__main__":
    main()
