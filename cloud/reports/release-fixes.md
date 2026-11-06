# release-fixes — complete

Inputs: owner-approved `cloud/jobs/COMMON.md` and `cloud/jobs/release-fixes.md` from `origin/cloud-plans-1105`; base `origin/cloud/combine` b0cc1371b5e739f9cd1b26f14aa5a21a82416b60. Software Architect, Programmer and TDD instructions loaded. No new architecture, frameworks, tables, CLI options, publish, tag or deploy.

Branch: `cloud/release-fixes` in Jini. Confirmed pushed commits:
- 941a2611251d2571b3a7c4db183b790870263680 — initial in-progress report.
- 01f07ef34baaba8d1c4e9ca389eb1931d26f643f — release consistency guard and version policy.
- 0088658fe032118c86ca580e57b6a4a4e64b6400 — prepared archive/version regressions and generated catalogs.

All pushed after `git pull --rebase origin cloud/release-fixes` except initial branch creation (fetched origin first; branch did not exist). No other push destinations.

## Item 1 outcome — already fixed on the requested base

Tovu base `5358aa594fb6e8c0ca107b1106fbf9ae43871d50` already contains the credential retirement from `e327c07c8fc220fa8612ba1eb60c81c28b8a900f`. No product source change was needed.

- `apps/website/src/server/runtime/lifecycle/daemon-supervisor.ts:422` splits daemon/tool credentials out of the child's OS environment and supplies them over private startup IPC.
- `apps/website/src/server/runtime/boot/startup-secrets.ts:18` consumes launch credentials into memory before descendant processes start.
- `apps/website/src/assistant/daemon-access.ts` keeps service capabilities in dedicated holders.
- `apps/website/src/server/inbound/assistant/agent-daemon-scope.ts:166` separates proxy authority and consumes the tool credential before `createNativeAgentRuntime` at lines 201–202. All CLI adapters share this sanitized runtime environment.
- `apps/website/src/server/runtime/composition/modules/assistant-tool-exec.ts:203` requires the stored current live attempt, matching workspace and principal; wire roles are removed and read-only attenuation remains.

Boot behavior is unchanged; no boot refusal was added. Tovu changes only `cloud/reports/release-fixes.md` on `cloud/release-fixes`. Confirmed pushed progress SHAs: `a72678623c4b5bc168eeb596617c4b73e93aee2a`, `8a63b7aed3fb3dfacf63a9f8b165ac6ac50cba22`. The final report commit is available at that branch's head. Its report contains exact setup and test commands.

Tovu verification: the four focused credential files passed **17/17 tests**, and `npm exec -- tsc -p tsconfig.json --noEmit` passed after full Jini rebuild and final relink. No live agent credentials or owner data were used.

## Item 2 outcome

Fixed. Both existing release entrypoints now build/pack the pending set before any upload. The existing guard compares the exact packed catalog against prepared provider/agent archives and immutable npm tarballs for skipped package versions. Upload loops use those already-checked archives, so prepack cannot replace checked bytes after validation. Missing skipped registry versions, other registry failures, selected distribution/catalog version disagreement, manifest drift and byte/digest drift fail before upload. Agent content changed relative to the latest published distribution must strictly advance its independent manifest semver. New plugins and unchanged plugin payloads retain their existing version policy.

Read-only npm checks confirmed current published distributions/catalog are 0.6.23. Their next release is now 0.6.24, including provider export paths and both current catalogs; no old artifact directory was edited. Cloudflare's published payload changed while its inner manifest remained 0.3.1; now 0.3.2. Vercel's payload matches the published 0.6.23 package byte-for-byte and legitimately retains inner version 0.1.0.

The generator received two compatibility changes needed by the release guard import: preserve optional-integrity semantics using object spread (fixes an existing exactOptionalPropertyTypes diagnostic once imported from scripts), and use an async catch/exitCode at the CLI boundary instead of top-level await so Node/tsx root CJS imports work. No vendor plugin is imported/executed by catalog validation.

## Exact changed files

- scripts/check-plugin-packages.ts — new release checks and registry archive reader; existing source/packed checks unchanged.
- scripts/publish-pending.ts — prepare all archives, validate exact catalog/distribution bytes before uploads, upload those archives; read-only --plan retained.
- scripts/publish-all.ts — same preflight via existing release helper, build pending packages first, upload prepared archives; registry lookup failures no longer silently mean unpublished.
- scripts/__tests__/plugin-release-consistency.test.ts — 8 focused cases.
- scripts/__tests__/plugin-release-prepare.test.ts — 2 focused cases.
- packages/plugin-catalog/scripts/generate.ts — optional integrity/CJS CLI compatibility described above.
- packages/plugin-catalog/README.md — release consistency and independent agent-version policy.
- packages/plugin-catalog/package.json and catalog.json — pending 0.6.24 metadata and completed digests.
- packages/provider-plugins/package.json and catalog.json — pending 0.6.24 exports/discovery metadata.
- packages/agent-plugins/package.json — pending 0.6.24 distribution.
- packages/agent-plugins/cloudflare/plugin.json — 0.3.2.
- cloud/reports/release-fixes.md — final job report for both items.

## Validation

All commands source `/workspace/.tovu-build/env.sh`; network permission enabled for subprocess/npm integration checks. Full test suites were not run, as directed. No tests or rules were disabled, skipped, weakened or deleted.

