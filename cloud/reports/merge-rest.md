# merge-rest — complete with findings

Branch: `cloud/combine` in both repositories. No branch omitted. All five fetched source tips are included in the requested order; Jini security-release was already an ancestor. Every other source branch has a separate real merge commit. All source report files are retained (Jini 22; Tovu 25).

Verified delivered checkpoints before this final documentation commit: Jini `0a2f6b8fca0d6ddbf58bbe45fc3f2662030011f5`; Tovu `adab90c5dcdf1a341c44b21abd7d48115101f120`. The final response supplies the subsequent report-commit heads. The delivery tables below identify every delivered first-parent commit preceding this report.

## Source tips and merge decisions

| Branch | Jini source tip | Jini delivery | Tovu source tip | Tovu delivery |
| --- | --- | --- | --- | --- |
| cloud/security-release | `62d35b21390ff4eb0ecc2ab3940964c5d2d9e7a4` | Already included before this job | `b9827ffb10e038c685ed50eecaa54bb3e67ef834` | `eab6981b465fbccf6eb4b9d6788aa06a1e2a471b` |
| cloud/om-chat-2 | `c73e7012e7e9aa62bb6e0bafc61edad367fb4888` | `a9f0c4a8d8783b71463c10701d133c759ccc156a` | `5978d387142f5a75f41512bd0629c962f5874a18` | `a39c41d00cd439ba8369e6f12156e8720f1ea5e5` |
| cloud/tag-b | `da403201dee5060e4139621404ff8a014c9b9537` | `99646dc8da9cdb543451594da199061cded66b30` | `9d316a08105e471b65ced952b9bcf37c6d93809c` | `3433c62662339c77eb85d339ea6c32acc99079a6` |
| cloud/passkeys | `10ed015df3383a147141678241574a9dcfe60904` | `ffda4b00e57bf845aa1e12f0412bb6c6a0b82d2b` | `41a90c02efdb671970914ef850ff1e8f105f2292` | `a50fe68892fb396f399d1d97f2693110ca27e4a4` |
| cloud/commerce | `3e30a2f21726bfc4479be26fab026fa403526ace` | `57f99354d07886a095300393196ca5b216b01c10` | `0cfe8b1f742d7a1205c033a026dcf52ce5f019ae` | `04287c586320772f487797dd1ab7009692ed0af3` |

GitHub compare verified every listed source tip as the merge base of its comparison to the delivered head, with `behind_by=0`. Later report commits are descendants of those verified heads.

## Conflict resolutions and limited follow-up

Jini conflicted only in `packages/agent-plugins/package.json`: kept the formspree/software-engineering exports and metadata alongside commerce and its Node server export, and retained both optional peer declarations and metadata. The lockfile merged automatically and the frozen install passed. Rebuilt artifacts changed one provider server digest in `packages/plugin-catalog/catalog.json`; regeneration was committed. The packed guard then found commerce missing from the shared agent-plugin layout registry. Its existing row/folder test failed on that omission. Registered commerce and retained the existing content/library boundary: moved the two unchanged generic re-export wrappers, including their why comment, from `commerce/server/index.*` to the existing `core/commerce-server.*` library files; the public `@jini-ai/agent-plugins/commerce/server` specifier and Node marker remain unchanged. Its manifest targets now point to the library files, so no extra library export reaches into a plugin content folder. No guard or policy code changed. The existing commerce tests retain import-isolation assertions at the exact new targets, and an added public-import test verifies identity with the generic kernel exports. Regeneration added commerce to the catalog. No package version changed.

Tovu commerce conflicted in these eight files:

- `apps/website/src/features/agent-plugins/bundled-catalog.ts`: retained all selected plugins; the seeded-enabled set remains unchanged, so commerce stays off by default.
- `apps/website/src/platform/db/migrations/checksums.ts`: retained every MFA/passkey and commerce checksum. Migration registries merged additively; no historical checksum was rewritten.
- `apps/website/src/server/inbound/public-http/http/site/render.ts`: retained form rendering and currency formatting imports and behavior.
- `apps/website/src/server/runtime/composition/app.ts` and `deps.ts`: retained existing OAuth/forms/identity/storage wiring and added commerce wiring through the existing composition owners.
- `apps/website/src/server/runtime/composition/provider-contracts.ts`: retained both form and payment validators.
- `apps/website/src/server/runtime/composition/provider-plugins.ts`: retained form-provider retirement/cancellation and shared payment leases, both known contracts, both returned ports, and the payment contract's separate slot type. A compile error exposed the widened slot union at the existing form-only filter; passing its known `form_collection` contract fixes that type without changing behavior.
- `apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts`: retained both added tests and all assertions. The generic validator fixture lacked a valid form port even on the pre-merge first parent. Added its `plan` fixture alongside the payment fixture; hostile-input and valid-port assertions are unchanged.

