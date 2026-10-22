#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
targets=(packages)
if [[ -d foundry/automation ]]; then
  targets+=(foundry/automation)
else
  echo '[automation-engine-vocabulary-firewall] SKIPPED: untracked foundry/automation is absent.' >&2
fi
exec depcruise --config .dependency-cruiser.mjs "${targets[@]}" "$@"
