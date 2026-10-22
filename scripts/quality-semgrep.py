#!/usr/bin/env python3
"""Launch the Community CLI; keep scan policy in .semgrep.yml and report counts only."""

import collections
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    binary = shutil.which("semgrep")
    if binary is None:
        print("SKIPPED: semgrep is not installed; no scan or rule tests ran.", file=sys.stderr)
        print("Install: brew install semgrep / pipx install semgrep", file=sys.stderr)
        return 127

    common = ["--metrics=off", "--disable-version-check", "--oss-only", "--strict"]
    arguments = sys.argv[1:]
    if arguments == ["--test"]:
        return subprocess.run([binary, "--test", ".semgrep", *common], check=False).returncode

    # JSON is a YAML subset: stdlib parsing avoids adding PyYAML or an npm package.
    # Semgrep has no native rule-pack include key; expand to repeated --config flags.
    manifest = json.loads((root / ".semgrep.yml").read_text())
    configs = [arg for config in manifest["configs"] for arg in ["--config", config]]
    # Raw JSON can contain credential-bearing source/message text. Keep it private,
    # print only counts, and remove it even on scanner/configuration failures.
    with tempfile.TemporaryFile(mode="w+") as report:
        result = subprocess.run(
            [binary, "scan", *configs, *common, "--json", *arguments, "."],
            stdout=report,
            check=False,
        )
        report.seek(0)
        try:
            data = json.load(report)
        except json.JSONDecodeError:
            print("Semgrep produced no readable JSON report; scan incomplete.", file=sys.stderr)
            return result.returncode or 2

    counts = collections.Counter(finding["check_id"] for finding in data.get("results", []))
    errors = data.get("errors", [])
    print(f"Semgrep: {sum(counts.values())} findings; {len(errors)} analysis errors")
    for rule, count in sorted(counts.items(), key=lambda entry: (-entry[1], entry[0])):
        print(f"{count:6d}  {rule}")
    for kind, count in sorted(collections.Counter(error.get("type", "unknown") for error in errors).items()):
        print(f"{count:6d}  analysis error: {kind}", file=sys.stderr)
    # Findings alone are report-only. --error can opt in later after policy approval.
    # Errors must remain visible; CI makes just the scan step non-blocking.
    return result.returncode or (2 if errors else 0)


if __name__ == "__main__":
    sys.exit(main())
