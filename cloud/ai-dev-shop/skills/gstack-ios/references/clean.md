# iOS Clean

## When

Use when preparing an iOS app for release by removing debug bridge packages, debug-only code paths, local test hooks, or temporary instrumentation.

## Workflow

1. Inventory first. Search for debug bridge dependencies, debug imports, `#if DEBUG` blocks, local endpoints, temporary logging, and generated debug files.
2. Present the inventory and explain what each item does.
3. Ask the user to approve the exact removal scope.
4. Remove only approved debug-only wiring.
5. Verify the app still builds in a release-appropriate configuration.
6. Report anything intentionally kept and why.

## Output

- Debug inventory
- Approved removal scope
- Files changed or proposed
- Build/verification result
- Reversibility notes

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that delete directories, remove debug wiring, clean caches, or rewrite generated templates. Do not proceed until the user says "yes" or "approved".
- Do not remove production feature flags, analytics, diagnostics, or logging without proof they are debug-only.
- Do not change signing, provisioning, or release settings unless explicitly requested.
