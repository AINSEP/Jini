# se-plugin — completed

Updated the existing `@jini-ai/agent-plugins/software-engineering` payload, displayed as **Tovu Software Engineering**, to inner content version **0.2.0**. No second plugin, new framework, vibe coding feature, deployment or publication was added. Commerce code and ui-ux-design were unchanged.

## Branches and commits

All pushes target `cloud/se-plugin` only.

| Repository | Base on `cloud/combine` | Pushed implementation commits |
| --- | --- | --- |
| Jini | `f07ae3d6ff55cf4da480acac44cc6f4b7686966b` | `c01c5da78` (initial report), `c9ce403a3ff5d2402d59b30578ba898083502062` (implementation) |
| Tovu | `74fedc1320d31431ab4a13d1e38af03a402ca28b` | `c1c69dcefa851b49b7d1db0da357980f52f91f8e` (mirror, overlay and delivery checks) |

This report is finalized in a subsequent documentation commit on each same branch; those final SHAs are in the job's final response and branch history.

Upstream clone: `https://github.com/leonaburime-ucla/AI-Dev-Shop`, exact SHA **`f02b883bbf51d043c3589eba093d78745600e13b`**. The requested shallow clone succeeded. Nothing was pushed upstream. Loaded the dispatched Software Architect, Programmer and TDD instructions.

## Content and selection

Kept one 3,328-byte router and six on-demand references. Selected upstream sections cover coding foundations, implementation guardrails, architecture defaults and reversible boundaries, root-cause debugging, behavior-level assertions, requirement/architecture/resource code review, resource-level authorization, secrets, secure input handling and focused prototyping. The README records the exact upstream SHA, nine source-file hashes and all seven delivered skill-file hashes.

Added dedicated security and prototyping routes; refreshed the other four references. Removed source/pipeline prerequisites and provenance from agent-readable skill text. Host permissions, tools, desktop-specific thresholds and activation instructions stay in Tovu's overlay. Updated the existing staging mirror and kept its byte-equality assertion. The plugin catalog changes only the software-engineering record.

Left out coordinator startup, persona switching, spec certification and approval hierarchies, peer orchestration, analyzer installation, deployment automation, mobile/platform-specific integrations and visual design assets. They require separate capabilities or fall outside this web app engineering payload. UI work discovers the existing design/accessibility capability; no sibling plugin is imported. Feature tests follow the active task/repository requirements; regression tests and honest verification remain explicit.

LICENSE retains the existing payload's Apache-2.0 terms and NOTICE retains the author attribution. The selected upstream has no root LICENSE or NOTICE; the documentation explicitly avoids claiming an upstream Apache declaration.

## Repeatable update

From Jini, with an upstream checkout containing the desired commit:

```sh
git -C /path/to/AI-Dev-Shop fetch origin <sha>
node scripts/sync-software-engineering.mjs /path/to/AI-Dev-Shop <40-character-sha>
```

Executed successfully with `/workspace/work/ai-dev-shop-latest` and the exact SHA above. The script reads pinned Git objects, ignores dirty upstream working files, selects named sections and applies explicit portability adaptations. It validates sections, provenance patterns, reference/entry limits and the whole payload budget before writing. Missing sections, malformed revisions and excessive reference sizes are covered by a real temporary-Git integration test; invalid extraction leaves target bytes intact. It never executes upstream code or accesses the network.

Review the generated diff; advance the inner version for changed content, regenerate the existing catalog, rebuild/relink and copy the complete skill tree into Tovu's existing staging mirror. No new update framework was introduced.

## Vibe coding reachability and remaining wiring

Tovu already selects the package subpath in `apps/website/src/features/agent-plugins/bundled-catalog.ts`. It seeds OFF. Its existing trusted shared `load_agent_plugin` loader can read an installed OFF plugin for clearly marked, read-only setup guidance; exclusion/trust checks and tool activation remain enforced (`automatic-agent-plugins.ts`). Call:

```json
{"pluginId":"software-engineering","skill":"software-engineering","file":"references/prototyping.md"}
```

After normal enablement, `agent_plugin_software_engineering` reads the router or a selected reference. Existing pinned `pluginRefIds: ["software-engineering"]` also flow through the assistant's resolver and pointer delivery. Tovu's overlay precedes every delivered reference. Tests exercise install, OFF state, enablement, every reference, injection/pointer delivery, revocation and reboot preservation.

`packages/vibecoding/src/core/session.ts` and `src/tools.ts` provide editor sessions and edit tools; they do not select this plugin or request its guidance. Tovu's Pages path uses the HTML editing helpers, but there is no dedicated vibe coding module caller that loads engineering guidance or pins it for an agent run. That future host caller must use the existing loader/pinning path, preserve activation/consent and provide an authorized coding workspace and tools. This job adds none of those features and no automatic enablement.

## UI/UX comparison

ui-ux-design's README still records the earlier `c10abee` sync, not the new SHA. Compared all files in its seven skill trees against the latest snapshot: no missing or extra files; four trees are byte-identical. Differences in `ui-ux-design/SKILL.md`, `shadcn-ui/SKILL.md` and `web-compliance/SKILL.md` are exactly the documented portability/context/frontmatter adaptations. Thus its recorded sync SHA is older, but the bundled skill content shows no additional upstream lag at this snapshot. It was not changed.

## Validation

Commands below ran in this container; the setup environment was loaded with `source /workspace/.tovu-build/env.sh`. Commands that spawn subprocesses were run with the tool's network permission enabled because the default sandbox caused `spawnSync ... EPERM` or hid child-test detail; no checks were disabled.

Jini setup/baseline:

```sh
CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store
pnpm -r build
node --test packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs
```

