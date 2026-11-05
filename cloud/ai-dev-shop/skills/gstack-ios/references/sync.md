# iOS Sync

## When

Use only when the user explicitly asks to regenerate or update debug bridge templates, device QA support files, or related iOS debug infrastructure.

## Workflow

1. Confirm the sync target: templates, generated Swift files, bridge package, or documentation.
2. Inventory current files and versions before changing anything.
3. Explain the planned regeneration or update path.
4. Ask for explicit approval before rewriting generated files.
5. Apply the update using repo-local tooling or documented source templates.
6. Verify compile/build behavior and, when available, bridge connectivity.

## Output

- Sync target and current state
- Update plan
- Files changed or proposed
- Verification result
- Follow-up cleanup or documentation needs

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that rewrite generated templates, clean caches, or alter project package configuration. Do not proceed until the user says "yes" or "approved".
- Do not assume gstack's upstream templates or daemons are installed.
- Do not run remote tunnel or device-sharing setup as part of sync.
