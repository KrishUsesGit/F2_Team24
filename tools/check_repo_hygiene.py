#!/usr/bin/env python3
"""Read-only repository hygiene check (standard library only).

Never modifies, creates or deletes any file. Exit status 0 = clean,
1 = findings, 2 = bad usage.

Scope is deliberately narrow so legitimate historical records are not
flagged:
  * only SOURCE files are scanned (*.py, *.sh);
  * experiments/ (raw evidence and derived artifacts), docs, JSON results,
    caches and .git are never scanned -- historical artifacts such as
    experiments/demo-run-01/path_bundle.json may legitimately contain
    machine paths and are kept unchanged;
  * system paths such as /var/lib/hoptrace are allowed (only per-user /
    per-machine paths are flagged).

Checks:
  1. .gitattributes exists (line-ending policy for the bash scripts).
  2. No absolute per-user path in source files (e.g. a /mnt/<drive>/Users/
     or <drive>:\\Users\\ path).
  3. No carriage-return characters in source files.

Usage:  python3 tools/check_repo_hygiene.py [--root PATH]
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

SOURCE_SUFFIXES = (".py", ".sh")
SKIP_DIRS = {".git", "experiments", "__pycache__", "node_modules", ".claude"}

# Built from fragments so this file does not match its own patterns.
_USER_PATH_PATTERNS = [
    re.compile("/mnt/[a-zA-Z]/" + "Users/"),
    re.compile(r"[A-Za-z]:[\\/]+" + r"Users[\\/]"),
    re.compile("/home/" + r"[^/\s\"']+/"),
]


def list_source_files(root: str) -> list[str]:
    """Prefer git (tracked + untracked-but-not-ignored); fall back to a walk."""
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            capture_output=True, check=True,
        ).stdout.decode("utf-8", "replace")
        rels = [p for p in out.split("\0") if p]
    except (OSError, subprocess.CalledProcessError):
        rels = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                rels.append(os.path.relpath(os.path.join(dirpath, name), root))
    keep = []
    for rel in rels:
        parts = rel.replace("\\", "/").split("/")
        if any(p in SKIP_DIRS for p in parts[:-1]):
            continue
        if rel.endswith(SOURCE_SUFFIXES):
            keep.append(rel)
    return sorted(set(keep))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    args = ap.parse_args()
    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f"not a directory: {root}", file=sys.stderr)
        return 2

    findings: list[str] = []
    if not os.path.exists(os.path.join(root, ".gitattributes")):
        findings.append(".gitattributes is missing")

    files = list_source_files(root)
    for rel in files:
        path = os.path.join(root, rel)
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError as e:
            findings.append(f"{rel}: unreadable ({e})")
            continue
        if b"\r" in data:
            findings.append(f"{rel}: contains carriage-return characters")
        text = data.decode("utf-8", "replace")
        for lineno, line in enumerate(text.splitlines(), 1):
            for pat in _USER_PATH_PATTERNS:
                if pat.search(line):
                    findings.append(f"{rel}:{lineno}: absolute per-user path")
                    break

    print(f"checked {len(files)} source files under {root}")
    if findings:
        print(f"{len(findings)} finding(s):")
        for f in findings:
            print("  " + f)
        return 1
    print("OK: no per-user paths, no CR characters, .gitattributes present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
