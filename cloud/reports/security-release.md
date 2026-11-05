# security-release — approved follow-up

Status: requested follow-up complete. Earlier verification exceptions remain recorded below. No publication performed.

Only `cloud/security-release` is pushed in Jini and Tovu. No main push, force push, publication, tag or deployment.

## Integration

Merged `origin/cloud/om-chat` in both repositories. The requested Jini `origin/integ/night-1105` and Tovu `origin/night-1105` are included through that ancestry; their explicit merge commands returned already up to date. All four ancestry checks pass.

Conflicts were limited to the Jini subprocess test helper and Tovu credential store. Resolutions retain all assertions, the rationale comment and existing defensive guards. No test, rule, timeout or threshold was weakened. Merge-preserving pull/rebase retained the integration history. Tovu pushes used the documented hook bypass to honor focused tests only; no hook file was changed.

The Jini merge changes only **agent-plugins and daemon**, both already in the release set. **Additional package bumps: none.** All 12 remain at **0.6.23**. Rebuilt all Jini packages, regenerated the catalog, and relinked Tovu. Tovu lockfiles remain deferred until publication.

## Final publish list

- `@jini-ai/agent-plugins`
- `@jini-ai/agent-runtime`
- `@jini-ai/agentic`
- `@jini-ai/chat`
- `@jini-ai/core`
- `@jini-ai/daemon`
- `@jini-ai/mcp`
- `@jini-ai/platform`
- `@jini-ai/ui`
- `@jini-ai/ui-kit`
- `@jini-ai/plugin-catalog`
- `@jini-ai/provider-plugins`

## Follow-up validation

- Full Jini recursive build: PASS.
- Jini complete typecheck and Tovu root, desktop, admin and site-chat typechecks: PASS.
- Focused tests: **197 PASS** — Jini daemon 40; conflict-related helper 2; Tovu site 13; selected desktop integration 1; desktop tools 10; conflict-related store/project scope 131.
- An incoming test-query typing error was corrected without changing its exact matching or assertions; its additional focused file has **45 PASS** and the fresh admin typecheck passes. Total focused follow-up tests: **242 PASS**.
- Changed production paths at the required complexity ceilings: no errors; existing warnings retained.
- `guard:plugins` and `guard:plugins:packed`: PASS.
- Packed catalog: **38 entries / 538 exact file digests PASS**, including all release versions and Tovu floors.
- Expanded final commit-range secret scans: PASS, no leaks. `git diff --check`: PASS.

