# Versioning and Lifecycle

## Core Rules

- Choose one versioning strategy early and apply it consistently.
- Treat compatibility policy as part of the contract, not release-note trivia.
- Separate additive changes from breaking changes explicitly.
- Publish the migration path before consumers need it.

## Deprecation Rules

- A deprecation notice names the deprecated field, endpoint, RPC, or event.
- A deprecation notice names the replacement.
- A deprecation notice includes notice date and expected removal condition or date.
- If the removal date is real and committed, include a Sunset signal as well.

## Breaking-Change Rules

- Removing or renaming a field, changing a field type, tightening requiredness, or changing auth behavior is a breaking change.
- Breaking changes require expand-contract rollout, not a same-day swap.
- Deprecation without migration guidance is not a lifecycle policy.

## Header Guidance

- Use the Deprecation response header when you need machine-visible deprecation signaling on HTTP responses.
- Use the Sunset header when you know the API, field, or endpoint retirement date.
- Headers help, but they do not replace human-readable migration guidance.

## Minimum Lifecycle Review Questions

- Can a consumer tell what is changing, when, and what to do next?
- Is the versioning scheme consistent with the existing API surface?
- Does the rollout plan allow overlap between old and new behavior?
- Are deprecation and removal dates realistic for actual consumers?

## References

- Deprecation HTTP Response Header Field (RFC 9745): https://www.rfc-editor.org/rfc/rfc9745.html
- Sunset HTTP Header Field (RFC 8594): https://www.rfc-editor.org/rfc/rfc8594.html
- Local rollout policy: `<AI_DEV_SHOP_ROOT>/skills/change-management/SKILL.md`