All assertions and why comments were preserved. Focused integration checks prove commerce-off does not activate payment/catalog storage and that the site's CMS-owned `/products` and `/products/example` paths still reach its CMS. The inactive-bundle check proves default-off plugins expose no tools or prompt injection.

Restored the lost Tovu `99faf59da` work only: site/desktop inventories carry optional `reasoningInModelId`; desktop models retain optional `reasoning`, including an explicit empty list, while unrelated descriptions remain omitted. The desktop DTO declares these fields. One focused regression in each existing test file uses `@jini-ai/agent-runtime/model-selection`'s `modelReasoningOptions` on the projected output to verify narrowing, Default retention, empty/absent distinction and suffix ownership. Both new regressions failed on the missing wiring before the production edits.

This follow-up adds no requests, probes, persistence, polls or timers. Existing inventory response serialization adds only optional model/level metadata, proportional to the supplied level lists. No new framework, option, table, migration or feature was authored beyond the requested merges and inventory gap. Existing source-job cost details remain in their retained reports.

## Verification

Final focused total: **151 distinct passing tests** (inventory 14; selected Tovu conflict/integration 69; catalog 62; registry 3; commerce bundle/public import 3). Repeated runs are not counted twice.

Every command sources `/workspace/.tovu-build/env.sh` first. Test commands need supported network-enabled execution in this container for child-process/local-HTTP harnesses. Default sandbox wrapper-only results are not counted as assertion evidence. No full repository suites ran.

Jini setup and required checks, from `/workspace/Jini`:

```sh
pnpm install --frozen-lockfile --store-dir /workspace/work/merge-rest/pnpm-store
pnpm -r build
pnpm typecheck
pnpm guard:plugins
pnpm guard:plugins:packed
pnpm --filter @jini-ai/plugin-catalog run generate
# After the packaging-only registry/library-target repair:
npm --prefix packages/agent-plugins run build
pnpm exec tsc -p scripts/tsconfig.json --noEmit
pnpm --filter @jini-ai/plugin-catalog exec vitest run __tests__/catalog.test.ts
```

PASS: clean starting-tree and merged recursive builds, all workspace/script typechecks, source plugin guard and catalog generation. PASS: final packed plugin guard after the registry/library-target repair, inspecting the actual release tarballs without weakening any policy.

The catalog packing assertion exceeded its unchanged 5,000 ms budget when run alongside heavy checks. Its first isolated retry passed 61/61 with packing in 683 ms. Registration then increased the metadata cases to 62; the recheck again overlapped compilers and crossed the same packing limit while its other 61 tests passed. After those jobs completed, the final isolated run passed 62/62; the unchanged packing assertion took 701 ms. No test, limit or assertion was changed.

```sh
npm_config_offline=true npm_config_update_notifier=false pnpm --filter @jini-ai/plugin-catalog exec vitest run __tests__/catalog.test.ts --maxWorkers=1 --minWorkers=1
```

Tovu setup and all required typechecks, from `/workspace/Tovu`:

```sh
npm --prefix packages/contracts run build
npm --prefix packages/sdk run build
JINI_PACKAGES_DIR=/workspace/Jini/packages npm run link:jini
npm run typecheck
npm --prefix apps/admin run typecheck
npm --prefix apps/desktop run typecheck
npm --prefix apps/site-chat run typecheck
```

PASS: all four final typechecks, including root E2E and all desktop projects. The final run used the completed Jini build. The initial root attempt encountered old identity build output plus the form-slot type error above; no source workaround for stale output was added. Tovu registry lockfiles and dependency manifests were not changed by linking and no link state was committed.

Packaging regressions and lint, from Jini:

```sh
pnpm exec vitest run scripts/__tests__/agent-plugin-subpaths.test.ts --maxWorkers=1 --minWorkers=1
node --test packages/agent-plugins/commerce/__tests__/bundled-package.test.mjs
pnpm exec eslint --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' scripts/lib/agent-plugin-packages.ts
```

PASS: registry 3/3 (RED missing commerce before the fix), commerce bundle/public-import 3/3, strict registry lint and scripts typecheck. After regeneration/relinking, both default-off named integration checks below were rerun and passed. The affected Tovu root typecheck was rerun after the library target move.

Inventory tests:

```sh
# /workspace/Tovu
node --import tsx --test --test-reporter=tap apps/website/src/assistant/__tests__/agents-owned-runtime.test.ts
# /workspace/Tovu/apps/desktop
node --experimental-test-module-mocks --import ./scripts/resolve-ts-ext.ts --test --test-reporter=tap src/desktop-agent-inventory.test.ts
```

PASS: site 6/6 and desktop 8/8; no skips. Before wiring, the added case in each failed on the missing metadata while the 12 original cases passed.

