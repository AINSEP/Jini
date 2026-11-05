# `@jini-ai/agent-plugins/software-engineering`

One portable Agent Plugin with one entry skill and four short references. Resolve the subpath
with the host package resolver; its directory holds the payload. Stage only that selected
folder and use the existing agent-plugin lifecycle for packing, installation and trusted reads.
No executable checker, MCP server, hook, analyzer download or sibling-plugin import is included.
Host permissions and activation remain authoritative. Tovu selects it but seeds it OFF.

The generic manifest name and skill name are `software-engineering`. The Tovu display name
exists only in `extensions.tovu.displayName`. The inner content version is 0.1.0; containing
package version/release is owned by Jini's release process and is not changed here.

## Sources and adaptations

Adapted from Jini's vendored `AI-Dev-Shop/` at Jini commit `6f507852d`: Programmer,
Software Architect, TDD and Code Review (the newer source calls it Code Inspection), with
coding-foundations, implementation-guardrails and testable-design-patterns. The current
Code Inspection persona was also consulted from `cloud/ai-dev-shop` on `cloud-plans-1105`.
Licensing and attribution remain in LICENSE and NOTICE, outside delivered skill text.

Removed pipeline prerequisites, persona switching, ADS paths, session/provenance text and
mandatory feature testing. Retained test-ready design and failing regression tests for bugs.
Adapted complexity to ≤10 (≤9 in apps/desktop), nesting ≤3, and the narrow proven exhaustive
switch exception. Added mutation honesty and UNVERIFIED behavior for missing checkers.
Memory discipline is discovered through the host rather than copied or imported from a sibling.

A matching skill tree is staged in Tovu at `cloud/ads-ainsep-skill/software-engineering/`
for later upstream integration; this job does not edit AI-Dev-Shop. Future content changes
should originate upstream and flow one way into this payload, with hashes reviewed here.

## Size and state cost

Entry ≤4 KiB; each reference ≤5 KiB; overlay ≤2 KiB; complete published payload ≤40 KiB.
Each build stages one payload read/write; each new digest installs O(payload) bytes through
the existing lifecycle. A guidance request inventories supporting files before reading the
selected file (up to 20 KiB inventory + 5 KiB selected + 2 KiB host overlay). No polling,
watcher, cache, schema, background task or new persistent state is added.

## Skill hashes (SHA-256)

| Path | Hash |
| --- | --- |
| `skills/software-engineering/SKILL.md` | `81cde8df1cf463de5a80f5e68055bd7e27a1e2ae4258fdf2fd42a1676a7bb608` |
| `skills/software-engineering/references/debugging.md` | `141eaa6c313a31077abded478af1b82c9011dfddef463976dc41d96f67eb0f91` |
| `skills/software-engineering/references/implementation.md` | `28c79b58fafe5f14ce5a16229c7391d66cd6007c6d91ad3af5bde62f8da2ccf1` |
| `skills/software-engineering/references/planning.md` | `919df0c8257aa163aa3355e6066723b602580ba28c32d33be96efe2fdaad6649` |
| `skills/software-engineering/references/verification.md` | `71784ccddd0f3aad32268f7cc2b680384264cda5c53bd41ea7039d28421da977` |
