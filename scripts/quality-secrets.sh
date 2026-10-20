#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if ! command -v gitleaks >/dev/null 2>&1; then
  echo 'SKIPPED: gitleaks is not installed; no secret scan ran.' >&2
  echo 'Install: brew install gitleaks (use v8.28.0 or newer); https://github.com/gitleaks/gitleaks#installing' >&2
  exit 0
fi
# Report-only findings; configuration/runtime failures still return a nonzero exit code.
# All locally available refs, including merge history. Uncommitted files are not in this scan.
exec gitleaks git . --config .gitleaks.toml --log-opts='--all --full-history -m' --redact --exit-code=0 "$@"