Conflict-focused commands, from `/workspace/Tovu`:

```sh
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 --test-reporter=tap apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts apps/website/src/platform/db/migrations/__tests__/checksums.test.ts apps/website/src/server/inbound/public-http/http/site/__tests__/render-products.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-composition.unit.test.ts apps/website/src/server/runtime/composition/__tests__/commerce-http.unit.test.ts
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 --test-reporter=tap --test-name-pattern='every bundled plugin not seeded enabled' apps/website/src/server/runtime/composition/__tests__/bundled-inactive-gating.integration.test.ts
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 --test-reporter=tap --test-name-pattern='commerce off: a fresh site' apps/website/src/server/runtime/composition/__tests__/commerce-data-retention.integration.test.ts
# After fixing only the valid form fixture:
TSX_TSCONFIG_PATH=apps/site-chat/tsconfig.json node --import tsx --import ./development/test-support/composed-bundle-env.ts --test --experimental-test-module-mocks --test-concurrency=1 --test-reporter=tap apps/website/src/server/runtime/composition/__tests__/provider-plugins.unit.test.ts
```

PASS: all 69 distinct selected tests have passing evidence. The first five-file run was 66/67 with the invalid form fixture; the corrected provider file passed 46/46. The other four files passed 21/21 (checksums 4, products 10, composition 4, HTTP 3), and both named integration cases passed 1/1. No disabled/skipped tests, lowered limits or weakened assertions.

## Complexity and minor findings

Strict lint commands from Tovu:

```sh
node node_modules/eslint/bin/eslint.js --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/features/agent-plugins/bundled-catalog.ts apps/website/src/platform/db/migrations/checksums.ts apps/website/src/server/inbound/public-http/http/site/render.ts apps/website/src/server/runtime/composition/app.ts apps/website/src/server/runtime/composition/deps.ts apps/website/src/server/runtime/composition/provider-contracts.ts apps/website/src/server/runtime/composition/provider-plugins.ts apps/website/src/assistant/agents.ts
node node_modules/eslint/bin/eslint.js --no-inline-config --rule '{"complexity":["error",9],"sonarjs/cognitive-complexity":["error",9]}' apps/desktop/src/desktop-agent-inventory.ts apps/desktop/src/contracts/runtime-inventory.ts
node node_modules/eslint/bin/eslint.js --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}' apps/website/src/server/runtime/composition/provider-plugins.ts apps/website/src/server/runtime/composition/provider-contracts.ts apps/website/src/assistant/agents.ts
```

PASS: final inventory and resolved non-composition-root code. No rule/config/disable changes. Jini's only conflicted source was a JSON manifest, checked by the source and packed plugin guards.

FINDING: composition roots remain above the ceiling: `createRouteDeps` 11 and `createApp` 11, both also 11 on the starting tree; `composeSiteRouteDeps` is 21 cyclomatic / 21 cognitive after combination, versus starting 18/18 and commerce source 17/13. Both branches' behavior is retained under the explicit merge-only/no-refactor scope. Measurements used the same strict rules and stdin filename against `abead5249` and `origin/cloud/commerce`; no limits were raised. The commands were:

```sh
git show abead5249:apps/website/src/server/runtime/composition/deps.ts | node node_modules/eslint/bin/eslint.js --stdin --stdin-filename apps/website/src/server/runtime/composition/deps.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'
git show origin/cloud/commerce:apps/website/src/server/runtime/composition/deps.ts | node node_modules/eslint/bin/eslint.js --stdin --stdin-filename apps/website/src/server/runtime/composition/deps.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'
git show abead5249:apps/website/src/server/runtime/composition/app.ts | node node_modules/eslint/bin/eslint.js --stdin --stdin-filename apps/website/src/server/runtime/composition/app.ts --no-inline-config --rule '{"complexity":["error",10],"sonarjs/cognitive-complexity":["error",10]}'
```
FINDING: inherited nested-assignment/nested-function warnings remain.
FINDING: full Jini range whitespace check reports `packages/chat/src/react/styles/chat-settings.css:149` (blank EOF) and `packages/commerce/src/catalog/__tests__/unit/repo.vitest.test.ts:272` (trailing whitespace), inherited from source branches. Listed without cleanup. Tovu's full range and both working diffs pass whitespace checks.
FINDING: pre-existing untracked Jini `packages/plugin-ui-ux-design/` payload is untouched and uncommitted. The sole test-created Tovu form-protection marker was removed; Tovu is clean.

Whitespace commands:

```sh
git -C /workspace/Jini diff 3a86f98ba..HEAD --check
git -C /workspace/Tovu diff abead5249..HEAD --check
```

## Secret scan and delivery

Gitleaks 8.28.0 release checksum verified. Final local ranges cover the same content trees as the connector-delivered history; each uploaded blob and tree SHA was verified. No credential values were printed or saved.