Only the requested focused tests were run in this follow-up. Existing unrelated admin timeout, publication-dependent lockfile alignment and inherited lint debt were not represented as fixed or green. Earlier detailed evidence is preserved in the [Jini prior report](https://github.com/AINSEP/Jini/blob/6f9799532db208cdf2e977b5ba63c1aaf02177e6/cloud/reports/security-release.md) and [Tovu prior report](https://github.com/AINSEP/Tovu/blob/3cf74191925aac83ee78f425396f7039a1b5decc/cloud/reports/security-release.md).

BUG — Earlier repeated admin test timeout remains unresolved; not retried here.

BUG — Earlier inherited strict-lint findings remain outside the changed production paths.

OPEN — Registry publication and subsequent Tovu lockfile refresh remain coordinator work.

No additional framework, schema, polling or persistent state was introduced by the merge resolutions. Generic behavior remains in Jini; Tovu retains product wiring. The site/desktop focused tests verify the merged compositions; live model execution remains outside the verified evidence.

## Exact commands

Commands use `source /workspace/.tovu-build/env.sh` first. Working directory is indicated for each group.

```sh
# /workspace/Jini
pnpm -r build
pnpm --filter @jini-ai/plugin-catalog run generate
pnpm guard:plugins
pnpm guard:plugins:packed
python /workspace/work/security-release/verify-packed-catalog.py
# /workspace/Tovu
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
```

```sh
# /workspace/Jini/packages/agent-plugins
node --test __tests__/vitest-compat.test.mjs
```

```sh
# /workspace/Tovu
node --import tsx --experimental-test-module-mocks --test --test-isolation=none apps/website/src/server/inbound/assistant/__tests__/agent-daemon-server.typed-tools.integration.test.ts
```

```sh
# /workspace/Tovu/apps/desktop
node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-isolation=none '--test-name-pattern=runtime registers the built tools' src/desktop-agent.test.ts
```

```sh
# /workspace/Tovu/apps/desktop
node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-isolation=none src/desktop-agent-tools.test.ts
```

```sh
# /workspace/Jini
npm --prefix packages/daemon test -- src/agent-executor/codex/__tests__/home-config.test.ts src/agent-executor/codex/__tests__/home-http-staging.test.ts src/agent-executor/codex/__tests__/home-cleanup.test.ts src/agent-executor/__tests__/http-mcp-launch.integration.test.ts --maxWorkers=1 --minWorkers=1
```

```sh
# /workspace/Tovu
node --import tsx --test --test-concurrency=1 apps/website/src/features/deployments/publish-credentials/__tests__/store.unit.test.ts apps/website/src/features/deployments/publish-credentials/__tests__/project-scope.unit.test.ts
```

```sh
# /workspace/Tovu
node_modules/.bin/tsc -p tsconfig.json --noEmit
```

```sh
# /workspace/Tovu
npm --prefix apps/desktop run typecheck
```

```sh
# /workspace/Tovu/apps/admin
npm run typecheck
```

```sh
# /workspace/Tovu
npm --prefix apps/site-chat run typecheck
```

```sh
# /workspace/Jini
pnpm typecheck
```

```sh
# /workspace/Tovu/apps/admin
node_modules/.bin/vitest run src/features/skills/__tests__/skill-install-i18n.unit.test.tsx --maxWorkers=1 --pool=threads
```

Strict lint used `--no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'` on the three merged daemon production files and the Tovu site composition/store. Desktop composition used both ceilings at 9. No suppression or debt baseline changed.

Final secret scans, after the report commit:

```sh
# /workspace/Jini
/workspace/work/security-release/tools/gitleaks git . --config .gitleaks.toml --log-opts='651571c5f..HEAD' --redact
# /workspace/Tovu
/workspace/work/security-release/tools/gitleaks git . --log-opts='e327c07c8..HEAD' --redact
```

## Inputs and pushed commits

Jini inputs (prior tip, om-chat, night):

- `6f9799532db208cdf2e977b5ba63c1aaf02177e6`
- `fc5dbec699c170a03137a1926da692c72c42e65f`
- `a9b1d949ffb0363ddaa3df2278e8a3fcf034add5`

Jini follow-up commits on `cloud/security-release`:

- `5edda64ef538fd9a5747caf78fa85b35b781cea8`
- `c4c50e2406a7b9d50ba3d57467a20dca76ea1043`
- `78329edf0d5bec53d772b12935cc9e0f4068c400`
- `a30742e1a946a13b72eeda549049c361b022ae7b`

Tovu inputs (prior tip, om-chat, night):

- `3cf74191925aac83ee78f425396f7039a1b5decc`
- `74beba62dd4b43c4e8104c251ed43f98e63bd21e`
- `ce99e7eba807b91d12926fe5889a9958032bc398`

Tovu follow-up commits on `cloud/security-release`:

- `6422c562d348b4dfbf88b5278a877a663d08a25b`
- `d93ec0a53acfe899052af0488f9769e56027a094`
- `8876cad02ad9b0a10c3e8adba6974af0cc7ab75a`
- `aa172f97160602d237b36bd67be341b11237e52e`
- `98d6ea8ed3e12ecdcd9da6d6d341c50d5e0b7b39`

These are the validated tips before the final documentation-only report commit. The final response gives the final report-commit SHAs, and this file is present at those heads. Earlier pushed commit inventories remain in the prior reports. Raw evidence is under `/workspace/work/security-release/merge-followup` and `followup-*.log`.
