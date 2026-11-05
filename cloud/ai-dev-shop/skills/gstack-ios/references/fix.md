# iOS Fix

## When

Use for a bounded iOS bug, crash, broken SwiftUI behavior, failing UI path, or reported device-specific regression.

## Workflow

1. Reproduce or collect enough evidence to define the failure.
2. Inspect the smallest relevant source area before editing.
3. State the suspected root cause and one narrow patch plan.
4. Patch only the files needed to address the failure.
5. Verify with build, targeted tests, simulator/device run, or a clear manual fallback.
6. Capture regression evidence and remaining risk.
7. Stop after three failed patch attempts and escalate with the evidence gathered.

## Output

- Reproduction evidence
- Root-cause hypothesis
- Files changed or proposed
- Verification result
- Remaining risk and rollback notes

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that delete directories, clean caches, rewrite generated templates, or alter signing/deploy settings. Do not proceed until the user says "yes" or "approved".
- Do not refactor unrelated views, models, packages, or project settings.
- Do not hide uncertainty if a device-only bug cannot be reproduced locally.
