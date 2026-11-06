# se-plugin — in progress

Branch: `cloud/se-plugin` in Jini and Tovu, based on `cloud/combine`:
Jini `f07ae3d6ff55cf4da480acac44cc6f4b7686966b`; Tovu `74fedc1320d31431ab4a13d1e38af03a402ca28b`.
Upstream AI-Dev-Shop: `f02b883bbf51d043c3589eba093d78745600e13b` (shallow clone succeeded).

Updating the existing software-engineering subpath with routed portable guidance and a pinned update command. No new plugin or vibe coding feature is being built.

Baseline: `node --test packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs` passed (4 tests). Jini recursive build and Tovu relinking passed.

## Bugs found

- Tovu's staged engineering skill mirror will become stale on content refresh; keep the existing equality check and update the mirror.
- Upstream has no root LICENSE or NOTICE; retain the existing payload's Apache-2.0 license and author attribution, and describe adaptations in README/NOTICE without asserting an upstream license declaration.
- Existing portable guidance includes the host-specific `apps/desktop` threshold; move it to the Tovu overlay.

## Open

Implementation and checks in progress. Pushed SHAs and exact final commands will be recorded here.

## Progress

Portable content refreshed from the pinned upstream snapshot. Six references now cover implementation, architecture, debugging, verification/code review, security and prototyping. The inner plugin version is 0.2.0. A deterministic Git-object sync script records source and payload hashes. Tovu staging mirror and host overlay are updated.

Fresh checks: plugin content 4/4; sync integration probe 1/1; Tovu plugin lifecycle/delivery 2/2 including every reference; catalog 65/65; plugin build/typecheck, script TypeScript check, touched Tovu test typecheck, strict complexity lint, source and packed package guards passed. Full suites were not run.

Additional bug found: the unchanged Tovu bundled-selection test omits commerce, stripe, formspree and google-forms from its expected list; the plugin-specific tests pass. This unrelated list is left unchanged.

Initial report pushed in Jini: c01c5da78 on cloud/se-plugin. Implementation push and final report follow.
