import json
import sys


def main() -> None:
    normalized = " ".join(sys.stdin.read().split()).lower()
    result = {"normalized": normalized, "wordCount": len(normalized.split())}
    print("RESULT_JSON:" + json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