Passed. The install used a writable workspace store after the default cache returned EROFS; the non-interactive reinstall required CI=true. The original plugin baseline was green. A regression assertion first failed against the original desktop-specific wording, then passed after moving that rule to the host overlay.

Jini final checks:

```sh
node --check scripts/sync-software-engineering.mjs
node --check scripts/__tests__/sync-software-engineering.test.mjs
node --test scripts/__tests__/sync-software-engineering.test.mjs packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs
pnpm --filter @jini-ai/agent-plugins build
pnpm --filter @jini-ai/agent-plugins typecheck
pnpm --filter @jini-ai/plugin-catalog generate
pnpm --filter @jini-ai/plugin-catalog test
pnpm exec tsc -p scripts/tsconfig.json --noEmit
pnpm guard:plugins
pnpm guard:plugins:packed
pnpm exec eslint --no-inline-config --rule 'complexity:[error,10]' --rule 'sonarjs/cognitive-complexity:[error,10]' --rule 'max-depth:[error,3]' scripts/sync-software-engineering.mjs scripts/__tests__/sync-software-engineering.test.mjs packages/agent-plugins/software-engineering/__tests__/bundled-package.test.mjs
```

Passed: **5 Node tests** (four payload checks and one sync integration test), **65 catalog tests**, builds, typechecks, source/packed package guards and strict complexity lint. ESLint 10.8.0, TypeScript 5.9.3, Node 24.22.1, pnpm 10.33.2. Catalog generation exposed unrelated provider artifact drift; only the engineering catalog row was retained.

From `packages/agent-plugins`, also ran:

```sh
npm pack --offline --ignore-scripts --json --cache /workspace/work/se-plugin/npm-cache --pack-destination /workspace/work/se-plugin
```

A direct tarfile probe compared all **11 engineering payload files byte-for-byte** with source: **39,533 bytes**, below the unchanged 40 KiB limit. Entry is below 4 KiB, each reference below 5 KiB, overlay 1,603 bytes below 2 KiB. No tests or executable sync script ship inside the selected payload.

Tovu checks:

```sh
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/bundled-software-engineering-package.unit.test.ts
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/bundled-automatic-relevance.unit.test.ts apps/website/src/features/agent-plugins/__tests__/unit/host-plugin-guidance.unit.test.ts
./node_modules/.bin/tsc -p /workspace/work/se-plugin/tsconfig.tovu-tests.json --noEmit
./node_modules/.bin/eslint --no-inline-config --rule 'complexity:[error,10]' --rule 'sonarjs/cognitive-complexity:[error,10]' --rule 'max-depth:[error,3]' apps/website/src/features/agent-plugins/__tests__/unit/bundled-software-engineering-package.unit.test.ts
```

Passed: **2 plugin delivery/lifecycle tests**, **21 affected relevance/overlay tests**, relinking, focused typecheck and complexity lint. The focused config extends Tovu's `tsconfig.tests.json`, includes only the changed test and its dependency closure, and sets `typeRoots` to `/workspace/Tovu/node_modules/@types` because the config lives outside the repo. No production TS changed in Tovu.

Also ran this bundled check:

```sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks apps/website/src/features/agent-plugins/__tests__/unit/bundled-software-engineering-package.unit.test.ts development/scripts/__tests__/bundled-agent-plugin-selection.test.ts
```

**4 passed, 1 failed**: the unchanged bundled id expectation omits already-selected plugins. The software-engineering checks passed. The stale expectation and selection files are byte-identical to the job base; no test was weakened, disabled, skipped or deleted. This unrelated failure was reported rather than changed. Full suites were not run, per job scope.

## Review and cost

Architecture audit: PASS for the scoped changes. Reused the existing plugin subpath, packaging/lifecycle/trust readers, overlay mechanism, catalog generator and staging mirror. No runtime path, table, migration, option, timer or background task was added. Local sync uses O(selected source + output bytes) memory/time with a fixed selection; it reads nine source objects and writes six references plus README once per requested update. Runtime staging/install remain O(payload) per build/digest; guidance reads one selected file, not all references.

Function review: the sync section reader has one job, explicit object input, a local source cache and a named-section failure; the CLI validates output before mutation. The temporary-Git test verifies pinned-source behavior, repeatability and failure-without-writes rather than mock call counts. Strict complexity/nesting checks passed. Reviewed revision handling, dirty input, partial extraction, size limits, source ownership and variable names; no unresolved introduced finding remains.

Scoped mutation tooling is not configured for this maintenance script: mutation score is UNVERIFIED, not claimed. Content-only guidance has no executable behavior to mutate. The real sync integration test and lifecycle delivery checks provide direct evidence; no coverage percentage is claimed.

## Bugs found

- FIXED: portable verification guidance contained Tovu's `apps/desktop` threshold. It now lives in the Tovu overlay; a regression assertion prevents recurrence.
- FIXED: the existing Tovu staging mirror would drift after a payload-only refresh. All seven skill files were refreshed and byte equality remains checked.
- DOCUMENTED: the selected upstream snapshot contains no root LICENSE or NOTICE. Existing payload licensing/attribution is retained without asserting an upstream license declaration.
- OPEN, pre-existing: Tovu's bundled-selection test expected list omits `commerce`, `stripe`, `formspree` and `google-forms`, all already selected on the base branch. Left unchanged, including all commerce code.
- OPEN, pre-existing artifact drift: rebuilding existing `posthog` and `sentry` provider artifacts changes their catalog digests locally. Those unrelated generated record changes were not included.

## Remaining work

The separate vibe coding module still needs to request this existing plugin through the host loader/run-reference path. No vibe coding features were built. The unrelated bundled-selection expectation and provider artifact reproducibility remain open. The local environment's pre-existing untracked legacy `packages/plugin-ui-ux-design/` directory was neither used nor committed. No live/owner data was accessed.
