# ainsep — Software Engineering Agent Plugin

Implemented the requested portable `@jini-ai/agent-plugins/software-engineering` payload and
Tovu wiring. It is available but OFF by default. Release/publishing and the eventual Tovu
registry dependency bump remain with the release owner.

## Inputs, branches and pushed source commits

Instructions read with `git show origin/cloud-plans-1105:<path>` after the requested fetch.
Plans ref: `a2e6fe163f47309cda7d576a624dd511faea035d`; precedence: job → TRIM A → plan.
Loaded Software Architect, Programmer and TDD personas from `/workspace/cloud/ai-dev-shop`;
consulted the vendored engineering sources and current Code Inspection guidance.

Both repositories use **cloud/ainsep**. Every push was preceded by a pull/rebase when the remote
branch existed. No main push, force push, deployment, npm publish or AI-Dev-Shop edit.

| Repository | Exact starting commit | Pushed source commits, in order |
| --- | --- | --- |
| Jini | `6f507852d` | `ef6842aae` — payload/registration; `ece564ee1` — content checks and entry budget |
| Tovu | `e327c07c8` | `45bd71113` — catalog/overlay/staged tree; `8e5421509` — lifecycle/delivery tests; `890d1cb3e` — assertion-based TS narrowing |

This report is committed after those source commits; its pushed commit is reported in the final response.

## Changes and boundaries

- Standard plugin.json, Apache LICENSE/NOTICE, README with source notes/hashes, one entry skill,
  four references (planning, implementation, debugging, verification), unpublished node:test checks.
- Generic name/subpath `software-engineering`; `Tovu Software Engineering` only in manifest
  `extensions.tovu.displayName`. Host-specific metadata stays in extensions.
- Guidance includes reuse, explicit dependencies, test-ready boundaries, safe actionable errors,
  resource bounds and self-inspection. It routes to references without pipeline prerequisites,
  provenance/session names in delivered skill text, or copied design/memory policy.
- Cognitive/cyclomatic ≤10, ≤9 in apps/desktop; nesting ≤3; only a proven delegating exhaustive
  switch gets the documented cyclomatic exception. Feature tests optional, bug regression first,
  added tests require scoped mutation, missing measurements UNVERIFIED. No executable enforcement
  is claimed or installed.
- Memory discipline is a host-reader reference to `memory-performance-discipline`, discovered only
  when available; no sibling plugin import or filesystem dependency is introduced.
- Tovu uses its existing bundled selection and overlay paths. Its enabled seed set is unchanged.
  The overlay requires tool discovery/site tools and forbids shell/installers from chat.
- The byte-identical upstream candidate is at
  `Tovu/cloud/ads-ainsep-skill/software-engineering/`; AI-Dev-Shop was not changed.
- No new runtime abstraction, table, option, timer, watcher, background work or persistent state.
  Architecture check: existing package/lifecycle owners and Tovu-only wiring retained.

## Measured budgets and state cost

| Artifact | Bytes | Budget |
| --- | ---: | ---: |
| Entry skill | 4,037 | 4,096 |
| Debugging | 1,718 | 5,120 |
| Implementation | 2,796 | 5,120 |
| Planning | 2,307 | 5,120 |
| Verification | 3,410 | 5,120 |
| Tovu overlay | 1,272 | 2,048 |
| Published plugin (9 files, including legal files and README) | 29,746 | 40,960 |

Per build: one payload read/write through existing staging. Per new digest: O(payload) install
writes through existing lifecycle. Per guidance request: existing supporting-file inventory
(up to 20 KiB budget) plus the selected file (up to 5 KiB) and overlay (up to 2 KiB).
Added polls/background work: **0 × 0**. No new cache or read loop.

## Verification — exact commands

Commands ran in this container with Node 24.22.1 after sourcing
`/workspace/.tovu-build/env.sh`. The instructed `/workspace/shared/dev-env.sh` and
`/workspace/shared/start-postgres.sh` were absent. Equivalent setup files were found in
`.tovu-build`. Network/subprocess-dependent commands used the supported sandbox grant.

**Jini**, working directory `/workspace/Jini`:

