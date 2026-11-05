---
name: superpowers-verification-before-completion
description: Use before claiming a fix, pass, readiness, or completion. Requires fresh command output that directly proves the claim.
---

# Superpowers Verification Before Completion

Never claim success without fresh evidence.

## Execution

- Identify the command that proves the claim.
- Run it now.
- Read the actual output and exit status.
- Report the result that the command proves, not the result you expected.

## Guardrails

- Old output does not count.
- Partial checks do not count.
- “Should pass” does not count.
- If verification fails, report the failure plainly.
- If evidence contradicts expectation, report the actual result instead of interpreting it optimistically.

## Output

- command run
- whether it passed or failed
- the specific evidence that supports the claim

## Reference

- Preconditions:
  - there is a concrete claim to verify
  - there is a command that can directly prove or disprove it
- Decision rule:
  - evidence is sufficient only if it directly matches the claim being made
  - if only a partial check exists, the claim is not ready
- Failure path:
  - if the verification command fails, report the exact failing state instead of claiming partial success
  - if no direct verification command exists, say the claim is not yet verifiable
- Claim types:
  - tests passing
  - builds succeeding
  - bugs being fixed
  - branch readiness
  - delegated work being done
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