```sh
# /workspace/Jini
/workspace/work/merge-rest/tools/gitleaks git . --config .gitleaks.toml --log-opts='3a86f98ba..HEAD --full-history -m' --redact --no-banner --report-format json --report-path /workspace/work/merge-rest/jini-secrets-final.json
# /workspace/Tovu
/workspace/work/merge-rest/tools/gitleaks git . --config .gitleaks.toml --log-opts='abead5249..HEAD --full-history -m' --redact --no-banner --report-format json --report-path /workspace/work/merge-rest/tovu-secrets-final.json
```

The source-range scans return exit1 with one Jini detection and three Tovu historical detections, all reviewed public RFC 6238 synthetic TOTP vectors in test fixtures (`totp-adapter.test.ts` and `owner-mfa-login.unit.test.ts`). No operational credential was found. Rules and allowlists are unchanged; findings remain unsuppressed. The final documentation-only ranges are rescanned after the report commit.

Initial native pushes used `git pull --rebase --ff-only origin cloud/combine` immediately before `git push origin HEAD:refs/heads/cloud/combine` (Tovu used the explicitly authorized `--no-verify`). Later CLI authentication was rejected. The connected GitHub app delivered the ordered merge trees/commits with `update_ref(branch_name="cloud/combine", expected_sha=<observed head>, force=false)`. Every tree matched the local tested tree; each update was a leased fast-forward. Connector metadata produces different commit IDs from local commit IDs. No divergent local history was force-pushed. Local upstream refs could not be refreshed through the rejected CLI credential; the remote heads below and the final response are authoritative.

### Jini

| Delivered SHA | Commit |
| --- | --- |
| `a3516383e638b0d6bf8e0649e732590273444649` | docs: record integration scope and starting points |
| `a9f0c4a8d8783b71463c10701d133c759ccc156a` | Merge chat updates into cloud/combine |
| `99646dc8da9cdb543451594da199061cded66b30` | Merge shared control updates into cloud/combine |
| `ffda4b00e57bf845aa1e12f0412bb6c6a0b82d2b` | Merge identity updates into cloud/combine |
| `57f99354d07886a095300393196ca5b216b01c10` | Merge commerce updates into cloud/combine |
| `7932eef2c6589cf1b8f066c3741cdfd973936e03` | docs: record merge checkpoint and conflict decisions |
| `5505b5ea1036ede5116b865ed5f7612a8caf7306` | chore(plugins): regenerate combined catalog digest |
| `894fd30a25f07f6771fcd9eb7ac0f3c1f7879713` | docs: record integration verification progress |
| `c52e89f4456a5bcb9956a7e2b3aa8ea2e1d23046` | docs: record completed type and focused checks |
| `e9aff14ae9df8caeea0ac352af6e8089c483db71` | fix(packaging): register commerce and retain its public server entry |
| `0a2f6b8fca0d6ddbf58bbe45fc3f2662030011f5` | chore(plugins): include registered commerce metadata |

### Tovu

| Delivered SHA | Commit |
| --- | --- |
| `a5be70ca8b74b56f5e4555a13b6eac720dfda357` | docs: record integration scope and starting points |
| `eab6981b465fbccf6eb4b9d6788aa06a1e2a471b` | Merge release updates into cloud/combine |
| `a39c41d00cd439ba8369e6f12156e8720f1ea5e5` | Merge chat updates into cloud/combine |
| `3433c62662339c77eb85d339ea6c32acc99079a6` | Merge shared control updates into cloud/combine |
| `a50fe68892fb396f399d1d97f2693110ca27e4a4` | Merge identity updates into cloud/combine |
| `04287c586320772f487797dd1ab7009692ed0af3` | Merge commerce updates into cloud/combine |
| `af3a0a56c8064cc81e7250053507d75fc6a2fd24` | docs: record merge checkpoint and conflict decisions |
| `fafae947c8e1f16768fe1c011e0e68ae46ac67ef` | fix(chat): preserve inventory reasoning metadata |
| `ddf8d65050ca24fb732cc73e6b43547ce2a9dd69` | fix(providers): retain form contract after combining slots |
| `2c29cb6f54bd0095845f16bb240a1ef16f2c18a7` | test(providers): retain valid fixtures for both contracts |
| `4c793bc5dc3fb400e4f119fbe26b38a18b4569ae` | docs: record integration verification progress |
| `adab90c5dcdf1a341c44b21abd7d48115101f120` | docs: record completed type and focused checks |


No main or other branch update, force-push, tag, deployment, npm publication, version bump, live payment or owner-data operation. Full suites remain the next job. Architecture/scope review: existing engine and host boundaries retained; only requested metadata wiring and minimal merge repairs added. No tests, assertions, why comments or rules were removed or weakened.