```sh
node --test packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs
node node_modules/vitest/vitest.mjs run scripts/__tests__/standalone-agent-plugin.integration.test.ts -t 'software-engineering|the tarball passes' --reporter=verbose
node node_modules/typescript/bin/tsc -p packages/agent-plugins/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/agent-plugins/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node scripts/lib/agent-plugin-packages.ts
node node_modules/eslint/bin/eslint.js --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' scripts/lib/agent-plugin-packages.ts
node --import tsx scripts/check-plugin-packages.ts
node --import tsx scripts/check-agent-plugin-content.ts
git diff --check 6f507852d
```

All passed. Content: **4/4**. Packed tests: **3 passed**, 91 unrelated tests unselected by the
name filter; no test source was skipped or weakened. Verified real npm tarball resolution,
isolation, omitted test folders, readable installed skills and preserved operator disablement.
The host-neutral fixture warns about its unknown namespace's publisher id; Tovu metadata parses
and displays correctly under Tovu. Build/typecheck/complexity/guards exited 0.

**Tovu**, working directory `/workspace/Tovu`:

```sh
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
node --import tsx --test apps/website/src/features/agent-plugins/__tests__/unit/bundled-software-engineering-package.unit.test.ts development/scripts/__tests__/bundled-agent-plugin-selection.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --types node apps/website/src/features/agent-plugins/bundled-catalog.ts
node node_modules/eslint/bin/eslint.js --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/agent-plugins/bundled-catalog.ts
git diff --check e327c07c8
```

All passed. Tests: **5/5**, no skips. Verified selected-package resolution, real seeding OFF,
no disabled-plugin tool/pinned guidance, explicit enablement, exact delivered skill plus overlay,
injected and pointer paths, held-tool revocation after reseeding, source-tree parity and size.
The exact new-test/catalog sources also had **0** syntax/semantic diagnostics using the existing
`tsconfig.tests.json` compiler options through the TypeScript API:
`node /workspace/work/ainsep/typecheck-touched.mjs` (scratch verification, no compiler config changed).

Website-wide compiler check:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
mkdir -p /workspace/work/ainsep/tovu-base
git archive e327c07c8 | tar -x -C /workspace/work/ainsep/tovu-base
ln -s /workspace/Tovu/node_modules /workspace/work/ainsep/tovu-base/node_modules
node /workspace/Tovu/node_modules/typescript/bin/tsc -p /workspace/work/ainsep/tovu-base/tsconfig.json --noEmit
```

Both compiler runs exited 2 with **the same 73 diagnostics**: 0 added and 0 removed after
normalizing checkout paths. No diagnostic names the changed production catalog. These existing
integration/type issues were not changed for this job. The touched-file compiler checks passed.

No test assertions, measured scope, thresholds or rules were weakened. Two redundant unreachable
error branches after narrowing assertions in the new test were removed to fix its TypeScript errors;
the assertions and all behavioral checks remain. Mutation: no new executable production logic was
authored (guidance and declarative metadata only), so there is no new implementation mutation target;
no mutation PASS is claimed. No full test suite, routing eval, live site or owner data was used.

## Open items and bugs

OPEN: Release owner must publish a Jini package containing this subpath and update Tovu's registry
dependency before a clean registry-only production bundle can resolve it. This job verified the
local linked checkout and real packed Jini artifact; it does not publish or deploy.

OPEN: Website-wide typecheck has 73 baseline diagnostics in unchanged files. Examples include
MCP federation options, missing MCP/chat exports, delegated-tool/attachment contracts and
`@tovu/contracts` resolution. Baseline equality is verified; remediation is outside this job.

OPEN: Full `pnpm -r build` setup was stopped during unrelated `packages/ui` compilation after the
affected agent-plugins package built successfully. The focused package was rebuilt independently
with tsc and passed. Full build is not claimed green. Fresh dependency setup initially hit the
read-only pnpm store (ERR_PNPM_EROFS) and a Corepack DNS failure; existing dependencies supported
all focused verification. PostgreSQL setup could not start; this job required no database service.

OPEN: Existing untracked `Jini/packages/plugin-ui-ux-design/` leftovers were preserved and excluded
from commits. No cleanup of unrelated files was performed.

BUG: No unresolved defect found in the introduced plugin, selection or activation behavior.

Suggested next assignee: release owner for the dependency/release sequence, and the separate
AI-Dev-Shop integration session for the staged skill tree. Required job work is implemented;
website-wide compilation and full-build health remain explicitly unverified beyond the results above.
