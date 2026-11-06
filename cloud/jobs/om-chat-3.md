# Job om-chat-3: shared chat items 5, 6, 7 (owner-approved 11-05)
Plan: cloud/plans/OMJ-plan-result.md, the lines for items 5, 6 and 7.
- Item 5: selected-agent and cancellation controls on discovery's public batch API, extending the existing owner in agent-runtime detection. No new cache.
- Item 6: image and read-only folder attachments through the existing imageContents, imagePaths and readOnlyExtraDirs delivery contract. Add only what a host needs to pass them. No staging service, no picker lifecycle.
- Item 7: required-HTTP policy, parser bounds, exact-selection and clamping cleanup, Antigravity registration. Reuse the existing exact-selection validation.
This is Jini shared chat code with small Tovu wiring. Do not touch Open Marketing's repo. Smallest change each.
Base: origin/cloud/combine in both repos, at its current tip. Branch cloud/om-chat-3 from it. Do not push to cloud/combine. Tests only for what you change; full suites run later. No skipping or weakening tests or rules. No publish, tag or main. Report at cloud/reports/om-chat-3.md and in your final message: shas, exact files, tests with commands, anything open. General wording in commits and notes.
