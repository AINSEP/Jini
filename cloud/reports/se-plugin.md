# se-plugin — in progress

Branch: `cloud/se-plugin` in Jini and Tovu, based on `cloud/combine`:
Jini `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`; Tovu `74fedc1320d31431ab4a13d1e38af03a402ca28b`.
Upstream AI-Dev-Shop: `f02b883bbf51d043c3589eba093d78745600e13b` (shallow clone succeeded).

Updating the existing software-engineering subpath with routed portable guidance and a pinned update command. No new plugin or vibe coding feature is being built.

Baseline: `node --test packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs` passed (4 tests). Jini recursive build and Tovu relinking are underway.

## Bugs found

- Tovu's staged engineering skill mirror will become stale on content refresh; keep the existing equality check and update the mirror.
- Upstream has no root LICENSE or NOTICE; retain the existing payload's Apache-2.0 license and author attribution, and describe adaptations in README/NOTICE without asserting an upstream license declaration.
- Existing portable guidance includes the host-specific `apps/desktop` threshold; move it to the Tovu overlay.

## Open

Implementation and checks in progress. Pushed SHAs and exact final commands will be recorded here.