- Failing-first: six new guard tests failed before implementation (`plugin-release-red.log`). Selected-provider/catalog version regression separately failed against previous commit (promise resolved instead of rejecting; `plugin-version-red.log`). Real Node no-upload preflight reproduced unsupported top-level await before the generator CLI fix (`plugin-real-preflight.log` was subsequently replaced by the final green run; the original diagnostic was investigated before the fix). Node import regression now passes.
- `pnpm exec vitest run scripts/__tests__/plugin-release-consistency.test.ts scripts/__tests__/plugin-release-prepare.test.ts scripts/__tests__/plugin-package-gates.test.ts scripts/__tests__/retired-plugin-packages.test.ts scripts/__tests__/agent-plugin-subpaths.test.ts` — 40/40 pass, 5 files. Log `/workspace/work/release-fixes/plugin-final-focused.log`.
- `pnpm --filter @jini-ai/plugin-catalog run test` — 62/62 pass. Log `plugin-catalog-tests.log`.
- `pnpm exec tsc -p scripts/tsconfig.json --noEmit` — pass after final code. Log `plugin-scripts-tsc-final.log`.
- `pnpm --filter @jini-ai/provider-plugins run typecheck` — pass. Log `plugin-provider-tsc.log`.
- `pnpm --filter @jini-ai/agent-plugins run typecheck` — pass. Log `plugin-agent-tsc.log`.
- `pnpm --filter @jini-ai/plugin-catalog run generate` — pass; then actual catalog prepack reran successfully during real preflight.
- `pnpm exec eslint scripts/check-plugin-packages.ts scripts/publish-pending.ts scripts/publish-all.ts packages/plugin-catalog/scripts/generate.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'` —2 preexisting findings only (below), no new/changed function findings. Log `plugin-complexity-final.log`.
- Real no-upload release preflight (after removing only generated agent dist source maps, as existing publish workflow does):
  `npm_config_cache=/workspace/work/release-fixes/npm-cache node --import tsx --input-type=module -` with stdin:
  ```js
  import { preparePluginRelease } from './scripts/publish-pending.ts';
  import { discoverJiniPackages } from './scripts/lib/pack-jini-packages.ts';
  const repoRoot = process.cwd();
  const registry = discoverJiniPackages(repoRoot);
  const archives = await preparePluginRelease({ repoRoot, registry,
    pending: ['@jini-ai/provider-plugins', '@jini-ai/agent-plugins', '@jini-ai/plugin-catalog'] });
  console.log('NO_UPLOAD_PREFLIGHT_OK', [...archives]);
  ```
  — pass, three real 0.6.24 archives prepared and checked, including latest published agent bytes. No upload call. Log `plugin-real-preflight.log`.
- `git diff --check` — pass. Source tree was clean before the final report; existing untracked `packages/plugin-ui-ux-design/` left untouched.

## Findings left open (minor, preexisting; not fixed)

BUG: `catalogEntry` in packages/plugin-catalog/scripts/generate.ts has strict cyclomatic complexity 12 (ceiling 10). AST source body is byte-identical to base; SHA256 9315848a88eba5e5d2c535849d531888265c735817abc3cc70ba9dc6fd949f7c.
BUG: `checkPluginPackages` in scripts/check-plugin-packages.ts has strict cognitive complexity 11 (ceiling 10). AST source body is byte-identical to base; SHA256 b0351c760384c26572f4ba9decfc7b61c77624471b2aac3fda0dd467215072da.
BUG: packages/provider-plugins/catalog.json retains the base's 8 provider entries and omits the newly added formspree provider; the shared plugin-catalog correctly includes all 9 provider source folders. Only versions were advanced in that distribution-local catalog, with no unrelated inventory change.

Proof of unchanged complexity findings: `/workspace/work/release-fixes/plugin-baseline-complexity-proof.log`, generated by TypeScript AST extraction of each function from current file versus `git show origin/cloud/combine:<path>`.

## Self-check

Architecture boundaries retained: unpublished tooling only, existing integrity owner and semver dependency reused; no runtime product or vendor imports. New guard functions each have one job; meaningful branches covered by file fixtures, registry-failure injection, mixed-validity batch, version-staleness case and real archive preflight. New public tooling signature uses required/options objects. Time/space is O(payload bytes + entries), with one cached registry archive per package version and one integrity read per plugin; release-only work, no runtime poll/read/write added. Changed manifest bumps do not force other agent manifests into lockstep. Prepared archives consume disk once per pending package until the release process finishes, matching the existing packer's retained-temp convention.

Both requested items are resolved: item 1 was already implemented and verified; item 2 is implemented and verified. Only the explicitly listed preexisting observations remain. Final report commits are the heads of `cloud/release-fixes` in their respective repositories.

Additional observed warning: Tovu's disposable bundled-plugin fixture logged `charts-recharts` `INTEGRITY_FAILED` in the passing principal integration test. No unrelated fixture/runtime change was made.

Setup verification: `CI=true pnpm install --frozen-lockfile --store-dir /workspace/work/pnpm-store` and `pnpm -r build` in Jini passed, then Tovu contracts/SDK builds and `JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini` passed. Initial stale-output/default-cache attempts were resolved before final validation.
